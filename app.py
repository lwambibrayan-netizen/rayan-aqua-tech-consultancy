import os,sys,json,math,hashlib,urllib.request,uuid,traceback
from http.server import BaseHTTPRequestHandler,HTTPServer
from urllib.parse import urlparse,parse_qs
os.environ.setdefault("QT_QPA_PLATFORM","offscreen")
os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN","EMPTY_DIR")
sys.path.extend(["/usr/share/qgis/python","/usr/share/qgis/python/plugins"])
from qgis.core import QgsApplication,QgsCoordinateReferenceSystem,QgsCoordinateTransform,QgsPointXY,QgsGeometry,QgsRectangle,QgsProject
from osgeo import gdal,ogr,osr
import numpy as np
ROOT="/io/data/processing"; os.makedirs(ROOT,exist_ok=True)
QgsApplication.setPrefixPath("/usr",True)
app=QgsApplication([],False); app.initQgis()
from processing.core.Processing import Processing
Processing.initialize()
gdal.UseExceptions()
def send(h,code,obj):
 raw=json.dumps(obj,allow_nan=False).encode()
 h.send_response(code); h.send_header("Content-Type","application/json"); h.send_header("Content-Length",str(len(raw))); h.end_headers(); h.wfile.write(raw)
def outdir(user,project):
 key=hashlib.sha256((user+"|"+project).encode()).hexdigest()[:32]
 p=os.path.join(ROOT,key); os.makedirs(p,exist_ok=True); return p
def persist_output(folder,operation,payload,fmt="application/json",file_name=None,metadata=None):
 output_id=uuid.uuid4().hex[:16]
 record={"id":output_id,"operation":operation,"created_at":__import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),"format":fmt,"metadata":metadata or {}}
 if payload is not None: record["data"]=payload
 if file_name: record["file_name"]=os.path.basename(file_name)
 path=os.path.join(folder,"output_"+output_id+".json")
 with open(path,"w",encoding="utf-8") as stream: json.dump(record,stream,separators=(",",":"),allow_nan=False)
 return {"id":output_id,"operation":operation,"format":fmt,"created_at":record["created_at"],"saved":True}
def check_bbox(b):
 w,s,e,n=[float(b[k]) for k in ("west","south","east","north")]
 if not all(map(math.isfinite,[w,s,e,n])) or w>=e or s>=n or w< -180 or e>180 or s< -85 or n>85 or e-w>1.5 or n-s>1.5:
  raise ValueError("Use a valid WGS84 bounding box no larger than 1.5 degrees per side.")
 return w,s,e,n
def tile_url(y,x,res):
 ns=("S" if y<0 else "N")+("%02d"%abs(y))+"_00"
 ew=("W" if x<0 else "E")+("%03d"%abs(x))+"_00"
 tag="COG_10" if res==30 else "COG_30"
 bucket="copernicus-dem-30m" if res==30 else "copernicus-dem-90m"
 stem="Copernicus_DSM_"+tag+"_"+ns+"_"+ew+"_DEM"
 return "https://"+bucket+".s3.amazonaws.com/"+stem+"/"+stem+".tif"
def exists(url):
 try:
  req=urllib.request.Request(url,method="HEAD",headers={"User-Agent":"RayanAqua-PyQGIS/1.0"})
  with urllib.request.urlopen(req,timeout=15) as r:return r.status==200
 except Exception:return False
