"""Dedicated PyQGIS terrain API. Run inside a QGIS-enabled Python image.
Configure TERRAIN_DEM_PATH to a georeferenced DEM GeoTIFF. No DEM is fabricated.
"""
import os, json, math, tempfile, re, uuid
from datetime import datetime, timezone
from functools import wraps
from flask import Flask, request, jsonify, send_file
from qgis.core import QgsApplication, QgsRasterLayer, QgsVectorLayer, QgsProject, QgsPointXY, QgsGeometry, QgsFeature, QgsFields, QgsField, QgsVectorFileWriter, QgsCoordinateReferenceSystem, QgsCoordinateTransform, QgsWkbTypes, QgsDistanceArea
from qgis.PyQt.QtCore import QVariant
import processing
from processing.core.Processing import Processing

app=Flask(__name__)
TOKEN=os.environ.get("PYQGIS_API_KEY","")
DEM=os.environ.get("TERRAIN_DEM_PATH","/data/dem/project-dem.tif")
QgsApplication.setPrefixPath(os.environ.get("QGIS_PREFIX_PATH","/usr"), True)
qgs=QgsApplication([],False); qgs.initQgis(); Processing.initialize()
project=QgsProject.instance()

def auth(fn):
    @wraps(fn)
    def wrapped(*a,**kw):
        if not TOKEN or request.headers.get("Authorization") != "Bearer "+TOKEN:
            return jsonify(error="Unauthorized"),401
        return fn(*a,**kw)
    return wrapped

def dem_layer():
    layer=QgsRasterLayer(DEM,"project DEM")
    if not layer.isValid(): raise ValueError("No valid project DEM GeoTIFF is configured. Set TERRAIN_DEM_PATH to a surveyed or verified DEM.")
    return layer

def coords_route(coords):
    if not isinstance(coords,list) or len(coords)<2: raise ValueError("Route requires at least two [longitude, latitude] coordinates.")
    return [(float(p[0]),float(p[1])) for p in coords]

def distance_measure(layer):
    measure=QgsDistanceArea()
    measure.setSourceCrs(layer.crs(),project.transformContext())
    measure.setEllipsoid(project.ellipsoid() or "WGS84")
    return measure

def pixel_resolution_m(layer):
    extent=layer.extent(); center=extent.center()
    adjacent=QgsPointXY(center.x()+layer.rasterUnitsPerPixelX(),center.y())
    return round(distance_measure(layer).measureLine(center,adjacent),2)

def sample_profile(layer, coords, spacing):
    if spacing<1 or spacing>1000: raise ValueError("Sample spacing must be 1–1000 m.")
    crs=layer.crs(); wgs=QgsCoordinateReferenceSystem("EPSG:4326")
    to_dem=QgsCoordinateTransform(wgs,crs,project)
    pts=[to_dem.transform(QgsPointXY(x,y)) for x,y in coords]
    measure=distance_measure(layer)
    samples=[]; chain=0.0
    for a,b in zip(pts,pts[1:]):
        length=measure.measureLine(a,b)
        n=max(1,math.ceil(length/spacing))
        for i in range(n):
            t=i/n; x=a.x()+(b.x()-a.x())*t; y=a.y()+(b.y()-a.y())*t
            val=layer.dataProvider().identify(QgsPointXY(x,y),QgsRasterLayer.IdentifyFormatValue).results()
            z=next((v for v in val.values() if isinstance(v,(int,float)) and math.isfinite(v)),None)
            samples.append({"chainage_m":round(chain+length*t,2),"elevation_m":z})
        chain+=length
    val=layer.dataProvider().identify(pts[-1],QgsRasterLayer.IdentifyFormatValue).results()
    z=next((v for v in val.values() if isinstance(v,(int,float)) and math.isfinite(v)),None)
    samples.append({"chainage_m":round(chain,2),"elevation_m":z})
    valid=[p["elevation_m"] for p in samples if p["elevation_m"] is not None]
    asc=sum(max(0,b-a) for a,b in zip(valid,valid[1:])); desc=sum(max(0,a-b) for a,b in zip(valid,valid[1:]))
    grades=[]
    for a,b in zip(samples,samples[1:]):
        run=b["chainage_m"]-a["chainage_m"]
        if run>0 and a["elevation_m"] is not None and b["elevation_m"] is not None:
            grades.append(max(0.0,(b["elevation_m"]-a["elevation_m"])/run*100))
    return {"profile":samples,"length_m":round(chain,2),"minimum_elevation_m":min(valid) if valid else None,"maximum_elevation_m":max(valid) if valid else None,"total_ascent_m":round(asc,2),"total_descent_m":round(desc,2),"maximum_uphill_grade_percent":round(max(grades,default=0.0),2)}

