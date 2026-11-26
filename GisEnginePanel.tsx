import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleMarker, MapContainer, Polygon, Polyline, TileLayer, WMSTileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import * as turf from '@turf/turf';
import 'leaflet/dist/leaflet.css';
import { api } from './client';
import { Download, FileUp, Layers3, MapPin, MousePointer2, Pentagon, Route, Save, Trash2, Waves, Ruler, LocateFixed, Mountain, FolderOpen, Plus, Copy } from 'lucide-react';

type GisServerStatus = {
  configured: boolean;
  connected: boolean;
  projectReady?: boolean;
  projectTitle?: string;
  projectPath?: string;
  wmsUrl?: string;
  wmsLayers?: string[];
  wfsLayers?: string[];
  service?: string;
  message: string;
  httpStatus?: number;
};

type Feature = {
  id: string;
  type: 'Point' | 'LineString' | 'Polygon';
  name: string;
  category: string;
  coordinates: number[] | number[][] | number[][][];
  properties?: Record<string, unknown>;
};
const palette: Record<string, string> = {
  'Water source': '#1686c7', Reservoir: '#0d7770', Tank: '#d49b37', Junction: '#2d8a50', Pipeline: '#d36d36', Boundary: '#7456a5', Other: '#64748b'
};
const defaultCenter: [number, number] = [-3.396, 38.556];

function MapClick({ mode, onPoint, onLinePoint, onPolygonPoint }: {
  mode: string; onPoint: (lat: number, lng: number) => void;
  onLinePoint: (lat: number, lng: number) => void;
  onPolygonPoint: (lat: number, lng: number) => void;
}) {
  useMapEvents({ click(event) {
    if (mode === 'point') onPoint(event.latlng.lat, event.latlng.lng);
    if (mode === 'line') onLinePoint(event.latlng.lat, event.latlng.lng);
    if (mode === 'polygon') onPolygonPoint(event.latlng.lat, event.latlng.lng);
  }});
  return null;
}
function RefitMap({ features }: { features: Feature[] }) {
  const map = useMap();
  useEffect(() => {
    const points: [number, number][] = features.flatMap(feature => {
      const coords: any = feature.coordinates;
      if (feature.type === 'Point') return [[coords[1], coords[0]] as [number, number]];
      if (feature.type === 'LineString') return coords.map((c: number[]) => [c[1], c[0]] as [number, number]);
      return (coords[0] || []).map((c: number[]) => [c[1], c[0]] as [number, number]);
    });
    if (points.length) map.fitBounds(L.latLngBounds(points), { padding: [30, 30], maxZoom: 15 });
  }, [features, map]);
  return null;
}
function makeFeature(name: string, category: string, type: Feature['type'], coordinates: any): Feature {
  return { id: crypto.randomUUID(), name, category, type, coordinates };
}
function featureToGeoJSON(feature: Feature): any {
  return { type: 'Feature', id: feature.id, geometry: { type: feature.type, coordinates: feature.coordinates }, properties: { name: feature.name, category: feature.category, ...feature.properties } };
}
function fromGeoJSON(input: any): Feature[] {
  const source = input?.featureCollection ?? input;
  const rows = source?.type === 'FeatureCollection' ? source.features : source?.type === 'Feature' ? [source] : [];
  return rows.filter((f: any) => f?.geometry && ['Point', 'LineString', 'Polygon'].includes(f.geometry.type)).map((f: any) => ({
    id: String(f.id || crypto.randomUUID()), type: f.geometry.type, name: String(f.properties?.name || f.properties?.title || f.geometry.type),
    category: String(f.properties?.category || (f.geometry.type === 'LineString' ? 'Pipeline' : f.geometry.type === 'Polygon' ? 'Boundary' : 'Other')),
    coordinates: f.geometry.coordinates, properties: f.properties || {}
  }));
}
function geometryMetrics(feature: Feature) {
  try {
    const geometry: any = { type: 'Feature', properties: {}, geometry: { type: feature.type, coordinates: feature.coordinates } };
    if (feature.type === 'LineString') return { length: turf.length(geometry, { units: 'kilometers' }) * 1000 };
    if (feature.type === 'Polygon') return { area: turf.area(geometry) };
    return { coordinates: (feature.coordinates as number[]).slice(0, 2) };
  } catch { return {}; }
}
function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url);
}

async function fetchTerrainElevations(points: Array<{ lat: number; lng: number }>): Promise<number[]> {
  const url = new URL('https://api.open-meteo.com/v1/elevation');
  url.searchParams.set('latitude', points.map(point => point.lat.toFixed(6)).join(','));
  url.searchParams.set('longitude', points.map(point => point.lng.toFixed(6)).join(','));
  const response = await fetch(url.toString());
  if (!response.ok) throw new Error('Terrain elevation service returned HTTP ' + response.status + '.');
  const data = await response.json();
  if (!Array.isArray(data?.elevation) || data.elevation.length !== points.length || data.elevation.some((value: unknown) => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error('The elevation service did not return a valid height for every coordinate.');
  }
  return data.elevation as number[];
}

async function findLeastCostRoute(start: number[], end: number[], obstacles: Feature[], gridSize = 17, slopeWeight = 8) {
  // Build a corridor grid around the start/end axis, sample real public DEM heights, then run Dijkstra.
  const dx=end[0]-start[0], dy=end[1]-start[1];
  const length=Math.hypot(dx,dy); if(length < 0.0001) throw new Error('Choose distinct start and end points.');
  const latScale=Math.max(0.2,Math.cos(((start[1]+end[1])/2)*Math.PI/180));
  const pad=Math.max(length*0.22,0.003);
  const nx=gridSize, ny=gridSize;
  const nodes:{lng:number;lat:number;z:number;blocked:boolean}[]=[];
  for(let r=0;r<ny;r++) for(let c=0;c<nx;c++) {
    const t=c/(nx-1), side=(r/(ny-1)-0.5)*2*pad;
    const lng=start[0]+dx*t-(dy/latScale/length)*side;
    const lat=start[1]+dy*t+(dx*latScale/length)*side;
    const pt:any={type:'Feature',properties:{},geometry:{type:'Point',coordinates:[lng,lat]}};
    const blocked=obstacles.some(f=>f.type==='Polygon'&&turf.booleanPointInPolygon(pt as any,{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:f.coordinates as any}} as any));
    nodes.push({lng,lat,z:0,blocked});
  }
  const elevations=await fetchTerrainElevations(nodes.map(n=>({lat:n.lat,lng:n.lng})));
  nodes.forEach((n,i)=>n.z=elevations[i]);
  const at=(r:number,c:number)=>r*nx+c, source=at(Math.floor(ny/2),0), target=at(Math.floor(ny/2),nx-1);
  const dist=Array(nodes.length).fill(Infinity), prev=Array(nodes.length).fill(-1), used=Array(nodes.length).fill(false); dist[source]=0;
  for(let step=0;step<nodes.length;step++) {
    let u=-1,best=Infinity; for(let i=0;i<nodes.length;i++) if(!used[i]&&dist[i]<best){best=dist[i];u=i;}
    if(u<0||u===target) break; used[u]=true;
    const r=Math.floor(u/nx),c=u%nx;
    for(let rr=Math.max(0,r-1);rr<=Math.min(ny-1,r+1);rr++) for(let cc=Math.max(0,c-1);cc<=Math.min(nx-1,c+1);cc++) {
      if(rr===r&&cc===c) continue; const v=at(rr,cc),a=nodes[u],b=nodes[v]; if(b.blocked) continue;
      const horizontal=Math.hypot((b.lng-a.lng)*111320*latScale,(b.lat-a.lat)*111320);
      const grade=Math.abs(b.z-a.z)/Math.max(horizontal,0.1);
      const cost=horizontal*(1+slopeWeight*grade*grade);
      if(dist[u]+cost<dist[v]){dist[v]=dist[u]+cost;prev[v]=u;}
    }
  }
  if(!Number.isFinite(dist[target])) throw new Error('No traversable route found. Check obstacle polygons or widen the route corridor.');
  const pathIndexes:number[]=[]; for(let u=target;u!==-1;u=prev[u]) pathIndexes.push(u); pathIndexes.reverse(); const path=pathIndexes.map(u=>[nodes[u].lng,nodes[u].lat]);
  path[0]=[start[0],start[1]]; path[path.length-1]=[end[0],end[1]];
  const maxSlope=pathIndexes.slice(1).reduce((m,u,i)=>Math.max(m,Math.abs(nodes[u].z-nodes[pathIndexes[i]].z)/Math.max(1,Math.hypot((nodes[u].lng-nodes[pathIndexes[i]].lng)*111320*latScale,(nodes[u].lat-nodes[pathIndexes[i]].lat)*111320)*100)),0);
  return {coordinates:path,cost:dist[target],length_m:path.slice(1).reduce((sum,p,i)=>sum+Math.hypot((p[0]-path[i][0])*111320*latScale,(p[1]-path[i][1])*111320),0),maxSlope_percent:maxSlope};
}