def utm(lon,lat):
 zone=max(1,min(60,int((lon+180)//6)+1))
 return (32700 if lat<0 else 32600)+zone
def dem_for(b,folder):
 w,s,e,n=check_bbox(b)
 tiles=[(y,x) for y in range(math.floor(s),math.floor(n)+1) for x in range(math.floor(w),math.floor(e)+1)]
 if len(tiles)>9:raise ValueError("Split this analysis into smaller terrain areas.")
 sources=[]; res=30
 for y,x in tiles:
  u=tile_url(y,x,30)
  if not exists(u):
   u=tile_url(y,x,90); res=90
   if not exists(u):raise RuntimeError("No public Copernicus DEM tile for "+str((y,x))+". Upload a local GeoTIFF DEM for this area.")
  sources.append("/vsicurl/"+u)
 epsg=utm((w+e)/2,(s+n)/2)
 tr=QgsCoordinateTransform(QgsCoordinateReferenceSystem("EPSG:4326"),QgsCoordinateReferenceSystem("EPSG:"+str(epsg)),QgsProject.instance())
 r=tr.transformBoundingBox(QgsRectangle(w,s,e,n))
 vrtpath="/vsimem/ra_"+uuid.uuid4().hex+".vrt"; vrt=gdal.BuildVRT(vrtpath,sources)
 if vrt is None:raise RuntimeError("GDAL could not read the Copernicus DEM tiles.")
 path=os.path.join(folder,"dem_"+uuid.uuid4().hex+".tif")
 ds=gdal.Warp(path,vrt,dstSRS="EPSG:"+str(epsg),outputBounds=(r.xMinimum(),r.yMinimum(),r.xMaximum(),r.yMaximum()),outputBoundsSRS="EPSG:"+str(epsg),xRes=res,yRes=res,resampleAlg="bilinear",outputType=gdal.GDT_Float32,dstNodata=-9999,multithread=True)
 vrt=None; gdal.Unlink(vrtpath)
 if ds is None or ds.RasterXSize<2 or ds.RasterYSize<2:raise RuntimeError("DEM clipping and UTM reprojection failed.")
 ds=None
 return path,res,epsg
def sample(ds,x,y):
 gt=ds.GetGeoTransform(); col=int((x-gt[0])/gt[1]); row=int((y-gt[3])/gt[5])
 if col<0 or row<0 or col>=ds.RasterXSize or row>=ds.RasterYSize:return None
 a=ds.GetRasterBand(1).ReadAsArray(col,row,1,1)
 if a is None:return None
 z=float(a[0,0]); return z if math.isfinite(z) and z>-9990 else None
def terrain_grid(path,max_dimension=64):
 if not isinstance(max_dimension,int) or max_dimension<16 or max_dimension>96:raise ValueError("Terrain grid maxDimension must be an integer from 16 to 96.")
 source=gdal.Open(path)
 if source is None:raise RuntimeError("Terrain DEM could not be opened for CAD surface export.")
 width,height=source.RasterXSize,source.RasterYSize
 scale=max(1.0,max(width,height)/max_dimension)
 out_width=max(2,min(max_dimension,int(round(width/scale))))
 out_height=max(2,min(max_dimension,int(round(height/scale))))
 sampled=gdal.Warp("",source,format="MEM",width=out_width,height=out_height,resampleAlg="bilinear",outputType=gdal.GDT_Float32,dstNodata=-9999)
 if sampled is None:raise RuntimeError("GDAL could not resample the terrain DEM for CAD.")
 band=sampled.GetRasterBand(1); values=band.ReadAsArray().astype("float64"); nodata=band.GetNoDataValue()
 valid=np.isfinite(values)
 if nodata is not None:valid &= values!=nodata
 values=np.where(valid,values,np.nan)[::-1,:]
 gt=sampled.GetGeoTransform()
 if gt[1]<=0 or gt[5]>=0:raise RuntimeError("Terrain grid requires a north-up projected DEM with positive X and negative Y pixel spacing.")
 elevations=[None if not math.isfinite(float(v)) else round(float(v),3) for v in values.reshape(-1)]
 if sum(v is not None for v in elevations)<4:raise RuntimeError("Terrain DEM has fewer than four valid elevation samples.")
 grid={"width":out_width,"height":out_height,"originX":round(float(gt[0]+gt[1]*0.5),3),"originY":round(float(gt[3]+gt[5]*(out_height-0.5)),3),"cellSizeX":round(float(gt[1]),3),"cellSizeY":round(float(-gt[5]),3),"elevationsM":elevations,"crs":"UNASSIGNED","verticalDatum":"EGM2008 (Copernicus DEM)"}
 sampled=None; source=None
 if grid["crs"]=="UNASSIGNED":raise RuntimeError("Terrain DEM CRS must be assigned by the processing operation.")
 return grid
def profile(ds,coords,spacing):
 if not isinstance(coords,list) or len(coords)<2 or len(coords)>20000:raise ValueError("Each route needs at least two coordinate vertices.")
 if spacing<5 or spacing>500:raise ValueError("Profile spacing must be between 5 m and 500 m.")
 target=QgsCoordinateReferenceSystem(); target.createFromWkt(ds.GetProjection())
 tr=QgsCoordinateTransform(QgsCoordinateReferenceSystem("EPSG:4326"),target,QgsProject.instance())
 points=[]
 for pair in coords:
  lon,lat=float(pair[0]),float(pair[1])
  if not math.isfinite(lon+lat) or abs(lon)>180 or abs(lat)>85:raise ValueError("Invalid route coordinate.")
  points.append(tr.transform(QgsPointXY(lon,lat)))
 geom=QgsGeometry.fromPolylineXY(points); length=geom.length()
 if length<=0:raise ValueError("Pipeline route has zero length.")
 distances=list(np.arange(0,length,spacing))
 if not distances or length-distances[-1]>.01:distances.append(length)
 rows=[]
 for d in distances:
  p=geom.interpolate(float(d)).asPoint(); z=sample(ds,p.x(),p.y())
  rows.append({"chainage_m":round(float(d),2),"elevation_m":None if z is None else round(z,2)})
 valid=[r["elevation_m"] for r in rows if r["elevation_m"] is not None]
 if len(valid)<2:raise RuntimeError("Insufficient valid DEM samples along the route.")
 up=down=0.0; grades=[]
 for a,b in zip(rows,rows[1:]):
  if a["elevation_m"] is None or b["elevation_m"] is None:continue
  dz=b["elevation_m"]-a["elevation_m"]; up+=max(0,dz); down+=max(0,-dz)
  dx=b["chainage_m"]-a["chainage_m"]
  if dx:grades.append(dz/dx*100)
 return {"length_m":round(length,2),"sample_spacing_m":spacing,"sample_count":len(rows),"valid_sample_count":len(valid),
 "minimum_elevation_m":round(min(valid),2),"maximum_elevation_m":round(max(valid),2),
 "start_elevation_m":rows[0]["elevation_m"],"end_elevation_m":rows[-1]["elevation_m"],
 "net_elevation_change_m":round(valid[-1]-valid[0],2),"total_ascent_m":round(up,2),"total_descent_m":round(down,2),
 "maximum_uphill_grade_percent":round(max([g for g in grades if g>0],default=0),2),
 "maximum_downhill_grade_percent":round(min([g for g in grades if g<0],default=0),2),"profile":rows}
def contour_geojson(path,interval,res):
 if interval<=0 or interval>100:raise ValueError("Contour interval must be between 0 and 100 metres.")
 dem=gdal.Open(path); mem=ogr.GetDriverByName("Memory").CreateDataSource("contours")
 src=osr.SpatialReference(); src.ImportFromWkt(dem.GetProjection())
 layer=mem.CreateLayer("contours",src,ogr.wkbLineString)
 layer.CreateField(ogr.FieldDefn("ID",ogr.OFTInteger)); layer.CreateField(ogr.FieldDefn("ELEV_M",ogr.OFTReal))
 gdal.ContourGenerate(dem.GetRasterBand(1),float(interval),0.0,[],0,-9999,layer,0,1)
 dst=osr.SpatialReference(); dst.ImportFromEPSG(4326); ct=osr.CoordinateTransformation(src,dst)
 features=[]; layer.ResetReading()
 while True:
  f=layer.GetNextFeature()
  if f is None:break
  g=f.GetGeometryRef().Clone(); g.Transform(ct); z=float(f.GetField("ELEV_M"))
  features.append({"type":"Feature","id":int(f.GetField("ID")),"geometry":json.loads(g.ExportToJson()),
   "properties":{"name":"Contour "+str(z)+" m","category":"Contour","contour_elevation_m":z,"elevation_source":"Copernicus DEM GLO-"+str(res)}})
 mem=None; dem=None
 return {"type":"FeatureCollection","features":features}
def slope_stats(path):
 dem=gdal.Open(path); target=os.path.join(os.path.dirname(path),"slope_"+uuid.uuid4().hex+".tif")
 ds=gdal.DEMProcessing(target,dem,"slope",computeEdges=True,slopeFormat="degree")
 if ds is None:raise RuntimeError("GDAL slope calculation failed.")
 band=ds.GetRasterBand(1); a=band.ReadAsArray().astype("float64"); nd=band.GetNoDataValue()
 valid=np.isfinite(a)
 if nd is not None:valid &= a!=nd
 v=a[valid]
 if not v.size:raise RuntimeError("No valid slope cells.")
 pct=lambda mask:round(float(np.mean(mask)*100),2)
 result={"cell_count":int(v.size),"minimum_slope_degrees":round(float(v.min()),2),"maximum_slope_degrees":round(float(v.max()),2),"mean_slope_degrees":round(float(v.mean()),2),
 "slope_classes_percent":{"0_to_2":pct((v>=0)&(v<2)),"2_to_5":pct((v>=2)&(v<5)),"5_to_10":pct((v>=5)&(v<10)),"10_to_20":pct((v>=10)&(v<20)),"above_20":pct(v>=20)}}
 ds=None; dem=None
 result["raster_file"]=os.path.basename(target)
 ds=None; dem=None
 return result

def least_cost_route(body,folder):
 start=body.get("start"); end=body.get("end")
 if not isinstance(start,list) or len(start)<2 or not isinstance(end,list) or len(end)<2: raise ValueError("Provide start and end as [longitude, latitude].")
 sx,sy=float(start[0]),float(start[1]); ex,ey=float(end[0]),float(end[1])
 if not all(map(math.isfinite,[sx,sy,ex,ey])) or max(abs(sx),abs(ex))>180 or max(abs(sy),abs(ey))>85: raise ValueError("Invalid route start or end coordinate.")
 if math.hypot((ex-sx)*111320*math.cos(math.radians((sy+ey)/2)),(ey-sy)*111320)<1: raise ValueError("Choose start and end points at least 1 m apart.")
 pad=max(0.003,math.hypot(ex-sx,ey-sy)*0.25)
 bb={"west":min(sx,ex)-pad,"south":min(sy,ey)-pad,"east":max(sx,ex)+pad,"north":max(sy,ey)+pad}
 dem,res,epsg=dem_for(bb,folder); src=gdal.Open(dem); band=src.GetRasterBand(1); arr=band.ReadAsArray().astype("float64")
 nd=band.GetNoDataValue(); valid=np.isfinite(arr)
 if nd is not None: valid &= arr!=nd
 gt=src.GetGeoTransform()
 wgs=osr.SpatialReference(); wgs.ImportFromEPSG(4326)
 target=osr.SpatialReference(); target.ImportFromEPSG(int(epsg))
 to_dem=osr.CoordinateTransformation(wgs,target); to_wgs=osr.CoordinateTransformation(target,wgs)
 def rc(lon,lat):
  x,y,_=to_dem.TransformPoint(lon,lat)
  return int((y-gt[3])/gt[5]),int((x-gt[0])/gt[1])
 sr,sc=rc(sx,sy); tr,tc=rc(ex,ey)
 rows,cols=arr.shape
 if not(0<=sr<rows and 0<=sc<cols and 0<=tr<rows and 0<=tc<cols): raise ValueError("Route endpoints fall outside the downloaded DEM coverage.")
 grid_n=max(41,min(201,int(body.get("gridSize",121))))
 rlo=max(0,min(sr,tr)-max(8,int(abs(tr-sr)*0.25))); rhi=min(rows-1,max(sr,tr)+max(8,int(abs(tr-sr)*0.25)))
 clo=max(0,min(sc,tc)-max(8,int(abs(tc-sc)*0.25))); chi=min(cols-1,max(sc,tc)+max(8,int(abs(tc-sc)*0.25)))
 rr=np.unique(np.rint(np.linspace(rlo,rhi,min(grid_n,max(2,rhi-rlo+1)))).astype(int))
 cc=np.unique(np.rint(np.linspace(clo,chi,min(grid_n,max(2,chi-clo+1)))).astype(int))
 if len(rr)<2 or len(cc)<2: raise ValueError("DEM coverage is too small for route analysis.")
 sidx=(int(np.argmin(abs(rr-sr))),int(np.argmin(abs(cc-sc))))
 tidx=(int(np.argmin(abs(rr-tr))),int(np.argmin(abs(cc-tc))))
 elev=arr[np.ix_(rr,cc)]; ok=valid[np.ix_(rr,cc)]
 if not ok[sidx] or not ok[tidx]: raise ValueError("A route endpoint has no valid DEM elevation.")
 obs=[]
 for f in body.get("obstacles",[]) if isinstance(body.get("obstacles",[]),list) else []:
  geom=f.get("geometry",f) if isinstance(f,dict) else None
  if geom and geom.get("type")=="Polygon":
   g=ogr.CreateGeometryFromJson(json.dumps(geom))
   if g: obs.append(g)
 if obs:
  for i,r in enumerate(rr):
   for j,c in enumerate(cc):
    if (i,j)==sidx or (i,j)==tidx: continue
    x=gt[0]+(c+0.5)*gt[1]; y=gt[3]+(r+0.5)*gt[5]
    lon,lat,_=to_wgs.TransformPoint(x,y); pt=ogr.Geometry(ogr.wkbPoint); pt.AddPoint(lon,lat)
    if any(g.Contains(pt) for g in obs): ok[i,j]=False
 weight=float(body.get("slopeWeight",8))
 if not math.isfinite(weight) or weight<0 or weight>1000: raise ValueError("Slope weight must be from 0 to 1000.")
 import heapq
 dist={sidx:0.0}; prev={}; heap=[(0.0,sidx)]; dirs=[(-1,-1),(-1,0),(-1,1),(0,-1),(0,1),(1,-1),(1,0),(1,1)]
 while heap:
  cost,u=heapq.heappop(heap)
  if cost!=dist.get(u): continue
  if u==tidx: break
  i,j=u
  for di,dj in dirs:
   ni,nj=i+di,j+dj
   if ni<0 or nj<0 or ni>=len(rr) or nj>=len(cc) or not ok[ni,nj]: continue
   dz=abs(float(elev[ni,nj]-elev[i,j])); dx=abs(float(gt[1])*(cc[nj]-cc[j])); dy=abs(float(gt[5])*(rr[ni]-rr[i]))
   horizontal=math.hypot(dx,dy)
   if horizontal<=0: continue
   nc=cost+horizontal*(1+weight*dz/horizontal); v=(ni,nj)
   if nc<dist.get(v,float("inf")): dist[v]=nc; prev[v]=u; heapq.heappush(heap,(nc,v))
 if tidx not in dist: raise ValueError("No route found through valid DEM cells; widen the corridor or review obstacles.")
 path=[tidx]
 while path[-1]!=sidx:path.append(prev[path[-1]])
 path.reverse(); coords=[]; length=0.0; ascent=0.0; max_grade=0.0
 for k,(i,j) in enumerate(path):
  x=gt[0]+(cc[j]+0.5)*gt[1]; y=gt[3]+(rr[i]+0.5)*gt[5]
  lon,lat,_=to_wgs.TransformPoint(x,y); coords.append([round(lon,7),round(lat,7)])
  if k:
   pi,pj=path[k-1]; d=math.hypot(float(gt[1])*(cc[j]-cc[pj]),float(gt[5])*(rr[i]-rr[pi]))
   dz=float(elev[i,j]-elev[pi,pj]); length+=d; ascent+=max(0,dz); max_grade=max(max_grade,abs(dz)/max(d,1e-9)*100)
 coords[0]=[sx,sy]; coords[-1]=[ex,ey]
 return {"coordinates":coords,"length_m":round(length,2),"terrain_cost":round(dist[tidx],2),"total_ascent_m":round(ascent,2),"max_slope_percent":round(max_grade,2),"dem_source":"Copernicus DEM GLO-"+str(res),"dem_resolution_m":res,"grid_rows":len(rr),"grid_columns":len(cc),"routing_method":"PyQGIS/GDAL DEM Dijkstra","slope_weight":weight}

class Handler(BaseHTTPRequestHandler):
 def log_message(self,fmt,*args):print("PYQGIS "+(fmt%args),flush=True)
 def do_GET(self):
  path=urlparse(self.path).path
  if path=="/terrain/outputs" or path.startswith("/terrain/outputs/"):
   if self.headers.get("Authorization","")!="Bearer "+os.environ.get("PYQGIS_API_KEY",""):return send(self,401,{"error":"Unauthorized"})
   q=parse_qs(urlparse(self.path).query); user=q.get("userId",[""])[0]; project=q.get("projectId",[""])[0]
   if not user or not project:return send(self,400,{"error":"Authenticated user and project IDs are required."})
   folder=outdir(user,project)
   if path=="/terrain/outputs":
    outputs=[]
    for name in os.listdir(folder):
     if not name.startswith("output_") or not name.endswith(".json"):continue
     try:
      with open(os.path.join(folder,name),encoding="utf-8") as stream:item=json.load(stream)
      outputs.append({k:item.get(k) for k in ("id","operation","created_at","format","metadata")})
     except Exception:continue
    outputs.sort(key=lambda x:x.get("created_at",""),reverse=True)
    return send(self,200,{"outputs":outputs})
   output_id=path.rsplit("/",1)[-1]
   if len(output_id)!=16 or any(c not in "0123456789abcdef" for c in output_id):return send(self,400,{"error":"Invalid terrain output ID."})
   manifest=os.path.join(folder,"output_"+output_id+".json")
   if not os.path.isfile(manifest):return send(self,404,{"error":"Terrain output not found in this project."})
   with open(manifest,encoding="utf-8") as stream:item=json.load(stream)
   if item.get("file_name"):
    file_path=os.path.realpath(os.path.join(folder,item["file_name"]))
    if not file_path.startswith(os.path.realpath(folder)+os.sep) or not os.path.isfile(file_path):return send(self,404,{"error":"Saved terrain raster is missing."})
    raw=open(file_path,"rb").read(); self.send_response(200); self.send_header("Content-Type","image/tiff"); self.send_header("Content-Disposition",'attachment; filename="'+os.path.basename(file_path)+'"'); self.send_header("Content-Length",str(len(raw))); self.end_headers(); self.wfile.write(raw); return
   raw=json.dumps(item,allow_nan=False).encode(); self.send_response(200); self.send_header("Content-Type","application/json"); self.send_header("Content-Disposition",'attachment; filename="rayanaqua-'+item.get("operation","terrain")+'-'+output_id+'.json"'); self.send_header("Content-Length",str(len(raw))); self.end_headers(); self.wfile.write(raw); return
  elif path=="/health":
   send(self,200,{"status":"ok","service":"RayanAqua PyQGIS Processing API","qgis_version":"QGIS","processing_initialized":True,"dem_source":"Copernicus DEM GLO-30 with GLO-90 fallback"})
  elif path=="/dem/check":
   q=parse_qs(urlparse(self.path).query)
   lat=float(q.get("lat",["-3.4"])[0]); lon=float(q.get("lon",["38.5"])[0])
   if not math.isfinite(lat+lon) or abs(lat)>85 or abs(lon)>180: raise ValueError("Provide a valid latitude and longitude.")
   y=math.floor(lat); x=math.floor(lon)
   u30=tile_url(y,x,30); u90=tile_url(y,x,90)
   a30=exists(u30); a90=exists(u90)
   check={"tile":str(y)+","+str(x),"location":{"latitude":lat,"longitude":lon},"copernicus_glo30_available":a30,"copernicus_glo90_available":a90,"recommended_resolution_m":30 if a30 else 90 if a90 else None,"status":"available" if a30 or a90 else "no_public_tile"}
   print("COPERNICUS_TILE_CHECK "+json.dumps(check),flush=True)
   send(self,200,check)
  elif path=="/algorithms":
   ids=[a.id() for a in QgsApplication.processingRegistry().algorithms()]
   send(self,200,{"count":len(ids),"algorithms":ids[:250]})
  elif path=="/selftest":
   folder=outdir("rayan-aqua-self-test","voi-terrain")
   bb={"west":38.50,"south":-3.40,"east":38.51,"north":-3.39}
   dem,res,epsg=dem_for(bb,folder)
   contour_result=contour_geojson(dem,10,res)
   slope_result=slope_stats(dem)
   ds=gdal.Open(dem)
   profile_result=profile(ds,[[38.501,-3.399],[38.509,-3.391]],30)
   ds=None
   report={"status":"passed","dem_source":"Copernicus DEM GLO-"+str(res),"resolution_m":res,"crs":"EPSG:"+str(epsg),"contour_features":len(contour_result["features"]),"slope_mean_degrees":slope_result["mean_slope_degrees"],"profile_sample_count":profile_result["sample_count"],"profile_valid_samples":profile_result["valid_sample_count"],"profile_min_elevation_m":profile_result["minimum_elevation_m"],"profile_max_elevation_m":profile_result["maximum_elevation_m"]}
   print("PYQGIS_SELF_TEST "+json.dumps(report),flush=True)
   send(self,200,report)
  else:send(self,404,{"error":"Not found"})
 def do_POST(self):
  if self.headers.get("Authorization","")!="Bearer "+os.environ.get("PYQGIS_API_KEY",""):return send(self,401,{"error":"Unauthorized"})
  try:
   size=int(self.headers.get("Content-Length","0"))
   if size<1 or size>10000000:return send(self,413,{"error":"Request body must be 1 byte to 10 MB."})
   b=json.loads(self.rfile.read(size)); user=str(b.get("userId","")); project=str(b.get("projectId",""))
   if not user or not project:return send(self,400,{"error":"Authenticated user and project IDs are required."})
   folder=outdir(user,project); op=urlparse(self.path).path.rstrip("/")
   if op.endswith("/terrain/grid"):
    w,s,e,n=check_bbox(b.get("bbox",{})); bb={"west":w,"south":s,"east":e,"north":n}
    dem,res,epsg=dem_for(bb,folder); grid=terrain_grid(dem,int(b.get("maxDimension",64)))
    grid["crs"]="EPSG:"+str(epsg)
    payload={"grid":grid,"dem":{"source":"Copernicus DEM GLO-"+str(res),"resolution_m":res,"type":"Digital Surface Model","crs":"EPSG:"+str(epsg),"bbox":bb}}
    output=persist_output(folder,"terrain-grid",payload,metadata={"crs":grid["crs"],"width":grid["width"],"height":grid["height"]})
    send(self,200,{**payload,"output":output})
   elif op.endswith("/terrain/least-cost"):
    result=least_cost_route(b,folder); dem={"source":result["dem_source"],"resolution_m":result["dem_resolution_m"]}
    output=persist_output(folder,"least-cost",{"route":result,"dem":dem})
    send(self,200,{"route":result,"dem":dem,"output":output})
   elif op in ("/terrain/profile","/terrain/compare"):
    routes=b.get("routes")
    if not isinstance(routes,list) or not routes or len(routes)>20:raise ValueError("Provide 1 to 20 pipeline routes.")
    pts=[p for r in routes for p in r.get("coordinates",[]) if isinstance(p,list) and len(p)>=2]
    if len(pts)<2:raise ValueError("At least two route vertices are required.")
    xs=[float(p[0]) for p in pts]; ys=[float(p[1]) for p in pts]; pad=max(.002,float(b.get("bufferDegrees",.003)))
    bb={"west":min(xs)-pad,"south":min(ys)-pad,"east":max(xs)+pad,"north":max(ys)+pad}
    dem,res,epsg=dem_for(bb,folder); ds=gdal.Open(dem); results=[]
    for r in routes:results.append({"id":str(r.get("id","")),"name":str(r.get("name","Pipeline")),"profile_result":profile(ds,r.get("coordinates",[]),float(b.get("spacingM",30)))})
    ds=None
    if op.endswith("compare"):
     results.sort(key=lambda r:(r["profile_result"]["length_m"],r["profile_result"]["total_ascent_m"]))
     for i,r in enumerate(results):r["rank"]=i+1
    payload={"dem":{"source":"Copernicus DEM GLO-"+str(res),"resolution_m":res,"type":"Digital Surface Model","crs":"EPSG:"+str(epsg),"bbox":bb},"routes":results,"comparison":op.endswith("compare")}
    output=persist_output(folder,"compare" if op.endswith("compare") else "profile",payload)
    payload["output"]=output
    send(self,200,payload)
   elif op in ("/terrain/contours","/terrain/slope","/terrain/analyze"):
    w,s,e,n=check_bbox(b.get("bbox",{})); bb={"west":w,"south":s,"east":e,"north":n}
    dem,res,epsg=dem_for(bb,folder)
    result={"dem":{"source":"Copernicus DEM GLO-"+str(res),"resolution_m":res,"type":"Digital Surface Model","crs":"EPSG:"+str(epsg),"bbox":bb}}
    if op in ("/terrain/contours","/terrain/analyze"):result["contours"]=contour_geojson(dem,float(b.get("contourIntervalM",5)),res)
    raster_output=None
    if op in ("/terrain/slope","/terrain/analyze"):
     result["slope"]=slope_stats(dem)
     raster_file=result["slope"].get("raster_file")
     if raster_file:raster_output=persist_output(folder,"slope-raster",None,"image/tiff",raster_file,result["slope"])
    output=persist_output(folder,op.rsplit("/",1)[-1],result)
    result["output"]=output
    if raster_output:result["raster_output"]=raster_output
    send(self,200,result)
   else:send(self,404,{"error":"Unknown terrain operation"})
  except ValueError as ex:send(self,400,{"error":str(ex)})
  except Exception as ex:
   print(traceback.format_exc(),flush=True); send(self,500,{"error":"PyQGIS processing failed: "+str(ex)[:450]})
port=int(os.environ.get("PORT","8080"))
print("Starting RayanAqua PyQGIS Processing API on",port,flush=True)
HTTPServer(("0.0.0.0",port),Handler).serve_forever()