def output_scope(user_id, project_id):
    user_id=str(user_id or "").strip(); project_id=str(project_id or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}",user_id) or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}",project_id):
        raise ValueError("A valid authenticated user and project are required for persistent terrain outputs.")
    root=os.path.realpath(os.environ.get("TERRAIN_OUTPUT_DIR","/data/terrain-outputs"))
    folder=os.path.realpath(os.path.join(root,user_id,project_id))
    if not folder.startswith(root+os.sep): raise ValueError("Invalid terrain output scope.")
    os.makedirs(folder,exist_ok=True)
    return folder

def create_output_file(body, operation, extension):
    folder=output_scope(body.get("userId"),body.get("projectId"))
    output_id=uuid.uuid4().hex[:16]
    return output_id,folder,os.path.join(folder,output_id+"."+extension)

def persist_json_output(body, operation, payload, metadata=None):
    output_id,folder,path=create_output_file(body,operation,"json")
    record={"id":output_id,"operation":operation,"created_at":datetime.now(timezone.utc).isoformat(),"format":"application/json","metadata":metadata or {},"data":payload}
    with open(path,"w",encoding="utf-8") as stream: json.dump(record,stream,separators=(",",":"),allow_nan=False)
    return {"id":output_id,"operation":operation,"format":"application/json","saved":True,"created_at":record["created_at"]}

def persist_raster_output(body, operation, raster_path, metadata=None, output_id=None, folder=None):
    if not output_id or not folder: output_id,folder,_=create_output_file(body,operation,"tif")
    record={"id":output_id,"operation":operation,"created_at":datetime.now(timezone.utc).isoformat(),"format":"image/tiff","file_name":os.path.basename(raster_path),"metadata":metadata or {}}
    manifest=os.path.join(folder,output_id+".json")
    with open(manifest,"w",encoding="utf-8") as stream: json.dump(record,stream,separators=(",",":"))
    return {"id":output_id,"operation":operation,"format":"image/tiff","saved":True,"created_at":record["created_at"]}

def layer_geojson(layer):
    path=os.path.join(tempfile.gettempdir(),"terrain-"+str(os.getpid())+".geojson")
    opts=QgsVectorFileWriter.SaveVectorOptions(); opts.driverName="GeoJSON"
    result=QgsVectorFileWriter.writeAsVectorFormatV3(layer,path,project.transformContext(),opts)
    if result[0] != QgsVectorFileWriter.NoError: raise RuntimeError(str(result))
    with open(path,encoding="utf-8") as f: data=json.load(f)
    os.unlink(path); return data

@app.get("/terrain/outputs")
@auth
def list_outputs():
    try:
        folder=output_scope(request.args.get("userId"),request.args.get("projectId"))
        outputs=[]
        for name in os.listdir(folder):
            if not re.fullmatch(r"[a-f0-9]{16}\.json",name): continue
            try:
                with open(os.path.join(folder,name),encoding="utf-8") as stream: item=json.load(stream)
                outputs.append({k:item.get(k) for k in ("id","operation","created_at","format","metadata")})
            except Exception: continue
        outputs.sort(key=lambda item:item.get("created_at",""),reverse=True)
        return jsonify(outputs=outputs)
    except Exception as e: return jsonify(error=str(e)),400