export default function GisEnginePanel({ projectId, projectTitle, initialData, hydraulicNetwork, hydraulicSimulation, onSave, onSendToEpanet }: {
  projectId: string; projectTitle?: string; initialData?: any; hydraulicNetwork?: any; hydraulicSimulation?: any;
  onSave: (data: any) => void | Promise<void>; onSendToEpanet?: (features: any[]) => void;
}) {
  const [features, setFeatures] = useState<Feature[]>([]);
  const [drafts, setDrafts] = useState<any[]>([]);
  const [activeDraftId, setActiveDraftId] = useState('');
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftNameInput, setDraftNameInput] = useState('GIS draft 1');
  const [draftsLoaded, setDraftsLoaded] = useState(false);
  const migratedLegacyProject = useRef('');
  const lastSavedDataRef = useRef('');
  const [mode, setMode] = useState('select');
  const [category, setCategory] = useState('Water source');
  const [name, setName] = useState('');
  const [pendingLine, setPendingLine] = useState<number[][]>([]);
  const [pendingPolygon, setPendingPolygon] = useState<number[][]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [message, setMessage] = useState('Choose a drawing tool, then tap the map to add features.');
  const [serverStatus, setServerStatus] = useState<GisServerStatus>({ configured: false, connected: false, message: 'Checking QGIS Server and OGC services…' });
  const [checkingServer, setCheckingServer] = useState(false);
  const [selectedWmsLayer, setSelectedWmsLayer] = useState('');
  const [selectedWfsLayer, setSelectedWfsLayer] = useState('');
  const [showQgisWms, setShowQgisWms] = useState(false);
  const [wfsBusy, setWfsBusy] = useState(false);
  const [elevationBusy, setElevationBusy] = useState(false);
  const [terrainBusy, setTerrainBusy] = useState(false);
  const [terrainResults, setTerrainResults] = useState<any>(null);
  const [savedTerrainOutputs, setSavedTerrainOutputs] = useState<any[]>([]);
  const [terrainOutputsAvailable, setTerrainOutputsAvailable] = useState(false);
  const [terrainServiceStatus, setTerrainServiceStatus] = useState<any>(null);
  const [terrainStatusBusy, setTerrainStatusBusy] = useState(false);
  const [contourInterval, setContourInterval] = useState('5');
  const [profileSpacing, setProfileSpacing] = useState('30');
  const [routeStartId,setRouteStartId]=useState(''); const [routeEndId,setRouteEndId]=useState(''); const [routeBusy,setRouteBusy]=useState(false); const [routeSlopeWeight,setRouteSlopeWeight]=useState('8');
  const [showSatellite, setShowSatellite] = useState(false);
  const [overlayMetric, setOverlayMetric] = useState<'compliance'|'pressure'|'flow'|'velocity'|'headloss'>('compliance');
  const [overlayStep, setOverlayStep] = useState(-1);
  const fileRef = useRef<HTMLInputElement>(null);
  const selected = features.find(feature => feature.id === selectedId);
  const summary = useMemo(() => ({ points: features.filter(f => f.type === 'Point').length, lines: features.filter(f => f.type === 'LineString').length, polygons: features.filter(f => f.type === 'Polygon').length }), [features]);
  const snapshots = hydraulicSimulation?.snapshots || [];
  const selectedSnapshot = snapshots.length ? snapshots[Math.max(0,Math.min(snapshots.length-1,overlayStep<0?snapshots.length-1:overlayStep))] : null;
  const overlayData = overlayMetric === 'compliance' ? hydraulicSimulation : selectedSnapshot || hydraulicSimulation;
  const overlayValues = useMemo(() => {
    if (overlayMetric === 'pressure') return (overlayData?.nodes || []).map((r: any) => Number(r.pressure)).filter(Number.isFinite);
    if (overlayMetric === 'flow') return (overlayData?.links || []).map((r: any) => Math.abs(Number(r.flow))).filter(Number.isFinite);
    if (overlayMetric === 'velocity') return (overlayData?.links || []).filter((r: any) => r.kind === 'pipe').map((r: any) => Math.abs(Number(r.velocity))).filter(Number.isFinite);
    if (overlayMetric === 'headloss') return (overlayData?.links || []).map((r: any) => Math.abs(Number(r.headloss))).filter(Number.isFinite);
    return [];
  }, [overlayData, overlayMetric]);
  const overlayRange = useMemo(() => ({ min: overlayValues.length ? Math.min(...overlayValues) : 0, max: overlayValues.length ? Math.max(...overlayValues) : 0 }), [overlayValues]);
  const overlayColor = (value: number | undefined) => {
    if (value === undefined || !Number.isFinite(value)) return '#87969a';
    if (overlayRange.max <= overlayRange.min) return '#16866b';
    const t = Math.max(0, Math.min(0.999, (value - overlayRange.min) / (overlayRange.max - overlayRange.min)));
    return ['#2563a6','#1595b5','#36a56b','#d4a72c','#c54f45'][Math.floor(t * 5)];
  };

  useEffect(() => {
    let cancelled = false;
    setDraftsLoaded(false);
    setDrafts([]);
    setActiveDraftId('');
    api.get('/api/projects/' + projectId + '/gis-drafts').then(response => {
      if (cancelled) return;
      const rows = (response.data.drafts || []) as any[];
      setDrafts(rows);
      setDraftsLoaded(true);
      if (rows.length) {
        const latest = rows[0];
        setActiveDraftId(latest.draftId);
        setFeatures(fromGeoJSON(latest.data));
        lastSavedDataRef.current = JSON.stringify(latest.data);
        setMessage('Opened most recently saved GIS draft: ' + latest.name);
      } else if (initialData) {
        setFeatures(fromGeoJSON(initialData));
      } else {
        setFeatures([]);
      }
    }).catch(error => {
      if (!cancelled) { setDraftsLoaded(true); setMessage(error instanceof Error ? error.message : 'Saved GIS drafts could not be loaded.'); }
    });
    return () => { cancelled = true; };
  }, [projectId]);

  useEffect(() => {
    if (!draftsLoaded || drafts.length || !initialData || migratedLegacyProject.current === projectId) return;
    const legacyFeatures = fromGeoJSON(initialData);
    if (!legacyFeatures.length) return;
    migratedLegacyProject.current = projectId;
    const data = { format: 'GeoJSON', crs: 'OGC:CRS84 (longitude, latitude)', featureCollection: { type: 'FeatureCollection', features: legacyFeatures.map(featureToGeoJSON) }, savedAt: new Date().toISOString() };
    api.post('/api/projects/' + projectId + '/gis-drafts', { name: 'Recovered GIS draft', data }).then(response => {
      const draft = response.data.draft;
      setDrafts([draft]);
      setActiveDraftId(draft.draftId);
      setFeatures(legacyFeatures);
      lastSavedDataRef.current = JSON.stringify(data);
      setMessage('Your previously saved GIS layers were recovered into a named draft.');
    }).catch(error => setMessage(error instanceof Error ? error.message : 'The previous GIS layers could not be migrated.'));
  }, [draftsLoaded, drafts.length, initialData, projectId]);

  const refreshServerStatus = useCallback(async () => {
    setCheckingServer(true);
    try {
      const response = await api.get('/api/gis/status');
      const status = response.data as GisServerStatus;
      setServerStatus(status);
      setSelectedWmsLayer(status.wmsLayers?.[0] || '');
      setSelectedWfsLayer(status.wfsLayers?.[0] || '');
      setShowQgisWms(false);
    } catch {
      setServerStatus({ configured: false, connected: false, message: 'Connection status could not be loaded.' });
    } finally {
      setCheckingServer(false);
    }
  }, []);

  useEffect(() => {
    void refreshServerStatus();
  }, [refreshServerStatus]);

  async function importQgisWfsLayer() {
    if (!selectedWfsLayer) {
      setMessage('Select a published QGIS WFS layer first.');
      return;
    }
    setWfsBusy(true);
    try {
      const response = await api.post('/api/gis/ogc/features', { typeName: selectedWfsLayer, limit: 5000 });
      const imported = fromGeoJSON(response.data.featureCollection);
      if (!imported.length) {
        setMessage('QGIS WFS connection is working, but this published layer currently contains zero features. Add or publish data to the QGIS project before importing.');
        return;
      }
      setFeatures(rows => [...rows, ...imported]);
      setMessage('Imported ' + imported.length + ' feature(s) from the real QGIS Server WFS layer: ' + selectedWfsLayer + '. Save the active GIS draft to retain them.');
    } catch (error) {
      setMessage(error instanceof Error ? 'QGIS WFS import failed: ' + error.message : 'QGIS WFS import failed.');
    } finally {
      setWfsBusy(false);
    }
  }

  async function refreshSavedTerrainOutputs() {
    try {
      const response = await api.get('/api/projects/' + projectId + '/gis-terrain/outputs');
      setSavedTerrainOutputs(response.data.outputs || []);
      setTerrainOutputsAvailable(true);
    } catch (error) {
      setTerrainOutputsAvailable(false);
      const detail = error instanceof Error ? error.message : 'Saved terrain outputs could not be listed.';
      if (!/404|not found|unknown/i.test(detail)) setMessage('Saved terrain outputs could not be listed: ' + detail);
    }
  }

  async function downloadTerrainOutput(outputId: string) {
    try {
      const file = await api.download('/api/projects/' + projectId + '/gis-terrain/outputs/' + outputId);
      const url = URL.createObjectURL(file.blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = file.filename; document.body.appendChild(anchor); anchor.click(); anchor.remove();
      URL.revokeObjectURL(url);
      setMessage('Downloaded saved PyQGIS output: ' + file.filename);
    } catch (error) {
      setMessage(error instanceof Error ? 'Terrain output download failed: ' + error.message : 'Terrain output download failed.');
    }
  }

  async function runTerrainOperation(operation: 'profile' | 'compare' | 'least-cost' | 'contours' | 'slope' | 'analyze', payload: Record<string, unknown>) {
    setTerrainBusy(true); setTerrainResults(null);
    try {
      const response = await api.post('/api/projects/' + projectId + '/gis-terrain/' + operation, payload);
      const result = response.data as any;
      setTerrainResults({ operation, ...result, generatedAt: new Date().toISOString() });
      if (result.contours?.features?.length) setFeatures(rows => [...rows, ...fromGeoJSON(result.contours)]);
      setMessage('PyQGIS processing completed using ' + (result.dem?.source || 'terrain service') + '. Verify terrain resolution and survey data before design use.');
      await refreshSavedTerrainOutputs();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'PyQGIS terrain processing failed. Check service connection and retry.');
    } finally { setTerrainBusy(false); }
  }

  function pipelineRoutes() {
    return features.filter(f => f.type === 'LineString' && (f.category === 'Pipeline' || f.properties?.hydraulicLinkType === 'pipe'));
  }
  function selectedPipelineRoute() {
    return features.find(f => f.id === selectedId && f.type === 'LineString' && (f.category === 'Pipeline' || f.properties?.hydraulicLinkType === 'pipe'));
  }
  function projectTerrainBounds() {
    if (!features.length) return null;
    const b = turf.bbox({ type: 'FeatureCollection', features: features.map(featureToGeoJSON) } as any);
    return { west:b[0]-.002, south:b[1]-.002, east:b[2]+.002, north:b[3]+.002 };
  }
  async function generateSelectedPipelineProfile() {
    const route = selectedPipelineRoute();
    if (!route) { setMessage('Select a pipeline line first.'); return; }
    await runTerrainOperation('profile',{spacingM:Number(profileSpacing),routes:[{id:route.id,name:route.name,coordinates:route.coordinates}]});
  }
  async function comparePipelineRoutes() {
    const routes=pipelineRoutes();
    if(routes.length<2){setMessage('Draw at least two pipeline alternatives to compare.');return;}
    await runTerrainOperation('compare',{spacingM:Number(profileSpacing),routes:routes.slice(0,20).map(r=>({id:r.id,name:r.name,coordinates:r.coordinates}))});
  }
  async function generateLeastCostPipelineRoute() {
    const points=features.filter(f=>f.type==='Point'); const a=points.find(f=>f.id===routeStartId), b=points.find(f=>f.id===routeEndId);
    if(!a||!b){setMessage('Select start and end GIS points for routing.');return;}
    setRouteBusy(true); setTerrainResults(null); setMessage('Requesting least-cost route from the PyQGIS DEM processor…');
    try {
      const response=await api.post('/api/projects/'+projectId+'/gis-terrain/least-cost',{start:a.coordinates,end:b.coordinates,slopeWeight:Number(routeSlopeWeight),gridSize:121,obstacles:features.filter(f=>f.type==='Polygon').map(featureToGeoJSON)});
      const result=response.data?.route;
      if(!Array.isArray(result?.coordinates)||result.coordinates.length<2) throw new Error('PyQGIS returned no valid route geometry.');
      const route=makeFeature('Least-cost route','Pipeline','LineString',result.coordinates);
      route.properties={routing_method:result.routing_method||'PyQGIS/GDAL DEM Dijkstra',dem_source:result.dem_source,dem_resolution_m:result.dem_resolution_m,terrain_cost:result.terrain_cost,route_length_m:result.length_m,max_sampled_slope_percent:result.max_slope_percent,total_ascent_m:result.total_ascent_m,slope_weight:result.slope_weight,grid_cells:Number(result.grid_rows||0)*Number(result.grid_columns||0)};
      setFeatures(rows=>[...rows,route]); setSelectedId(route.id);
      setTerrainResults({operation:'least-cost',...response.data,generatedAt:new Date().toISOString()});
      await refreshSavedTerrainOutputs();
      setMessage('PyQGIS least-cost route generated from '+(result.dem_source||'the terrain DEM')+'. Review the route against survey data and construction constraints before design.');
    } catch(e){setMessage(e instanceof Error?'PyQGIS least-cost routing failed: '+e.message:'PyQGIS least-cost routing failed.');} finally{setRouteBusy(false);}
  }
  async function generateTerrainAnalysis() {
    const bbox=projectTerrainBounds();
    if(!bbox){setMessage('Add a project boundary or GIS features first.');return;}
    await runTerrainOperation('analyze',{bbox,contourIntervalM:Number(contourInterval)});
  }
  async function checkTerrainService() {
    setTerrainStatusBusy(true);
    try {
      const bounds = projectTerrainBounds();
      const lat = bounds ? (bounds.south + bounds.north) / 2 : defaultCenter[0];
      const lon = bounds ? (bounds.west + bounds.east) / 2 : defaultCenter[1];
      const response = await api.post('/api/projects/' + projectId + '/gis-terrain/status', { lat, lon });
      setTerrainServiceStatus(response.data);
      await refreshSavedTerrainOutputs();
      const dem = response.data?.demAvailability;
      setMessage(dem?.recommended_resolution_m
        ? 'PyQGIS is online. Copernicus DEM coverage is available at approximately ' + dem.recommended_resolution_m + ' m for this project area.'
        : 'PyQGIS is online, but no public Copernicus DEM tile was found for this area. Import a local GeoTIFF DEM.');
    } catch (error) {
      setTerrainServiceStatus({ error: error instanceof Error ? error.message : 'Terrain service check failed.' });
      setMessage(error instanceof Error ? error.message : 'Could not contact the PyQGIS processing service.');
    } finally {
      setTerrainStatusBusy(false);
    }
  }

  function exportTerrainContours() {
    const data=terrainResults?.contours;
    if(!data?.features?.length){setMessage('No contour lines to export.');return;}
    download('rayanaqua-terrain-contours.geojson',JSON.stringify(data,null,2),'application/geo+json');
  }
  function exportTerrainProfile() {
    const routes=terrainResults?.routes||[];
    if(!routes.length){setMessage('Run a pipeline profile first.');return;}
    const rows=[['Route','Chainage_m','Elevation_m']];
    routes.forEach((r:any)=>r.profile_result.profile.forEach((p:any)=>rows.push([r.name,p.chainage_m,p.elevation_m??''])));
    download('rayanaqua-pipeline-ground-profile.csv',rows.map(r=>r.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\r\n'),'text/csv');
  }

  function profileChartPoints(profile: Array<{ chainage_m: number; elevation_m: number | null }>) {
    const valid = profile.filter(point => point.elevation_m !== null && Number.isFinite(point.elevation_m));
    if (valid.length < 2) return '';
    const min = Math.min(...valid.map(point => point.elevation_m as number));
    const max = Math.max(...valid.map(point => point.elevation_m as number));
    return valid.map((point, index) => {
      const x = 10 + (index / (valid.length - 1)) * 580;
      const y = max === min ? 60 : 110 - (((point.elevation_m as number) - min) / (max - min)) * 100;
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
  }

  function syncFromEpanet(persist = false) {
    const geo = hydraulicNetwork?.geo;
    if (!hydraulicNetwork?.nodes?.length || !geo?.nodes) {
      setMessage('No saved GIS coordinate reference is attached to this EPANET network. Import the network from GIS first; schematic-only INP coordinates cannot be treated as geographic coordinates.');
      return;
    }
    const existingByEpanetId = new Map(features.map(feature => [String(feature.properties?.epanetId || ''), feature]));
    const existingById = new Map(features.map(feature => [feature.id, feature]));
    const synchronized: Feature[] = [];
    hydraulicNetwork.nodes.forEach((node: any) => {
      const coordinate = geo.nodes[node.id];
      if (!Array.isArray(coordinate) || coordinate.length < 2) return;
      const componentId = String(geo.componentIds?.[node.id] || '');
      const previous = existingByEpanetId.get(node.id) || existingById.get(componentId);
      const id = String(geo.componentIds?.[node.id] || previous?.id || 'epanet-' + node.id);
      const properties = {
        ...(previous?.properties || {}),
        epanetId: node.id,
        rayanComponentId: id,
        hydraulicNodeType: node.kind,
        elevation_m: node.elevation,
        demand_lps: node.kind === 'J' ? node.demand : undefined,
        reservoir_head_m: node.kind === 'R' ? node.head : undefined,
        tank_initial_level_m: node.kind === 'T' ? node.initialLevel : undefined,
        tank_min_level_m: node.kind === 'T' ? node.minLevel : undefined,
        tank_max_level_m: node.kind === 'T' ? node.maxLevel : undefined,
        tank_diameter_m: node.kind === 'T' ? node.diameter : undefined,
        tank_min_volume_m3: node.kind === 'T' ? node.minVolume : undefined,
      };
      synchronized.push({ id, type: 'Point', name: previous?.name || node.id, category: node.kind === 'R' ? 'Reservoir' : node.kind === 'T' ? 'Tank' : 'Junction', coordinates: coordinate, properties });
    });
    hydraulicNetwork.links.forEach((link: any) => {
      const route = geo.routes?.[link.id];
      const start = geo.nodes[link.from];
      const end = geo.nodes[link.to];
      const coordinates = Array.isArray(route) && route.length >= 2 ? route : start && end ? [start, end] : null;
      if (!coordinates) return;
      const componentId = String(geo.componentIds?.[link.id] || '');
      const previous = existingByEpanetId.get(link.id) || existingById.get(componentId);
      const id = String(geo.componentIds?.[link.id] || previous?.id || 'epanet-' + link.id);
      const properties = {
        ...(previous?.properties || {}),
        epanetId: link.id,
        rayanComponentId: id,
        hydraulicLinkType: link.kind,
        from_node_id: link.from,
        to_node_id: link.to,
        diameter_mm: link.diameter,
        link_status: link.status,
        length_m: link.length,
        roughness_c: link.roughness,
        minor_loss_k: link.minorLoss,
        valve_type: link.valveType,
        valve_setting: link.setting,
        pump_curve: link.pumpCurve,
      };
      synchronized.push({ id, type: 'LineString', name: previous?.name || link.id, category: link.kind === 'pump' ? 'Pump' : link.kind === 'valve' ? 'Valve' : 'Pipeline', coordinates, properties });
    });
    if (!synchronized.length) {
      setMessage('No geographically referenced EPANET components were available to synchronize.');
      return;
    }
    const synchronizedIds = new Set(synchronized.map(feature => feature.id));
    const preserved = features.filter(feature => !synchronizedIds.has(feature.id) && !feature.properties?.epanetId && !feature.properties?.hydraulicNodeType && !feature.properties?.hydraulicLinkType);
    const merged = [...preserved, ...synchronized];
    setFeatures(merged);
    setSelectedId('');
    setMessage('Synchronized ' + synchronized.length + ' hydraulic components from EPANET while retaining unrelated GIS layers.');
    if (persist) {
      const collection = { type: 'FeatureCollection', features: merged.map(featureToGeoJSON) };
      void onSave({ format: 'GeoJSON', crs: 'OGC:CRS84 (longitude, latitude)', featureCollection: collection, savedAt: new Date().toISOString(), synchronizedFromEpanet: true });
    }
  }

  useEffect(() => {
    if (hydraulicNetwork?.geo?.nodes && Object.keys(hydraulicNetwork.geo.nodes).length) syncFromEpanet(true);
  }, [hydraulicNetwork]);

  async function sendToEpanet() {
    const collection = { type: 'FeatureCollection', features: features.map(featureToGeoJSON) };
    if (!collection.features.length) { setMessage('This GIS draft has no features to transfer.'); return; }
    if (!onSendToEpanet) { setMessage('EPANET transfer is unavailable in this workspace.'); return; }
    setDraftBusy(true); setMessage('Opening EPANET and saving the current GIS layers…');
    try {
      const savePromise = onSave({ format: 'GeoJSON', crs: 'OGC:CRS84 (longitude, latitude)', featureCollection: collection, savedAt: new Date().toISOString() });
      onSendToEpanet(collection.features);
      await savePromise;
    } catch (error) {
      setMessage('EPANET opened, but the GIS backup save failed: '+(error instanceof Error ? error.message : 'unknown save error')+'.');
    } finally { setDraftBusy(false); }
  }

  async function applyTerrainElevation(featureIds?: string[]) {
    const targets = features.filter(feature => feature.type === 'Point' && (!featureIds || featureIds.includes(feature.id)));
    if (!targets.length) { setMessage('There are no mapped point features to sample.'); return; }
    setElevationBusy(true);
    try {
      let updated = 0;
      for (let start = 0; start < targets.length; start += 100) {
        const batch = targets.slice(start, start + 100);
        const heights = await fetchTerrainElevations(batch.map(feature => {
          const c = feature.coordinates as number[];
          return { lat: c[1], lng: c[0] };
        }));
        const sampledAt = new Date().toISOString();
        setFeatures(rows => rows.map(feature => {
          const index = batch.findIndex(target => target.id === feature.id);
          if (index < 0) return feature;
          updated++;
          return { ...feature, properties: { ...feature.properties, elevation_m: heights[index], elevation_source: 'Copernicus DEM GLO-90 via Open-Meteo Elevation API', elevation_resolution_m: 90, elevation_method: 'Digital elevation model estimate', elevation_status: 'DEM_ESTIMATE', elevation_fetched_at: sampledAt } };
        }));
      }
      setMessage('Terrain elevations sampled for ' + updated + ' point(s). Source: Copernicus DEM GLO-90, approximately 90 m resolution. Check against survey levels before final design.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Terrain elevation lookup failed. Check your connection and retry.');
    } finally { setElevationBusy(false); }
  }

  function addPoint(lat: number, lng: number) {
    const nodeType = category === 'Water source' || category === 'Reservoir' ? 'R' : category === 'Junction' ? 'J' : category === 'Tank' ? 'T' : '';
    const initialProperties: Record<string, unknown> = nodeType ? { hydraulicNodeType: nodeType, ...(nodeType === 'J' ? { demand_lps: 0 } : {}) } : {};
    const feature = { ...makeFeature(name.trim() || category, category, 'Point', [lng, lat]), properties: initialProperties };
    setFeatures(rows => [...rows, feature]); setSelectedId(feature.id); setName(''); setMessage('Point added as ' + (nodeType === 'R' ? 'reservoir/source' : nodeType === 'J' ? 'junction' : nodeType === 'T' ? 'tank' : 'GIS point') + '. Looking up terrain elevation…');
    void fetchTerrainElevations([{ lat, lng }]).then(([height]) => {
      setFeatures(rows => rows.map(row => row.id === feature.id ? { ...row, properties: { ...row.properties, elevation_m: height, elevation_source: 'Copernicus DEM GLO-90 via Open-Meteo Elevation API', elevation_resolution_m: 90, elevation_method: 'Digital elevation model estimate', elevation_status: 'DEM_ESTIMATE', elevation_fetched_at: new Date().toISOString() } } : row));
      setMessage('Terrain height for ' + feature.name + ': ' + height.toFixed(2) + ' m (Copernicus DEM GLO-90, ~90 m resolution). Verify with survey data for final design.');
    }).catch(error => setMessage(error instanceof Error ? 'Point added, but terrain lookup failed: ' + error.message : 'Point added, but terrain lookup failed.'));
  }
  function addLinePoint(lat: number, lng: number) { setPendingLine(rows => [...rows, [lng, lat]]); setMessage('Pipeline vertices: ' + (pendingLine.length + 1) + '. Tap Finish pipeline when ready.'); }
  function finishLine() {
    if (pendingLine.length < 2) { setMessage('A pipeline needs at least two vertices.'); return; }
    const feature = { ...makeFeature(name.trim() || 'Pipeline ' + (summary.lines + 1), 'Pipeline', 'LineString', pendingLine), properties: { hydraulicLinkType: 'pipe', diameter_mm: 160, roughness_c: 130, minor_loss_k: 0, design_defaults_used: true } };
    setFeatures(rows => [...rows, feature]); setSelectedId(feature.id); setPendingLine([]); setName(''); setMessage('Pipeline line created.');
  }
  function addPolygonPoint(lat: number, lng: number) { setPendingPolygon(rows => [...rows, [lng, lat]]); setMessage('Boundary vertices: ' + (pendingPolygon.length + 1) + '. Add at least three, then finish.'); }
  function finishPolygon() {
    if (pendingPolygon.length < 3) { setMessage('A polygon needs at least three vertices.'); return; }
    const feature = makeFeature(name.trim() || 'Boundary ' + (summary.polygons + 1), 'Boundary', 'Polygon', [...pendingPolygon, pendingPolygon[0]]);
    setFeatures(rows => [...rows, feature]); setSelectedId(feature.id); setPendingPolygon([]); setName(''); setMessage('Polygon created.');
  }
  async function importFile(file?: File) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const imported = fromGeoJSON(parsed);
      if (!imported.length) throw new Error('No supported Point, LineString or Polygon features were found.');
      setFeatures(rows => [...rows, ...imported]); setMessage('Imported ' + imported.length + ' GeoJSON features.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not read GeoJSON.'); }
    if (fileRef.current) fileRef.current.value = '';
  }
  function exportFile() {
    const collection = { type: 'FeatureCollection', features: features.map(featureToGeoJSON) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(collection, null, 2)], { type: 'application/geo+json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'rayanaqua-' + (projectTitle || 'gis-project').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.geojson'; anchor.click(); URL.revokeObjectURL(url);
    setMessage('GeoJSON export prepared.');
  }
  function draftData() {
    return { format: 'GeoJSON', crs: 'OGC:CRS84 (longitude, latitude)', featureCollection: { type: 'FeatureCollection', features: features.map(featureToGeoJSON) }, savedAt: new Date().toISOString() };
  }
  async function createDraft(copyCurrent = false) {
    const draftName = draftNameInput.trim() || 'GIS draft ' + (drafts.length + 1);
    setDraftBusy(true);
    try {
      const sourceFeatures = copyCurrent ? features : [];
      const data = { ...draftData(), featureCollection: { type: 'FeatureCollection', features: sourceFeatures.map(featureToGeoJSON) } };
      const response = await api.post('/api/projects/' + projectId + '/gis-drafts', { name: draftName.trim(), data });
      const created = response.data.draft;
      setDrafts(rows => [created, ...rows]);
      lastSavedDataRef.current = JSON.stringify(data);
      setActiveDraftId(created.draftId);
      setFeatures(sourceFeatures);
      setSelectedId(''); setPendingLine([]); setPendingPolygon([]);
      try { await onSave(data); setMessage('Created and saved "' + created.name + '". It will remain in this project until you delete it.'); }
      catch (backupError) { setMessage('GIS draft "' + created.name + '" was saved. The secondary project GIS document could not be updated: ' + (backupError instanceof Error ? backupError.message : 'unknown error') + '.'); }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not create the GIS draft.');
    } finally { setDraftBusy(false); }
  }
  async function openDraft(draft: any) {
    if (draft.draftId === activeDraftId) return;
    if (!window.confirm('Open "' + draft.name + '"? Unsaved changes in the current working draft will be replaced. Save them first if you need them.')) return;
    setDraftBusy(true);
    try {
      const response = await api.get('/api/projects/' + projectId + '/gis-drafts');
      const latest = (response.data.drafts || []).find((row: any) => row.draftId === draft.draftId);
      if (!latest) throw new Error('That saved draft could not be found. Refresh the draft list.');
      setDrafts(response.data.drafts || []);
      setActiveDraftId(latest.draftId);
      setFeatures(fromGeoJSON(latest.data));
      lastSavedDataRef.current = JSON.stringify(latest.data);
      setSelectedId(''); setPendingLine([]); setPendingPolygon([]);
      setMessage('Opened saved draft: ' + latest.name);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not open this draft.'); }
    finally { setDraftBusy(false); }
  }
  async function save() {
    const data = draftData();
    setDraftBusy(true);
    try {
      if (activeDraftId) {
        const response = await api.put('/api/projects/' + projectId + '/gis-drafts/' + activeDraftId, { data });
        const updated = response.data.draft;
        setDrafts(rows => rows.map(row => row.draftId === activeDraftId ? updated : row).sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt))));
      } else {
        const draftName = draftNameInput.trim() || 'GIS draft ' + (drafts.length + 1);
        const response = await api.post('/api/projects/' + projectId + '/gis-drafts', { name: draftName, data });
        const created = response.data.draft;
        setDrafts(rows => [created, ...rows]);
        setActiveDraftId(created.draftId);
      }
      lastSavedDataRef.current = JSON.stringify(data);
      try { await onSave(data); setMessage('Saved GIS draft. It is stored under this project and will not be removed unless you explicitly delete it.'); }
      catch (backupError) { setMessage('GIS draft was saved successfully. The secondary project GIS document could not be updated: ' + (backupError instanceof Error ? backupError.message : 'unknown error') + '.'); }
    } catch (error) { setMessage(error instanceof Error ? error.message : 'GIS draft could not be saved.'); }
    finally { setDraftBusy(false); }
  }
  async function deleteDraft(draft: any) {
    if (!window.confirm('Permanently delete the saved GIS draft "' + draft.name + '"? This cannot be undone.')) return;
    setDraftBusy(true);
    try {
      await api.delete('/api/projects/' + projectId + '/gis-drafts/' + draft.draftId);
      setDrafts(rows => rows.filter(row => row.draftId !== draft.draftId));
      if (activeDraftId === draft.draftId) setActiveDraftId('');
      setMessage('Deleted "' + draft.name + '" only after your confirmation. Other drafts are unchanged.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Draft could not be deleted.'); }
    finally { setDraftBusy(false); }
  }
  function removeSelected() { setFeatures(rows => rows.filter(f => f.id !== selectedId)); setSelectedId(''); setMessage('Selected feature removed.'); }

  useEffect(() => {
    if (!draftsLoaded || !activeDraftId) return;
    const data = draftData();
    const serialized = JSON.stringify(data);
    if (serialized === lastSavedDataRef.current) return;
    const timer = window.setTimeout(async () => {
      try {
        const response = await api.put('/api/projects/' + projectId + '/gis-drafts/' + activeDraftId, { data });
        const updated = response.data.draft;
        lastSavedDataRef.current = serialized;
        setDrafts(rows => rows.map(row => row.draftId === activeDraftId ? updated : row).sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt))));
        await onSave(data);
        setMessage('All GIS feature details automatically saved to the active draft.');
      } catch (error) {
        setMessage(error instanceof Error ? 'Automatic GIS save failed: ' + error.message + '. Use Save active draft to retry.' : 'Automatic GIS save failed. Use Save active draft to retry.');
      }
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [features, activeDraftId, draftsLoaded, projectId]);

  return (
    <div className="gis-workspace">
      <div className="active-project-strip">
        <span>
          <Waves size={16} />
          <strong>QGIS Server: {serverStatus.projectReady ? 'WMS / WFS ready' : serverStatus.connected ? 'Server online · project not ready' : serverStatus.configured ? 'Unavailable' : 'Setup pending'}</strong>
          <small>{serverStatus.message}</small>
        </span>
        <button className="secondary-button" onClick={refreshServerStatus} disabled={checkingServer}>
          {checkingServer ? 'Checking…' : 'Check QGIS services'}
        </button>
      </div>
      {serverStatus.projectReady && <div className="gis-tool-group" style={{margin:'0 0 12px',padding:12,border:'1px solid var(--line, #d8e1e8)',borderRadius:10,background:'var(--panel, #fff)',display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
        <strong style={{fontSize:13}}>Live QGIS OGC services</strong>
        <label style={{fontSize:12}}>WMS map layer
          <select className="gis-input" style={{minWidth:145,marginLeft:6}} value={selectedWmsLayer} onChange={e => setSelectedWmsLayer(e.target.value)}>
            {(serverStatus.wmsLayers || []).map(layer => <option key={layer} value={layer}>{layer}</option>)}
          </select>
        </label>
        <button className={showQgisWms ? 'primary-button' : 'secondary-button'} onClick={() => setShowQgisWms(value => !value)} disabled={!selectedWmsLayer}>
          {showQgisWms ? 'Hide QGIS WMS overlay' : 'Show QGIS WMS overlay'}
        </button>
        <label style={{fontSize:12}}>WFS feature layer
          <select className="gis-input" style={{minWidth:145,marginLeft:6}} value={selectedWfsLayer} onChange={e => setSelectedWfsLayer(e.target.value)}>
            {(serverStatus.wfsLayers || []).map(layer => <option key={layer} value={layer}>{layer}</option>)}
          </select>
        </label>
        <button className="secondary-button" onClick={() => void importQgisWfsLayer()} disabled={!selectedWfsLayer || wfsBusy}>
          {wfsBusy ? 'Reading WFS…' : 'Import WFS features'}
        </button>
        <small style={{flexBasis:'100%',fontSize:11,opacity:.72}}>WMS displays the QGIS Server-rendered map. WFS reads published vector features into this project draft. The starter QGIS project contains empty engineering layers until you add data.</small>
      </div>}
      <div className="gis-draft-manager" style={{marginBottom:16,padding:16,border:'1px solid var(--line, #d8e1e8)',borderRadius:12,background:'var(--panel, #fff)'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,flexWrap:'wrap'}}>
          <div><strong><FolderOpen size={16} style={{verticalAlign:'middle',marginRight:7}}/>Saved GIS drafts</strong><div style={{fontSize:12,opacity:.72,marginTop:4}}>{drafts.length} saved draft(s) · {activeDraftId ? 'Active: ' + (drafts.find(row => row.draftId === activeDraftId)?.name || 'working copy') : 'No saved draft selected'}</div></div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            <input aria-label="GIS draft name" value={draftNameInput} onChange={e => setDraftNameInput(e.target.value)} placeholder={'GIS draft ' + (drafts.length + 1)} maxLength={100} className="gis-input" style={{minWidth:150,maxWidth:220}} />
            <button className="secondary-button" onClick={() => void createDraft(false)} disabled={draftBusy}><Plus size={15}/> New blank draft</button>
            <button className="secondary-button" onClick={() => void createDraft(true)} disabled={draftBusy || !features.length}><Copy size={15}/> Save as new draft</button>
            <button className="primary-button" onClick={save} disabled={draftBusy}><Save size={15}/> {draftBusy ? 'Saving…' : 'Save active draft'}</button>
          </div>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:12}}>
          {!drafts.length && <span style={{fontSize:13,opacity:.7}}>No named drafts yet. Create a draft before starting a new design.</span>}
          {drafts.map(draft => <div key={draft.draftId} style={{display:'flex',alignItems:'center',gap:6,padding:'7px 9px',borderRadius:9,border:'1px solid ' + (draft.draftId === activeDraftId ? '#16866b' : 'var(--line, #d8e1e8)'),background:draft.draftId === activeDraftId ? 'rgba(22,134,107,.08)' : 'transparent'}}>
            <button className="secondary-button" style={{padding:'5px 8px'}} onClick={() => void openDraft(draft)} disabled={draftBusy || draft.draftId === activeDraftId} title={draft.draftId === activeDraftId ? 'This draft is currently open' : 'Open this saved GIS draft for editing'}><FolderOpen size={14}/>{draft.draftId === activeDraftId ? 'Open: ' : 'Open draft: '}{draft.name}</button>
            <span style={{fontSize:11,opacity:.65}}>{new Date(draft.updatedAt).toLocaleDateString()}</span>
            <button className="icon-button" title={'Delete ' + draft.name} aria-label={'Delete ' + draft.name} onClick={() => void deleteDraft(draft)} disabled={draftBusy}><Trash2 size={14}/></button>
          </div>)}
        </div>
      </div>
      {hydraulicSimulation && <div className="gis-tool-group" style={{margin:'0 0 12px',padding:12,border:'1px solid var(--line, #d8e1e8)',borderRadius:10,background:'var(--panel, #fff)'}}>
        <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
          <strong style={{fontSize:13}}>EPANET simulation result overlays</strong>
          {snapshots.length>0 && <label className="gis-label">Simulation time<select className="gis-input" value={String(overlayStep<0?snapshots.length-1:overlayStep)} onChange={e=>setOverlayStep(Number(e.target.value))}>{snapshots.map((shot:any,i:number)=><option key={i} value={i}>Period {i+1} · {Number(shot.timeHours).toFixed(2)} h</option>)}</select></label>}
          <label className="gis-label">Map result<select className="gis-input" value={overlayMetric} onChange={e=>setOverlayMetric(e.target.value as typeof overlayMetric)}><option value="compliance">Engineering compliance</option><option value="pressure">Junction pressure (m)</option><option value="flow">Link flow (L/s)</option><option value="velocity">Pipe velocity (m/s)</option><option value="headloss">Link headloss (EPANET units)</option></select></label>
          <span style={{fontSize:11,opacity:.7}}>{overlayMetric==='compliance'?'Red = outside configured criteria · green = pass':overlayValues.length?`Range ${overlayRange.min.toFixed(2)}–${overlayRange.max.toFixed(2)} · low to high`:'No matching simulation results'}</span>
        </div>
        {overlayMetric!=='compliance' && <div style={{display:'flex',gap:4,alignItems:'center',marginTop:8}}>{['#2563a6','#1595b5','#36a56b','#d4a72c','#c54f45'].map(c=><span key={c} style={{height:8,flex:1,background:c,borderRadius:4}}/>)}<small style={{fontSize:10,opacity:.7,marginLeft:5}}>Low → High</small></div>}
        <small style={{display:'block',fontSize:10,opacity:.7,marginTop:6}}>Map values show the selected hydraulic time step; pressure is shown at junctions and link metrics on mapped pipes, pumps and valves.</small>
      </div>}
      <div className="gis-tool-group" style={{margin:'0 0 12px',padding:12,border:'1px solid var(--line, #d8e1e8)',borderRadius:10,background:'var(--panel, #fff)'}}>
        <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
          <strong style={{fontSize:13,flexBasis:'100%'}}>Terrain analysis and pipeline routing</strong>
          <label className="gis-label">Route start<select className="gis-input" value={routeStartId} onChange={e=>setRouteStartId(e.target.value)}><option value="">Choose point…</option>{features.filter(f=>f.type==='Point').map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
          <label className="gis-label">Route end<select className="gis-input" value={routeEndId} onChange={e=>setRouteEndId(e.target.value)}><option value="">Choose point…</option>{features.filter(f=>f.type==='Point').map(f=><option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
          <label className="gis-label">Slope cost weight<input className="gis-input" type="number" min="0" max="100" step="1" value={routeSlopeWeight} onChange={e=>setRouteSlopeWeight(e.target.value)} style={{width:90}}/></label>
          <button className="primary-button" onClick={()=>void generateLeastCostPipelineRoute()} disabled={routeBusy}>{routeBusy?'Finding route…':'Generate DEM-grid least-cost route'}</button>
          <label className="gis-label">Profile spacing (m)<input className="gis-input" type="number" min="5" max="500" step="5" value={profileSpacing} onChange={e=>setProfileSpacing(e.target.value)} style={{width:120}}/></label>
          <button className="secondary-button" onClick={()=>void generateSelectedPipelineProfile()} disabled={terrainBusy}>{terrainBusy?'Processing…':'Pipeline ground profile'}</button>
          <button className="secondary-button" onClick={()=>void comparePipelineRoutes()} disabled={terrainBusy}>Compare routes ({pipelineRoutes().length})</button>
          <label className="gis-label">Contour interval (m)<input className="gis-input" type="number" min="0.5" max="100" step="0.5" value={contourInterval} onChange={e=>setContourInterval(e.target.value)} style={{width:120}}/></label>
          <button className="primary-button" onClick={()=>void generateTerrainAnalysis()} disabled={terrainBusy||!features.length}>{terrainBusy?'Running PyQGIS…':'Generate contours + slope'}</button>
          <button className="secondary-button" onClick={()=>void checkTerrainService()} disabled={terrainStatusBusy}>{terrainStatusBusy?'Checking DEM…':'Check PyQGIS / DEM coverage'}</button>
        </div>
        <small style={{display:'block',marginTop:6,opacity:.72}}>The least-cost route uses a local 17 × 17 grid and public DEM elevation samples. Ground profiles, route comparisons, contours and slope analysis are separate PyQGIS-service operations. DEM values are terrain estimates, not surveyed ground levels; verify with survey data before final design.</small>
        {terrainServiceStatus&&<small style={{display:'block',marginTop:6}}>
          {terrainServiceStatus.error ? 'PyQGIS status: '+terrainServiceStatus.error :
            'PyQGIS '+(terrainServiceStatus.service?.status==='ok'?'online':'unavailable')+' · GLO-30 '+(terrainServiceStatus.demAvailability?.copernicus_glo30_available?'available':'not available')+' · GLO-90 '+(terrainServiceStatus.demAvailability?.copernicus_glo90_available?'available':'not available')+' · tile '+terrainServiceStatus.demAvailability?.tile}
        </small>}
        {terrainOutputsAvailable ? <div style={{marginTop:10,paddingTop:10,borderTop:'1px solid var(--line, #d8e1e8)'}}>
          <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
            <strong style={{fontSize:12}}>Saved PyQGIS project outputs · {savedTerrainOutputs.length}</strong>
            <button className="secondary-button" onClick={()=>void refreshSavedTerrainOutputs()}>Refresh saved outputs</button>
          </div>
          {savedTerrainOutputs.map((output:any)=><div key={output.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,flexWrap:'wrap',padding:'7px 0',borderBottom:'1px solid var(--line, #e3e9ed)'}}>
            <span style={{fontSize:11}}><strong>{String(output.operation||'Terrain output').replace('-',' ')}</strong> · {output.format==='image/tiff'?'GeoTIFF raster':'JSON / GeoJSON'} · {output.created_at?new Date(output.created_at).toLocaleString():'Saved'}</span>
            <button className="secondary-button" onClick={()=>void downloadTerrainOutput(output.id)}>Download output</button>
          </div>)}
          {!savedTerrainOutputs.length&&<small style={{fontSize:11,opacity:.7}}>No saved terrain outputs for this project yet.</small>}
        </div> : <div style={{marginTop:10,paddingTop:10,borderTop:'1px solid var(--line, #d8e1e8)',display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
          <small style={{fontSize:11,opacity:.7}}>Persistent terrain-output downloads become available after the staged PyQGIS service update is deployed.</small>
          <button className="secondary-button" onClick={()=>void refreshSavedTerrainOutputs()}>Check output archive</button>
        </div>}
        {terrainResults&&<div style={{marginTop:10,paddingTop:10,borderTop:'1px solid var(--line, #d8e1e8)'}}>
          <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
            <strong>{terrainResults.operation==='compare'?'Pipeline route comparison':terrainResults.operation==='profile'?'Pipeline ground profile':'Terrain analysis results'}</strong>
            <span style={{fontSize:11,opacity:.7}}>{terrainResults.dem?.source} · {terrainResults.dem?.resolution_m} m · {terrainResults.dem?.crs}</span>
            {terrainResults.contours?.features?.length>0&&<button className="secondary-button" onClick={exportTerrainContours}>Export contours GeoJSON</button>}
            {terrainResults.routes?.length>0&&<button className="secondary-button" onClick={exportTerrainProfile}>Export profile CSV</button>}
          </div>
          {terrainResults.routes?.map((r:any)=><div key={r.id} style={{marginTop:8,padding:8,border:'1px solid var(--line, #d8e1e8)',borderRadius:8}}>
            <strong>{r.rank?'Rank '+r.rank+' · ':''}{r.name}</strong>
            <div style={{fontSize:12,display:'flex',gap:12,flexWrap:'wrap',marginTop:4}}>
              <span>Length {r.profile_result.length_m.toFixed(1)} m</span><span>Elevation {r.profile_result.minimum_elevation_m.toFixed(1)}–{r.profile_result.maximum_elevation_m.toFixed(1)} m</span><span>Rise {r.profile_result.total_ascent_m.toFixed(1)} m</span><span>Fall {r.profile_result.total_descent_m.toFixed(1)} m</span><span>Max uphill {r.profile_result.maximum_uphill_grade_percent.toFixed(1)}%</span>
            </div>
            <svg viewBox="0 0 600 120" role="img" aria-label={'Terrain elevation profile for '+r.name} style={{width:'100%',height:120,marginTop:8,background:'var(--surface, #f4f7f9)',borderRadius:6}}>
              <polyline fill="none" stroke="#1686b4" strokeWidth="3" points={profileChartPoints(r.profile_result.profile)}/>
            </svg>
            <div style={{display:'flex',justifyContent:'space-between',fontSize:10,opacity:.7}}><span>0 m chainage</span><span>{r.profile_result.length_m.toFixed(1)} m</span><span>{r.profile_result.minimum_elevation_m.toFixed(1)}–{r.profile_result.maximum_elevation_m.toFixed(1)} m elevation</span></div>
          </div>)}
          {terrainResults.slope&&<div style={{marginTop:8,fontSize:12}}><strong>Slope analysis</strong>: mean {terrainResults.slope.mean_slope_degrees}°, maximum {terrainResults.slope.maximum_slope_degrees}° across {terrainResults.slope.cell_count.toLocaleString()} cells
            <div style={{display:'flex',gap:10,flexWrap:'wrap',marginTop:4}}>{Object.entries(terrainResults.slope.slope_classes_percent).map(([k,v])=><span key={k}>{k.replaceAll('_','–')}°: {String(v)}%</span>)}</div>
          </div>}
          {terrainResults.contours&&<small style={{display:'block',marginTop:6}}>{terrainResults.contours.features.length} contour lines generated and added to the GIS layer list.</small>}
        </div>}
      </div>
      <div className="gis-toolbar">
        <div className="gis-tool-group">
          <button className="secondary-button" onClick={() => void applyTerrainElevation()} disabled={elevationBusy || !features.some(feature => feature.type === 'Point')}><Mountain size={15}/>{elevationBusy ? 'Sampling elevations…' : 'Fetch terrain elevations'}</button>
          <button className="secondary-button" onClick={() => syncFromEpanet()} disabled={!hydraulicNetwork?.geo?.nodes}>Synchronize from EPANET</button>
          <button className="primary-button" onClick={sendToEpanet} disabled={!features.length || draftBusy}>{draftBusy ? "Opening EPANET…" : "Save and open EPANET"}</button>
        </div>
        <div className="gis-tool-group">
          <button className={mode === 'select' ? 'gis-tool active' : 'gis-tool'} onClick={() => setMode('select')}><MousePointer2 size={16}/> Select</button>
          <button className={mode === 'point' ? 'gis-tool active' : 'gis-tool'} onClick={() => setMode('point')}><MapPin size={16}/> Point</button>
          <button className={mode === 'line' ? 'gis-tool active' : 'gis-tool'} onClick={() => setMode('line')}><Route size={16}/> Pipeline</button>
          <button className={mode === 'polygon' ? 'gis-tool active' : 'gis-tool'} onClick={() => setMode('polygon')}><Pentagon size={16}/> Area</button>
        </div>
        <div className="gis-tool-group">
          <button className="secondary-button" onClick={() => setShowSatellite(v => !v)}><Layers3 size={15}/>{showSatellite ? 'Street map' : 'Satellite'}</button>
          <button className="secondary-button" onClick={() => fileRef.current?.click()}><FileUp size={15}/> Import</button>
          <input ref={fileRef} type="file" accept=".geojson,.json,application/geo+json,application/json" hidden onChange={e => importFile(e.target.files?.[0])}/>
          <button className="secondary-button" onClick={exportFile} disabled={!features.length}><Download size={15}/> Export</button>
          <button className="primary-button" onClick={save}><Save size={15}/> Save layers</button>
        </div>
      </div>
      <div className="gis-layout">
        <aside className="gis-side-panel">
          <div className="gis-panel-heading"><strong>Feature layers</strong><span>{features.length} items</span></div>
          <label className="gis-label">Feature name</label>
          <input className="gis-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Voi River intake"/>
          <label className="gis-label">Feature category</label>
          <select className="gis-input" value={category} onChange={e => setCategory(e.target.value)}>{Object.keys(palette).map(item => <option key={item}>{item}</option>)}</select>
          <div className="gis-counts"><span>{summary.points} points</span><span>{summary.lines} lines</span><span>{summary.polygons} areas</span></div>
          {mode === 'line' && <button className="primary-button full" onClick={finishLine} disabled={pendingLine.length < 2}>Finish pipeline ({pendingLine.length} vertices)</button>}
          {mode === 'polygon' && <button className="primary-button full" onClick={finishPolygon} disabled={pendingPolygon.length < 3}>Finish boundary ({pendingPolygon.length} vertices)</button>}
          <div className="gis-feature-list">
            {features.map(feature => <button key={feature.id} className={selectedId === feature.id ? 'gis-feature selected' : 'gis-feature'} onClick={() => setSelectedId(feature.id)}><span className="gis-swatch" style={{background: palette[feature.category] || palette.Other}}/><span><strong>{feature.name}</strong><small>{feature.category} · {feature.type}</small></span></button>)}
            {!features.length && <p className="gis-empty">No features yet. Add a point, pipeline or area on the map.</p>}
          </div>
          {selected && <div className="gis-inspector">
            <div className="gis-panel-heading"><strong>Feature details</strong><button className="gis-delete" onClick={removeSelected}><Trash2 size={14}/></button></div>
            <strong>{selected.name}</strong><small>{selected.category}</small>
            {selected.type === 'LineString' && <p>Mapped length: {((geometryMetrics(selected) as any).length || 0).toFixed(2)} m</p>}
            {selected.type === 'Polygon' && <p>Area: {(((geometryMetrics(selected) as any).area || 0) / 10000).toFixed(3)} ha</p>}
            {selected.type === 'Point' && <>
              <p>Coordinates: {((geometryMetrics(selected) as any).coordinates || [0,0])[1].toFixed(6)}, {((geometryMetrics(selected) as any).coordinates || [0,0])[0].toFixed(6)}</p>
              <label className="gis-label">EPANET node type</label>
              <select className="gis-input" value={String(selected.properties?.hydraulicNodeType || '')} onChange={e => setFeatures(rows => rows.map(f => f.id === selected.id ? {...f, properties:{...f.properties, hydraulicNodeType:e.target.value}} : f))}>
                <option value="">Not assigned</option><option value="J">Junction</option><option value="R">Reservoir</option><option value="T">Tank</option>
              </select>
              <label className="gis-label">Ground / node elevation (m)</label>
              <input className="gis-input" type="number" step="any" placeholder="Fetch from terrain or enter survey level" value={String(selected.properties?.elevation_m ?? '')} onChange={e => setFeatures(rows => rows.map(f => f.id === selected.id ? {...f, properties:{...f.properties, elevation_m:e.target.value === '' ? '' : Number(e.target.value), elevation_status:'MANUAL_OVERRIDE', elevation_source:'User-entered value'}} : f))}/>
              {selected.properties?.elevation_source && <small>Source: {String(selected.properties.elevation_source)}{selected.properties?.elevation_resolution_m ? ' · ~' + String(selected.properties.elevation_resolution_m) + ' m grid' : ''}{selected.properties?.elevation_status === 'DEM_ESTIMATE' ? ' · DEM estimate, not surveyed' : ' · manually entered'}</small>}
              <button className="secondary-button" onClick={() => void applyTerrainElevation([selected.id])} disabled={elevationBusy}><Mountain size={14}/> {elevationBusy ? 'Sampling…' : 'Refresh terrain height'}</button>
              {selected.properties?.hydraulicNodeType === 'J' && <><label className="gis-label">Demand (L/s)</label><input className="gis-input" type="number" min="0" step="any" value={String(selected.properties?.demand_lps ?? '')} onChange={e => setFeatures(rows => rows.map(f => f.id === selected.id ? {...f, properties:{...f.properties, demand_lps:e.target.value === '' ? '' : Number(e.target.value)}} : f))}/></>}
              {selected.properties?.hydraulicNodeType === 'R' && <><label className="gis-label">Reservoir hydraulic head (m)</label><input className="gis-input" type="number" step="any" value={String(selected.properties?.reservoir_head_m ?? '')} onChange={e => setFeatures(rows => rows.map(f => f.id === selected.id ? {...f, properties:{...f.properties, reservoir_head_m:e.target.value === '' ? '' : Number(e.target.value)}} : f))}/></>}
              {selected.properties?.hydraulicNodeType === 'T' && <>
                {(['tank_initial_level_m','tank_min_level_m','tank_max_level_m','tank_diameter_m'] as const).map((key,i)=><label className="gis-label" key={key}>{['Initial water level (m)','Minimum water level (m)','Maximum water level (m)','Tank diameter (m)'][i]}<input className="gis-input" type="number" step="any" value={String(selected.properties?.[key] ?? '')} onChange={e => setFeatures(rows => rows.map(f => f.id === selected.id ? {...f, properties:{...f.properties, [key]:e.target.value === '' ? '' : Number(e.target.value)}} : f))}/></label>)}
                <label className="gis-label">Minimum volume (m³)<input className="gis-input" type="number" min="0" step="any" value={String(selected.properties?.tank_min_volume_m3 ?? '0')} onChange={e => setFeatures(rows => rows.map(f => f.id === selected.id ? {...f, properties:{...f.properties, tank_min_volume_m3:e.target.value === '' ? '' : Number(e.target.value)}} : f))}/></label>
              </>}
            </>}
            {selected.type === 'LineString' && <>
              <label className="gis-label">Hydraulic link component</label>
              <select className="gis-input" value={String(selected.properties?.hydraulicLinkType || 'pipe')} onChange={e => setFeatures(rows => rows.map(f => f.id === selected.id ? {...f, properties:{...f.properties, hydraulicLinkType:e.target.value}} : f))}><option value="pipe">Pipe</option><option value="pump">Pump</option><option value="valve">Valve</option></select>
                            <label className="gis-label">Upstream node</label><select className="gis-input" value={String(selected.properties?.from_node_id || '')} onChange={e => setFeatures(rows => rows.map(f => f.id === selected.id ? {...f, properties:{...f.properties, from_node_id:e.target.value}} : f))}><option value="">Select upstream node</option>{features.filter(f => f.type === 'Point' && f.properties?.hydraulicNodeType).map(f => <option key={f.id} value={String(f.properties?.epanetId || f.id)}>{f.name}</option>)}</select>
              <label className="gis-label">Downstream node</label><select className="gis-input" value={String(selected.properties?.to_node_id || '')} onChange={e => setFeatures(rows => rows.map(f => f.id === selected.id ? {...f, properties:{...f.properties, to_node_id:e.target.value}} : f))}><option value="">Select downstream node</option>{features.filter(f => f.type === 'Point' && f.properties?.hydraulicNodeType).map(f => <option key={f.id} value={String(f.properties?.epanetId || f.id)}>{f.name}</option>)}</select>
              {selected.properties?.hydraulicLinkType === 'valve' && <><label className="gis-label">Valve type</label><select className="gis-input" value={String(selected.properties?.valve_type || 'PRV')} onChange={e => setFeatures(rows => rows.map(f => f.id === selected.id ? {...f, properties:{...f.properties, valve_type:e.target.value}} : f))}>{['PRV','PSV','PBV','FCV','TCV','GPV'].map(v => <option key={v}>{v}</option>)}</select>{selected.properties?.valve_type === 'GPV' ? <><label className="gis-label">GPV flow : headloss curve (L/s : m)</label><input className="gis-input" value={String(selected.properties?.valve_curve || '10:5, 20:10, 30:18')} onChange={e => setFeatures(rows => rows.map(f => f.id === selected.id ? {...f, properties:{...f.properties, valve_curve:e.target.value}} : f))}/></> : <><label className="gis-label">Valve setting</label><input className="gis-input" type="number" step="any" value={String(selected.properties?.valve_setting ?? '')} onChange={e => setFeatures(rows => rows.map(f => f.id === selected.id ? {...f, properties:{...f.properties, valve_setting:Number(e.target.value)}} : f))}/></>}</>}
              {selected.properties?.hydraulicLinkType === 'pump' && <><label className="gis-label">Pump design flow (L/s)</label><input className="gis-input" type="number" min="0" step="any" value={String(selected.properties?.pump_flow_lps ?? '')} onChange={e => setFeatures(rows => rows.map(f => f.id === selected.id ? {...f, properties:{...f.properties, pump_flow_lps:e.target.value === '' ? '' : Number(e.target.value), pump_curve:e.target.value === '' ? '' : e.target.value + ':' + String(f.properties?.pump_head_m ?? '')}} : f))}/><label className="gis-label">Pump design head (m)</label><input className="gis-input" type="number" min="0" step="any" value={String(selected.properties?.pump_head_m ?? '')} onChange={e => setFeatures(rows => rows.map(f => f.id === selected.id ? {...f, properties:{...f.properties, pump_head_m:e.target.value === '' ? '' : Number(e.target.value), pump_curve:String(f.properties?.pump_flow_lps ?? '') + ':' + e.target.value}} : f))}/></>}
              <label className="gis-label">Link status</label><select className="gis-input" value={String(selected.properties?.link_status || 'Open')} onChange={e => setFeatures(rows => rows.map(f => f.id === selected.id ? {...f, properties:{...f.properties, link_status:e.target.value}} : f))}><option>Open</option><option>Closed</option><option>CV</option></select>
              <label className="gis-label">Pipe / link material</label><input className="gis-input" value={String(selected.properties?.material || '')} placeholder="e.g. HDPE PE100" onChange={e => setFeatures(rows => rows.map(f => f.id === selected.id ? {...f, properties:{...f.properties, material:e.target.value}} : f))}/>
              <label className="gis-label">Pipe internal diameter (mm)</label><input className="gis-input" type="number" min="1" step="any" value={String(selected.properties?.diameter_mm ?? '')} onChange={e => setFeatures(rows => rows.map(f => f.id === selected.id ? {...f, properties:{...f.properties, diameter_mm:e.target.value === '' ? '' : Number(e.target.value)}} : f))}/>
              <label className="gis-label">Hazen–Williams roughness C</label><input className="gis-input" type="number" min="1" step="any" value={String(selected.properties?.roughness_c ?? '')} onChange={e => setFeatures(rows => rows.map(f => f.id === selected.id ? {...f, properties:{...f.properties, roughness_c:e.target.value === '' ? '' : Number(e.target.value)}} : f))}/>
              <label className="gis-label">Minor loss coefficient K (optional)</label><input className="gis-input" type="number" min="0" step="any" value={String(selected.properties?.minor_loss_k ?? '0')} onChange={e => setFeatures(rows => rows.map(f => f.id === selected.id ? {...f, properties:{...f.properties, minor_loss_k:e.target.value === '' ? '' : Number(e.target.value)}} : f))}/>
            </>}
          </div>}
        </aside>
        <div className="gis-map-wrap">
          <MapContainer center={defaultCenter} zoom={10} scrollWheelZoom style={{height: '100%', minHeight: 440, width: '100%'}}>
            {showSatellite ? <TileLayer attribution='Tiles &copy; Esri' url='https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'/> : <TileLayer attribution='&copy; OpenStreetMap contributors' url='https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'/>}
            {showQgisWms && serverStatus.projectReady && serverStatus.wmsUrl && selectedWmsLayer && <WMSTileLayer key={selectedWmsLayer} url={serverStatus.wmsUrl} layers={selectedWmsLayer} format="image/png" transparent={true} version="1.3.0" attribution="QGIS Server"/>}
            <MapClick mode={mode} onPoint={addPoint} onLinePoint={addLinePoint} onPolygonPoint={addPolygonPoint}/>
            <RefitMap features={features}/>
            {features.map(feature => {
              const color = palette[feature.category] || palette.Other;
              if (feature.type === 'Point') {
                const c = feature.coordinates as number[];
                const result = overlayData?.nodes?.find((item: any) => item.id === feature.properties?.epanetId);
                const pressureFail = result && (result.minPressure < (hydraulicNetwork?.settings?.minPressure ?? 15) || result.maxPressure > (hydraulicNetwork?.settings?.maxPressure ?? 60));
                const resultColor = overlayMetric === 'compliance'
                  ? result ? pressureFail ? '#c54f45' : '#16866b' : color
                  : overlayMetric === 'pressure' && result ? overlayColor(Number(result.pressure)) : color;
                return <CircleMarker key={feature.id} center={[c[1], c[0]]} radius={7} pathOptions={{color: resultColor, fillColor: resultColor, fillOpacity: 0.9}} eventHandlers={{click: () => setSelectedId(feature.id)}}/>;
              }
              if (feature.type === 'LineString') {
                const result = overlayData?.links?.find((item: any) => item.id === feature.properties?.epanetId);
                const minVelocity = hydraulicNetwork?.settings?.minVelocity ?? 0.3;
                const maxVelocity = hydraulicNetwork?.settings?.maxVelocity ?? 2;
                const metric = overlayMetric === 'flow' ? Math.abs(Number(result?.flow))
                  : overlayMetric === 'velocity' ? Math.abs(Number(result?.velocity))
                  : overlayMetric === 'headloss' ? Math.abs(Number(result?.headloss)) : undefined;
                const applicable = result && (overlayMetric === 'flow' || overlayMetric === 'headloss' || (overlayMetric === 'velocity' && result.kind === 'pipe'));
                const complianceFail = result && result.kind === 'pipe' && (result.maxVelocity > maxVelocity || result.minVelocity < minVelocity);
                const resultColor = overlayMetric === 'compliance'
                  ? result && result.kind === 'pipe' ? complianceFail ? '#c54f45' : '#16866b' : color
                  : applicable ? overlayColor(metric) : color;
                return <Polyline key={feature.id} positions={(feature.coordinates as number[][]).map(c => [c[1], c[0]])} pathOptions={{color: resultColor, weight: 5}} eventHandlers={{click: () => setSelectedId(feature.id)}}/>;
              }
              return <Polygon key={feature.id} positions={(feature.coordinates as number[][][])[0].map(c => [c[1], c[0]])} pathOptions={{color, fillOpacity: 0.18}} eventHandlers={{click: () => setSelectedId(feature.id)}}/>;
            })}
            {pendingLine.length > 0 && <Polyline positions={pendingLine.map(c => [c[1], c[0]])} pathOptions={{color: '#e58b2d', dashArray: '6 6'}}/>}
            {pendingPolygon.length > 0 && <Polyline positions={pendingPolygon.map(c => [c[1], c[0]])} pathOptions={{color: '#8b6bc0', dashArray: '6 6'}}/>}
          </MapContainer>
          <div className="gis-map-hint"><LocateFixed size={14}/> {mode === 'select' ? 'Tap a feature to inspect it' : mode === 'point' ? 'Tap map to place a point' : mode === 'line' ? 'Tap map to add pipeline vertices' : 'Tap map to draw boundary vertices'}</div>
        </div>
      </div>
      <div className="gis-status"><span><Waves size={15}/> {message}</span><span>CRS: EPSG:4326 · WGS 84</span></div>
      {hydraulicSimulation && <div className="gis-disclaimer"><Waves size={15}/> Hydraulic result overlay: green = within configured screening criteria; red = pressure or velocity criteria exceeded. Select a simulation revision and verify all time-step results before design approval.</div>}
      <div className="gis-disclaimer"><Ruler size={15}/> Length and area are calculated from geographic coordinates using Turf.js. Confirm the project CRS and survey accuracy before using measurements for construction quantities or setting out.</div>
    </div>
  );
}
