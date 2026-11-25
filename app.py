"""Dedicated PyQGIS terrain API. Run inside a QGIS-enabled Python image.
Configure TERRAIN_DEM_PATH to a georeferenced DEM GeoTIFF. No DEM is fabricated.
"""
import os, json, math, tempfile
from functools import wraps
from flask import Flask, request, jsonify
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

def layer_geojson(layer):
    path=os.path.join(tempfile.gettempdir(),"terrain-"+str(os.getpid())+".geojson")
    opts=QgsVectorFileWriter.SaveVectorOptions(); opts.driverName="GeoJSON"
    result=QgsVectorFileWriter.writeAsVectorFormatV3(layer,path,project.transformContext(),opts)
    if result[0] != QgsVectorFileWriter.NoError: raise RuntimeError(str(result))
    with open(path,encoding="utf-8") as f: data=json.load(f)
    os.unlink(path); return data

@app.get("/health")
@auth
def health(): return jsonify(status="ok",engine="PyQGIS",processing=True,dem_configured=os.path.isfile(DEM))

@app.get("/dem/check")
@auth
def dem_check():
    try:
        layer=dem_layer()
        return jsonify(copernicus_glo30_available=False,copernicus_glo90_available=False,local_dem_available=True,source=os.path.basename(DEM),resolution_m=layer.rasterUnitsPerPixelX(),crs=layer.crs().authid(),note="Local DEM configured; confirm source and survey accuracy.")
    except Exception as e:
        return jsonify(copernicus_glo30_available=False,copernicus_glo90_available=False,local_dem_available=False,error=str(e),recommended_action="Configure TERRAIN_DEM_PATH with a verified GeoTIFF DEM.")

@app.post("/terrain/profile")
@auth
def profile():
    body=request.get_json(force=True); layer=dem_layer(); spacing=float(body.get("spacingM",30))
    routes=[]
    for r in body.get("routes",[]):
        routes.append({"id":r.get("id"),"name":r.get("name","Route"),"profile_result":sample_profile(layer,coords_route(r.get("coordinates")),spacing)})
    return jsonify(dem={"source":os.path.basename(DEM),"resolution_m":pixel_resolution_m(layer),"crs":layer.crs().authid()},routes=routes)

@app.post("/terrain/compare")
@auth
def compare():
    result=profile().get_json()
    result["routes"].sort(key=lambda r:(r["profile_result"]["total_ascent_m"],r["profile_result"]["length_m"]))
    for i,r in enumerate(result["routes"],1): r["rank"]=i
    return jsonify(result)

@app.post("/terrain/contours")
@auth
def contours():
    body=request.get_json(force=True); interval=float(body.get("contourIntervalM",5))
    if interval<=0: return jsonify(error="Contour interval must be positive."),400
    layer=dem_layer()
    out=processing.run("gdal:contour",{"INPUT":layer,"BAND":1,"INTERVAL":interval,"FIELD_NAME":"elevation","CREATE_3D":False,"IGNORE_NODATA":True,"OUTPUT":"memory:"})["OUTPUT"]
    return jsonify(contours=layer_geojson(out),dem={"source":os.path.basename(DEM),"resolution_m":abs(layer.rasterUnitsPerPixelX()),"crs":layer.crs().authid()})

@app.post("/terrain/slope")
@auth
def slope():
    layer=dem_layer()
    out=processing.run("native:slope",{"INPUT":layer,"Z_FACTOR":1,"OUTPUT":"TEMPORARY_OUTPUT"})["OUTPUT"]
    return jsonify(message="Slope raster generated by QGIS native:slope.",source=out.source(),crs=out.crs().authid())

@app.post("/terrain/analyze")
@auth
def analyze():
    body=request.get_json(force=True); layer=dem_layer()
    interval=float(body.get("contourIntervalM",5))
    contours=processing.run("gdal:contour",{"INPUT":layer,"BAND":1,"INTERVAL":interval,"FIELD_NAME":"elevation","CREATE_3D":False,"IGNORE_NODATA":True,"OUTPUT":"memory:"})["OUTPUT"]
    slope_layer=processing.run("native:slope",{"INPUT":layer,"Z_FACTOR":1,"OUTPUT":"TEMPORARY_OUTPUT"})["OUTPUT"]
    return jsonify(contours=layer_geojson(contours),slope={"source":slope_layer.source(),"crs":slope_layer.crs().authid()},dem={"source":os.path.basename(DEM),"resolution_m":abs(layer.rasterUnitsPerPixelX()),"crs":layer.crs().authid()})

@app.post("/terrain/least-cost")
@auth
def least_cost():
    return jsonify(error="Least-cost routing requires a project-specific cost raster and obstacle layer. Supply these as configured layers before routing; the service will not invent terrain or obstacle data."),422

if __name__=="__main__": app.run(host="0.0.0.0",port=int(os.environ.get("PORT","8080")))