@app.get("/terrain/outputs/<output_id>")
@auth
def get_output(output_id):
    if not re.fullmatch(r"[a-f0-9]{16}",output_id): return jsonify(error="Invalid terrain output ID."),400
    try:
        folder=output_scope(request.args.get("userId"),request.args.get("projectId"))
        manifest=os.path.join(folder,output_id+".json")
        if not os.path.isfile(manifest): return jsonify(error="Terrain output not found in this project."),404
        with open(manifest,encoding="utf-8") as stream: item=json.load(stream)
        if item.get("file_name"):
            path=os.path.realpath(os.path.join(folder,item["file_name"]))
            if not path.startswith(folder+os.sep) or not os.path.isfile(path): return jsonify(error="Stored terrain raster is missing."),404
            return send_file(path,as_attachment=True,download_name=os.path.basename(path),mimetype="image/tiff")
        return jsonify(item)
    except Exception as e: return jsonify(error=str(e)),400

@app.get("/health")
@auth
def health(): return jsonify(status="ok",engine="PyQGIS",processing=True,dem_configured=os.path.isfile(DEM))

@app.get("/dem/check")
@auth
def dem_check():
    try:
        layer=dem_layer()
        return jsonify(copernicus_glo30_available=False,copernicus_glo90_available=False,local_dem_available=True,source=os.path.basename(DEM),resolution_m=pixel_resolution_m(layer),crs=layer.crs().authid(),note="Local DEM configured; confirm source and survey accuracy.")
    except Exception as e:
        return jsonify(copernicus_glo30_available=False,copernicus_glo90_available=False,local_dem_available=False,error=str(e),recommended_action="Configure TERRAIN_DEM_PATH with a verified GeoTIFF DEM.")

@app.post("/terrain/profile")
@auth
def profile():
    body=request.get_json(force=True); layer=dem_layer(); spacing=float(body.get("spacingM",30))
    routes=[]
    for r in body.get("routes",[]):
        routes.append({"id":r.get("id"),"name":r.get("name","Route"),"profile_result":sample_profile(layer,coords_route(r.get("coordinates")),spacing)})
    dem={"source":os.path.basename(DEM),"resolution_m":pixel_resolution_m(layer),"crs":layer.crs().authid()}
    output=persist_json_output(body,"profile",{"routes":routes},{"dem":dem,"spacing_m":spacing})
    return jsonify(dem=dem,routes=routes,output=output)

@app.post("/terrain/compare")
@auth
def compare():
    result=profile().get_json()
    result["routes"].sort(key=lambda r:(r["profile_result"]["total_ascent_m"],r["profile_result"]["length_m"]))
    for i,r in enumerate(result["routes"],1): r["rank"]=i
    output=persist_json_output(request.get_json(force=True),"compare",{"routes":result["routes"]},{"dem":result.get("dem")})
    result["output"]=output
    return jsonify(result)

@app.post("/terrain/contours")
@auth
def contours():
    body=request.get_json(force=True); interval=float(body.get("contourIntervalM",5))
    if interval<=0: return jsonify(error="Contour interval must be positive."),400
    layer=dem_layer()
    out=processing.run("gdal:contour",{"INPUT":layer,"BAND":1,"INTERVAL":interval,"FIELD_NAME":"elevation","CREATE_3D":False,"IGNORE_NODATA":True,"OUTPUT":"memory:"})["OUTPUT"]
    contours_data=layer_geojson(out); dem={"source":os.path.basename(DEM),"resolution_m":pixel_resolution_m(layer),"crs":layer.crs().authid()}
    output=persist_json_output(body,"contours",{"contours":contours_data},{"dem":dem,"contour_interval_m":interval})
    return jsonify(contours=contours_data,dem=dem,output=output)

@app.post("/terrain/slope")
@auth
def slope():
    body=request.get_json(force=True); layer=dem_layer()
    output_id,folder,raster_path=create_output_file(body,"slope","tif")
    out=processing.run("native:slope",{"INPUT":layer,"Z_FACTOR":1,"OUTPUT":raster_path})["OUTPUT"]
    metadata={"source":os.path.basename(DEM),"resolution_m":pixel_resolution_m(layer),"crs":layer.crs().authid(),"slope_crs":out.crs().authid()}
    output=persist_raster_output(body,"slope",raster_path,metadata,output_id,folder)
    return jsonify(message="Slope raster generated and saved by QGIS native:slope.",source=os.path.basename(raster_path),crs=out.crs().authid(),output=output)

@app.post("/terrain/analyze")
@auth
def analyze():
    body=request.get_json(force=True); layer=dem_layer()
    interval=float(body.get("contourIntervalM",5))
    if interval<=0: return jsonify(error="Contour interval must be positive."),400
    contours=processing.run("gdal:contour",{"INPUT":layer,"BAND":1,"INTERVAL":interval,"FIELD_NAME":"elevation","CREATE_3D":False,"IGNORE_NODATA":True,"OUTPUT":"memory:"})["OUTPUT"]
    contours_data=layer_geojson(contours); dem={"source":os.path.basename(DEM),"resolution_m":pixel_resolution_m(layer),"crs":layer.crs().authid()}
    contour_output=persist_json_output(body,"contours",{"contours":contours_data},{"dem":dem,"contour_interval_m":interval})
    output_id,folder,raster_path=create_output_file(body,"slope","tif")
    slope_layer=processing.run("native:slope",{"INPUT":layer,"Z_FACTOR":1,"OUTPUT":raster_path})["OUTPUT"]
    slope_output=persist_raster_output(body,"slope",raster_path,{"dem":dem,"slope_crs":slope_layer.crs().authid()},output_id,folder)
    return jsonify(contours=contours_data,slope={"source":os.path.basename(raster_path),"crs":slope_layer.crs().authid()},dem=dem,outputs=[contour_output,slope_output])

@app.post("/terrain/least-cost")
@auth
def least_cost():
    """Generate a DEM-derived least-cost pipeline corridor using QGIS raster sampling and Dijkstra."""
    import heapq
    body=request.get_json(force=True)
    layer=dem_layer()
    start=body.get("start"); end=body.get("end")
    if not (isinstance(start,list) and len(start)>=2 and isinstance(end,list) and len(end)>=2):
        return jsonify(error="Choose valid start and end points [longitude, latitude]."),400
    start=(float(start[0]),float(start[1])); end=(float(end[0]),float(end[1]))
    if not all(math.isfinite(v) for v in (*start,*end)) or start==end:
        return jsonify(error="Start and end coordinates must be finite and different."),400
    size=max(31,min(151,int(body.get("gridSize",81))))
    slope_weight=max(0.0,min(100.0,float(body.get("slopeWeight",8))))
    wgs=QgsCoordinateReferenceSystem("EPSG:4326")
    to_dem=QgsCoordinateTransform(wgs,layer.crs(),project)
    to_wgs=QgsCoordinateTransform(layer.crs(),wgs,project)
    a=to_dem.transform(QgsPointXY(*start)); b=to_dem.transform(QgsPointXY(*end))
    extent=layer.extent()
    dx=b.x()-a.x(); dy=b.y()-a.y()
    direct=math.hypot(dx,dy)
    if direct < 1: return jsonify(error="Start and end points are too close to route."),400
    pad=max(direct*0.30, pixel_resolution_m(layer)*5)
    nx=size; ny=size
    transform=layer.dataProvider()
    obstacles=body.get("obstacles") or []
    obstacle_geometries=[]
    for item in obstacles:
        try:
            geom=QgsGeometry.fromJson(json.dumps(item.get("geometry",item)).encode("utf-8"))
            if not geom.isEmpty():
                geom.transform(QgsCoordinateTransform(wgs,layer.crs(),project))
                obstacle_geometries.append(geom)
        except Exception: pass
    nodes=[]; valid=[]
    for r in range(ny):
        for c in range(nx):
            t=c/(nx-1)
            side=(r/(ny-1)-0.5)*2*pad
            x=a.x()+dx*t-(dy/direct)*side
            y=a.y()+dy*t+(dx/direct)*side
            point=QgsPointXY(x,y)
            if not extent.contains(point):
                nodes.append(None); continue
            values=transform.identify(point,QgsRasterLayer.IdentifyFormatValue).results()
            z=next((float(v) for v in values.values() if isinstance(v,(int,float)) and math.isfinite(v) and abs(v)<1e6),None)
            if z is None:
                nodes.append(None); continue
            geo=to_wgs.transform(point)
            blocked=False
            for geom in obstacle_geometries:
                if geom.contains(QgsGeometry.fromPointXY(point)): blocked=True; break
            nodes.append({"x":x,"y":y,"z":z,"geo":[geo.x(),geo.y()],"blocked":blocked})
            if not blocked: valid.append(len(nodes)-1)
    def nearest_index(point):
        return min(valid,key=lambda i:(nodes[i]["x"]-point.x())**2+(nodes[i]["y"]-point.y())**2) if valid else None
    source=nearest_index(a); target=nearest_index(b)
    if source is None or target is None:
        return jsonify(error="The configured DEM does not cover the selected start/end corridor, or obstacles block it."),422
    dist=[float("inf")]*len(nodes); prev=[-1]*len(nodes); dist[source]=0
    queue=[(0.0,source)]; visited=set()
    while queue:
        cost,u=heapq.heappop(queue)
        if u in visited: continue
        visited.add(u)
        if u==target: break
        row,col=divmod(u,nx)
        for rr in range(max(0,row-1),min(ny,row+2)):
            for cc in range(max(0,col-1),min(nx,col+2)):
                v=rr*nx+cc
                if v==u or nodes[v] is None or nodes[v]["blocked"] or v in visited: continue
                p=nodes[u]; q=nodes[v]
                horizontal=math.hypot(q["x"]-p["x"],q["y"]-p["y"])
                grade=abs(q["z"]-p["z"])/max(horizontal,0.1)
                candidate=cost+horizontal*(1+slope_weight*grade*grade)
                if candidate<dist[v]:
                    dist[v]=candidate; prev[v]=u; heapq.heappush(queue,(candidate,v))
    if not math.isfinite(dist[target]):
        return jsonify(error="No traversable DEM route found. Widen the corridor or review obstacle polygons."),422
    indices=[]; cur=target
    while cur!=-1:
        indices.append(cur); cur=prev[cur]
    indices.reverse()
    coords=[nodes[i]["geo"] for i in indices]
    coords[0]=list(start); coords[-1]=list(end)
    profile_result=sample_profile(layer,coords,max(5.0,pixel_resolution_m(layer)))
    route={"coordinates":coords,"routing_method":"QGIS DEM-grid Dijkstra","dem_source":os.path.basename(DEM),"dem_resolution_m":pixel_resolution_m(layer),"terrain_cost":round(dist[target],3),"length_m":profile_result["length_m"],"max_slope_percent":profile_result["maximum_uphill_grade_percent"],"total_ascent_m":profile_result["total_ascent_m"],"total_descent_m":profile_result["total_descent_m"],"slope_weight":slope_weight,"grid_rows":ny,"grid_columns":nx}
    dem={"source":os.path.basename(DEM),"resolution_m":pixel_resolution_m(layer),"crs":layer.crs().authid()}
    output=persist_json_output(body,"least-cost",{"route":route,"dem":dem},{"start":list(start),"end":list(end)})
    return jsonify(route=route,dem=dem,output=output)

if __name__=="__main__": app.run(host="0.0.0.0",port=int(os.environ.get("PORT","8080")))
