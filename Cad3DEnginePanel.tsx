import { useEffect, useMemo, useRef, useState } from 'react';
import { createHistory, pushHistory, undoHistory, redoHistory, objectSnapCandidates, constrainPointToAngle } from './cad-geometry';
import { moveEntities, copyEntities, rotateEntities, mirrorEntities, stretchEntities, rectangularArray, trimLine, extendLine, offsetLine, offsetPolyline, selectEntitiesInWindow, chamferPolylineCorner, filletPolylineCorner, editEntityGrip, scaleEntities, validateCadEntities, trimPolylineSegment, extendPolylineSegment } from './cad-editing';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Download, FileUp, Layers3, Save, Crosshair, Maximize2, Minimize2, ChevronDown } from 'lucide-react';
import { api } from './client';
import { connectPipeEndpoints, createWaterComponent, component3dLength, componentPlanLength, type WaterCadComponent, type WaterCadDocument, type WaterComponentKind } from './water-cad';
import { createDraftingDocument, makeAlignedDimension, makeLinearDimension, measureDimension, formatDimension, sheetDimensionsMm, validateDraftingDocument, findAssociativeAnchor, findAssociativeCircle, resolveAssociativeDimension, resolveAssociativeRadialDimension, resolveAssociativeAngularDimension, measureAngularDimension, type DraftingDocument, type DraftAnnotation } from './cad-drafting';
import { exportDraftingDxf, importDraftingDxf, type DxfShape } from './cad-dxf';
import { DIMENSION_STYLES, formatStyledDimension, validateDimensionStyle, appendDrawingRevision, type DimensionStyle } from './cad-dimension-standards';
import { synchronizeLayerTemplate, validateLayerStandard, validatePlotConfiguration, type LayerStandard } from './cad-layer-standards';
import { auditEngineeringDrawing, type EngineeringDrawingAudit } from './cad-engineering-verification';
import { ENGINEERING_BLOCK_LIBRARY, getEngineeringBlock, instantiateEngineeringBlock, instantiateEngineeringPorts, type BlockInsert } from './cad-object-library';
import { fitViewportScale, pointInsideViewport, validatePaperLayout, type PaperLayout } from './cad-paper-space';
import { calculateAngularDimension, calculateRadiusDimension, calculateDiameterDimension, calculateOrdinateDimension, calculateBaselineDimensions, calculateChainDimensions } from './cad-dimension-geometry';
import { circleFromCenterRadius, circleFromCenterDiameter, circleFromDiameter, circleFromThreePoints, ellipseFromBounds, ellipseFromAxisEndpoints, arcFromThreePoints, arcFromCenterStartAngle } from './cad-primitives';
import { buildBendCentreline, buildPipeLongitudinalProfile, buildPreliminaryBoq, buildReducerCentreline, buildTeeCentreline, connectWaterPorts, exportWaterNetworkToEpanet, getWaterPorts, validateWaterNetworkTopology } from './water-network-engineering';
import { applyTerrainToPipe, buildTerrainAwarePipeProfile, buildTerrainIssues, sampleGroundProfile, sampleTerrainElevation, samplePipeCentrelineElevation, type TerrainGrid } from './water-terrain-engineering';
import { epanetSimulationToHydraulicSeries, importEpanetInp, mergeEpanetRoundTrip, type HydraulicResults } from './water-epanet-bridge';
import { buildHydraulicOverlay, type HydraulicOverlay, type HydraulicOverlayMetric } from './water-hydraulic-overlays';
import { runEpanetHydraulicSimulation } from './water-epanet-runner';

type Point2D = { x: number; y: number };
type Shape = {
  id: string;
  type: 'line' | 'polyline' | 'rect' | 'circle';
  points: Point2D[];
  radius?: number;
  bulges?: number[];
  layer: string;
};
type Props = {
  projectId: string;
  initialData?: any;
  gisFeatures?: any[];
  linkedEpanetInp?: string;
  linkedEpanetSimulation?: any;
  linkedEpanetIdMap?: Array<{epanetId:string;cadId:string;kind:'node'|'link'}>;
  linkedEpanetUpdatedAt?: string;
  onSendToEpanet?: (input: string, idMap: Array<{epanetId:string;cadId:string;kind:'node'|'link'}>) => void;
  onSave: (data: any) => Promise<void> | void;
};
type SnapPoint = { point: Point2D; kind: string; distance: number };
type SelectedShape = Shape | null;

const makeId = () => Math.random().toString(36).slice(2, 10);
const WIDTH = 1000;
const HEIGHT = 650;
const SNAP_PIXELS = 16;

function nearestPointOnSegment(point: Point2D, a: Point2D, b: Point2D): Point2D {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return { ...a };
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

export function exportDxf(shapes: Shape[]) {
  const output = [
    '0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '0', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
  ];
  shapes.forEach(shape => {
    // A rectangle is four edges, not a two-vertex diagonal polyline.
    if (shape.type === 'rect') {
      const [a, b] = shape.points;
      const corners = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
      for (let i = 0; i < 4; i++) {
        const start = corners[i];
        const end = corners[(i + 1) % 4];
        output.push('0', 'LINE', '8', shape.layer || '0',
          '10', String(start.x), '20', String(start.y),
          '11', String(end.x), '21', String(end.y));
      }
      return;
    }
    output.push(
      '0',
      shape.type === 'line' ? 'LINE' : shape.type === 'circle' ? 'CIRCLE' : 'LWPOLYLINE',
      '8',
      shape.layer || '0'
    );
    if (shape.type === 'line') {
      output.push(
        '10', String(shape.points[0].x), '20', String(shape.points[0].y),
        '11', String(shape.points[1].x), '21', String(shape.points[1].y)
      );
    } else if (shape.type === 'circle') {
      output.push(
        '10', String(shape.points[0].x), '20', String(shape.points[0].y),
        '40', String(shape.radius || 1)
      );
    } else {
      output.push('90', String(shape.points.length), '70', '0');
      shape.points.forEach((point,index) => {
        output.push('10', String(point.x), '20', String(point.y));
        const bulge=shape.bulges?.[index]||0;
        if(Math.abs(bulge)>1e-12)output.push('42',String(bulge));
      });
    }
  });
  return output.concat(['0', 'ENDSEC', '0', 'EOF']).join('\n');
}

export function importDxf(source: string): Shape[] {
  const rows = source.replace(/\r/g, '').split('\n');
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i + 1 < rows.length; i += 2) {
    pairs.push([rows[i].trim(), rows[i + 1].trim()]);
  }
  const start = pairs.findIndex(pair => pair[0] === '2' && pair[1] === 'ENTITIES');
  if (start < 0) throw new Error('DXF ENTITIES section not found.');

  const result: Shape[] = [];
  let entity: { type: string; values: Array<[string, string]> } | null = null;
  const flush = () => {
    if (!entity) return;
    const get = (code: string) => entity!.values.find(pair => pair[0] === code)?.[1];
    const number = (code: string) => Number(get(code) || 0);
    const layer = get('8') || '0';
    if (entity.type === 'LINE') {
      result.push({
        id: makeId(), type: 'line',
        points: [{ x: number('10'), y: number('20') }, { x: number('11'), y: number('21') }],
        layer,
      });
    }
    if (entity.type === 'CIRCLE') {
      result.push({
        id: makeId(), type: 'circle',
        points: [{ x: number('10'), y: number('20') }],
        radius: number('40'), layer,
      });
    }
    if (entity.type === 'LWPOLYLINE') {
      const points: Point2D[] = [];
      const bulges: number[] = [];
      let x: number | null = null;
      entity.values.forEach(([code, value]) => {
        if (code === '10') x = Number(value);
        if (code === '20' && x !== null) {
          points.push({ x, y: Number(value) });
          bulges.push(0);
          x = null;
        }
        if (code === '42' && bulges.length) bulges[bulges.length-1]=Number(value);
      });
      if (points.length > 1) result.push({ id: makeId(), type: 'polyline', points, bulges, layer });
    }
    entity = null;
  };

  for (let i = start + 1; i < pairs.length; i++) {
    const [code, value] = pairs[i];
    if (code === '0') {
      flush();
      if (value === 'ENDSEC') break;
      if (['LINE', 'CIRCLE', 'LWPOLYLINE'].includes(value)) {
        entity = { type: value, values: [] };
      }
    } else if (entity) {
      entity.values.push([code, value]);
    }
  }
  flush();
  if (!result.length) throw new Error('No supported LINE, CIRCLE or LWPOLYLINE entities found.');
  return result;
}

function toSvgPoint(svg: SVGSVGElement, clientX: number, clientY: number): Point2D {
  const matrix = svg.getScreenCTM();
  if (!matrix) return { x: 0, y: 0 };
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const transformed = point.matrixTransform(matrix.inverse());
  return { x: transformed.x, y: transformed.y };
}

function screenDistance(svg: SVGSVGElement, a: Point2D, b: Point2D): number {
  const matrix = svg.getScreenCTM();
  if (!matrix) return Infinity;
  const pa = svg.createSVGPoint();
  pa.x = a.x;
  pa.y = a.y;
  const pb = svg.createSVGPoint();
  pb.x = b.x;
  pb.y = b.y;
  const sa = pa.matrixTransform(matrix);
  const sb = pb.matrixTransform(matrix);
  return Math.hypot(sa.x - sb.x, sa.y - sb.y);
}


function bulgeSegmentPoints(a:Point2D,b:Point2D,bulge:number,steps=16):Point2D[] {
  if(!Number.isFinite(bulge)||Math.abs(bulge)<1e-12)return [a,b];
  const dx=b.x-a.x,dy=b.y-a.y,chord=Math.hypot(dx,dy);
  if(chord<1e-12)return [a,b];
  const sweep=4*Math.atan(bulge),radius=chord*(1+bulge*bulge)/(4*Math.abs(bulge));
  const midpoint={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
  const offset=chord*(1-bulge*bulge)/(4*bulge);
  const center={x:midpoint.x-dy/chord*offset,y:midpoint.y+dx/chord*offset};
  const start=Math.atan2(a.y-center.y,a.x-center.x);
  return Array.from({length:steps+1},(_,i)=>{const angle=start+sweep*i/steps;return {x:center.x+radius*Math.cos(angle),y:center.y+radius*Math.sin(angle)};});
}
function nearestPointOnBulgeArc(cursor:Point2D,a:Point2D,b:Point2D,bulge:number):Point2D {
  const dx=b.x-a.x,dy=b.y-a.y,chord=Math.hypot(dx,dy);
  if(chord<=1e-12||Math.abs(bulge)<=1e-12)return nearestPointOnSegment(cursor,a,b);
  const offset=chord*(1-bulge*bulge)/(4*bulge);
  const center={x:(a.x+b.x)/2-dy/chord*offset,y:(a.y+b.y)/2+dx/chord*offset};
  const radius=chord*(1+bulge*bulge)/(4*Math.abs(bulge));
  const start=Math.atan2(a.y-center.y,a.x-center.x),sweep=4*Math.atan(bulge);
  const dxCursor=cursor.x-center.x,dyCursor=cursor.y-center.y;
  if(Math.hypot(dxCursor,dyCursor)<1e-12)return a;
  const angle=Math.atan2(dyCursor,dxCursor);
  const tau=Math.PI*2,mod=(v:number)=>(v%tau+tau)%tau;
  const onArc=sweep>=0?mod(angle-start)<=sweep+1e-9:mod(start-angle)<=-sweep+1e-9;
  if(!onArc)return Math.hypot(cursor.x-a.x,cursor.y-a.y)<=Math.hypot(cursor.x-b.x,cursor.y-b.y)?a:b;
  return {x:center.x+radius*Math.cos(angle),y:center.y+radius*Math.sin(angle)};
}
function expandedPolylinePoints(shape:{points:Point2D[];bulges?:number[]}):Point2D[] {
  const result:Point2D[]=[];
  for(let i=0;i<shape.points.length-1;i++){
    const segment=bulgeSegmentPoints(shape.points[i],shape.points[i+1],shape.bulges?.[i]||0);
    result.push(...(i?segment.slice(1):segment));
  }
  return result;
}
function polylineSvgPath(shape:{points:Point2D[];bulges?:number[]}):string {
  if(!shape.points.length)return '';
  let path='M '+shape.points[0].x+' '+shape.points[0].y;
  for(let i=0;i<shape.points.length-1;i++){
    const a=shape.points[i],b=shape.points[i+1],bulge=shape.bulges?.[i]||0;
    if(Math.abs(bulge)<1e-12){path+=' L '+b.x+' '+b.y;continue;}
    const chord=Math.hypot(b.x-a.x,b.y-a.y),radius=chord*(1+bulge*bulge)/(4*Math.abs(bulge));
    const sweep=4*Math.atan(bulge),large=Math.abs(sweep)>Math.PI?1:0,flag=bulge>0?1:0;
    path+=' A '+radius+' '+radius+' 0 '+large+' '+flag+' '+b.x+' '+b.y;
  }
  return path;
}

function getSnapCandidates(shapes: Shape[], cursor: Point2D): Array<{ point: Point2D; kind: string }> {
  const candidates: Array<{ point: Point2D; kind: string }> = [];
  shapes.forEach(shape => {
    if (shape.type === 'circle') {
      const center = shape.points[0];
      const radius = shape.radius || 12;
      const dx = cursor.x - center.x;
      const dy = cursor.y - center.y;
      const length = Math.hypot(dx, dy) || 1;
      candidates.push({ point: center, kind: 'CENTER' });
      candidates.push({
        point: { x: center.x + (dx / length) * radius, y: center.y + (dy / length) * radius },
        kind: 'NEAREST',
      });
      [0, Math.PI / 2, Math.PI, Math.PI * 1.5].forEach(angle => {
        candidates.push({
          point: { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius },
          kind: 'QUADRANT',
        });
      });
      return;
    }
    shape.points.forEach(point => candidates.push({ point, kind: 'ENDPOINT' }));
    if(shape.type==='polyline'){
      for(let i=0;i<shape.points.length-1;i++){
        const a=shape.points[i],b=shape.points[i+1],bulge=shape.bulges?.[i]||0;
        candidates.push({point:Math.abs(bulge)>1e-12?nearestPointOnBulgeArc(cursor,a,b,bulge):nearestPointOnSegment(cursor,a,b),kind:'NEAREST'});
        const segment=bulgeSegmentPoints(a,b,bulge,2);
        candidates.push({point:segment[Math.floor(segment.length/2)],kind:'MIDPOINT'});
      }
    }else if(shape.type==='line'){
      candidates.push({point:nearestPointOnSegment(cursor,shape.points[0],shape.points[1]),kind:'NEAREST'});
      candidates.push({point:{x:(shape.points[0].x+shape.points[1].x)/2,y:(shape.points[0].y+shape.points[1].y)/2},kind:'MIDPOINT'});
    }else if(shape.type==='rect'){
      getSegments([shape]).forEach(([a,b])=>candidates.push({point:nearestPointOnSegment(cursor,a,b),kind:'NEAREST'}));
    }
  });
  return candidates;
}

function segmentIntersection(a: Point2D, b: Point2D, c: Point2D, d: Point2D): Point2D | null {
  const denominator = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
  if (Math.abs(denominator) < 1e-9) return null;
  const determinantAB = a.x * b.y - a.y * b.x;
  const determinantCD = c.x * d.y - c.y * d.x;
  const x = (determinantAB * (c.x - d.x) - (a.x - b.x) * determinantCD) / denominator;
  const y = (determinantAB * (c.y - d.y) - (a.y - b.y) * determinantCD) / denominator;
  const within = (p: Point2D, q: Point2D, value: Point2D) =>
    value.x >= Math.min(p.x, q.x) - 1e-7 && value.x <= Math.max(p.x, q.x) + 1e-7 &&
    value.y >= Math.min(p.y, q.y) - 1e-7 && value.y <= Math.max(p.y, q.y) + 1e-7;
  return within(a, b, { x, y }) && within(c, d, { x, y }) ? { x, y } : null;
}

function getSegments(shapes: Shape[]): Array<[Point2D, Point2D]> {
  const segments: Array<[Point2D, Point2D]> = [];
  shapes.forEach(shape => {
    if (shape.type === 'line' || shape.type === 'polyline') {
      const expanded=shape.type==='polyline'?expandedPolylinePoints(shape):shape.points;
      for (let i = 0; i < expanded.length - 1; i++) segments.push([expanded[i], expanded[i + 1]]);
    } else if (shape.type === 'rect') {
      const [a, b] = shape.points;
      const corners = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
      for (let i = 0; i < 4; i++) segments.push([corners[i], corners[(i + 1) % 4]]);
    }
  });
  return segments;
}

function findSnap(svg: SVGSVGElement, cursor: Point2D, shapes: Shape[], enabled: boolean, waterCad?: WaterCadDocument, metresPerDrawingUnit = 1, referencePoint?: Point2D): SnapPoint | null {
  if (!enabled) return null;
  let best: SnapPoint | null = null;
  const candidates = getSnapCandidates(shapes, cursor);
  const straightSegments: Array<[Point2D, Point2D]> = [];
  const circles: Array<{center:Point2D;radius:number}> = [];
  shapes.forEach(shape => {
    if (shape.type === 'line' && shape.points.length >= 2) straightSegments.push([shape.points[0], shape.points[1]]);
    else if (shape.type === 'polyline') {
      for (let i=0;i<shape.points.length-1;i++) if (Math.abs(shape.bulges?.[i] || 0) <= 1e-12) {
        straightSegments.push([shape.points[i],shape.points[i+1]]);
      }
    } else if (shape.type === 'rect' && shape.points.length >= 2) {
      const [a,b]=shape.points, corners=[a,{x:b.x,y:a.y},b,{x:a.x,y:b.y}];
      for(let i=0;i<4;i++) straightSegments.push([corners[i],corners[(i+1)%4]]);
    } else if (shape.type === 'circle' && shape.points.length && (shape.radius || 12) > 0) {
      circles.push({center:shape.points[0],radius:shape.radius || 12});
    }
  });
  candidates.push(...objectSnapCandidates(cursor,straightSegments,circles,referencePoint).map(candidate=>({point:candidate.point,kind:candidate.kind})));
  if (waterCad && Number.isFinite(metresPerDrawingUnit) && metresPerDrawingUnit > 0) {
    waterCad.components.forEach(component => getWaterPorts(component).forEach(port => candidates.push({
      point: { x: port.point.x / metresPerDrawingUnit, y: port.point.y / metresPerDrawingUnit }, kind: 'PORT ' + port.role.toUpperCase(),
    })));
  }
  const segments = getSegments(shapes);
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const point = segmentIntersection(segments[i][0], segments[i][1], segments[j][0], segments[j][1]);
      if (point) candidates.push({ point, kind: 'INTERSECTION' });
    }
  }
  candidates.forEach(candidate => {
    const distance = screenDistance(svg, cursor, candidate.point);
    if (distance <= SNAP_PIXELS && (!best || distance < best.distance)) {
      best = { ...candidate, distance };
    }
  });
  return best;
}

export default function Cad3DEnginePanel({ projectId, initialData, gisFeatures = [], linkedEpanetInp = '', linkedEpanetSimulation, linkedEpanetIdMap, linkedEpanetUpdatedAt, onSendToEpanet, onSave }: Props) {
  const [history, setHistory] = useState(() => createHistory<Shape[]>(initialData?.shapes || []));
  const [waterCad, setWaterCad] = useState<WaterCadDocument>(() => initialData?.waterCad ? { ...initialData.waterCad, horizontalCrs: initialData.waterCad.horizontalCrs ?? 'LOCAL_METRIC', horizontalUnits: initialData.waterCad.horizontalUnits ?? 'm' } : { schemaVersion: 1, units: 'm', verticalDatum: 'Project datum - confirm before design', horizontalCrs: 'LOCAL_METRIC', horizontalUnits: 'm' as const, components: [] });
  const [terrainGrid, setTerrainGrid] = useState<TerrainGrid | null>(() => initialData?.terrainGrid || null);
  const [terrainTransferBusy, setTerrainTransferBusy] = useState(false);
  const [hydraulicResults, setHydraulicResults] = useState<HydraulicResults | null>(() => initialData?.hydraulicResults || null);
  const [hydraulicResultSeries, setHydraulicResultSeries] = useState<HydraulicResults[]>(() => initialData?.hydraulicResultSeries || []);
  const [hydraulicReport, setHydraulicReport] = useState<string>(() => initialData?.hydraulicReport || '');
  const [hydraulicTimeIndex, setHydraulicTimeIndex] = useState(0);
  const [simulationBusy, setSimulationBusy] = useState(false);
  const [epanetImportMode, setEpanetImportMode] = useState<'replace'|'merge'>('replace');
  const [hydraulicMetric, setHydraulicMetric] = useState<HydraulicOverlayMetric>('velocityMs');
  const [hydraulicOverlay, setHydraulicOverlay] = useState<HydraulicOverlay | null>(() => initialData?.hydraulicOverlay || null);
  useEffect(() => {
    if(!linkedEpanetInp.trim())return;
    const epanetTime=linkedEpanetUpdatedAt?Date.parse(linkedEpanetUpdatedAt):NaN;
    const drawingTime=initialData?.updatedAt?Date.parse(initialData.updatedAt):NaN;
    if(Number.isFinite(epanetTime)&&Number.isFinite(drawingTime)&&drawingTime>epanetTime){
      setMessage('The saved CAD drawing is newer than the saved EPANET model. Send CAD to EPANET again before synchronizing to avoid replacing newer drawing edits.');
      return;
    }
    try{
      const imported=importEpanetInp(linkedEpanetInp,waterCad.verticalDatum);
      const merged=mergeEpanetRoundTrip(waterCad,imported.document,linkedEpanetIdMap??[]);
      const resultIdMap=new Map<string,string>();
      if(linkedEpanetIdMap?.length){
        linkedEpanetIdMap.forEach(item=>{
          const target=merged.components.find(component=>component.id===item.cadId);
          if(item.kind==='link'||(target&&['junction','source','tank','reservoir'].includes(target.kind)))resultIdMap.set(item.epanetId,item.cadId);
        });
      }else exportWaterNetworkToEpanet(merged).idMap.forEach(item=>resultIdMap.set(item.epanetId,item.cadId));
      const frames=epanetSimulationToHydraulicSeries(linkedEpanetSimulation).map(frame=>({
        ...frame,
        nodes:frame.nodes.map(node=>({...node,id:resultIdMap.get(node.id)??node.id})),
        links:frame.links.map(link=>({...link,id:resultIdMap.get(link.id)??link.id}))
      }));
      setWaterCad(merged);
      setHydraulicReport(typeof linkedEpanetSimulation?.report==='string'?linkedEpanetSimulation.report:'');
      if(frames.length){
        setHydraulicResultSeries(frames);
        setHydraulicTimeIndex(frames.length-1);
        setHydraulicResults(frames[frames.length-1]);
        setHydraulicOverlay(buildHydraulicOverlay(merged,frames[frames.length-1],hydraulicMetric));
      }else{
        setHydraulicResultSeries([]);
        setHydraulicTimeIndex(0);
        setHydraulicResults(null);
        setHydraulicOverlay(null);
      }
      setMessage('Synchronized saved EPANET network into CAD: '+merged.components.length+' network objects'+(frames.length?' and '+frames.length+' hydraulic result timestep(s)':'')+'. CAD-only fittings and matching surveyed geometry are retained where IDs and coordinates match.');
    }catch(error){setMessage(error instanceof Error?'EPANET-to-CAD synchronization failed: '+error.message:'EPANET-to-CAD synchronization failed.');}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[linkedEpanetInp,linkedEpanetUpdatedAt]);
  const [terrainCoverM, setTerrainCoverM] = useState(1.2);
  const [terrainProfileSpacingM, setTerrainProfileSpacingM] = useState(5);
  const [drafting, setDrafting] = useState<DraftingDocument>(() => createDraftingDocument(initialData?.drafting));
  const [draftTool, setDraftTool] = useState<'none' | 'dimension' | 'text' | 'leader'>('none');
  const [annotationDraft, setAnnotationDraft] = useState<Point2D[]>([]);
  const [annotationText, setAnnotationText] = useState('');
  const [dimensionOffset, setDimensionOffset] = useState(2);
  const [dimensionPrecision, setDimensionPrecision] = useState(3);
  const [dimensionKind, setDimensionKind] = useState<'aligned' | 'linear' | 'angular' | 'radius' | 'diameter' | 'ordinate' | 'baseline' | 'chain'>('aligned');
  const [ordinateAxis, setOrdinateAxis] = useState<'x' | 'y'>('x');
  const [dimensionStyle, setDimensionStyle] = useState<DimensionStyle>(() => initialData?.drafting?.dimensionStyle || DIMENSION_STYLES.ISO);
  const [layerTemplate, setLayerTemplate] = useState<LayerStandard>('WATER_UTILITY');
  const [revisionDraft, setRevisionDraft] = useState({ revision: '', date: new Date().toISOString().slice(0,10), description: '', drawnBy: '', checkedBy: '', approvedBy: '', status: 'FOR REVIEW' as const });
  const [newLayerName, setNewLayerName] = useState('');
  const [libraryBlockName, setLibraryBlockName] = useState(ENGINEERING_BLOCK_LIBRARY[0].name);
  const [libraryRotationDeg, setLibraryRotationDeg] = useState(0);
  const [libraryPlacementActive, setLibraryPlacementActive] = useState(false);
  const [engineeringAudit, setEngineeringAudit] = useState<EngineeringDrawingAudit | null>(null);
  const [paperLayouts, setPaperLayouts] = useState<PaperLayout[]>(() => initialData?.paperLayouts || []);
  const [selectedWaterId, setSelectedWaterId] = useState('');
  const [activeWaterTool, setActiveWaterTool] = useState<WaterComponentKind | null>(null);
  const [waterDraft, setWaterDraft] = useState<Point2D[]>([]);
  const [portA, setPortA] = useState('');
  const [portB, setPortB] = useState('');
  const shapes = history.present;
  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  async function toggleCadFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setIsFullscreen(value => !value);
    }
  }

  function setShapes(next: Shape[] | ((current: Shape[]) => Shape[])) {
    setHistory(current => pushHistory(current, typeof next === 'function' ? next(current.present) : next));
  }
  const [mode, setMode] = useState<'select' | 'line' | 'polyline' | 'rect' | 'circle' | 'ellipse' | 'arc'>('select');
  const [circleMethod, setCircleMethod] = useState<'center-radius'|'center-diameter'|'two-point'|'three-point'>('center-radius');
  const [ellipseMethod, setEllipseMethod] = useState<'corner-corner'|'axis-endpoints'>('corner-corner');
  const [arcMethod, setArcMethod] = useState<'three-point'|'center-start-angle'>('three-point');
  const [arcSweepDegrees, setArcSweepDegrees] = useState(90);
  const [draft, setDraft] = useState<Point2D[]>([]);
  const [view, setView] = useState<'2d' | '3d'>('2d');
  const [ribbonTab, setRibbonTab] = useState<'Home'|'Modify'|'Insert'|'Annotate'|'Drafting'|'Water Network'|'3D Modeling'|'Analyze'|'View'|'Output'|'Manage'>('Home');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [commandLine, setCommandLine] = useState('');
  const [layer, setLayer] = useState('0');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [units, setUnits] = useState('m');
  const [calibratedMetresPerUnit, setCalibratedMetresPerUnit] = useState<number | null>(
    Number.isFinite(initialData?.calibratedMetresPerUnit) && initialData.calibratedMetresPerUnit > 0
      ? initialData.calibratedMetresPerUnit : null
  );
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [orthoEnabled, setOrthoEnabled] = useState(false);
  const [polarEnabled, setPolarEnabled] = useState(false);
  const [polarIncrement, setPolarIncrement] = useState(15);
  const [gridSnapEnabled, setGridSnapEnabled] = useState(false);
  const [gridSize, setGridSize] = useState(10);
  const [hiddenLayers, setHiddenLayers] = useState<string[]>([]);
  const [snapMarker, setSnapMarker] = useState<SnapPoint | null>(null);
  const [selectedShapeId, setSelectedShapeId] = useState('');
  const [selectedShapeIds, setSelectedShapeIds] = useState<string[]>([]);
  const [selectionBox, setSelectionBox] = useState<{start:Point2D;end:Point2D}|null>(null);
  const [lastSelectionWindow, setLastSelectionWindow] = useState<{minX:number;minY:number;maxX:number;maxY:number}|null>(null);
  const selectionRef = useRef<{pointerId:number;start:Point2D;current:Point2D}|null>(null);
  const suppressSelectionClick = useRef(false);
  const [commandDistance, setCommandDistance] = useState(5);
  const [moveDeltaX, setMoveDeltaX] = useState(5);
  const [moveDeltaY, setMoveDeltaY] = useState(0);
  const [scaleFactor, setScaleFactor] = useState(1.1);
  const [gripIndex, setGripIndex] = useState(0);
  const [commandAngle, setCommandAngle] = useState(90);
  const [commandEndpoint, setCommandEndpoint] = useState<0|1>(0);
  const [cornerIndex, setCornerIndex] = useState(1);
  const [segmentIndex, setSegmentIndex] = useState(0);
  const [offsetSide, setOffsetSide] = useState<1|-1>(1);
  const [arrayRows, setArrayRows] = useState(2);
  const [arrayColumns, setArrayColumns] = useState(2);
  const [arraySpacing, setArraySpacing] = useState(20);
  const [previewShapes, setPreviewShapes] = useState<Shape[]|null>(null);
  const [cursorPoint, setCursorPoint] = useState<Point2D | null>(null);
  const [viewBox, setViewBox] = useState({ x: 0, y: 0, width: WIDTH, height: HEIGHT });
  const [panMode, setPanMode] = useState(false);
  const panRef = useRef<{ pointerId: number; x: number; y: number; viewBox: typeof viewBox } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const terrainFileRef = useRef<HTMLInputElement>(null);
  const epanetFileRef = useRef<HTMLInputElement>(null);
  const hydraulicResultsFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setHistory(createHistory<Shape[]>(initialData?.shapes || []));
    setWaterCad(initialData?.waterCad ? { ...initialData.waterCad, horizontalCrs: initialData.waterCad.horizontalCrs ?? 'LOCAL_METRIC', horizontalUnits: initialData.waterCad.horizontalUnits ?? 'm' } : { schemaVersion: 1, units: 'm', verticalDatum: 'Project datum - confirm before design', horizontalCrs: 'LOCAL_METRIC', horizontalUnits: 'm' as const, components: [] });
    setTerrainGrid(initialData?.terrainGrid || null);
    setHydraulicResults(initialData?.hydraulicResults || null);
    setHydraulicResultSeries(initialData?.hydraulicResultSeries || []);
    setHydraulicReport(initialData?.hydraulicReport || '');
    setHydraulicTimeIndex(0);
    setHydraulicOverlay(initialData?.hydraulicOverlay || null);
    setDrafting(createDraftingDocument(initialData?.drafting));
    setPaperLayouts(initialData?.paperLayouts || []);
    setEngineeringAudit(null);
    setDimensionStyle(initialData?.drafting?.dimensionStyle || DIMENSION_STYLES.ISO);
    setDraftTool('none');
    setAnnotationDraft([]);
    setSelectedWaterId('');
    setActiveWaterTool(null);
    setWaterDraft([]);
    setCalibratedMetresPerUnit(Number.isFinite(initialData?.calibratedMetresPerUnit) && initialData.calibratedMetresPerUnit > 0 ? initialData.calibratedMetresPerUnit : null);
    setViewBox(initialData?.viewport && [initialData.viewport.x, initialData.viewport.y, initialData.viewport.width, initialData.viewport.height].every(Number.isFinite)
      ? initialData.viewport : { x: 0, y: 0, width: WIDTH, height: HEIGHT });
    setDraft([]);
    setSelectedShapeId('');
    setSelectedShapeIds([]);
  }, [initialData]);

  const counts = useMemo(() => ({
    routes: shapes.filter(shape => shape.type === 'line' || shape.type === 'polyline').length,
    structures: shapes.filter(shape => shape.type === 'rect').length,
    circles: shapes.filter(shape => shape.type === 'circle').length,
  }), [shapes]);
  const activePaperLayout = paperLayouts.find(layout => layout.id === 'LAY-' + drafting.sheet.drawingNumber);
  const activePaperViewport = activePaperLayout?.viewports[0];

  function resolveDraftPoint(svg: SVGSVGElement, raw: Point2D) {
    const objectSnap = findSnap(svg, raw, shapes, snapEnabled, waterCad, calibratedMetresPerUnit || 1, draft.length ? draft[draft.length - 1] : waterDraft.length ? waterDraft[waterDraft.length - 1] : undefined);
    let point = objectSnap?.point || raw;
    if (!objectSnap && gridSnapEnabled && gridSize > 0) {
      point = { x: Math.round(point.x / gridSize) * gridSize, y: Math.round(point.y / gridSize) * gridSize };
    }
    const anchor = draft.length ? draft[draft.length - 1] : waterDraft.length ? waterDraft[waterDraft.length - 1] : null;
    if (!objectSnap && anchor && orthoEnabled) {
      const dx = point.x - anchor.x;
      const dy = point.y - anchor.y;
      point = Math.abs(dx) >= Math.abs(dy) ? { x: point.x, y: anchor.y } : { x: anchor.x, y: point.y };
    } else if (!objectSnap && anchor && polarEnabled) {
      point = constrainPointToAngle(anchor, point, polarIncrement);
    }
    return { point, snapped: objectSnap };
  }

  function pointerPosition(event: React.PointerEvent<SVGSVGElement>) {
    const raw = toSvgPoint(event.currentTarget, event.clientX, event.clientY);
    const resolved = resolveDraftPoint(event.currentTarget, raw);
    return { raw, snapped: resolved.snapped, point: resolved.point };
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (selectionRef.current && selectionRef.current.pointerId===event.pointerId) {
      const point=toSvgPoint(event.currentTarget,event.clientX,event.clientY);
      selectionRef.current.current=point; setSelectionBox({start:selectionRef.current.start,end:point}); return;
    }
    if (panRef.current && panRef.current.pointerId === event.pointerId) {
      const svg = event.currentTarget;
      const rect = svg.getBoundingClientRect();
      const start = panRef.current;
      const dx = (event.clientX - start.x) * start.viewBox.width / Math.max(rect.width, 1);
      const dy = (event.clientY - start.y) * start.viewBox.height / Math.max(rect.height, 1);
      setViewBox({ ...start.viewBox, x: start.viewBox.x - dx, y: start.viewBox.y - dy });
      return;
    }
    const { point, snapped } = pointerPosition(event);
    setCursorPoint(point);
    setSnapMarker(snapped);
  }

  function handlePointerLeave() {
    if (!panRef.current) setSnapMarker(null);
    setCursorPoint(null);
  }

  function handleCanvasClick(event: React.MouseEvent<SVGSVGElement>) {
    if (suppressSelectionClick.current) { suppressSelectionClick.current=false; return; }
    if (panRef.current || panMode) return;
    if (draftTool !== 'none') {
      const annotationLayer = draftTool === 'dimension' ? 'DIMENSIONS' : draftTool === 'text' ? 'TEXT' : 'ANNOTATION';
      if (drafting.layers.find(item => item.name === annotationLayer)?.locked) { setMessage('The annotation layer is locked. Unlock it before placing this annotation.'); return; }
      const raw = toSvgPoint(event.currentTarget, event.clientX, event.clientY);
      const point = resolveDraftPoint(event.currentTarget, raw).point;
      const metres = { x: point.x * (calibratedMetresPerUnit || 1), y: point.y * (calibratedMetresPerUnit || 1) };
      if (draftTool === 'text') {
        const item: DraftAnnotation = { id: makeId(), kind: 'text', layer: 'TEXT', at: metres, text: annotationText || 'Note', heightMm: 2.5, rotationDeg: 0 };
        setDrafting(current => ({ ...current, annotations: [...current.annotations, item] }));
        setDraftTool('none'); setAnnotationDraft([]);
        setMessage('Text annotation placed.'); return;
      }
      const next = [...annotationDraft, metres];
      const requiredPoints = draftTool === 'dimension' && ['angular','radius','diameter','ordinate'].includes(dimensionKind) ? 3 : draftTool === 'dimension' && ['baseline','chain'].includes(dimensionKind) ? 4 : 2;
      if (next.length < requiredPoints) { setAnnotationDraft(next); setMessage('Point ' + next.length + ' set. Choose point ' + (next.length + 1) + ' of ' + requiredPoints + '.'); return; }
      if (draftTool === 'dimension') {
        try {
          const scale = calibratedMetresPerUnit || 1;
          if (dimensionKind === 'linear' || dimensionKind === 'aligned') {
            const item = dimensionKind === 'linear' ? makeLinearDimension(makeId(), next[0], next[1], dimensionOffset * scale, 'DIMENSIONS', dimensionStyle.precision) : makeAlignedDimension(makeId(), next[0], next[1], dimensionOffset * scale, 'DIMENSIONS', dimensionStyle.precision);
            const measured = dimensionKind === 'linear' ? Math.abs(next[1].x-next[0].x) : Math.hypot(next[1].x-next[0].x,next[1].y-next[0].y);
            item.textOverride = formatStyledDimension(measured, dimensionStyle);
            const anchorA = findAssociativeAnchor(next[0], shapes, 0.002, scale);
            const anchorB = findAssociativeAnchor(next[1], shapes, 0.002, scale);
            if (anchorA || anchorB) item.association = { a: anchorA, b: anchorB };
            setDrafting(current => ({ ...current, annotations: [...current.annotations, item] }));
          } else if (dimensionKind === 'angular') {
            const item: Extract<DraftAnnotation, { kind: 'angular' }> = { id: makeId(), kind: 'angular', layer: 'DIMENSIONS', vertex: next[0], rayA: next[1], rayB: next[2], offsetM: Math.max(0.001, Math.abs(dimensionOffset * scale)), precision: dimensionStyle.precision };
            const vertex = findAssociativeAnchor(next[0], shapes, 0.002, scale), rayA = findAssociativeAnchor(next[1], shapes, 0.002, scale), rayB = findAssociativeAnchor(next[2], shapes, 0.002, scale);
            if (vertex || rayA || rayB) item.association = { vertex, rayA, rayB };
            measureAngularDimension(item);
            setDrafting(current => ({ ...current, annotations: [...current.annotations, item] }));
            setMessage('Associative angular dimension placed. Snapped line/polyline vertices will update its angle when edited.');
            setDraftTool('none'); setAnnotationDraft([]); return;
          } else if (dimensionKind === 'radius' || dimensionKind === 'diameter') {
            const circleId = findAssociativeCircle(next[0], shapes, 0.002, scale);
            const item: DraftAnnotation = { id: makeId(), kind: 'radial', layer: 'DIMENSIONS', circleId, center: next[0], radiusM: Math.hypot(next[1].x-next[0].x, next[1].y-next[0].y), dimensionType: dimensionKind, leaderAngleRad: Math.atan2(next[2].y-next[0].y, next[2].x-next[0].x), precision: dimensionStyle.precision };
            setDrafting(current => ({ ...current, annotations: [...current.annotations, item] }));
            setMessage(circleId ? 'Associative circle dimension placed. Radius and diameter update when the circle changes.' : 'Radius/diameter dimension placed without an associative circle reference.');
            setDraftTool('none'); setAnnotationDraft([]); return;
          } else {
            const id = makeId(), graphics: Shape[] = [], pushLine = (a: Point2D, b: Point2D) => graphics.push({ id: makeId(), type: 'line', points: [{x:a.x/scale,y:a.y/scale},{x:b.x/scale,y:b.y/scale}], layer: 'DIMENSIONS' });
            let labelPoint: Point2D, label = '';
            if (dimensionKind === 'angular') {
              const g = calculateAngularDimension(next[0], next[1], next[2], Math.max(0.001, Math.abs(dimensionOffset * scale)));
              pushLine(g.firstExtension.a,g.firstExtension.b); pushLine(g.secondExtension.a,g.secondExtension.b);
              const arcPoints = Array.from({length:25},(_,i)=>{const a=g.arc.startAngleRad+(g.arc.endAngleRad-g.arc.startAngleRad)*i/24;return {x:(g.arc.center.x+Math.cos(a)*g.arc.radius)/scale,y:(g.arc.center.y+Math.sin(a)*g.arc.radius)/scale};});
              graphics.push({id:makeId(),type:'polyline',points:arcPoints,layer:'DIMENSIONS'}); labelPoint=g.labelPoint; label=(g.angleRad*180/Math.PI).toFixed(dimensionStyle.precision)+'°';
            } else if (dimensionKind === 'radius' || dimensionKind === 'diameter') {
              const g = dimensionKind === 'radius' ? calculateRadiusDimension(next[0],next[1],next[2]) : calculateDiameterDimension(next[0],next[1],next[2]);
              g.centerMark.forEach(line=>pushLine(line.a,line.b)); pushLine(g.leader.a,g.leader.b);
              labelPoint=g.labelPoint; label=(dimensionKind === 'radius'?'R ':'Ø ')+formatStyledDimension(dimensionKind === 'radius'?g.radius:g.radius*2,dimensionStyle);
            } else if (dimensionKind === 'ordinate') {
              const offset = ordinateAxis === 'x' ? next[2].y-next[1].y : next[2].x-next[1].x;
              const g = calculateOrdinateDimension(next[0],next[1],ordinateAxis,offset);
              pushLine(g.originExtension.a,g.originExtension.b); pushLine(g.featureExtension.a,g.featureExtension.b); pushLine(g.dimensionLine.a,g.dimensionLine.b);
              labelPoint=g.labelPoint; label=formatStyledDimension(g.value,dimensionStyle);
            } else if (dimensionKind === 'baseline') {
              const offset = ordinateAxis === 'x' ? next[3].y-next[2].y : next[3].x-next[2].x;
              const dimensions = calculateBaselineDimensions(next[0],next.slice(1,3),offset,ordinateAxis);
              const notes: DraftAnnotation[] = [];
              dimensions.forEach((g,index) => {
                pushLine(g.originExtension.a,g.originExtension.b); pushLine(g.featureExtension.a,g.featureExtension.b); pushLine(g.dimensionLine.a,g.dimensionLine.b);
                notes.push({id:makeId(),kind:'text',layer:'DIMENSIONS',at:g.labelPoint,text:formatStyledDimension(g.value,dimensionStyle),heightMm:dimensionStyle.textHeightMm,rotationDeg:0});
              });
              setShapes(current => [...current,...graphics]); setDrafting(current => ({...current,annotations:[...current.annotations,...notes]}));
              setMessage('Baseline dimensions placed. Geometry is editable linework and text, not associative.');
              setDraftTool('none'); setAnnotationDraft([]); return;
            } else {
              const basePoints = next.slice(0,3), first=basePoints[0], second=basePoints[1];
              const dx=second.x-first.x,dy=second.y-first.y,len=Math.hypot(dx,dy)||1,nx=-dy/len,ny=dx/len;
              const offset=(next[3].x-first.x)*nx+(next[3].y-first.y)*ny;
              const lines=calculateChainDimensions(basePoints,offset);
              lines.forEach((line,index) => {
                pushLine(basePoints[index],line.a); pushLine(basePoints[index+1],line.b); pushLine(line.a,line.b);
                const midpoint={x:(line.a.x+line.b.x)/2,y:(line.a.y+line.b.y)/2};
                const value=Math.hypot(basePoints[index+1].x-basePoints[index].x,basePoints[index+1].y-basePoints[index].y);
                const note: DraftAnnotation={id:makeId(),kind:'text',layer:'DIMENSIONS',at:midpoint,text:formatStyledDimension(value,dimensionStyle),heightMm:dimensionStyle.textHeightMm,rotationDeg:0};
                setDrafting(current=>({...current,annotations:[...current.annotations,note]}));
              });
              setShapes(current => [...current,...graphics]);
              setMessage('Chain dimensions placed. Geometry is editable linework and text, not associative.');
              setDraftTool('none'); setAnnotationDraft([]); return;
            }
            setShapes(current => [...current,...graphics]);
            const note: DraftAnnotation = {id,kind:'text',layer:'DIMENSIONS',at:labelPoint,text:label,heightMm:dimensionStyle.textHeightMm,rotationDeg:0};
            setDrafting(current => ({...current,annotations:[...current.annotations,note]}));
          }
          setMessage(dimensionKind.charAt(0).toUpperCase()+dimensionKind.slice(1)+' dimension placed. Snapped line/polyline endpoints are associative and remeasure when their source vertices move; free-picked points remain fixed.');
        } catch (error) { setMessage(error instanceof Error ? error.message : 'Dimension could not be placed.'); }
      } else {
        const item: DraftAnnotation = { id: makeId(), kind: 'leader', layer: 'ANNOTATION', points: next, text: annotationText || 'Note', textHeightMm: 2.5 };
        setDrafting(current => ({ ...current, annotations: [...current.annotations, item] }));
        setMessage('Leader annotation placed.');
      }
      setDraftTool('none'); setAnnotationDraft([]); return;
    }
    if (libraryPlacementActive) {
      const raw = toSvgPoint(event.currentTarget, event.clientX, event.clientY);
      const resolved = resolveDraftPoint(event.currentTarget, raw);
      insertEngineeringBlock(resolved.point);
      return;
    }
    if (activeWaterTool) {
      const raw = toSvgPoint(event.currentTarget, event.clientX, event.clientY);
      const resolved = resolveDraftPoint(event.currentTarget, raw);
      if (activeWaterTool === 'pipe') {
        const last = waterDraft[waterDraft.length - 1];
        if (last && Math.hypot(resolved.point.x - last.x, resolved.point.y - last.y) < 0.01) {
          setMessage('Route vertex is too close to the previous point. Choose a distinct point.');
          return;
        }
        const next = [...waterDraft, resolved.point];
        setWaterDraft(next);
        setMessage(next.length === 1 ? 'Pipe route started. Click additional route vertices, then choose Finish pipe route.' : next.length + ' route points set. Continue drawing or finish the route.');
        return;
      }
      commitWaterPlacement(activeWaterTool,[resolved.point]); return;
    }
    if (mode === 'select') {
      setLastSelectionWindow(null);
      const target = (event.target as SVGElement).closest('[data-shape-id], [data-water-id]') as SVGElement | null;
      const id = target?.getAttribute('data-shape-id') || '';
      const waterId = target?.getAttribute('data-water-id') || '';
      if (waterId) {
        setSelectedWaterId(waterId);
        setSelectedShapeId('');
        setSelectedShapeIds([]);
        setMessage('Water component selected. Edit its engineering properties in the component register.');
        return;
      }
      if (event.shiftKey && id) {
        setSelectedShapeIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
        setSelectedShapeId(id);
      } else {
        setSelectedShapeId(id);
        setSelectedShapeIds(id ? [id] : []);
      }
      setMessage(id ? 'Entity selected. Hold Shift to add/remove entities from the selection.' : 'No entity selected.');
      return;
    }
    if (drafting.layers.find(item => item.name === layer)?.locked) { setMessage('The current layer is locked. Choose an unlocked layer before drawing.'); return; }
    const raw = toSvgPoint(event.currentTarget, event.clientX, event.clientY);
    const resolved = resolveDraftPoint(event.currentTarget, raw);
    const snapped = resolved.snapped;
    const point = resolved.point;

    if (mode === 'circle') {
      const next=[...draft,point];
      const required=circleMethod==='three-point'?3:2;
      if(next.length<required){setDraft(next);setMessage('Circle '+circleMethod+': point '+next.length+' set. Choose point '+(next.length+1)+' of '+required+'.');return;}
      try{
        const id=makeId();
        const circle=circleMethod==='three-point'?circleFromThreePoints(next[0],next[1],next[2],id,layer)
          :circleMethod==='two-point'?circleFromDiameter(next[0],next[1],id,layer)
          :circleMethod==='center-diameter'?circleFromCenterDiameter(next[0],next[1],id,layer)
          :circleFromCenterRadius(next[0],next[1],id,layer);
        setShapes(current=>[...current,circle]);setDraft([]);setMode('select');
        setMessage('Circle created using '+circleMethod+'. Radius '+formatLength(circle.radius)+', diameter '+formatLength(circle.radius*2)+'.');
      }catch(error){setDraft([]);setMode('select');setMessage(error instanceof Error?error.message:'Circle construction failed.');}
      return;
    }
    if (mode === 'ellipse') {
      const next=[...draft,point];
      const required=ellipseMethod==='axis-endpoints'?3:2;
      if(next.length<required){setDraft(next);setMessage('Ellipse '+ellipseMethod+': point '+next.length+' set. Choose point '+(next.length+1)+' of '+required+'.');return;}
      try{const ellipse=ellipseMethod==='axis-endpoints'?ellipseFromAxisEndpoints(next[0],next[1],next[2],makeId(),layer):ellipseFromBounds(next[0],next[1],makeId(),layer);setShapes(current=>[...current,ellipse]);setDraft([]);setMode('select');setMessage('Ellipse created as a closed segmented polyline on layer '+layer+'.');}
      catch(error){setDraft([]);setMode('select');setMessage(error instanceof Error?error.message:'Ellipse construction failed.');}
      return;
    }
    if (mode === 'arc') {
      const next=[...draft,point];
      const required=arcMethod==='three-point'?3:2;
      if(next.length<required){setDraft(next);setMessage('Arc '+arcMethod+': point '+next.length+' set. Choose point '+(next.length+1)+' of '+required+'.');return;}
      try{const arc=arcMethod==='three-point'?arcFromThreePoints(next[0],next[1],next[2],makeId(),layer):arcFromCenterStartAngle(next[0],next[1],arcSweepDegrees,makeId(),layer);setShapes(current=>[...current,arc]);setDraft([]);setMode('select');setMessage('Circular arc created with true bulge geometry on layer '+layer+'.');}
      catch(error){setDraft([]);setMode('select');setMessage(error instanceof Error?error.message:'Arc construction failed.');}
      return;
    }

    if (!draft.length) {
      setDraft([point]);
      setMessage(snapped ? 'Start point snapped to ' + snapped.kind + '.' : 'Start point set. Choose the next point.');
      return;
    }

    if (mode === 'polyline') {
      setDraft(current => [...current, point]);
      setMessage(snapped ? 'Vertex snapped to ' + snapped.kind + '.' : 'Polyline vertex added.');
      return;
    }

    setShapes(current => [...current, { id: makeId(), type: mode, points: [draft[0], point], layer }]);
    setDraft([]);
    setMode('select');
    setMessage(snapped ? 'Geometry created with endpoint snapped to ' + snapped.kind + '.' : 'Geometry created.');
  }

  function finishPolyline(close = false) {
    if (draft.length > 1) {
      const points = close && draft.length > 2 ? [...draft, { ...draft[0] }] : draft;
      setShapes(current => [...current, { id: makeId(), type: 'polyline', points, layer }]);
    }
    setDraft([]);
    setMode('select');
    setMessage(close ? 'Polyline closed.' : 'Polyline finished.');
  }

  async function importFile(file?: File) {
    if (!file) return;
    try {
      const text = await file.text();
      if (file.name.toLowerCase().endsWith('.json')) {
        const data = JSON.parse(text).shapes;
        if (!Array.isArray(data) || !data.length) throw new Error('No supported drawing entities in this file.');
        setShapes(current => [...current, ...data]);
        setMessage('Imported ' + data.length + ' drawing entities from JSON.');
      } else {
        const imported = importDraftingDxf(text, calibratedMetresPerUnit ?? undefined, Number(drafting.sheet.scale.split(':')[1]) || 100);
        if (!calibratedMetresPerUnit && imported.metresPerDrawingUnit !== null) setCalibratedMetresPerUnit(imported.metresPerDrawingUnit);
        setShapes(current => [...current, ...imported.shapes]);
        setDrafting(current => {
          const known = new Set(current.layers.map(item => item.name.toUpperCase()));
          const added = imported.layers.filter(item => !known.has(item.name.toUpperCase()));
          return { ...current, layers: [...current.layers, ...added], annotations: [...current.annotations, ...imported.annotations] };
        });
        setMessage('Imported ' + imported.shapes.length + ' geometry entities and ' + imported.annotations.length + ' text annotations.' + (imported.warnings.length ? ' ' + imported.warnings.join(' ') : ''));
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Drawing import failed.');
    }
    if (fileRef.current) fileRef.current.value = '';
  }

  async function importGisDraft() {
    let sourceFeatures = gisFeatures;
    try {
      const response = await api.get('/api/projects/' + projectId + '/gis-drafts');
      const drafts = response.data.drafts || [];
      const newest = drafts.slice().sort((a: any, b: any) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
      const savedFeatures = newest?.data?.featureCollection?.features;
      if (Array.isArray(savedFeatures) && savedFeatures.length) sourceFeatures = savedFeatures;
    } catch (error) {
      setMessage(error instanceof Error ? 'Could not load saved GIS drafts: ' + error.message : 'Could not load saved GIS drafts.');
      return;
    }
    const features = sourceFeatures.filter(feature =>
      ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'].includes(feature.geometry?.type)
    );
    if (!features.length) {
      setMessage('No supported saved GIS features were found. Save the GIS draft first, then retry CAD import.');
      return;
    }
    // GeoJSON geometries are nested to different depths. Flatten coordinates only
    // for extents, then preserve each line/ring as its own CAD polyline.
    const coordinatePairs: number[][] = [];
    const collectPairs = (value: unknown): void => {
      if (!Array.isArray(value)) return;
      if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
        if (Number.isFinite(value[0]) && Number.isFinite(value[1])) coordinatePairs.push([value[0], value[1]]);
        return;
      }
      value.forEach(collectPairs);
    };
    features.forEach(feature => collectPairs(feature.geometry.coordinates));
    if (!coordinatePairs.length) {
      setMessage('The saved GIS draft contains no valid coordinate pairs to import.');
      return;
    }
    const minX = Math.min(...coordinatePairs.map(point => point[0]));
    const maxX = Math.max(...coordinatePairs.map(point => point[0]));
    const minY = Math.min(...coordinatePairs.map(point => point[1]));
    const maxY = Math.max(...coordinatePairs.map(point => point[1]));
    const span = Math.max(maxX - minX, maxY - minY, 0.0001);
    const convert = (coordinate: number[]) => ({
      x: 80 + ((coordinate[0] - minX) / span) * 800,
      y: 570 - ((coordinate[1] - minY) / span) * 500,
    });
    const added: Shape[] = [];
    const layerFor = (feature: any) => String(feature.properties?.category || 'GIS').toUpperCase();
    const addLine = (coords: unknown, layer: string) => {
      if (!Array.isArray(coords)) return;
      const points = coords.filter((point: any) => Array.isArray(point) && point.length >= 2 && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1]))).map(convert);
      if (points.length >= 2) added.push({ id: makeId(), type: 'polyline', points, layer });
    };
    features.forEach(feature => {
      const geometry = feature.geometry;
      const layer = layerFor(feature);
      if (geometry.type === 'Point') {
        added.push({ id: makeId(), type: 'circle', points: [convert(geometry.coordinates)], radius: 5, layer });
      } else if (geometry.type === 'MultiPoint') {
        geometry.coordinates.forEach((point: number[]) => added.push({ id: makeId(), type: 'circle', points: [convert(point)], radius: 5, layer }));
      } else if (geometry.type === 'LineString') {
        addLine(geometry.coordinates, layer);
      } else if (geometry.type === 'MultiLineString') {
        geometry.coordinates.forEach((line: unknown) => addLine(line, layer));
      } else if (geometry.type === 'Polygon') {
        geometry.coordinates.forEach((ring: unknown) => addLine(ring, layer));
      } else if (geometry.type === 'MultiPolygon') {
        geometry.coordinates.forEach((polygon: unknown) => {
          if (Array.isArray(polygon)) polygon.forEach((ring: unknown) => addLine(ring, layer));
        });
      }
    });
    if (!added.length) {
      setMessage('The saved GIS draft contains no CAD-compatible points or lines.');
      return;
    }
    setShapes(current => [...current, ...added]);
    setMessage('Imported ' + added.length + ' CAD elements from the saved GIS draft. Coordinates are normalized drawing space, not survey-control coordinates.');
  }


  const selectedWaterComponent = waterCad.components.find(component => component.id === selectedWaterId) || null;
  function addWaterComponent(kind: WaterComponentKind) {
    if (!calibratedMetresPerUnit || calibratedMetresPerUnit <= 0) {
      setMessage('Calibrate the CAD drawing from a verified known length before placing water-engineering objects in metre coordinates.');
      return;
    }
    setActiveWaterTool(kind);
    setWaterDraft([]);
    setMode('select');
    setMessage(kind === 'pipe' ? 'Click the pipe start, any intermediate route vertices and its end point. Finish the route when ready; object snapping is active.' : 'Click the placement point for the ' + kind + '. Object snapping is active.');
  }
  function commitWaterPlacement(kind: WaterComponentKind, points: Point2D[]) {
    const prefix: Record<WaterComponentKind,string> = { pipe:'P', bend:'B', tee:'T', reducer:'RED', valve:'V', pump:'PU', tank:'TK', chamber:'CH', hydrant:'HYD', meter:'M', 'air-valve':'AV', washout:'WO', reservoir:'RES', source:'SRC', junction:'J' };
    let serial = 1;
    let id = prefix[kind] + '-' + String(serial).padStart(3, '0');
    while (waterCad.components.some(item => item.id === id)) {
      serial += 1;
      id = prefix[kind] + '-' + String(serial).padStart(3, '0');
    }
    const metres = points.map(point => ({ x: point.x * calibratedMetresPerUnit!, y: point.y * calibratedMetresPerUnit! }));
    const component = createWaterComponent(kind, id, metres[0].x, metres[0].y);
    component.geometry = kind === 'pipe' ? metres : [{ ...metres[0] }];
    setWaterCad(current => ({ ...current, components: [...current.components, component] }));
    setSelectedWaterId(id);
    setActiveWaterTool(null);
    setWaterDraft([]);
    setMessage(id + ' placed using calibrated drawing scale. Confirm surveyed elevations and engineering properties.');
  }
  function updateWaterProperties(patch: Partial<WaterCadComponent['properties']>) {
    if (!selectedWaterId) return;
    setWaterCad(current => ({ ...current, components: current.components.map(item => item.id === selectedWaterId ? { ...item, properties: { ...item.properties, ...patch } } : item) }));
  }

  const selectedShape: SelectedShape = shapes.find(shape => shape.id === selectedShapeId) || null;
  const selectedShapes = shapes.filter(shape => selectedShapeIds.includes(shape.id));

  function placeRadialDimensionFromSelection(kind: 'radius' | 'diameter') {
    if (!selectedShape || selectedShape.type !== 'circle') return false;
    const scale = calibratedMetresPerUnit || 1;
    const centre = { x: selectedShape.points[0].x * scale, y: selectedShape.points[0].y * scale };
    const radiusM = (selectedShape.radius || 0) * scale;
    if (!Number.isFinite(radiusM) || radiusM <= 1e-9) {
      setMessage('Cannot dimension this circle: its radius is zero or invalid.');
      return true;
    }
    if (drafting.layers.find(item => item.name === 'DIMENSIONS')?.locked) {
      setMessage('The DIMENSIONS layer is locked. Unlock it before placing this dimension.');
      return true;
    }
    try {
      const edge = { x: centre.x + radiusM, y: centre.y };
      const offsetM = Math.max(radiusM * 0.35, Math.abs(dimensionOffset * scale), 0.01);
      const leaderPoint = { x: centre.x + (radiusM + offsetM) * Math.cos(-Math.PI / 4), y: centre.y + (radiusM + offsetM) * Math.sin(-Math.PI / 4) };
      const geometry = kind === 'radius'
        ? calculateRadiusDimension(centre, edge, leaderPoint)
        : calculateDiameterDimension(centre, edge, leaderPoint);
      const graphics: Shape[] = [];
      const pushLine = (a: Point2D, b: Point2D) => graphics.push({
        id: makeId(), type: 'line',
        points: [{ x: a.x / scale, y: a.y / scale }, { x: b.x / scale, y: b.y / scale }],
        layer: 'DIMENSIONS'
      });
      geometry.centerMark.forEach(line => pushLine(line.a, line.b));
      pushLine(geometry.leader.a, geometry.leader.b);
      if (kind === 'diameter') pushLine(edge, { x: centre.x - radiusM, y: centre.y });
      const value = kind === 'radius' ? radiusM : radiusM * 2;
      const annotation: DraftAnnotation = {
        id: makeId(), kind: 'text', layer: 'DIMENSIONS', at: geometry.labelPoint,
        text: (kind === 'radius' ? 'R ' : 'Ø ') + formatStyledDimension(value, dimensionStyle),
        heightMm: dimensionStyle.textHeightMm, rotationDeg: 0
      };
      setShapes(current => [...current, ...graphics]);
      setDrafting(current => ({ ...current, annotations: [...current.annotations, annotation] }));
      setDraftTool('none');
      setAnnotationDraft([]);
      setMessage((kind === 'radius' ? 'Radius' : 'Diameter') + ' dimension placed from selected circle. The measured value is captured as editable drawing geometry.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Radial dimension could not be placed.');
    }
    return true;
  }

  function previewDrawing(next: Shape[], label: string) {
    if (selectedShapes.some(shape => drafting.layers.find(item => item.name === shape.layer)?.locked)) { setMessage('Selection includes locked-layer entities. Unlock the layer before modifying them.'); return; }
    setPreviewShapes(next);
    setMessage(label + ' preview ready. Apply preview to commit, or cancel it.');
  }
  function commitPreview() {
    if (!previewShapes) return;
    setShapes(previewShapes);
    setPreviewShapes(null);
    setMessage('Preview committed to the drawing.');
  }

  function updateSelected(patch: Partial<Shape>) {
    if (!selectedShapeId) return;
    if (drafting.layers.find(item => item.name === selectedShape?.layer)?.locked) { setMessage('This layer is locked. Unlock it before editing entities.'); return; }
    setShapes(rows => rows.map(shape => shape.id === selectedShapeId ? { ...shape, ...patch } : shape));
  }

  function calibrateSelectedLine() {
    if (!selectedShape || selectedShape.type !== 'line') return;
    const drawingLength = Math.hypot(selectedShape.points[1].x - selectedShape.points[0].x, selectedShape.points[1].y - selectedShape.points[0].y);
    if (!Number.isFinite(drawingLength) || drawingLength <= 0) {
      setMessage('A zero-length line cannot be used for scale calibration.');
      return;
    }
    const entered = window.prompt('Enter the verified real-world length of this selected line in metres. Do not estimate.');
    if (entered === null) return;
    const knownLength = Number(entered);
    if (!Number.isFinite(knownLength) || knownLength <= 0) {
      setMessage('Calibration cancelled: enter a positive, verified length in metres.');
      return;
    }
    setCalibratedMetresPerUnit(knownLength / drawingLength);
    setMessage('Drawing calibrated from the selected line. Measurements now use the verified metre scale.');
  }

  function deleteSelectedShape() {
    const ids = selectedShapeIds.length ? selectedShapeIds : selectedShape ? [selectedShape.id] : [];
    if (!ids.length) return;
    const selected = shapes.filter(shape => ids.includes(shape.id));
    if (selected.some(shape => drafting.layers.find(item => item.name === shape.layer)?.locked)) {
      setMessage('Selection includes locked-layer entities. Unlock those layers before deleting.');
      return;
    }
    if (!window.confirm('Delete ' + ids.length + ' selected CAD entity/entities?')) return;
    setShapes(rows => rows.filter(shape => !ids.includes(shape.id)));
    setSelectedShapeId('');
    setSelectedShapeIds([]);
    setMessage(ids.length + ' selected CAD entity/entities deleted.');
  }

  function insertEngineeringBlock(atDrawingPoint?: Point2D) {
    if (!calibratedMetresPerUnit) { setMessage('Calibrate the drawing from a verified real length before inserting engineering objects at true scale.'); return; }
    try {
      const block = getEngineeringBlock(libraryBlockName);
      const placement = atDrawingPoint || { x: viewBox.x + viewBox.width / 2, y: viewBox.y + viewBox.height / 2 };
      const atMetres = { x: placement.x * calibratedMetresPerUnit, y: placement.y * calibratedMetresPerUnit };
      const targetLayer = block.category === 'valve' ? 'WATER_VALVE' : block.category === 'structure' ? 'WATER_STRUCTURE' : block.category === 'pipework' ? 'WATER_PIPE' : 'WATER_FITTING';
      const insert: BlockInsert = { blockName: block.name, at: { x: atMetres.x * 1000, y: atMetres.y * 1000 }, rotationDeg: libraryRotationDeg, scaleX: 1, scaleY: 1, layer: targetLayer, properties: { ...block.defaultProperties } };
      const primitives = instantiateEngineeringBlock(insert);
      const toDrawing = (point: { x: number; y: number }) => ({ x: point.x / 1000 / calibratedMetresPerUnit, y: point.y / 1000 / calibratedMetresPerUnit });
      const newShapes: Shape[] = primitives.map(primitive => {
        if (primitive.kind === 'line') return { id: makeId(), type: 'line', points: [toDrawing(primitive.a), toDrawing(primitive.b)], layer: targetLayer };
        if (primitive.kind === 'circle') return { id: makeId(), type: 'circle', points: [toDrawing(primitive.center)], radius: primitive.radius / 1000 / calibratedMetresPerUnit, layer: targetLayer };
        return { id: makeId(), type: 'polyline', points: primitive.points.map(toDrawing), layer: targetLayer };
      });
      setShapes(current => [...current, ...newShapes]);
      if (block.waterKind && block.name !== 'PIPE_BREAK') {
        const id = block.name + '-' + makeId();
        const component = createWaterComponent(block.waterKind, id, atMetres.x, atMetres.y);
        component.properties = { ...component.properties, ...block.defaultProperties, rotationDeg: libraryRotationDeg };
        const transformedPorts = instantiateEngineeringPorts(insert, block);
        if (transformedPorts.length) {
          component.customPorts = transformedPorts.map((port,index) => ({
            id: port.id,
            point: { x: port.point.x / 1000, y: port.point.y / 1000 },
            role: block.waterKind === 'tee' ? (index === 2 ? 'branch' : 'run')
              : ['tank','reservoir','chamber','hydrant'].includes(block.waterKind || '') ? 'node'
              : /branch|drain/i.test(port.id) ? 'branch'
              : index === 0 ? 'inlet' : 'outlet',
            diameterMm: port.nominalDiameterMm ?? (Number(block.defaultProperties.nominalDiameterMm ?? component.properties.nominalDiameterMm) || undefined),
          }));
        }
        setWaterCad(current => ({ ...current, components: [...current.components, component] }));
        setSelectedWaterId(id);
      }
      setLibraryPlacementActive(false);
      setMessage(block.name + ' inserted at calibrated scale and ' + libraryRotationDeg + '° rotation. Review position, orientation and engineering properties before design use.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Engineering object could not be inserted.'); }
  }

  function createOrRefreshPaperLayout() {
    if (!calibratedMetresPerUnit) { setMessage('Calibrate the drawing before creating a scaled paper-space viewport.'); return; }
    const dimensions = sheetDimensionsMm(drafting.sheet);
    const viewportWidthMm = dimensions.widthMm - 40;
    const viewportHeightMm = dimensions.heightMm - 80;
    if (viewportWidthMm <= 0 || viewportHeightMm <= 0) { setMessage('The selected sheet is too small for the default paper-space viewport.'); return; }
    try {
      const scaleDenominator = fitViewportScale(viewBox.width * calibratedMetresPerUnit, viewBox.height * calibratedMetresPerUnit, viewportWidthMm, viewportHeightMm, [20,25,50,75,100,150,200,250,500,1000,2000,5000]);
      const layoutId = 'LAY-' + drafting.sheet.drawingNumber;
      const layout: PaperLayout = {
        id: layoutId, name: drafting.sheet.title, sheetSize: drafting.sheet.size, widthMm: dimensions.widthMm, heightMm: dimensions.heightMm, orientation: drafting.sheet.orientation,
        printableMarginMm: 10, plotScale: '1:1',
        viewports: [{ id: 'VP-' + drafting.sheet.drawingNumber, name: 'Main model viewport', xMm: 20, yMm: 20, widthMm: viewportWidthMm, heightMm: viewportHeightMm, modelCenter: { x: (viewBox.x + viewBox.width / 2) * calibratedMetresPerUnit, y: (viewBox.y + viewBox.height / 2) * calibratedMetresPerUnit }, scaleDenominator, rotationDeg: 0, locked: true, visible: true }],
      };
      const issues = validatePaperLayout(layout);
      if (issues.length) { setMessage('Paper-space layout could not be created: ' + issues.join(' ')); return; }
      setPaperLayouts(current => [...current.filter(item => item.id !== layoutId), layout]);
      setMessage('Paper-space layout created for ' + drafting.sheet.drawingNumber + ' with a locked 1:' + scaleDenominator + ' model viewport. Save the drawing to persist it.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Paper-space layout could not be created.'); }
  }
  function updatePaperViewport(patch: Partial<PaperLayout['viewports'][number]>) {
    const layoutId = 'LAY-' + drafting.sheet.drawingNumber;
    setPaperLayouts(current => current.map(layout => layout.id === layoutId
      ? { ...layout, viewports: layout.viewports.map((viewport,index) => index === 0 ? { ...viewport, ...patch } : viewport) }
      : layout));
  }
  function runEngineeringAudit() {
    const result = auditEngineeringDrawing({ drafting: { ...drafting, dimensionStyle }, waterCad, shapes, metresPerDrawingUnit: calibratedMetresPerUnit, paperLayouts, layerStandard: layerTemplate, dimensionStyle });
    setEngineeringAudit(result);
    setMessage('Engineering drawing audit completed: ' + result.status + ' · ' + result.errors + ' errors · ' + result.warnings + ' warnings.');
  }
  async function importTerrainGridFile(file?: File) {
    if (!file) return;
    try {
      const grid = JSON.parse(await file.text()) as TerrainGrid;
      if (!grid || !Number.isInteger(grid.width) || !Number.isInteger(grid.height) || !Array.isArray(grid.elevationsM) || !grid.crs || !grid.verticalDatum) throw new Error('Terrain JSON must include width, height, origin, cell sizes, elevationsM, crs and verticalDatum.');
      sampleTerrainElevation(grid,grid.originX,grid.originY);
      setTerrainGrid(grid);
      setMessage('Terrain grid loaded: ' + grid.width + ' × ' + grid.height + ' cells · ' + grid.crs + ' · vertical datum ' + grid.verticalDatum + '. Save the drawing to persist it.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Terrain import failed.'); }
    if (terrainFileRef.current) terrainFileRef.current.value = '';
  }

  async function fetchTerrainSurfaceFromGis() {
    if (!gisFeatures.length) { setMessage('Save GIS features first, then fetch their terrain surface here.'); return; }
    const points: number[][] = [];
    const collect = (value: any): void => {
      if (!Array.isArray(value)) return;
      if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
        if (Number.isFinite(value[0]) && Number.isFinite(value[1])) points.push(value);
        return;
      }
      value.forEach(collect);
    };
    gisFeatures.forEach(feature => collect(feature.geometry?.coordinates ?? feature.coordinates));
    const valid = points.filter(point => Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90);
    if (!valid.length) { setMessage('The saved GIS draft has no valid geographic coordinates for DEM clipping.'); return; }
    const bbox = {
      west: Math.min(...valid.map(point => point[0])) - 0.002,
      south: Math.min(...valid.map(point => point[1])) - 0.002,
      east: Math.max(...valid.map(point => point[0])) + 0.002,
      north: Math.max(...valid.map(point => point[1])) + 0.002,
    };
    setTerrainTransferBusy(true);
    setMessage('Requesting a project-clipped DEM grid from PyQGIS…');
    try {
      const response = await api.post('/api/projects/' + projectId + '/gis-terrain/grid', { bbox, maxDimension: 64 });
      const grid = response.data?.grid as TerrainGrid;
      if (!grid || !Number.isInteger(grid.width) || !Number.isInteger(grid.height) || !Array.isArray(grid.elevationsM) || !grid.crs || !grid.verticalDatum) throw new Error('PyQGIS returned an incomplete terrain grid.');
      sampleTerrainElevation(grid, grid.originX, grid.originY);
      setTerrainGrid(grid);
      await onSave({
        shapes, waterCad, terrainGrid: grid, hydraulicResults, hydraulicResultSeries, hydraulicReport, hydraulicOverlay,
        drafting: { ...drafting, dimensionStyle }, paperLayouts, units, schemaVersion: 1,
        coordinateSystem: calibratedMetresPerUnit ? 'calibrated-local-grid' : 'legacy-unscaled-drawing-units',
        calibratedMetresPerUnit, viewport: viewBox, format: 'RayanAqua CAD v3', updatedAt: new Date().toISOString(),
      });
      setMessage('PyQGIS DEM surface saved into this CAD drawing: ' + grid.width + ' × ' + grid.height + ' samples · ' + grid.crs + ' · ' + grid.verticalDatum + '. Terrain alignment still requires matching network CRS, metre units and vertical datum.');
    } catch (error) {
      setMessage(error instanceof Error ? 'CAD terrain acquisition failed: ' + error.message : 'CAD terrain acquisition failed.');
    } finally {
      setTerrainTransferBusy(false);
    }
  }

  async function importEpanetFile(file?: File, mode: 'replace'|'merge' = 'replace') {
    if (!file) return;
    try {
      if (mode==='replace' && waterCad.components.length && !window.confirm('Replace the current water CAD network with this EPANET model? CAD-only fittings and annotations in the water network will not be retained.')) return;
      const imported = importEpanetInp(await file.text());
      const nextDocument=mode==='merge'?mergeEpanetRoundTrip(waterCad,imported.document):imported.document;
      setWaterCad(nextDocument);
      setHydraulicResults(null);
      setHydraulicResultSeries([]);
      setHydraulicReport('');
      setHydraulicTimeIndex(0);
      setHydraulicOverlay(null);
      setMessage((mode==='merge'?'Merged ':'Imported ') + imported.document.components.length + ' EPANET network objects into CAD.' + (mode==='merge'?' Existing CAD-only fittings and matching surveyed vertex levels were preserved where IDs/coordinates matched.':'') + (imported.warnings.length ? ' Review: ' + imported.warnings.join(' ') : ' Hydraulic properties and supported network geometry were retained.'));
    } catch (error) { setMessage(error instanceof Error ? error.message : 'EPANET import failed.'); }
    if (epanetFileRef.current) epanetFileRef.current.value = '';
  }

  async function runProjectHydraulics() {
    if (simulationBusy) return;
    setSimulationBusy(true);
    try {
      const exported = exportWaterNetworkToEpanet(waterCad);
      if(exported.warnings.some(warning=>warning.startsWith('EPANET ID collision') || warning.startsWith('EPANET node ID collision'))) throw new Error('EPANET IDs are not unique after normalization. Rename the conflicting CAD objects before simulation.');
      if (exported.warnings.length && !window.confirm('The EPANET export has '+exported.warnings.length+' warning(s). Some CAD components may not be represented in the hydraulic model. Review the warnings before proceeding. Run the model anyway?\n\n'+exported.warnings.slice(0,8).join('\n'))) return;
      const output = await runEpanetHydraulicSimulation(exported.input);
      if (!output.results.length) throw new Error('EPANET completed without returning hydraulic timesteps.');
      const nodeIdMap=new Map(exported.idMap.filter(item=>item.kind==='node').map(item=>[item.epanetId,item.cadId]));
      const linkIdMap=new Map(exported.idMap.filter(item=>item.kind==='link').map(item=>[item.epanetId,item.cadId]));
      const mappedResults=output.results.map(result=>({...result,nodes:result.nodes.map(node=>({...node,id:nodeIdMap.get(node.id)??node.id})),links:result.links.map(link=>({...link,id:linkIdMap.get(link.id)??link.id}))}));
      const finalIndex=mappedResults.length-1;
      const finalResult=mappedResults[finalIndex];
      setHydraulicResultSeries(mappedResults);
      setHydraulicReport(output.report);
      setHydraulicTimeIndex(finalIndex);
      setHydraulicResults(finalResult);
      setHydraulicOverlay(buildHydraulicOverlay(waterCad,finalResult,hydraulicMetric));
      setMessage('OWA-EPANET simulation completed: '+output.results.length+' hydraulic timestep(s); final time '+finalResult.timeSeconds+' s. Review pressure, flow, velocity and headloss overlays. '+(exported.warnings.length?exported.warnings.length+' export warning(s) remain.':''));
    } catch (error) { setMessage(error instanceof Error ? 'EPANET simulation failed: '+error.message : 'EPANET simulation failed.'); }
    finally { setSimulationBusy(false); }
  }

  function selectHydraulicTime(index:number) {
    const result=hydraulicResultSeries[index];
    if(!result)return;
    setHydraulicTimeIndex(index);
    setHydraulicResults(result);
    setHydraulicOverlay(buildHydraulicOverlay(waterCad,result,hydraulicMetric));
  }

  async function importHydraulicResultsFile(file?: File) {
    if (!file) return;
    try {
      const results = JSON.parse(await file.text()) as HydraulicResults;
      if (!Number.isFinite(results.timeSeconds) || !Array.isArray(results.nodes) || !Array.isArray(results.links)) throw new Error('Results JSON must include timeSeconds, nodes[] and links[].');
      const exportedIds=exportWaterNetworkToEpanet(waterCad).idMap;
      const nodeIdMap=new Map(exportedIds.filter(item=>item.kind==='node').map(item=>[item.epanetId,item.cadId]));
      const linkIdMap=new Map(exportedIds.filter(item=>item.kind==='link').map(item=>[item.epanetId,item.cadId]));
      const mappedResults={...results,nodes:results.nodes.map(node=>({...node,id:nodeIdMap.get(node.id)??node.id})),links:results.links.map(link=>({...link,id:linkIdMap.get(link.id)??link.id}))};
      setHydraulicResults(mappedResults);
      setHydraulicResultSeries([mappedResults]);
      setHydraulicTimeIndex(0);
      setHydraulicOverlay(buildHydraulicOverlay(waterCad, mappedResults, hydraulicMetric));
      setMessage('Hydraulic results loaded for ' + results.timeSeconds + ' seconds. Results are matched to CAD IDs; unmatched IDs are not displayed.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Hydraulic result import failed.'); }
    if (hydraulicResultsFileRef.current) hydraulicResultsFileRef.current.value = '';
  }

  function changeHydraulicMetric(metric: HydraulicOverlayMetric) {
    setHydraulicMetric(metric);
    if (hydraulicResults) setHydraulicOverlay(buildHydraulicOverlay(waterCad, hydraulicResults, metric));
  }

  function applyTerrainToSelectedPipe() {
    const selected = waterCad.components.find(component => component.id === selectedWaterId);
    if (!terrainGrid) { setMessage('Import a terrain elevation grid before routing a pipe.'); return; }
    if (waterCad.horizontalUnits !== 'm' || waterCad.horizontalCrs !== terrainGrid.crs || waterCad.verticalDatum !== terrainGrid.verticalDatum) { setMessage('Terrain routing blocked: project CRS ('+(waterCad.horizontalCrs||'unset')+', '+(waterCad.horizontalUnits||'unknown')+') must match terrain CRS ('+terrainGrid.crs+') and vertical datum ('+terrainGrid.verticalDatum+') in metres. Reproject/vertically transform the data first; do not relabel coordinates.'); return; }
    if (!selected || selected.kind !== 'pipe') { setMessage('Select a pipe in the component register first.'); return; }
    try {
      const updated = applyTerrainToPipe(selected, terrainGrid, terrainCoverM, 0, terrainProfileSpacingM);
      setWaterCad(current => ({ ...current, components: current.components.map(component => component.id === updated.id ? updated : component) }));
      const profile = sampleGroundProfile(terrainGrid, updated.geometry, terrainProfileSpacingM);
      setMessage('Terrain route applied to ' + updated.id + ': ' + profile.length + ' profile samples. Review cover and invert levels, then save.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Terrain routing failed.'); }
  }

  async function saveDrawing() {
    const geometryIssues = validateCadEntities(shapes);
    if (geometryIssues.length) {
      setMessage('Save blocked by CAD geometry validation: ' + geometryIssues.slice(0, 5).join(' '));
      return;
    }
    setBusy(true);
    try {
      await onSave({
        shapes,
        waterCad,
        terrainGrid,
        hydraulicResults,
        hydraulicResultSeries,
        hydraulicReport,
        hydraulicOverlay,
        drafting: { ...drafting, dimensionStyle },
        paperLayouts,
        units,
        schemaVersion: 1,
        coordinateSystem: calibratedMetresPerUnit ? 'calibrated-local-grid' : 'legacy-unscaled-drawing-units',
        calibratedMetresPerUnit,
        viewport: viewBox,
        format: 'RayanAqua CAD v3',
        updatedAt: new Date().toISOString(),
      });
      setMessage('Drawing, water network and drafting annotations saved to this project.');
    } catch (error) {
      setMessage(error instanceof Error ? 'Save failed: ' + error.message : 'Drawing could not be saved. Please retry.');
    } finally {
      setBusy(false);
    }
  }

  function downloadWaterFile(filename: string, content: string, type: string) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadEpanetInput() {
    const result = exportWaterNetworkToEpanet(waterCad);
    downloadWaterFile('rayanaqua-network.inp', result.input, 'text/plain');
    setMessage(result.warnings.length ? 'EPANET INP exported with ' + result.warnings.length + ' warning(s): ' + result.warnings.join(' ') : 'EPANET INP exported. You can run the bundled OWA-EPANET engine here or validate the file in desktop EPANET.');
  }

  function validateWaterTopology() {
    const issues = validateWaterNetworkTopology(waterCad);
    const errors = issues.filter(issue => issue.severity === 'error').length;
    const warnings = issues.filter(issue => issue.severity === 'warning').length;
    setMessage(issues.length ? 'Network check: ' + errors + ' error(s), ' + warnings + ' warning(s). ' + issues.slice(0, 5).map(issue => issue.message).join(' ') : 'Network topology check passed: all defined ports are connected within tolerance.');
  }

  function downloadWaterBoq() {
    const rows = buildPreliminaryBoq(waterCad);
    const csv = ['Code,Description,Unit,Quantity,Material,Nominal diameter (mm)', ...rows.map(row => [row.code, '"' + row.description.replace(/"/g, '""') + '"', row.unit, row.quantity.toFixed(3), row.material || '', row.nominalDiameterMm || ''].join(','))].join('\n');
    downloadWaterFile('rayanaqua-preliminary-boq.csv', csv, 'text/csv');
  }

  function updateDrawingSheet(patch: Partial<DraftingDocument['sheet']>) {
    setDrafting(current => {
      const sheet = { ...current.sheet, ...patch };
      const sheets = [...current.sheets];
      sheets[current.activeSheetIndex] = sheet;
      return { ...current, sheet, sheets };
    });
  }
  function selectDrawingSheet(index: number) {
    setDrafting(current => ({ ...current, activeSheetIndex: index, sheet: { ...current.sheets[index] } }));
  }
  function addDrawingSheet() {
    setDrafting(current => {
      const index = current.sheets.length;
      const sheet = { ...current.sheet, drawingNumber: 'RA-WTR-' + String(index + 1).padStart(3, '0'), title: 'Water Engineering Detail', revision: 'P01', status: 'PRELIMINARY' as const };
      return { ...current, sheet, sheets: [...current.sheets, sheet], activeSheetIndex: index };
    });
  }

  function addDraftLayer() {
    const name = newLayerName.trim().toUpperCase().replace(/\\s+/g, '_');
    if (!name) return;
    if (drafting.layers.some(item => item.name.toUpperCase() === name)) { setMessage('That layer already exists.'); return; }
    setDrafting(current => ({ ...current, layers: [...current.layers, { name, color: '#ffffff', lineType: 'CONTINUOUS', lineWeightMm: 0.18, visible: true, locked: false, plot: true }] }));
    setNewLayerName('');
  }
  function applyLayerTemplate() {
    const result = synchronizeLayerTemplate(drafting.layers, layerTemplate);
    setDrafting(current => ({ ...current, layers: result.layers }));
    const changes = [...result.added.map(name => 'added ' + name), ...result.updated.map(name => 'updated ' + name)];
    setMessage(changes.length ? 'Applied ' + layerTemplate + ' layer profile: ' + changes.join(', ') + '. Visibility, lock and plot settings were preserved.' : 'All layers already match the ' + layerTemplate + ' profile.');
  }
  function addRevisionEntry() {
    try {
      const revision = { ...revisionDraft, status: drafting.sheet.status };
      const history = appendDrawingRevision(drafting.revisionHistory || [], revision);
      setDrafting(current => ({ ...current, revisionHistory: history, sheet: { ...current.sheet, revision: revision.revision, status: revision.status }, sheets: current.sheets.map((sheet,index) => index === current.activeSheetIndex ? { ...sheet, revision: revision.revision, status: revision.status } : sheet) }));
      setRevisionDraft(current => ({ ...current, revision: '', description: '' }));
      setMessage('Revision ' + revision.revision + ' added to this drawing sheet history.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Revision could not be added.'); }
  }
  function validateDrafting() {
    const issues = [...validateDraftingDocument(drafting), ...validateDimensionStyle(dimensionStyle), ...validatePlotConfiguration(drafting.layers), ...validateLayerStandard(drafting.layers, layerTemplate)];
    setMessage(issues.length ? 'Drafting check: ' + issues.join(' ') : 'Drafting standards check passed. Check the drawing visually before issue.');
  }
  function removeAnnotation(id: string) {
    setDrafting(current => ({ ...current, annotations: current.annotations.filter(item => item.id !== id) }));
  }
  function exportSheetSvg(printToPdf = false, sheetOverride?: DraftingDocument['sheet'], batch = false): string | void {
    const sheet = sheetOverride || drafting.sheet;
    const { widthMm, heightMm } = sheetDimensionsMm(sheet);
    const denominator = Number(sheet.scale.split(':')[1]) || 100;
    const metresPerUnit = calibratedMetresPerUnit || 1;
    const paperLayout = paperLayouts.find(layout => layout.id === 'LAY-' + sheet.drawingNumber && Math.abs(layout.widthMm - widthMm) < 0.5 && Math.abs(layout.heightMm - heightMm) < 0.5);
    const viewport = paperLayout?.viewports.find(item => item.visible);
    const drawingScaleDenominator = viewport?.scaleDenominator || denominator;
    const factor = metresPerUnit * 1000 / drawingScaleDenominator;
    const margin = 10, titleBlockHeight = 42, usableWidth = widthMm - margin * 2, usableHeight = heightMm - margin * 2 - titleBlockHeight;
    const allPoints = shapes.flatMap(shape => shape.points)
      .concat(waterCad.components.flatMap(item => item.geometry.map(p => ({ x: p.x / metresPerUnit, y: p.y / metresPerUnit }))))
      .concat(drafting.annotations.flatMap(item => item.kind === 'text' ? [{x:item.at.x/metresPerUnit,y:item.at.y/metresPerUnit}] : item.kind === 'leader' ? item.points.map(p=>({x:p.x/metresPerUnit,y:p.y/metresPerUnit})) : item.kind === 'radial' ? [{x:item.center.x/metresPerUnit,y:item.center.y/metresPerUnit}] : item.kind === 'angular' ? [item.vertex,item.rayA,item.rayB].map(p=>({x:p.x/metresPerUnit,y:p.y/metresPerUnit})) : [{x:item.a.x/metresPerUnit,y:item.a.y/metresPerUnit},{x:item.b.x/metresPerUnit,y:item.b.y/metresPerUnit}]));
    const minX = allPoints.length ? Math.min(...allPoints.map(p=>p.x)) : 0;
    const maxX = allPoints.length ? Math.max(...allPoints.map(p=>p.x)) : 1;
    const minY = allPoints.length ? Math.min(...allPoints.map(p=>p.y)) : 0;
    const maxY = allPoints.length ? Math.max(...allPoints.map(p=>p.y)) : 1;
    const tx = margin + (usableWidth - (maxX-minX)*factor)/2 - minX*factor;
    const ty = margin + (usableHeight - (maxY-minY)*factor)/2 + maxY*factor;
    const mapPoint = (p: {x:number;y:number}) => {
      if (viewport) {
        const dx = p.x * metresPerUnit - viewport.modelCenter.x, dy = p.y * metresPerUnit - viewport.modelCenter.y;
        const angle = viewport.rotationDeg * Math.PI / 180, cosine = Math.cos(angle), sine = Math.sin(angle);
        return { x: viewport.xMm + viewport.widthMm / 2 + factor * (dx * cosine - dy * sine), y: viewport.yMm + viewport.heightMm / 2 - factor * (dx * sine + dy * cosine) };
      }
      return { x: tx + p.x * factor, y: ty - p.y * factor };
    };
    const layer = (name:string) => drafting.layers.find(x=>x.name===name);
     const plotColor = (value:string) => value.toLowerCase() === '#ffffff' ? '#111111' : value;
    const allowed = new Set(drafting.layers.filter(x=>x.visible&&x.plot).map(x=>x.name));
    const safe = (value:string) => value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const drawing = shapes.filter(shape=>allowed.has(shape.layer||'0')).map(shape=>{
      const style=layer(shape.layer||'0'), color=plotColor(style?.color||'#111111'), weight=style?.lineWeightMm||0.18;
      if(shape.type==='line'){const a=mapPoint(shape.points[0]),b=mapPoint(shape.points[1]);return '<line x1="'+a.x+'" y1="'+a.y+'" x2="'+b.x+'" y2="'+b.y+'" stroke="'+color+'" stroke-width="'+weight+'"/>';}
      if(shape.type==='circle'){const a=mapPoint(shape.points[0]);return '<circle cx="'+a.x+'" cy="'+a.y+'" r="'+(shape.radius||1)*factor+'" fill="none" stroke="'+color+'" stroke-width="'+weight+'"/>';}
      const pts=shape.type==='rect'?[shape.points[0],{x:shape.points[1].x,y:shape.points[0].y},shape.points[1],{x:shape.points[0].x,y:shape.points[1].y},shape.points[0]]:shape.points;
      return '<polyline points="'+pts.map(p=>{const q=mapPoint(p);return q.x+','+q.y;}).join(' ')+'" fill="none" stroke="'+color+'" stroke-width="'+weight+'"/>';
    }).join('');
    const water = waterCad.components.filter(item=>allowed.has(waterLayerName(item.kind))).map(item=>{
      const pts=item.geometry.map(p=>mapPoint({x:p.x/metresPerUnit,y:p.y/metresPerUnit}));
      if(!pts.length)return '';
      const result=hydraulicOverlay?.items.find(entry=>entry.componentId===item.id);
      const colour=result?.colour||'#087e83';
      const resultLabel=result?' '+safe(result.label):'';
      if(item.kind==='pipe'&&pts.length>1){
        let arrow='';
        if(result?.direction&&result.direction!=='stagnant'){
          const index=Math.max(0,Math.floor((pts.length-1)/2));let a=pts[index],b=pts[Math.min(index+1,pts.length-1)];
          if(result.direction==='reverse'){const swap=a;a=b;b=swap;}
          const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy)||1,ux=dx/length,uy=dy/length,nx=-uy,ny=ux,size=2.5,mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2},tip={x:mid.x+ux*size,y:mid.y+uy*size},base={x:mid.x-ux*size*0.65,y:mid.y-uy*size*0.65};
          arrow='<polygon points="'+tip.x+','+tip.y+' '+(base.x+nx*size*0.55)+','+(base.y+ny*size*0.55)+' '+(base.x-nx*size*0.55)+','+(base.y-ny*size*0.55)+'" fill="'+colour+'"/>';
        }
        return '<polyline points="'+pts.map(p=>p.x+','+p.y).join(' ')+'" fill="none" stroke="'+colour+'" stroke-width="0.45"/>'+arrow+'<text x="'+(pts[0].x+1)+'" y="'+(pts[0].y-1)+'" font-size="2.2" fill="'+colour+'">'+safe(item.properties.tag)+resultLabel+'</text>';
      }
      return '<circle cx="'+pts[0].x+'" cy="'+pts[0].y+'" r="1.5" fill="none" stroke="'+colour+'" stroke-width="0.35"/><text x="'+(pts[0].x+2)+'" y="'+(pts[0].y-2)+'" font-size="2.5" fill="'+colour+'">'+safe(item.properties.tag)+resultLabel+'</text>';
    }).join('');
    const annotations=drafting.annotations.filter(item=>allowed.has(item.layer)).map(item=>{
      const color=plotColor(layer(item.layer)?.color||'#111111');
      if(item.kind==='text'){const p=mapPoint({x:item.at.x/metresPerUnit,y:item.at.y/metresPerUnit});return '<text x="'+p.x+'" y="'+p.y+'" font-size="'+item.heightMm+'" fill="'+color+'">'+safe(item.text)+'</text>';}
      if(item.kind==='radial'){
        const resolved=resolveAssociativeRadialDimension(item,shapes,calibratedMetresPerUnit||1),center=mapPoint({x:resolved.center.x/metresPerUnit,y:resolved.center.y/metresPerUnit}),radius=resolved.radiusM*1000/drawingScaleDenominator;
        const edge={x:center.x+Math.cos(item.leaderAngleRad)*radius,y:center.y-Math.sin(item.leaderAngleRad)*radius},opposite={x:center.x-Math.cos(item.leaderAngleRad)*radius,y:center.y+Math.sin(item.leaderAngleRad)*radius},value=item.dimensionType==='radius'?resolved.radiusM:resolved.radiusM*2,label=(item.dimensionType==='radius'?'R ':'Ø ')+formatStyledDimension(value,dimensionStyle);
        const dimensionLine=item.dimensionType==='diameter'?'<line x1="'+opposite.x+'" y1="'+opposite.y+'" x2="'+edge.x+'" y2="'+edge.y+'" stroke="'+color+'" stroke-width="0.18"/>':'<line x1="'+center.x+'" y1="'+center.y+'" x2="'+edge.x+'" y2="'+edge.y+'" stroke="'+color+'" stroke-width="0.18"/>';
        return dimensionLine+'<text x="'+(edge.x+1)+'" y="'+(edge.y-1)+'" font-size="2.5" fill="'+color+'">'+safe(label)+'</text>';
      }
      if(item.kind==='angular'){
        const resolved=resolveAssociativeAngularDimension(item,shapes,calibratedMetresPerUnit||1),g=calculateAngularDimension(resolved.vertex,resolved.rayA,resolved.rayB,item.offsetM),pts=Array.from({length:25},(_,i)=>{const a=g.arc.startAngleRad+(g.arc.endAngleRad-g.arc.startAngleRad)*i/24;return mapPoint({x:(g.arc.center.x+Math.cos(a)*g.arc.radius)/metresPerUnit,y:(g.arc.center.y+Math.sin(a)*g.arc.radius)/metresPerUnit});}),at=mapPoint({x:g.labelPoint.x/metresPerUnit,y:g.labelPoint.y/metresPerUnit}),label=(measureAngularDimension(resolved)*180/Math.PI).toFixed(item.precision)+'°';
        const vertex=mapPoint({x:resolved.vertex.x/metresPerUnit,y:resolved.vertex.y/metresPerUnit}),rayA=mapPoint({x:resolved.rayA.x/metresPerUnit,y:resolved.rayA.y/metresPerUnit}),rayB=mapPoint({x:resolved.rayB.x/metresPerUnit,y:resolved.rayB.y/metresPerUnit});
        return '<line x1="'+vertex.x+'" y1="'+vertex.y+'" x2="'+rayA.x+'" y2="'+rayA.y+'" stroke="'+color+'" stroke-width="0.18"/><line x1="'+vertex.x+'" y1="'+vertex.y+'" x2="'+rayB.x+'" y2="'+rayB.y+'" stroke="'+color+'" stroke-width="0.18"/><polyline points="'+pts.map(p=>p.x+','+p.y).join(' ')+'" fill="none" stroke="'+color+'" stroke-width="0.18"/><text x="'+at.x+'" y="'+at.y+'" font-size="2.5" fill="'+color+'">'+safe(label)+'</text>';
      }
      if(item.kind==='leader'){const pts=item.points.map(p=>mapPoint({x:p.x/metresPerUnit,y:p.y/metresPerUnit}));const last=pts[pts.length-1];return '<polyline points="'+pts.map(p=>p.x+','+p.y).join(' ')+'" fill="none" stroke="'+color+'" stroke-width="0.18"/><text x="'+(last.x+1)+'" y="'+(last.y-1)+'" font-size="'+item.textHeightMm+'" fill="'+color+'">'+safe(item.text)+'</text>';}
      const resolved=resolveAssociativeDimension(item,shapes,calibratedMetresPerUnit||1),a=mapPoint({x:resolved.a.x/metresPerUnit,y:resolved.a.y/metresPerUnit}),b=mapPoint({x:resolved.b.x/metresPerUnit,y:resolved.b.y/metresPerUnit});
      const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1,nx=-dy/len,ny=dx/len,off=item.offsetM*1000/drawingScaleDenominator;
      const p1={x:a.x+nx*off,y:a.y+ny*off},p2={x:b.x+nx*off,y:b.y+ny*off};
      const label=item.association?formatStyledDimension(measureDimension(resolved),dimensionStyle):item.textOverride||formatDimension(measureDimension(resolved),item.precision,sheet.units),mid={x:(p1.x+p2.x)/2,y:(p1.y+p2.y)/2},arrow=dimensionStyle.arrowSizeMm,extOffset=dimensionStyle.extensionOffsetMm,extBeyond=dimensionStyle.extensionBeyondMm,e1={x:a.x+nx*extOffset,y:a.y+ny*extOffset},e2={x:b.x+nx*extOffset,y:b.y+ny*extOffset},e1End={x:p1.x+nx*extBeyond,y:p1.y+ny*extBeyond},e2End={x:p2.x+nx*extBeyond,y:p2.y+ny*extBeyond};
      return '<line x1="'+e1.x+'" y1="'+e1.y+'" x2="'+e1End.x+'" y2="'+e1End.y+'" stroke="'+color+'" stroke-width="0.18"/><line x1="'+e2.x+'" y1="'+e2.y+'" x2="'+e2End.x+'" y2="'+e2End.y+'" stroke="'+color+'" stroke-width="0.18"/><line x1="'+p1.x+'" y1="'+p1.y+'" x2="'+p2.x+'" y2="'+p2.y+'" stroke="'+color+'" stroke-width="0.18"/><path d="M '+p1.x+' '+p1.y+' l '+(dx/len*arrow+nx*arrow*0.5)+' '+(dy/len*arrow+ny*arrow*0.5)+' M '+p1.x+' '+p1.y+' l '+(dx/len*arrow-nx*arrow*0.5)+' '+(dy/len*arrow-ny*arrow*0.5)+' M '+p2.x+' '+p2.y+' l '+(-dx/len*arrow+nx*arrow*0.5)+' '+(-dy/len*arrow+ny*arrow*0.5)+' M '+p2.x+' '+p2.y+' l '+(-dx/len*arrow-nx*arrow*0.5)+' '+(-dy/len*arrow-ny*arrow*0.5)+'" stroke="'+color+'" fill="none" stroke-width="0.18"/><text x="'+mid.x+'" y="'+(mid.y-dimensionStyle.textGapMm)+'" text-anchor="middle" font-size="'+dimensionStyle.textHeightMm+'" fill="'+color+'">'+safe(label)+'</text>';
    }).join('');
    const titleX=widthMm-170,titleY=heightMm-42;
    const titleBlock='<rect x="'+titleX+'" y="'+titleY+'" width="160" height="32" fill="white" stroke="black" stroke-width="0.25"/><line x1="'+titleX+'" y1="'+(titleY+8)+'" x2="'+(titleX+160)+'" y2="'+(titleY+8)+'" stroke="black" stroke-width="0.18"/><line x1="'+titleX+'" y1="'+(titleY+22)+'" x2="'+(titleX+160)+'" y2="'+(titleY+22)+'" stroke="black" stroke-width="0.18"/><line x1="'+(titleX+105)+'" y1="'+titleY+'" x2="'+(titleX+105)+'" y2="'+(titleY+32)+'" stroke="black" stroke-width="0.18"/><text x="'+(titleX+2)+'" y="'+(titleY+5.5)+'" font-size="3.2">'+safe(sheet.company)+'</text><text x="'+(titleX+2)+'" y="'+(titleY+14)+'" font-size="3">'+safe(sheet.title)+'</text><text x="'+(titleX+2)+'" y="'+(titleY+19)+'" font-size="2.5">'+safe(sheet.status)+'</text><text x="'+(titleX+2)+'" y="'+(titleY+27)+'" font-size="2.2">DES: '+safe(sheet.designer)+'</text><text x="'+(titleX+54)+'" y="'+(titleY+27)+'" font-size="2.2">CHK: '+safe(sheet.checker)+'</text><text x="'+(titleX+2)+'" y="'+(titleY+30.5)+'" font-size="2.2">APP: '+safe(sheet.approver)+'</text><text x="'+(titleX+107)+'" y="'+(titleY+5.5)+'" font-size="2.5">DWG '+safe(sheet.drawingNumber)+'</text><text x="'+(titleX+107)+'" y="'+(titleY+11)+'" font-size="2.5">REV '+safe(sheet.revision)+'</text><text x="'+(titleX+107)+'" y="'+(titleY+16)+'" font-size="2.5">SCALE '+safe(viewport ? '1:' + drawingScaleDenominator : sheet.scale)+'</text><text x="'+(titleX+107)+'" y="'+(titleY+21)+'" font-size="2.5">'+safe(sheet.date)+'</text><text x="'+(titleX+107)+'" y="'+(titleY+27)+'" font-size="2.2">UNITS '+safe(sheet.units)+'</text>';
    const border='<rect x="5" y="5" width="'+(widthMm-10)+'" height="'+(heightMm-10)+'" fill="none" stroke="black" stroke-width="0.5"/>';
    const revisionRows=(drafting.revisionHistory||[]).slice(-5).map((r,i)=>'<text x="15" y="'+(heightMm-58+i*3.5)+'" font-size="2.1">'+safe(r.revision)+' · '+safe(r.date)+' · '+safe(r.description)+'</text>').join('');
    const revisionTable=revisionRows?'<text x="15" y="'+(heightMm-61)+'" font-size="2.4" font-weight="bold">REVISION HISTORY</text>'+revisionRows:'';
    const notes=(sheet.generalNotes||'').split('\n').filter(Boolean).slice(0,8).map((line,i)=>'<text x="15" y="'+(heightMm-24-i*3.2)+'" font-size="2.2">'+safe(line)+'</text>').join('');
    const keyPlan=sheet.keyPlanText?'<text x="15" y="14" font-size="3" font-weight="bold">KEY PLAN · '+safe(sheet.keyPlanText)+'</text>':'';
    const northArrow=sheet.showNorthArrow===false?'':'<g transform="translate('+(widthMm-22)+' 24)"><path d="M 0 9 L 0 -9 M 0 -9 L -3 -3 M 0 -9 L 3 -3" stroke="black" fill="none" stroke-width="0.6"/><text x="0" y="-12" text-anchor="middle" font-size="3">N</text></g>';
    const scaleBarModelM=Math.min(5,50*drawingScaleDenominator/1000),scaleBarLengthMm=scaleBarModelM*1000/denominator;
    const scaleBar=sheet.showScaleBar===false?'':'<g transform="translate(18 '+(heightMm-18)+')"><rect x="0" y="0" width="'+(scaleBarLengthMm/2)+'" height="2" fill="black"/><rect x="'+(scaleBarLengthMm/2)+'" y="0" width="'+(scaleBarLengthMm/2)+'" height="2" fill="white" stroke="black" stroke-width="0.25"/><text x="'+(scaleBarLengthMm/2)+'" y="-2" text-anchor="middle" font-size="2.5">'+scaleBarModelM.toFixed(2)+' m</text><text x="'+(scaleBarLengthMm/2)+'" y="6" text-anchor="middle" font-size="2">GRAPHIC SCALE</text></g>';
    const legendItems=drafting.layers.filter(item=>item.visible&&item.plot&&item.name!=='0').slice(0,10).map((item,i)=>'<line x1="15" y1="'+(25+i*4)+'" x2="24" y2="'+(25+i*4)+'" stroke="'+item.color+'" stroke-width="'+Math.max(0.25,item.lineWeightMm)+'"/><text x="27" y="'+(26+i*4)+'" font-size="2.4">'+safe(item.name)+'</text>').join('');
    const legend=legendItems?'<text x="15" y="22" font-size="2.8" font-weight="bold">LEGEND</text>'+legendItems:'';
    const hydraulicLegend=hydraulicOverlay?'<g><text x="'+(widthMm-88)+'" y="18" font-size="2.6" font-weight="bold">HYDRAULIC '+safe(hydraulicOverlay.metric.toUpperCase())+' · t='+hydraulicOverlay.timeSeconds+' s</text><line x1="'+(widthMm-88)+'" y1="23" x2="'+(widthMm-82)+'" y2="23" stroke="#15936d" stroke-width="1"/><text x="'+(widthMm-80)+'" y="24" font-size="2.2">Within limits</text><line x1="'+(widthMm-88)+'" y1="28" x2="'+(widthMm-82)+'" y2="28" stroke="#8a8f98" stroke-width="1"/><text x="'+(widthMm-80)+'" y="29" font-size="2.2">No result</text><line x1="'+(widthMm-88)+'" y1="33" x2="'+(widthMm-82)+'" y2="33" stroke="#d43b35" stroke-width="1"/><text x="'+(widthMm-80)+'" y="34" font-size="2.2">Outside limits</text></g>':'';
    const viewportClip = viewport ? '<defs><clipPath id="ra-model-viewport"><rect x="'+viewport.xMm+'" y="'+viewport.yMm+'" width="'+viewport.widthMm+'" height="'+viewport.heightMm+'"/></clipPath></defs>' : '';
    const viewportFrame = viewport ? '<rect x="'+viewport.xMm+'" y="'+viewport.yMm+'" width="'+viewport.widthMm+'" height="'+viewport.heightMm+'" fill="none" stroke="#333333" stroke-width="0.25"/>' : '';
    const drawingGroup = viewport ? '<g clip-path="url(#ra-model-viewport)">'+drawing+water+annotations+'</g>' : '<g>'+drawing+water+annotations+'</g>';
    const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+widthMm+'mm" height="'+heightMm+'mm" viewBox="0 0 '+widthMm+' '+heightMm+'"><rect width="100%" height="100%" fill="white"/>'+border+titleBlock+viewportClip+drawingGroup+viewportFrame+'<g>'+keyPlan+northArrow+legend+hydraulicLegend+revisionTable+notes+scaleBar+'</g></svg>';
    if (batch) return svg;
    downloadWaterFile((sheet.drawingNumber||'drawing')+'.svg',svg,'image/svg+xml');
    if (printToPdf) { const printWindow = window.open('', '_blank'); if (printWindow) { printWindow.document.open(); printWindow.document.write('<!doctype html><html><head><title>'+safe(sheet.drawingNumber)+'</title><style>@page{size:'+widthMm+'mm '+heightMm+'mm;margin:0}html,body{margin:0;padding:0}svg{display:block;width:100%;height:auto}</style></head><body>'+svg+'</body></html>'); printWindow.onload = () => printWindow.print(); printWindow.document.close(); } else setMessage('Print window was blocked. Allow pop-ups for this app, then retry Print / Save as PDF.'); }
    const mapped = viewport ? allPoints.map(mapPoint) : [];
    const fits = viewport ? mapped.every(point => pointInsideViewport(point, viewport)) : (maxX-minX)*factor<=usableWidth&&(maxY-minY)*factor<=usableHeight;
    if (!batch) setMessage(fits?'Drawing sheet SVG exported at '+sheet.scale+'. Review title block and plotted scale before issue.':'Sheet exported, but geometry exceeds the selected sheet at '+sheet.scale+'. Choose a larger sheet or smaller scale.');
  }

  function printAllDrawingSheets() {
    const pages = drafting.sheets.map((sheet, index) => {
      const svg = exportSheetSvg(false, sheet, true);
      const dimensions = sheetDimensionsMm(sheet);
      return { svg: typeof svg === 'string' ? svg : '', index, widthMm: dimensions.widthMm, heightMm: dimensions.heightMm };
    }).filter(page => page.svg);
    if (!pages.length) { setMessage('There are no drawing sheets to print.'); return; }
    const printWindow = window.open('', '_blank');
    if (!printWindow) { setMessage('Print window was blocked. Allow pop-ups, then retry the multi-sheet PDF export.'); return; }
    const pageStyles = pages.map(page => '@page sheet' + page.index + '{size:' + page.widthMm + 'mm ' + page.heightMm + 'mm;margin:0}.sheet-' + page.index + '{page:sheet' + page.index + ';break-after:page;page-break-after:always}').join('');
    const markup = pages.map(page => '<section class="sheet-' + page.index + '">' + page.svg + '</section>').join('');
    printWindow.document.open();
    printWindow.document.write('<!doctype html><html><head><title>RayanAqua drawing set</title><style>' + pageStyles + 'html,body{margin:0;padding:0}.sheet-' + pages.map(page => page.index).join(', .sheet-') + '{margin:0;padding:0}.sheet-' + pages.map(page => page.index).join(' svg,.sheet-') + ' svg{display:block;width:100%;height:auto}</style></head><body>' + markup + '</body></html>');
    printWindow.onload = () => printWindow.print();
    printWindow.document.close();
    setMessage('Prepared ' + pages.length + ' drawing sheets for one multi-page PDF print. Choose Save as PDF in the print dialog.');
  }
  function downloadDxf() {
    const metresPerUnit = calibratedMetresPerUnit || 1;
    const waterDrawing: DxfShape[] = waterCad.components.flatMap((component, index): DxfShape[] => {
      const toDrawingPoints = (points: {x:number;y:number}[]) => points.map(point => ({ x: point.x / metresPerUnit, y: point.y / metresPerUnit }));
      if (component.kind === 'pipe') return [{ id: 'W-' + component.id, type: 'polyline' as const, points: toDrawingPoints(component.geometry), layer: waterLayerName(component.kind) }];
      if (component.kind === 'bend') return [{ id: 'W-' + component.id, type: 'polyline' as const, points: toDrawingPoints(buildBendCentreline(component, 24)), layer: waterLayerName(component.kind) }];
      if (component.kind === 'reducer') return [{ id: 'W-' + component.id, type: 'polyline' as const, points: toDrawingPoints(buildReducerCentreline(component)), layer: waterLayerName(component.kind) }];
      if (component.kind === 'tee') return buildTeeCentreline(component).map((points, branch) => ({ id: 'W-' + component.id + '-' + branch, type: 'polyline' as const, points: toDrawingPoints(points), layer: waterLayerName(component.kind) }));
      return [{ id: 'W-' + component.id + '-' + index, type: 'circle' as const, points: toDrawingPoints(component.geometry.slice(0, 1)), radius: 0.15 / metresPerUnit, layer: waterLayerName(component.kind) }];
    });
    const dxf = exportDraftingDxf([...shapes, ...waterDrawing], drafting, metresPerUnit);
    const url = URL.createObjectURL(new Blob([dxf], { type: 'application/dxf' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'rayanaqua-drawing.dxf';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    if (view !== '3d' || !hostRef.current) return;
    const host = hostRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#edf3f1');
    const camera = new THREE.PerspectiveCamera(45, host.clientWidth / Math.max(host.clientHeight, 1), 0.1, 10000);
    camera.position.set(550, 650, 900);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(host.clientWidth, host.clientHeight);
    host.appendChild(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x68766f, 2));
    const light = new THREE.DirectionalLight(0xffffff, 2);
    light.position.set(300, 700, 500);
    scene.add(light);
    // Engineering model grid is sized after model extents are calculated.
    // Render the engineering network from project-metre XYZ geometry, not as a flat 2D extrusion.
    const horizontalScale = waterCad.horizontalUnits === 'ft' ? 0.3048 : 1;
    const networkPoints = waterCad.components.flatMap(component => component.geometry);
    const nodeElevations = new Map(waterCad.components.filter(component=>['junction','source','tank','reservoir'].includes(component.kind)).map(component=>[component.id,component.properties.hydraulicElevationM??component.geometry[0]?.z]));
    const portElevations=new Map<string,number>();
    waterCad.components.forEach(component=>{
      getWaterPorts(component).forEach((port,index)=>{
        const endpointId=index===0?component.fromNodeId:index===1?component.toNodeId:undefined;
        const endpointLevel=endpointId?nodeElevations.get(endpointId):undefined;
        const geometryPoint=component.kind==='pipe'?(index===0?component.geometry[0]:component.geometry[component.geometry.length-1]):component.geometry[port.index]??component.geometry[0];
        const level=port.point.z??port.point.invertLevelM??geometryPoint?.z??geometryPoint?.invertLevelM??endpointLevel??component.properties.hydraulicElevationM;
        if(typeof level==='number'&&Number.isFinite(level))portElevations.set(port.id,level);
      });
    });
    const elevationConnections=waterCad.connections??[];
    for(let pass=0;pass<elevationConnections.length;pass++){
      let changed=false;
      elevationConnections.forEach(connection=>{
        const a=portElevations.get(connection.aPortId),b=portElevations.get(connection.bPortId);
        if(a!==undefined&&b===undefined){portElevations.set(connection.bPortId,a);changed=true;}
        else if(b!==undefined&&a===undefined){portElevations.set(connection.aPortId,b);changed=true;}
      });
      if(!changed)break;
    }
    const cadPoints = shapes.flatMap(shape => shape.points.map(point=>({x:point.x*(calibratedMetresPerUnit??1),y:point.y*(calibratedMetresPerUnit??1)})));
    const terrainAligned = !!terrainGrid && waterCad.horizontalUnits === 'm' && waterCad.horizontalCrs === terrainGrid.crs && waterCad.verticalDatum === terrainGrid.verticalDatum;
    const terrainValues = (terrainAligned ? terrainGrid?.elevationsM : undefined)?.filter((value): value is number => typeof value === 'number' && Number.isFinite(value)) ?? [];
    const networkElevations = [
      ...networkPoints.flatMap(point=>[point.z,point.invertLevelM]),
      ...waterCad.components.map(component=>component.properties.hydraulicElevationM),
      ...[...nodeElevations.values()],
    ].filter((value):value is number=>typeof value==='number'&&Number.isFinite(value));
    const verticalBase = terrainValues.length ? terrainValues.reduce((minimum,value)=>Math.min(minimum,value),Infinity) : networkElevations.length ? Math.min(...networkElevations) : 0;
    const allX = [...networkPoints.map(point => point.x*horizontalScale), ...cadPoints.map(point=>point.x), ...(terrainAligned && terrainGrid ? [terrainGrid.originX, terrainGrid.originX + (terrainGrid.width-1)*terrainGrid.cellSizeX] : [])];
    const allY = [...networkPoints.map(point => point.y*horizontalScale), ...cadPoints.map(point=>point.y), ...(terrainAligned && terrainGrid ? [terrainGrid.originY, terrainGrid.originY + (terrainGrid.height-1)*terrainGrid.cellSizeY] : [])];
    const centreX = allX.length ? (Math.min(...allX)+Math.max(...allX))/2 : 0;
    const centreY = allY.length ? (Math.min(...allY)+Math.max(...allY))/2 : 0;
    const span = Math.max(allX.length ? Math.max(...allX)-Math.min(...allX) : 0, allY.length ? Math.max(...allY)-Math.min(...allY) : 0, 10);
    scene.add(new THREE.GridHelper(span*1.5,Math.min(100,Math.max(10,Math.round(span/5)))));
    camera.far=Math.max(10000,span*10);camera.updateProjectionMatrix();
    camera.position.set(span*0.9, span*0.8, span*1.1);
    camera.lookAt(0,0,0);
    shapes.forEach(shape => {
      const material = new THREE.MeshStandardMaterial({ color: '#167b78' });
      if (shape.type === 'circle') {
        const radius = Math.max(shape.radius || 4, 2);
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius*(calibratedMetresPerUnit??1), radius*(calibratedMetresPerUnit??1), 0.1, 24), material);
        mesh.position.set(shape.points[0].x*(calibratedMetresPerUnit??1)-centreX, 0, shape.points[0].y*(calibratedMetresPerUnit??1)-centreY);
        scene.add(mesh);
      } else if (shape.type === 'rect') {
        const a = shape.points[0];
        const b = shape.points[1];
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(Math.max(0.1, Math.abs(b.x - a.x)*(calibratedMetresPerUnit??1)), 0.1, Math.max(0.1, Math.abs(b.y - a.y)*(calibratedMetresPerUnit??1))),
          material
        );
        mesh.position.set((a.x + b.x) / 2*(calibratedMetresPerUnit??1)-centreX, 0, (a.y + b.y) / 2*(calibratedMetresPerUnit??1)-centreY);
        scene.add(mesh);
      } else if (shape.points.length > 1) {
        const route=(shape.type==='polyline'?expandedPolylinePoints(shape):shape.points).map(point => new THREE.Vector3(point.x*(calibratedMetresPerUnit??1)-centreX, 0, point.y*(calibratedMetresPerUnit??1)-centreY));
        for(let index=1;index<route.length;index++){
          const segment=new THREE.LineCurve3(route[index-1],route[index]);
          scene.add(new THREE.Mesh(new THREE.TubeGeometry(segment,1,Math.max(0.02,1.8*(calibratedMetresPerUnit??1)),8,false),material));
        }
      }
    });

    if (terrainAligned && terrainGrid) {
      const stride=Math.max(1,Math.ceil(Math.max(terrainGrid.width,terrainGrid.height)/200));
      const cols=Array.from({length:Math.ceil((terrainGrid.width-1)/stride)+1},(_,index)=>Math.min(index*stride,terrainGrid.width-1));
      const rows=Array.from({length:Math.ceil((terrainGrid.height-1)/stride)+1},(_,index)=>Math.min(index*stride,terrainGrid.height-1));
      const positions:number[]=[]; const indices:number[]=[]; const sampled:number[]=[];
      rows.forEach(row=>cols.forEach(col=>{
        const elevation=terrainGrid.elevationsM[row*terrainGrid.width+col];sampled.push(elevation===null?NaN:elevation);
        positions.push(terrainGrid.originX+col*terrainGrid.cellSizeX-centreX,elevation===null?0:elevation-verticalBase,terrainGrid.originY+row*terrainGrid.cellSizeY-centreY);
      }));
      for(let row=0;row<rows.length-1;row++) for(let col=0;col<cols.length-1;col++){
        const a=row*cols.length+col,b=a+1,c=a+cols.length,d=c+1;
        if([sampled[a],sampled[b],sampled[c]].every(Number.isFinite))indices.push(a,c,b);
        if([sampled[b],sampled[c],sampled[d]].every(Number.isFinite))indices.push(b,c,d);
      }
      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
      geometry.setIndex(indices);geometry.computeVertexNormals();
      const material=new THREE.MeshStandardMaterial({color:'#b8c6a5',side:THREE.DoubleSide,transparent:true,opacity:0.55,wireframe:false});
      scene.add(new THREE.Mesh(geometry,material));
    }
    const addPipeTube=(route:THREE.Vector3[],radius:number,colour:string)=>{
      if(route.length<2)return;
      for(let index=1;index<route.length;index++){
        const segment=new THREE.LineCurve3(route[index-1],route[index]);
        const mesh=new THREE.Mesh(new THREE.TubeGeometry(segment,1,radius,12,false),new THREE.MeshStandardMaterial({color:colour}));
        scene.add(mesh);
      }
    };
    waterCad.components.forEach(component=>{
      const fromElevation=component.fromNodeId?nodeElevations.get(component.fromNodeId):undefined;
      const toElevation=component.toNodeId?nodeElevations.get(component.toNodeId):undefined;
      const connectedLevels=getWaterPorts(component).map(port=>portElevations.get(port.id)).filter((level):level is number=>typeof level==='number'&&Number.isFinite(level));
      const connectedMean=connectedLevels.length?connectedLevels.reduce((sum,level)=>sum+level,0)/connectedLevels.length:undefined;
      const baseLevel=component.properties.hydraulicElevationM??fromElevation??toElevation??connectedMean??component.geometry[0]?.z??component.geometry[0]?.invertLevelM??0;
      const routeLengths=[0];
      for(let index=1;index<component.geometry.length;index++){const a=component.geometry[index-1],b=component.geometry[index];routeLengths.push(routeLengths[index-1]+Math.hypot(b.x-a.x,b.y-a.y));}
      const totalRouteLength=routeLengths[routeLengths.length-1]??0;
      const pointElevation=(point:{x:number;y:number;z?:number;invertLevelM?:number},index:number)=>{
        if(typeof point.z==='number'&&Number.isFinite(point.z))return point.z;
        if(typeof point.invertLevelM==='number'&&Number.isFinite(point.invertLevelM))return point.invertLevelM;
        if(component.kind==='pipe'&&terrainAligned&&terrainGrid){const terrainCentreline=samplePipeCentrelineElevation(component,point,terrainGrid,terrainCoverM);if(terrainCentreline!==null)return terrainCentreline;}
        if(fromElevation!==undefined&&toElevation!==undefined&&totalRouteLength>0)return fromElevation+(toElevation-fromElevation)*(routeLengths[index]??0)/totalRouteLength;
        return baseLevel;
      };
      const to3d=(point:{x:number;y:number;z?:number;invertLevelM?:number},index=0)=>new THREE.Vector3(point.x*horizontalScale-centreX,pointElevation(point,index)-verticalBase,point.y*horizontalScale-centreY);
      const points=component.geometry.map((point,index)=>to3d(point,index));
      const overlayItem=hydraulicOverlay?.items.find(item=>item.componentId===component.id);
      const colour=overlayItem?.colour??'#087e83';
      const radius=Math.max((component.properties.externalDiameterMm??component.properties.nominalDiameterMm??100)/2000,0.025);
      if(component.kind==='pipe') {
        addPipeTube(points,radius,colour);
        if(overlayItem?.direction&&overlayItem.direction!=='stagnant'&&points.length>1){
          let from=points[0],to=points[points.length-1];if(overlayItem.direction==='reverse'){const swap=from;from=to;to=swap;}
          const direction=to.clone().sub(from);const arrow=new THREE.Mesh(new THREE.ConeGeometry(Math.max(radius*2,0.08),Math.max(radius*5,0.2),12),new THREE.MeshStandardMaterial({color:colour}));
          arrow.position.copy(from).add(to).multiplyScalar(0.5);arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize());scene.add(arrow);
        }
      } else if(component.kind==='bend') {
        const route=buildBendCentreline(component,24).map(point=>to3d({...point,z:point.z??baseLevel}));
        addPipeTube(route,radius,colour);
      } else if(component.kind==='tee') {
        buildTeeCentreline(component).forEach(branch=>addPipeTube(branch.map(point=>to3d({...point,z:point.z??baseLevel})),radius,colour));
      } else if(component.kind==='reducer') {
        const ports=buildReducerCentreline(component).map(point=>to3d({...point,z:point.z??baseLevel}));
        if(ports.length===2){
          const direction=ports[1].clone().sub(ports[0]);const length=direction.length();
          if(length>0){
            const outletRadius=Math.max((component.properties.outletDiameterMm??component.properties.nominalDiameterMm??100)/2000,0.025);
            const mesh=new THREE.Mesh(new THREE.CylinderGeometry(outletRadius,radius,length,16),new THREE.MeshStandardMaterial({color:colour}));
            mesh.position.copy(ports[0]).add(ports[1]).multiplyScalar(0.5);
            mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize());scene.add(mesh);
          }
        }
      } else if(component.kind==='pump'||component.kind==='valve'||component.kind==='meter') {
        const ports=getWaterPorts(component).slice(0,2).map((port,index)=>to3d({...port.point,z:(index===0?fromElevation:toElevation)??baseLevel},index));
        if(ports.length===2){
          const direction=ports[1].clone().sub(ports[0]);const length=Math.max(direction.length(),component.properties.fittingLengthM??0.5);
          const mesh=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,length,16),new THREE.MeshStandardMaterial({color:colour}));
          mesh.position.copy(ports[0]).add(ports[1]).multiplyScalar(0.5);
          mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.length()>0?direction.normalize():new THREE.Vector3(1,0,0));scene.add(mesh);
        }
      } else if(component.kind==='tank'||component.kind==='reservoir') {
        const height=Math.max(component.properties.tankMaxLevelM??component.properties.tankOperatingLevelM??3,1);
        const tankRadius=Math.max((component.properties.tankDiameterM??7)/2,0.5);
        const mesh=new THREE.Mesh(new THREE.CylinderGeometry(tankRadius,tankRadius,height,24),new THREE.MeshStandardMaterial({color:colour,transparent:true,opacity:0.8}));
        mesh.position.copy(points[0]??new THREE.Vector3()).add(new THREE.Vector3(0,height/2,0));scene.add(mesh);
      } else if(component.kind==='chamber') {
        const mesh=new THREE.Mesh(new THREE.BoxGeometry(component.properties.chamberLengthM??1.2,component.properties.chamberDepthM??1.5,component.properties.chamberWidthM??1),new THREE.MeshStandardMaterial({color:colour,wireframe:true}));
        mesh.position.copy(points[0]??new THREE.Vector3());scene.add(mesh);
      } else if(points.length) {
        const marker=new THREE.Mesh(new THREE.SphereGeometry(Math.max(radius,0.12),16,12),new THREE.MeshStandardMaterial({color:colour}));
        marker.position.copy(points[0]);scene.add(marker);
      }
    });
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    const resize = () => {
      if (!host.clientWidth || !host.clientHeight) return;
      camera.aspect = host.clientWidth / host.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(host.clientWidth, host.clientHeight);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    let frame = 0;
    const animate = () => {
      frame = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      host.replaceChildren();
      scene.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          if (Array.isArray(object.material)) object.material.forEach(material => material.dispose());
          else object.material.dispose();
        }
      });
    };
  }, [view, shapes, waterCad, terrainGrid, hydraulicOverlay, calibratedMetresPerUnit]);

  const formatLength = (drawingUnits: number) => calibratedMetresPerUnit
    ? ((drawingUnits * calibratedMetresPerUnit) * (units === 'mm' ? 1000 : 1)).toFixed(3) + ' ' + units
    : drawingUnits.toFixed(3) + ' drawing units (unscaled)';
  const selectedMetrics = selectedShape ? (() => {
    if (selectedShape.type === 'circle') return 'Radius: ' + formatLength(selectedShape.radius || 0) + ' · Diameter: ' + formatLength((selectedShape.radius || 0) * 2);
    if (selectedShape.type === 'rect') {
      const a = selectedShape.points[0], b = selectedShape.points[1];
      return 'Width: ' + formatLength(Math.abs(b.x - a.x)) + ' · Height: ' + formatLength(Math.abs(b.y - a.y));
    }
    const points = selectedShape.points;
    let total = 0;
    for (let i = 0; i < points.length-1; i++) {
      const bulge=selectedShape.bulges?.[i]||0;
      const chord=Math.hypot(points[i+1].x-points[i].x,points[i+1].y-points[i].y);
      total += Math.abs(bulge)<1e-12?chord:(chord*(1+bulge*bulge)/(4*Math.abs(bulge)))*Math.abs(4*Math.atan(bulge));
    }
    return (selectedShape.type === 'line' ? 'Length: ' : 'Total path length: ') + formatLength(total);
  })() : '';
  const waterLayerName = (kind: WaterComponentKind) => kind === 'pipe' ? 'WATER_PIPE' : kind === 'valve' ? 'WATER_VALVE' : kind === 'chamber' ? 'WATER_CHAMBER' : ['tank','reservoir','source'].includes(kind) ? 'WATER_STRUCTURE' : 'WATER_FITTING';
  const layerNames = Array.from(new Set([...drafting.layers.map(item => item.name), ...shapes.map(shape => shape.layer || '0')])).sort();
  const visibleShapes = shapes.filter(shape => !hiddenLayers.includes(shape.layer || '0') && drafting.layers.find(item => item.name === (shape.layer || '0'))?.visible !== false);
  const renderedWaterComponents = waterCad.components.filter(component => drafting.layers.find(item => item.name === waterLayerName(component.kind))?.visible !== false && !hiddenLayers.includes(waterLayerName(component.kind))).map(component => {
    const pts = component.geometry.map(point => ({ x: point.x / (calibratedMetresPerUnit || 1), y: point.y / (calibratedMetresPerUnit || 1) }));
    const p = pts[0] || {x:0,y:0};
    const selected = selectedWaterId === component.id;
    const hydraulicItem = hydraulicOverlay?.items.find(item => item.componentId === component.id);
    const stroke = selected ? '#d04d3f' : hydraulicItem?.colour || '#087e83';
    const resultText=hydraulicItem ? ' · '+hydraulicItem.label : '';
    const sw = Math.max(viewBox.width / 700, 1.2);
    const projectPoints = (points: {x:number;y:number}[]) => points.map(point => ({ x: point.x / (calibratedMetresPerUnit || 1), y: point.y / (calibratedMetresPerUnit || 1) }));
    if (component.kind === 'bend') {
      const arc = projectPoints(buildBendCentreline(component, 20));
      return <g key={component.id} data-water-id={component.id}><polyline points={arc.map(q => q.x + ',' + q.y).join(' ')} fill="none" stroke={stroke} strokeWidth={sw * 3} /><text x={p.x + 5} y={p.y - 6} fontSize={Math.max(viewBox.width / 90, 8)} fill={stroke}>{component.properties.tag}{resultText}</text></g>;
    }
    if (component.kind === 'tee') {
      const branches = buildTeeCentreline(component).map(projectPoints);
      return <g key={component.id} data-water-id={component.id} fill="none" stroke={stroke} strokeWidth={sw * 3}><polyline points={branches[0].map(q => q.x + ',' + q.y).join(' ')} /><polyline points={branches[1].map(q => q.x + ',' + q.y).join(' ')} /><circle cx={p.x} cy={p.y} r={sw * 2} fill={stroke} /><text x={p.x + 13 * sw} y={p.y} fill={stroke} stroke="none" fontSize={Math.max(viewBox.width / 90, 8)}>{component.properties.tag}{resultText}</text></g>;
    }
    if (component.kind === 'reducer') {
      const ends = projectPoints(buildReducerCentreline(component));
      const dx = ends[1].x - ends[0].x, dy = ends[1].y - ends[0].y;
      const length = Math.hypot(dx, dy) || 1, nx = -dy / length, ny = dx / length;
      const d1 = (component.properties.nominalDiameterMm ?? 110) / 1000 / (calibratedMetresPerUnit || 1);
      const d2 = (component.properties.outletDiameterMm ?? 90) / 1000 / (calibratedMetresPerUnit || 1);
      const polygon = [[ends[0].x + nx*d1/2, ends[0].y + ny*d1/2], [ends[1].x + nx*d2/2, ends[1].y + ny*d2/2], [ends[1].x - nx*d2/2, ends[1].y - ny*d2/2], [ends[0].x - nx*d1/2, ends[0].y - ny*d1/2]].map(q => q.join(',')).join(' ');
      return <g key={component.id} data-water-id={component.id}><polygon points={polygon} fill="#e4f4f2" stroke={stroke} strokeWidth={sw * 2} /><text x={p.x + 5} y={p.y - 8} fontSize={Math.max(viewBox.width / 90, 8)} fill={stroke}>{component.properties.tag}{resultText}</text></g>;
    }
    if (component.kind === 'pipe' && pts.length > 1) {
      let flowArrow:string|null=null;
      if(hydraulicItem?.direction&&hydraulicItem.direction!=='stagnant'){
        const index=Math.max(0,Math.floor((pts.length-1)/2));
        let a=pts[index],b=pts[Math.min(index+1,pts.length-1)];
        if(hydraulicItem.direction==='reverse'){const swap=a;a=b;b=swap;}
        const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy)||1,ux=dx/length,uy=dy/length,nx=-uy,ny=ux,size=Math.max(viewBox.width/180,6),mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2},tip={x:mid.x+ux*size,y:mid.y+uy*size},base={x:mid.x-ux*size*0.65,y:mid.y-uy*size*0.65};
        flowArrow=[tip.x+','+tip.y,(base.x+nx*size*0.55)+','+(base.y+ny*size*0.55),(base.x-nx*size*0.55)+','+(base.y-ny*size*0.55)].join(' ');
      }
      return <g key={component.id} data-water-id={component.id}><polyline points={pts.map(q=>q.x+','+q.y).join(' ')} fill="none" stroke={stroke} strokeWidth={sw*3} />{flowArrow&&<polygon points={flowArrow} fill={stroke}/>}<text x={p.x+5} y={p.y-6} fontSize={Math.max(viewBox.width/90,8)} fill={stroke}>{component.properties.tag}{hydraulicItem ? ' · ' + hydraulicItem.label : ''}</text></g>;
    }
    if (component.kind === 'tank' || component.kind === 'reservoir') return <g key={component.id} data-water-id={component.id}><circle cx={p.x} cy={p.y} r={12*sw} fill="#e4f4f2" stroke={stroke} strokeWidth={sw*2}/><text x={p.x+14*sw} y={p.y} fontSize={Math.max(viewBox.width/90,8)} fill={stroke}>{component.properties.tag}{resultText}</text></g>;
    if (component.kind === 'pump') return <g key={component.id} data-water-id={component.id}><path d={`M ${p.x-10*sw} ${p.y-9*sw} L ${p.x+10*sw} ${p.y} L ${p.x-10*sw} ${p.y+9*sw} Z`} fill="#e4f4f2" stroke={stroke} strokeWidth={sw*2}/><text x={p.x+14*sw} y={p.y} fontSize={Math.max(viewBox.width/90,8)} fill={stroke}>{component.properties.tag}{resultText}</text></g>;
    const symbol = component.kind === 'valve' ? <path d={`M ${p.x-9*sw} ${p.y-8*sw} L ${p.x} ${p.y} L ${p.x-9*sw} ${p.y+8*sw} M ${p.x+9*sw} ${p.y-8*sw} L ${p.x} ${p.y} L ${p.x+9*sw} ${p.y+8*sw}`} /> : <rect x={p.x-8*sw} y={p.y-8*sw} width={16*sw} height={16*sw} />;
    return <g key={component.id} data-water-id={component.id} fill="none" stroke={stroke} strokeWidth={sw*2}>{symbol}<text x={p.x+13*sw} y={p.y} fontSize={Math.max(viewBox.width/90,8)} fill={stroke} stroke="none">{component.properties.tag}{resultText}</text></g>;
  });

  const renderedAnnotations = drafting.annotations.filter(item => drafting.layers.find(l => l.name === item.layer)?.visible !== false).map(item => {
    const layerStyle = drafting.layers.find(l => l.name === item.layer);
    const color = layerStyle?.color || '#202020';
    const scale = Number(drafting.sheet.scale.split(':')[1]) || 100;
    const paperHeight = (mm: number) => mm * scale / 1000 / (calibratedMetresPerUnit || 1);
    const toDrawing = (p: Point2D) => ({ x: p.x / (calibratedMetresPerUnit || 1), y: p.y / (calibratedMetresPerUnit || 1) });
    if (item.kind === 'text') { const at = toDrawing(item.at); return <text key={item.id} x={at.x} y={at.y} fontSize={paperHeight(item.heightMm)} fill={color}>{item.text}</text>; }
    if (item.kind === 'leader') { const pts = item.points.map(toDrawing); const last = pts[pts.length - 1]; return <g key={item.id}><polyline points={pts.map(p => p.x + ',' + p.y).join(' ')} fill='none' stroke={color}/><text x={last.x + paperHeight(1.5)} y={last.y - paperHeight(1)} fontSize={paperHeight(item.textHeightMm)} fill={color}>{item.text}</text></g>; }
    if (item.kind === 'radial') {
      const resolved = resolveAssociativeRadialDimension(item, shapes, calibratedMetresPerUnit || 1), center = toDrawing(resolved.center), radius = resolved.radiusM / (calibratedMetresPerUnit || 1);
      const direction = { x: Math.cos(item.leaderAngleRad), y: Math.sin(item.leaderAngleRad) }, edge = { x: center.x + direction.x * radius, y: center.y + direction.y * radius }, opposite = { x: center.x - direction.x * radius, y: center.y - direction.y * radius };
      const label = (item.dimensionType === 'radius' ? 'R ' : 'Ø ') + formatStyledDimension(item.dimensionType === 'radius' ? resolved.radiusM : resolved.radiusM * 2, dimensionStyle);
      return <g key={item.id} fill='none' stroke={color}>{item.dimensionType === 'diameter' ? <line x1={opposite.x} y1={opposite.y} x2={edge.x} y2={edge.y}/> : <line x1={center.x} y1={center.y} x2={edge.x} y2={edge.y}/>}<line x1={center.x-paperHeight(1.5)} y1={center.y} x2={center.x+paperHeight(1.5)} y2={center.y}/><line x1={center.x} y1={center.y-paperHeight(1.5)} x2={center.x} y2={center.y+paperHeight(1.5)}/><text x={edge.x+paperHeight(2)} y={edge.y-paperHeight(1)} fontSize={paperHeight(dimensionStyle.textHeightMm)} fill={color} stroke='none'>{label}</text></g>;
    }
    if (item.kind === 'angular') {
      const resolved = resolveAssociativeAngularDimension(item, shapes, calibratedMetresPerUnit || 1), g = calculateAngularDimension(resolved.vertex, resolved.rayA, resolved.rayB, item.offsetM);
      const pts = Array.from({length:25},(_,i)=>{const a=g.arc.startAngleRad+(g.arc.endAngleRad-g.arc.startAngleRad)*i/24;return toDrawing({x:g.arc.center.x+Math.cos(a)*g.arc.radius,y:g.arc.center.y+Math.sin(a)*g.arc.radius});});
      const at = toDrawing(g.labelPoint), label = (measureAngularDimension(resolved)*180/Math.PI).toFixed(item.precision)+'°';
      return <g key={item.id} fill='none' stroke={color}><polyline points={pts.map(p=>p.x+','+p.y).join(' ')}/><line x1={resolved.vertex.x/(calibratedMetresPerUnit||1)} y1={resolved.vertex.y/(calibratedMetresPerUnit||1)} x2={resolved.rayA.x/(calibratedMetresPerUnit||1)} y2={resolved.rayA.y/(calibratedMetresPerUnit||1)}/><line x1={resolved.vertex.x/(calibratedMetresPerUnit||1)} y1={resolved.vertex.y/(calibratedMetresPerUnit||1)} x2={resolved.rayB.x/(calibratedMetresPerUnit||1)} y2={resolved.rayB.y/(calibratedMetresPerUnit||1)}/><text x={at.x} y={at.y} fontSize={paperHeight(dimensionStyle.textHeightMm)} fill={color} stroke='none'>{label}</text></g>;
    }
    const resolved = resolveAssociativeDimension(item, shapes, calibratedMetresPerUnit || 1);
    const a = toDrawing(resolved.a), b = toDrawing(resolved.b);
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length, ny = dx / length, off = item.offsetM / (calibratedMetresPerUnit || 1);
    const p1 = { x: a.x + nx * off, y: a.y + ny * off }, p2 = { x: b.x + nx * off, y: b.y + ny * off };
    const label = item.association ? formatStyledDimension(measureDimension(resolved), dimensionStyle) : item.textOverride || formatDimension(measureDimension(resolved), item.precision, drafting.sheet.units);
    const h = paperHeight(dimensionStyle.textHeightMm), mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    return <g key={item.id} fill='none' stroke={color} strokeWidth={Math.max(viewBox.width / 1800, 0.45)}><line x1={a.x} y1={a.y} x2={p1.x} y2={p1.y}/><line x1={b.x} y1={b.y} x2={p2.x} y2={p2.y}/><line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}/><text x={mid.x} y={mid.y - h * 0.2} textAnchor='middle' fontSize={h} fill={color} stroke='none'>{label}</text></g>;
  });
  const renderedShapes = visibleShapes.map(shape => {
    const layerStyle = drafting.layers.find(item => item.name === (shape.layer || '0'));
    const color = layerStyle?.color || '#ffffff';
    const lineWeight = Math.max(0.7, (layerStyle?.lineWeightMm || 0.25) * 5);
    const dashArray = layerStyle?.lineType === 'DASHED' || layerStyle?.lineType === 'HIDDEN' ? '8 5' : layerStyle?.lineType === 'CENTER' ? '12 4 2 4' : layerStyle?.lineType === 'PHANTOM' ? '12 4 2 4 2 4' : undefined;
    if (shape.type === 'circle') {
      return <circle data-shape-id={shape.id} key={shape.id} cx={shape.points[0].x} cy={shape.points[0].y} r={shape.radius || 12} fill="none" stroke={selectedShapeIds.includes(shape.id) ? '#d04d3f' : color} strokeWidth={selectedShapeIds.includes(shape.id) ? 4 : lineWeight} strokeDasharray={dashArray} />;
    }
    if (shape.type === 'rect') {
      const a = shape.points[0];
      const b = shape.points[1];
      return <rect data-shape-id={shape.id} key={shape.id} x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} fill="none" stroke={selectedShapeIds.includes(shape.id) ? '#d04d3f' : color} strokeWidth={selectedShapeIds.includes(shape.id) ? 4 : lineWeight} strokeDasharray={dashArray} />;
    }
    if (shape.type === 'line') {
      return <line data-shape-id={shape.id} key={shape.id} x1={shape.points[0].x} y1={shape.points[0].y} x2={shape.points[1].x} y2={shape.points[1].y} stroke={selectedShapeIds.includes(shape.id) ? '#d04d3f' : color} strokeWidth={selectedShapeIds.includes(shape.id) ? 5 : lineWeight} strokeDasharray={dashArray} />;
    }
    return <path data-shape-id={shape.id} key={shape.id} d={polylineSvgPath(shape)} fill="none" stroke={selectedShapeIds.includes(shape.id) ? '#d04d3f' : color} strokeWidth={selectedShapeIds.includes(shape.id) ? 5 : lineWeight} strokeDasharray={dashArray} />;
  });

  return (
    <div className={`aquacad-shell ${isFullscreen ? 'aquacad-fullscreen' : ''}`}>
      <div className="aquacad-titlebar">
        <div className="aquacad-titlelockup"><span className="aquacad-mark">A</span><div><strong>AquaCAD</strong><small>RayanAqua · Project drawing environment</small></div></div>
        <div className="aquacad-quick-access" aria-label="Quick access toolbar">
          <button title="Open / import drawing" onClick={()=>fileRef.current?.click()}>Open</button>
          <button title="Save drawing" onClick={saveDrawing} disabled={busy}>Save</button>
          <button title="Undo (Ctrl+Z)" aria-label="Undo" onClick={()=>setHistory(current=>undoHistory(current))} disabled={!history.past.length}>↶</button>
          <button title="Redo (Ctrl+Y)" aria-label="Redo" onClick={()=>setHistory(current=>redoHistory(current))} disabled={!history.future.length}>↷</button>
          <button title={panMode ? "Exit Pan mode" : "Pan drawing (select, then drag)"} aria-label="Pan drawing" aria-pressed={panMode} className={panMode ? "selected" : ""} onClick={()=>setPanMode(value=>!value)}>✋ Pan</button>
          <button title="Zoom Extents" aria-label="Zoom Extents" onClick={()=>setViewBox({x:0,y:0,width:WIDTH,height:HEIGHT})}>Zoom Extents</button>
          <button title="Plot / PDF" onClick={()=>exportSheetSvg(true)}>Plot</button>
        </div>
        <div className="aquacad-title-actions">
          <span className="aquacad-project-label">PROJECT DRAWING</span>
          <button className="aquacad-window-button" onClick={toggleCadFullscreen} title={isFullscreen ? 'Exit full screen' : 'Maximize CAD workspace'} aria-label={isFullscreen ? 'Restore CAD workspace' : 'Maximize CAD workspace'}>
            {isFullscreen ? <Minimize2 size={16}/> : <Maximize2 size={16}/>}<span>{isFullscreen ? 'Restore' : 'Maximize'}</span>
          </button>
        </div>
      </div>

      <div className="aquacad-ribbon">
        <div className="aquacad-ribbon-tabs" role="tablist" aria-label="AquaCAD ribbon">
          {(['Home','Modify','Insert','Annotate','Drafting','Water Network','3D Modeling','Analyze','View','Output','Manage'] as const).map(tab => <button key={tab} role="tab" aria-selected={ribbonTab===tab} className={ribbonTab===tab?'active':''} onClick={()=>setRibbonTab(tab)}>{tab}</button>)}
        </div>
        <div className="aquacad-ribbon-content">
          <input ref={fileRef} type="file" accept=".dxf,.json" hidden onChange={event => importFile(event.target.files?.[0])} />
          <input ref={terrainFileRef} type="file" accept=".json,application/json" hidden onChange={event => importTerrainGridFile(event.target.files?.[0])} />
          <input ref={epanetFileRef} type="file" accept=".inp,.txt,text/plain" hidden onChange={event => importEpanetFile(event.target.files?.[0],epanetImportMode)} />
          <input ref={hydraulicResultsFileRef} type="file" accept=".json,application/json" hidden onChange={event => importHydraulicResultsFile(event.target.files?.[0])} />
          <div className="aquacad-ribbon-groups">
            {ribbonTab==='Home' && <>
              <div className="aquacad-ribbon-group"><strong>Draw</strong><div className="aquacad-tool-grid">
                {([['↖','Select','select'],['╱','Line','line'],['⌁','Polyline','polyline'],['▭','Rectangle','rect'],['○','Circle','circle'],['⬭','Ellipse','ellipse'],['⌒','Arc','arc']] as const).map(([icon,label,tool])=><button key={tool} title={label} className={mode===tool?'selected':''} onClick={()=>{setMode(tool);setDraft([]);setMessage(label+' tool active. '+(tool==='circle'?'Choose a construction method below.':tool==='ellipse'?'Pick opposite bounding corners.':tool==='arc'?'Choose an arc construction method below.':'Specify points in the drawing.'));}}><i>{icon}</i><span>{label}</span></button>)}
                <label>Layer <select aria-label="Current drawing layer" value={layer} onChange={e=>setLayer(e.target.value)}>{drafting.layers.map(item=><option key={item.name} value={item.name}>{item.name}</option>)}</select></label>
                <button title="Create or edit drawing layers" onClick={()=>setRibbonTab('Drafting')}><i>＋</i><span>Manage Layers</span></button>
                {mode==='ellipse'&&<label>Ellipse method <select value={ellipseMethod} onChange={e=>{setEllipseMethod(e.target.value as typeof ellipseMethod);setDraft([]);}}><option value="corner-corner">Opposite corners</option><option value="axis-endpoints">Major axis + minor radius (3-point)</option></select></label>}
                {mode==='circle'&&<label>Circle method <select value={circleMethod} onChange={e=>{setCircleMethod(e.target.value as typeof circleMethod);setDraft([]);}}><option value="center-radius">Centre + radius</option><option value="center-diameter">Centre + diameter</option><option value="two-point">2-point diameter</option><option value="three-point">3-point</option></select></label>}
                {mode==='polyline'&&draft.length>1&&<><button onClick={()=>finishPolyline(false)}><i>✓</i><span>Finish Polyline</span></button>{draft.length>2&&<button onClick={()=>finishPolyline(true)}><i>□</i><span>Close Polyline</span></button>}</>}
                {mode==='arc'&&<><label>Arc method <select value={arcMethod} onChange={e=>{setArcMethod(e.target.value as typeof arcMethod);setDraft([]);}}><option value="three-point">3-point arc</option><option value="center-start-angle">Centre + start + angle</option></select></label>{arcMethod==='center-start-angle'&&<label>Sweep ° <input type="number" min="-359.999" max="359.999" step="any" value={arcSweepDegrees} onChange={e=>setArcSweepDegrees(Number(e.target.value))} style={{width:72}}/></label>}</>}
              </div></div>
              <div className="aquacad-ribbon-group"><strong>Modify</strong><div className="aquacad-tool-grid">
                <button title="Undo" onClick={()=>setHistory(current=>undoHistory(current))} disabled={!history.past.length}><i>↶</i><span>Undo</span></button>
                <button title="Redo" onClick={()=>setHistory(current=>redoHistory(current))} disabled={!history.future.length}><i>↷</i><span>Redo</span></button>
                <button title="Delete all selected entities" onClick={deleteSelectedShape} disabled={!selectedShapeIds.length}><i>⌫</i><span>Erase</span></button>
                <button title="Clear selection" onClick={()=>setSelectedShapeIds([])}><i>⊡</i><span>Deselect</span></button>
              </div></div>
              <div className="aquacad-ribbon-group"><strong>Precision</strong><div className="aquacad-tool-grid">
                <button className={snapEnabled?'selected':''} onClick={()=>setSnapEnabled(v=>!v)}><i>✣</i><span>Object Snap</span></button>
                <button className={orthoEnabled?'selected':''} onClick={()=>setOrthoEnabled(v=>!v)}><i>⊥</i><span>Ortho</span></button>
                <button className={gridSnapEnabled?'selected':''} onClick={()=>setGridSnapEnabled(v=>!v)}><i>▦</i><span>Grid Snap</span></button>
                <button className={polarEnabled?'selected':''} onClick={()=>setPolarEnabled(v=>!v)}><i>∠</i><span>Polar</span></button>
              </div></div>
              <div className="aquacad-ribbon-group"><strong>Clipboard & Files</strong><div className="aquacad-tool-grid">
                <button onClick={saveDrawing} disabled={busy}><i>▣</i><span>Save</span></button>
                <button onClick={()=>fileRef.current?.click()}><i>⇩</i><span>Open / Import</span></button>
                <button onClick={downloadDxf}><i>DXF</i><span>Export DXF</span></button>
              </div></div>
            </>}
            {ribbonTab==='Modify' && <>
              <div className="aquacad-ribbon-group"><strong>Transform</strong>
                <div className="aquacad-tool-grid">
                  <label>Distance <input type="number" step="any" value={commandDistance} onChange={e=>setCommandDistance(Number(e.target.value))} style={{width:76}}/></label>
                  <label>Angle ° <input type="number" step="any" value={commandAngle} onChange={e=>setCommandAngle(Number(e.target.value))} style={{width:68}}/></label>
                  <label>Scale × <input type="number" min="0.001" step="any" value={scaleFactor} onChange={e=>setScaleFactor(Number(e.target.value))} style={{width:68}}/></label>
                  <label>ΔX <input type="number" step="any" value={moveDeltaX} onChange={e=>setMoveDeltaX(Number(e.target.value))} style={{width:58}}/></label>
                  <label>ΔY <input type="number" step="any" value={moveDeltaY} onChange={e=>setMoveDeltaY(Number(e.target.value))} style={{width:58}}/></label>
                  <label>Array spacing <input type="number" min="0.001" step="any" value={arraySpacing} onChange={e=>setArraySpacing(Math.max(0.001,Number(e.target.value)||0.001))} style={{width:66}}/></label>
                  <button disabled={!selectedShapes.length} onClick={()=>{try{const pivot=selectedShapes[0].points[0];previewDrawing(shapes.map(x=>selectedShapeIds.includes(x.id)?moveEntities([x],{x:moveDeltaX,y:moveDeltaY})[0]:x),'MOVE');}catch(e){setMessage(e instanceof Error?e.message:'Move failed.')}}}><i>↔</i><span>Move</span></button>
                  <button disabled={!selectedShapes.length} onClick={()=>{try{previewDrawing([...shapes,...copyEntities(selectedShapes,{x:moveDeltaX,y:moveDeltaY})],'COPY');}catch(e){setMessage(e instanceof Error?e.message:'Copy failed.')}}}><i>▣</i><span>Copy</span></button>
                  <button disabled={!selectedShapes.length} onClick={()=>{try{const pivot=selectedShapes[0].points[0];previewDrawing(shapes.map(x=>selectedShapeIds.includes(x.id)?rotateEntities([x],pivot,commandAngle)[0]:x),'ROTATE');}catch(e){setMessage(e instanceof Error?e.message:'Rotate failed.')}}}><i>⟳</i><span>Rotate</span></button>
                  <button disabled={!selectedShapes.length} onClick={()=>{try{const a=selectedShapes[0].points[0],b={x:a.x,y:a.y+1};previewDrawing(shapes.map(x=>selectedShapeIds.includes(x.id)?mirrorEntities([x],a,b)[0]:x),'MIRROR');}catch(e){setMessage(e instanceof Error?e.message:'Mirror failed.')}}}><i>⇋</i><span>Mirror</span></button>
                  <button disabled={!selectedShapes.length||!Number.isFinite(scaleFactor)||scaleFactor<=0} onClick={()=>{try{const base=selectedShapes[0].points[0];const scaled=scaleEntities(selectedShapes,base,scaleFactor);const byId=new Map(scaled.map(item=>[item.id,item]));previewDrawing(shapes.map(x=>byId.get(x.id)||x),'SCALE');}catch(e){setMessage(e instanceof Error?e.message:'Scale failed.')}}}><i>⤢</i><span>Scale</span></button>
                  <button disabled={!selectedShapes.length} onClick={()=>{try{previewDrawing([...shapes,...rectangularArray(selectedShapes,arrayRows,arrayColumns,arraySpacing,arraySpacing)],'ARRAY');}catch(e){setMessage(e instanceof Error?e.message:'Array failed.')}}}><i>▦</i><span>Rectangular Array</span></button>
                  <label>Rows <input type="number" min="1" value={arrayRows} onChange={e=>setArrayRows(Math.max(1,Number(e.target.value)||1))} style={{width:48}}/></label>
                  <label>Columns <input type="number" min="1" value={arrayColumns} onChange={e=>setArrayColumns(Math.max(1,Number(e.target.value)||1))} style={{width:48}}/></label>
                </div>
              </div>
              <div className="aquacad-ribbon-group"><strong>Geometry Editing</strong>
                <div className="aquacad-tool-grid">
                  <label>Segment # <input type="number" min="0" value={segmentIndex} onChange={e=>setSegmentIndex(Math.max(0,Math.floor(Number(e.target.value)||0)))} style={{width:54}}/></label>
                  <label>Endpoint <select value={commandEndpoint} onChange={e=>setCommandEndpoint(Number(e.target.value) as 0|1)}><option value={0}>Start</option><option value={1}>End</option></select></label>
                  <label>Corner # <input type="number" min="1" value={cornerIndex} onChange={e=>setCornerIndex(Math.max(1,Number(e.target.value)||1))} style={{width:48}}/></label>
                  <button title="Select the straight cutting edge first, then Shift-select the target entity last. Set its endpoint or polyline segment above, then preview Trim." disabled={selectedShapes.length!==2||!selectedShapes.some(x=>x.id===selectedShapeId&&['line','polyline'].includes(x.type))||!selectedShapes.some(x=>x.id!==selectedShapeId&&x.type==='line')} onClick={()=>{try{const target=selectedShapes.find(item=>item.id===selectedShapeId)!;const cutter=selectedShapes.find(item=>item.id!==selectedShapeId)!;const pick=target.type==='polyline'?target.points[Math.min(segmentIndex+(commandEndpoint===0?0:1),target.points.length-1)]:target.points[commandEndpoint];previewDrawing(shapes.map(x=>x.id===selectedShapeId?(x.type==='line'?trimLine(x,cutter,pick):trimPolylineSegment(x,cutter,pick,segmentIndex)):x),'TRIM');}catch(e){setMessage(e instanceof Error?e.message:'Trim failed.')}}}><i>✂</i><span>Trim</span></button>
                  <button disabled={selectedShapes.length!==2||!selectedShapes.some(x=>x.id===selectedShapeId&&['line','polyline'].includes(x.type))||!selectedShapes.some(x=>x.id!==selectedShapeId&&x.type==='line')} onClick={()=>{try{const target=selectedShapes.find(item=>item.id===selectedShapeId)!;const boundary=selectedShapes.find(item=>item.id!==selectedShapeId)!;previewDrawing(shapes.map(x=>x.id===selectedShapeId?(x.type==='line'?extendLine(x,boundary,commandEndpoint):extendPolylineSegment(x,boundary,commandEndpoint,segmentIndex)):x),'EXTEND');}catch(e){setMessage(e instanceof Error?e.message:'Extend failed.')}}}><i>↗</i><span>Extend</span></button>
                  <button disabled={selectedShapes.length!==1||selectedShapes[0].type!=='polyline'} onClick={()=>{try{previewDrawing(shapes.map(x=>x.id===selectedShapes[0].id?chamferPolylineCorner(x,cornerIndex,commandDistance):x),'CHAMFER');}catch(e){setMessage(e instanceof Error?e.message:'Chamfer failed.')}}}><i>⌜</i><span>Chamfer</span></button>
                  <button disabled={selectedShapes.length!==1||selectedShapes[0].type!=='polyline'} onClick={()=>{try{previewDrawing(shapes.map(x=>x.id===selectedShapes[0].id?filletPolylineCorner(x,cornerIndex,commandDistance):x),'FILLET');}catch(e){setMessage(e instanceof Error?e.message:'Fillet failed.')}}}><i>⌒</i><span>Fillet</span></button>
                  <button disabled={selectedShapes.length!==1||!['line','polyline'].includes(selectedShapes[0].type)} onClick={()=>{try{const entity=selectedShapes[0];previewDrawing([...shapes,entity.type==='line'?offsetLine(entity,commandDistance,offsetSide):offsetPolyline(entity,commandDistance,offsetSide)],'OFFSET');}catch(e){setMessage(e instanceof Error?e.message:'Offset failed.')}}}><i>⇉</i><span>Offset</span></button>
                  <button onClick={()=>setOffsetSide(value=>value===1?-1:1)}><i>⇄</i><span>Offset: {offsetSide===1?'Left':'Right'}</span></button>
                  <button disabled={!selectedShapes.length||!lastSelectionWindow} onClick={()=>{try{previewDrawing(shapes.map(x=>selectedShapeIds.includes(x.id)?stretchEntities([x],lastSelectionWindow!,{x:commandDistance,y:0})[0]:x),'STRETCH');}catch(e){setMessage(e instanceof Error?e.message:'Stretch failed.')}}}><i>↔</i><span>Stretch</span></button>
                </div>
              </div>
              <div className="aquacad-ribbon-group"><strong>Grip & Preview</strong>
                <div className="aquacad-tool-grid">
                  <label>Grip index <input type="number" min="0" step="1" value={gripIndex} onChange={e=>setGripIndex(Math.max(0,Math.floor(Number(e.target.value)||0)))} style={{width:52}}/></label>
                  <button disabled={selectedShapes.length!==1||!cursorPoint||!Number.isFinite(cursorPoint.x)||!Number.isFinite(cursorPoint.y)} onClick={()=>{try{const target=selectedShapes[0];previewDrawing(shapes.map(x=>x.id===target.id?editEntityGrip(x,gripIndex,cursorPoint!):x),'GRIP EDIT');}catch(e){setMessage(e instanceof Error?e.message:'Grip edit failed.')}}}><i>✥</i><span>Move Grip</span></button>
                  <button className="primary" disabled={!previewShapes} onClick={commitPreview}><i>✓</i><span>Apply Preview</span></button>
                  <button disabled={!previewShapes} onClick={()=>{setPreviewShapes(null);setMessage('Preview cancelled.')}}><i>×</i><span>Cancel Preview</span></button>
                  <button disabled={!selectedShapeIds.length} onClick={deleteSelectedShape}><i>⌫</i><span>Erase Selection</span></button>
                </div>
              </div>
            </>}
            {ribbonTab==='Insert' && <>
              <div className="aquacad-ribbon-group"><strong>Blocks & References</strong><div className="aquacad-tool-grid">
                <button onClick={()=>{setLibraryPlacementActive(true);setMessage('Choose a parametric library object below, then click the drawing to place it.')}}><i>▣</i><span>Insert Block</span></button>
                <button onClick={()=>fileRef.current?.click()}><i>⇩</i><span>Import DXF</span></button>
                <button onClick={importGisDraft}><i>⌖</i><span>GIS Draft</span></button>
                <button onClick={()=>terrainFileRef.current?.click()}><i>▤</i><span>Terrain Grid</span></button>
              </div></div>
              <div className="aquacad-ribbon-group"><strong>Drawing Sheets</strong><div className="aquacad-tool-grid">
                <button onClick={addDrawingSheet}><i>▧</i><span>New Sheet</span></button>
                <button onClick={createOrRefreshPaperLayout}><i>▤</i><span>Paper Layout</span></button>
                <button onClick={()=>exportSheetSvg(true)}><i>⎙</i><span>Print / PDF</span></button>
              </div></div>
            </>}
            {ribbonTab==='Annotate' && <>
              <div className="aquacad-ribbon-group"><strong>Dimensions</strong><div className="aquacad-tool-grid">
                {(['aligned','linear','angular','radius','diameter','ordinate'] as const).map(kind=><button key={kind} className={draftTool==='dimension'&&dimensionKind===kind?'selected':''} onClick={()=>{setDimensionKind(kind);setAnnotationDraft([]);if((kind==='radius'||kind==='diameter')&&placeRadialDimensionFromSelection(kind))return;setDraftTool('dimension');setMessage(kind==='radius'||kind==='diameter'?'Select circle centre, circle edge and leader landing point, or select a circle first for one-click dimensioning.':'Select the required points to place a '+kind+' dimension.')}}><i>↔</i><span>{kind[0].toUpperCase()+kind.slice(1)}</span></button>)}
              </div></div>
              <div className="aquacad-ribbon-group"><strong>Text & Leaders</strong><div className="aquacad-tool-grid">
                <button onClick={()=>{setDraftTool('text');setMessage('Click the drawing to place text.')}}><i>A</i><span>Text</span></button>
                <button onClick={()=>{setDraftTool('leader');setAnnotationDraft([]);setMessage('Click leader arrow point, then text landing point.')}}><i>↗</i><span>Leader</span></button>
                <button onClick={()=>setDraftTool('none')}><i>×</i><span>Cancel</span></button>
              </div></div>
            </>}
            {ribbonTab==='Water Network' && <>
              <div className="aquacad-ribbon-group"><strong>Pipes & Fittings</strong><div className="aquacad-tool-grid">
                {([['━','Pipe','pipe'],['┐','Bend','bend'],['┬','Tee','tee'],['▷','Reducer','reducer']] as const).map(([icon,label,kind])=><button key={kind} onClick={()=>addWaterComponent(kind)}><i>{icon}</i><span>{label}</span></button>)}
              </div></div>
              <div className="aquacad-ribbon-group"><strong>Valves</strong><div className="aquacad-tool-grid">
                {([['⋈','Gate Valve','valve'],['◇','PRV','valve'],['▶','Check Valve','valve']] as const).map(([icon,label,kind])=><button key={label} onClick={()=>addWaterComponent(kind)}><i>{icon}</i><span>{label}</span></button>)}
              </div></div>
              <div className="aquacad-ribbon-group"><strong>Equipment</strong><div className="aquacad-tool-grid">
                {(['pump','tank','chamber','hydrant','meter'] as WaterComponentKind[]).map(kind=><button key={kind} onClick={()=>addWaterComponent(kind)}><i>{kind==='pump'?'⚙':kind==='tank'?'▣':kind==='hydrant'?'●':'◉'}</i><span>{kind[0].toUpperCase()+kind.slice(1)}</span></button>)}
              </div></div>
              <div className="aquacad-ribbon-group"><strong>Network Nodes</strong><div className="aquacad-tool-grid">
                <button onClick={()=>addWaterComponent('meter')}><i>◉</i><span>Meter</span></button>
                <button onClick={()=>addWaterComponent('hydrant')}><i>●</i><span>Hydrant</span></button>
                <button onClick={()=>addWaterComponent('chamber')}><i>▯</i><span>Chamber</span></button>
              </div></div>
            </>}
            {ribbonTab==='3D Modeling' && <div className="aquacad-ribbon-group"><strong>3D workspace</strong><div className="aquacad-tool-grid">
              <button className={view==='3d'?'selected':''} onClick={()=>setView('3d')}><i>▣</i><span>3D Model</span></button>
              <button className={view==='2d'?'selected':''} onClick={()=>setView('2d')}><i>▱</i><span>2D Wireframe</span></button>
              <button className={view==='3d'?'selected':''} onClick={()=>setView('3d')}><i>⤢</i><span>Open 3D View</span></button>
            </div></div>}
            {ribbonTab==='3D Modeling' && <div className="aquacad-ribbon-group"><strong>Terrain & Elevation</strong><div className="aquacad-tool-grid">
              <button onClick={()=>void fetchTerrainSurfaceFromGis()} disabled={terrainTransferBusy || !gisFeatures.length}><i>▤</i><span>{terrainTransferBusy?'Fetching DEM…':'Fetch DEM from GIS'}</span></button>
              <button onClick={()=>terrainFileRef.current?.click()}><i>⇩</i><span>Import Terrain Grid</span></button>
            </div><small className="muted">{terrainGrid ? 'Terrain loaded · '+terrainGrid.width+' × '+terrainGrid.height+' · '+terrainGrid.crs : 'Fetch a DEM clipped to the saved GIS project features.'}</small></div>}
            {ribbonTab==='Analyze' && <>
              <div className="aquacad-ribbon-group"><strong>Hydraulic Analysis</strong><div className="aquacad-tool-grid">
                <button className="primary" onClick={runProjectHydraulics} disabled={simulationBusy||!waterCad.components.length}><i>▶</i><span>{simulationBusy?'Running…':'Run EPANET'}</span></button>
                <button onClick={()=>{setEpanetImportMode('replace');epanetFileRef.current?.click()}}><i>⇩</i><span>Import INP</span></button>
                <button onClick={downloadEpanetInput}><i>⇧</i><span>Export INP</span></button>
                <button onClick={()=>hydraulicResultsFileRef.current?.click()}><i>▤</i><span>Load Results</span></button>
              </div></div>
              <div className="aquacad-ribbon-group"><strong>Review Results</strong><div className="aquacad-tool-grid">
                <button onClick={()=>setMessage(hydraulicOverlay?'Overlay metric: '+hydraulicOverlay.metric:'Run a simulation to view hydraulic results.')}><i>▥</i><span>Results</span></button>
                <button onClick={()=>{const issues=buildTerrainIssues(waterCad);setMessage(issues.map(x=>x.message).join(' · ')||'No terrain issues found.')}}><i>⚠</i><span>Warnings</span></button>
                <button onClick={runEngineeringAudit}><i>✓</i><span>Drawing Audit</span></button>
              </div></div>
            </>}
            {ribbonTab==='View' && <div className="aquacad-ribbon-group"><strong>Navigate & Display</strong><div className="aquacad-tool-grid">
              <button onClick={()=>setPanMode(v=>!v)} className={panMode?'selected':''}><i>✋</i><span>Pan</span></button>
              <button onClick={()=>setViewBox({x:0,y:0,width:WIDTH,height:HEIGHT})}><i>⌕</i><span>Zoom Extents</span></button>
              <button onClick={toggleCadFullscreen}><i>⛶</i><span>{isFullscreen?'Restore':'Maximize'}</span></button>

            </div></div>}
            {ribbonTab==='Output' && <div className="aquacad-ribbon-group"><strong>Plot, Export & Reports</strong><div className="aquacad-tool-grid">
              <button onClick={()=>exportSheetSvg(true)}><i>⎙</i><span>Plot / PDF</span></button>
              <button onClick={downloadDxf}><i>DXF</i><span>Export DXF</span></button>
              <button onClick={downloadEpanetInput}><i>INP</i><span>Export EPANET</span></button>

            </div></div>}
            {ribbonTab==='Manage' && <div className="aquacad-ribbon-group"><strong>Drawing Standards & Settings</strong><div className="aquacad-tool-grid">
              <label>Layer <select value={layer} onChange={e=>setLayer(e.target.value)}>{drafting.layers.map(item=><option key={item.name} value={item.name}>{item.name}</option>)}</select></label>
              <label>Standard <select value={layerTemplate} onChange={e=>setLayerTemplate(e.target.value as LayerStandard)}><option value="WATER_UTILITY">Water utility</option><option value="CIVIL_SITE">Civil / site</option><option value="MECHANICAL">Mechanical</option></select></label>
              <button onClick={applyLayerTemplate}><i>≡</i><span>Apply Standard</span></button>
              <button onClick={runEngineeringAudit}><i>✓</i><span>Audit</span></button>
            </div></div>}
          </div>
        {ribbonTab==='Insert' && <div className="aquacad-ribbon-extra" data-cad-ribbon-panel="blocks">
      <div className="panel" style={{ padding: 14, display: 'grid', gap: 9 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div><strong>Engineering object library</strong><div className="muted" style={{ fontSize: 12 }}>Parametric water symbols with named connection ports and default schedules</div></div>
          <span className="muted" style={{ fontSize: 11 }}>{ENGINEERING_BLOCK_LIBRARY.length} library objects</span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={libraryBlockName} onChange={event => setLibraryBlockName(event.target.value)} style={{ minWidth: 210, padding: 7 }}>
            {ENGINEERING_BLOCK_LIBRARY.map(block => <option key={block.name} value={block.name}>{block.name.replaceAll('_', ' ')} · {block.category}</option>)}
          </select>
          <label>Rotation (degrees) <input type="number" step="1" value={libraryRotationDeg} onChange={event => setLibraryRotationDeg(Number(event.target.value)||0)} style={{width:75}}/></label>
          <button className={libraryPlacementActive ? "primary-button" : "secondary-button"} onClick={() => { if (!calibratedMetresPerUnit) { setMessage('Calibrate the drawing before placing engineering objects.'); return; } setLibraryPlacementActive(value => !value); setMessage(libraryPlacementActive ? 'Object placement cancelled.' : 'Click a point in the drawing to place the selected engineering object.'); }} disabled={!calibratedMetresPerUnit}>{libraryPlacementActive ? 'Cancel placement' : 'Place object · click drawing'}</button>
          <button className="secondary-button" onClick={() => insertEngineeringBlock()} disabled={!calibratedMetresPerUnit}>Insert at drawing centre</button>
          {!calibratedMetresPerUnit && <span className="muted" style={{ fontSize: 11 }}>Scale calibration required</span>}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="secondary-button" onClick={createOrRefreshPaperLayout} disabled={!calibratedMetresPerUnit}>Create / refresh paper-space layout</button>
          <button className="secondary-button" onClick={runEngineeringAudit}>Run engineering drawing audit</button>
          {engineeringAudit && <strong style={{ fontSize: 12, color: engineeringAudit.status === 'FAIL' ? '#b42318' : engineeringAudit.status === 'PASS_WITH_WARNINGS' ? '#9a6700' : '#16794b' }}>{engineeringAudit.status} · {engineeringAudit.errors} errors · {engineeringAudit.warnings} warnings</strong>}
        </div>
        <div className="muted" style={{ fontSize: 11 }}>{paperLayouts.length} saved paper-space layouts · {paperLayouts.reduce((sum, layout) => sum + layout.viewports.length, 0)} viewports</div>
        {activePaperViewport && <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:8,borderTop:'1px solid #d7dfdc',paddingTop:10}}>
          <strong style={{gridColumn:'1/-1',fontSize:12}}>Paper-space viewport · {activePaperViewport.name}</strong>
          <label><input type="checkbox" checked={activePaperViewport.locked} onChange={e=>updatePaperViewport({locked:e.target.checked})}/> Lock viewport</label>
          <label>Paper X (mm)<input type="number" min="10" step="1" value={activePaperViewport.xMm} disabled={activePaperViewport.locked} onChange={e=>updatePaperViewport({xMm:Number(e.target.value)})}/></label>
          <label>Paper Y (mm)<input type="number" min="10" step="1" value={activePaperViewport.yMm} disabled={activePaperViewport.locked} onChange={e=>updatePaperViewport({yMm:Number(e.target.value)})}/></label>
          <label>Width (mm)<input type="number" min="10" step="1" value={activePaperViewport.widthMm} disabled={activePaperViewport.locked} onChange={e=>updatePaperViewport({widthMm:Number(e.target.value)})}/></label>
          <label>Height (mm)<input type="number" min="10" step="1" value={activePaperViewport.heightMm} disabled={activePaperViewport.locked} onChange={e=>updatePaperViewport({heightMm:Number(e.target.value)})}/></label>
          <label>Scale denominator<input type="number" min="1" step="1" value={activePaperViewport.scaleDenominator} disabled={activePaperViewport.locked} onChange={e=>updatePaperViewport({scaleDenominator:Number(e.target.value)})}/></label>
          <label>Rotation (degrees)<input type="number" step="1" value={activePaperViewport.rotationDeg} disabled={activePaperViewport.locked} onChange={e=>updatePaperViewport({rotationDeg:Number(e.target.value)})}/></label>
          <label>Model centre X (m)<input type="number" step="any" value={activePaperViewport.modelCenter.x} disabled={activePaperViewport.locked} onChange={e=>updatePaperViewport({modelCenter:{...activePaperViewport.modelCenter,x:Number(e.target.value)}})}/></label>
          <label>Model centre Y (m)<input type="number" step="any" value={activePaperViewport.modelCenter.y} disabled={activePaperViewport.locked} onChange={e=>updatePaperViewport({modelCenter:{...activePaperViewport.modelCenter,y:Number(e.target.value)}})}/></label>
          <span className="muted" style={{fontSize:11,gridColumn:'1/-1'}}>Unlock to edit. Changes are saved with the drawing; run the engineering audit to validate sheet bounds.</span>
        </div>}
        {engineeringAudit && <div style={{ display: 'grid', gap: 4, fontSize: 12 }}>
          <span>{engineeringAudit.summary.shapeCount} CAD entities · {engineeringAudit.summary.annotationCount} annotations · {engineeringAudit.summary.waterComponentCount} water components · {engineeringAudit.summary.layerCount} layers · {engineeringAudit.summary.sheetCount} sheets</span>
          {engineeringAudit.issues.slice(0, 12).map((issue, index) => <div key={issue.code + '-' + index} style={{ color: issue.severity === 'error' ? '#b42318' : '#9a6700' }}>{issue.severity.toUpperCase()} · {issue.code}: {issue.message}</div>)}
          {engineeringAudit.issues.length > 12 && <span className="muted">Showing first 12 of {engineeringAudit.issues.length} findings.</span>}
        </div>}
      </div>
        </div>}
        {ribbonTab==='Drafting' && <div className="aquacad-ribbon-extra" data-cad-ribbon-panel="drafting">
      <div className="panel" style={{ padding: 14 }}>
        <span className="eyebrow muted">PROFESSIONAL DRAFTING</span>
        <h3 style={{ margin: "5px 0" }}>Dimensions, annotations, layers & drawing sheets</h3>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center" }}>
          <button className={draftTool === "dimension" && dimensionKind === "aligned" ? "primary-button" : "secondary-button"} onClick={() => { setDimensionKind("aligned"); setDraftTool("dimension"); setAnnotationDraft([]); setMessage("Select two points for an aligned dimension."); }}>Aligned dimension</button>
          <button className={draftTool === "dimension" && dimensionKind === "linear" ? "primary-button" : "secondary-button"} onClick={() => { setDimensionKind("linear"); setDraftTool("dimension"); setAnnotationDraft([]); setMessage("Select two points for a horizontal/vertical linear dimension."); }}>Linear dimension</button>
          {(['angular','radius','diameter','ordinate'] as const).map(kind => <button key={kind} className={draftTool === 'dimension' && dimensionKind === kind ? 'primary-button' : 'secondary-button'} onClick={() => { setDimensionKind(kind); setDraftTool('dimension'); setAnnotationDraft([]); setMessage(kind === 'angular' ? 'Select vertex, first ray point and second ray point.' : kind === 'ordinate' ? 'Select datum origin, feature point and offset direction point.' : 'Select circle centre, circle edge and leader landing point.'); }}>{kind[0].toUpperCase()+kind.slice(1)} dimension</button>)}
          {(['baseline','chain'] as const).map(kind => <button key={kind} className={draftTool === 'dimension' && dimensionKind === kind ? 'primary-button' : 'secondary-button'} onClick={() => { setDimensionKind(kind); setDraftTool('dimension'); setAnnotationDraft([]); setMessage(kind === 'baseline' ? 'Select datum origin, two feature points, then offset direction.' : 'Select three chain vertices, then offset direction.'); }}>{kind[0].toUpperCase()+kind.slice(1)} dimension</button>)}
          <button className={draftTool === "text" ? "primary-button" : "secondary-button"} onClick={() => { setDraftTool("text"); setMessage("Click the drawing to place text."); }}>Place text</button>
          <button className={draftTool === "leader" ? "primary-button" : "secondary-button"} onClick={() => { setDraftTool("leader"); setAnnotationDraft([]); setMessage("Click leader arrow point, then text landing point."); }}>Leader</button>
          {draftTool !== "none" && <button className="secondary-button" onClick={() => { setDraftTool("none"); setAnnotationDraft([]); }}>Cancel annotation</button>}
          <label>Text / note <input value={annotationText} onChange={e => setAnnotationText(e.target.value)} style={{ width: 180 }}/></label>
          <label>Dimension offset / angular radius (m) <input type="number" step="any" value={dimensionOffset} onChange={e => setDimensionOffset(Number(e.target.value))} style={{ width: 95 }}/></label>
          <label>Ordinate axis <select value={ordinateAxis} onChange={e => setOrdinateAxis(e.target.value as 'x'|'y')}><option value="x">X</option><option value="y">Y</option></select></label>
          <label>Precision <select value={dimensionPrecision} onChange={e => { const precision = Number(e.target.value); setDimensionPrecision(precision); setDimensionStyle(current => ({ ...current, precision })); }}><option value={0}>0</option><option value={1}>0.0</option><option value={2}>0.00</option><option value={3}>0.000</option><option value={4}>0.0000</option></select></label>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 9, marginTop: 12 }}>
          <label>Standard <select value={drafting.standard} onChange={e => { const standard = e.target.value as DraftingDocument["standard"]; setDrafting(v => ({ ...v, standard })); setDimensionStyle(DIMENSION_STYLES[standard]); }}><option value="ISO">ISO / EN</option><option value="BS">British Standards</option><option value="ANSI">ANSI / ASME</option></select></label>
          <label>Sheet set <select value={drafting.activeSheetIndex} onChange={e => selectDrawingSheet(Number(e.target.value))}>{drafting.sheets.map((sheet,index) => <option key={index} value={index}>{sheet.drawingNumber} · {sheet.title}</option>)}</select></label><button className="secondary-button" onClick={addDrawingSheet}>Add sheet</button>
          <label>Sheet <select value={drafting.sheet.size} onChange={e => updateDrawingSheet({ size: e.target.value as DraftingDocument["sheet"]["size"] })}>{["A0","A1","A2","A3","A4","CUSTOM"].map(x => <option key={x}>{x}</option>)}</select></label>
          {drafting.sheet.size === "CUSTOM" && <><label>Custom width (mm) <input type="number" min="180" max="5000" value={drafting.sheet.widthMm ?? 297} onChange={e => updateDrawingSheet({ widthMm: Number(e.target.value) })}/></label><label>Custom height (mm) <input type="number" min="120" max="5000" value={drafting.sheet.heightMm ?? 420} onChange={e => updateDrawingSheet({ heightMm: Number(e.target.value) })}/></label></>}
          {drafting.sheet.size !== "CUSTOM" && <label>Orientation <select value={drafting.sheet.orientation} onChange={e => updateDrawingSheet({ orientation: e.target.value as "landscape"|"portrait" })}><option value="landscape">Landscape</option><option value="portrait">Portrait</option></select></label>}
          <label>Plot scale <select value={drafting.sheet.scale} onChange={e => updateDrawingSheet({ scale: e.target.value })}>{["1:20","1:25","1:50","1:75","1:100","1:150","1:200","1:250","1:500","1:1000","1:2000"].map(x => <option key={x}>{x}</option>)}</select></label>
          <label>Units <select value={drafting.sheet.units} onChange={e => updateDrawingSheet({ units: e.target.value as "m"|"mm" })}><option value="m">metres</option><option value="mm">millimetres</option></select></label>
          <label>Drawing number <input value={drafting.sheet.drawingNumber} onChange={e => updateDrawingSheet({ drawingNumber: e.target.value })}/></label>
          <label>Drawing title <input value={drafting.sheet.title} onChange={e => updateDrawingSheet({ title: e.target.value })}/></label>
          <label>Revision <input value={drafting.sheet.revision} onChange={e => updateDrawingSheet({ revision: e.target.value })}/></label>
          <label>Status <select value={drafting.sheet.status} onChange={e => updateDrawingSheet({ status: e.target.value as DraftingDocument["sheet"]["status"] })}>{["PRELIMINARY","FOR REVIEW","FOR APPROVAL","FOR CONSTRUCTION","AS BUILT"].map(x => <option key={x}>{x}</option>)}</select></label>
          <label>Designer <input value={drafting.sheet.designer} onChange={e => updateDrawingSheet({ designer: e.target.value })}/></label>
          <label>Checker <input value={drafting.sheet.checker} onChange={e => updateDrawingSheet({ checker: e.target.value })}/></label>
          <label>Approver <input value={drafting.sheet.approver} onChange={e => updateDrawingSheet({ approver: e.target.value })}/></label>
          <label>Company <input value={drafting.sheet.company} onChange={e => updateDrawingSheet({ company: e.target.value })}/></label>
          <label>Issue date <input type="date" value={drafting.sheet.date} onChange={e => updateDrawingSheet({ date: e.target.value })}/></label>
          <label>General notes<textarea value={drafting.sheet.generalNotes || ''} onChange={e => updateDrawingSheet({ generalNotes: e.target.value })} rows={2}/></label>
          <label>Key plan / location note<input value={drafting.sheet.keyPlanText || ''} onChange={e => updateDrawingSheet({ keyPlanText: e.target.value })} placeholder="e.g. Voi town distribution zone"/></label>
          <label><input type="checkbox" checked={drafting.sheet.showNorthArrow !== false} onChange={e => updateDrawingSheet({ showNorthArrow: e.target.checked })}/> Show north arrow</label>
          <label><input type="checkbox" checked={drafting.sheet.showScaleBar !== false} onChange={e => updateDrawingSheet({ showScaleBar: e.target.checked })}/> Show scale bar</label>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          <button className="secondary-button" onClick={validateDrafting}>Validate drafting</button>
          <button className="secondary-button" onClick={() => exportSheetSvg()}>Export sheet SVG</button>
          <button className="secondary-button" onClick={() => exportSheetSvg(true)}>Print / Save as PDF</button>
          <button className="secondary-button" onClick={printAllDrawingSheets} disabled={drafting.sheets.length < 2}>Print complete sheet set</button>
          <span className="muted" style={{ fontSize: 12 }}>{sheetDimensionsMm(drafting.sheet).widthMm} × {sheetDimensionsMm(drafting.sheet).heightMm} mm · {drafting.annotations.length} annotations</span>
        </div>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
          <label>Layer template <select value={layerTemplate} onChange={e => setLayerTemplate(e.target.value as LayerStandard)}><option value="WATER_UTILITY">Water utility</option><option value="CIVIL_SITE">Civil / site</option><option value="MECHANICAL">Mechanical</option></select></label><button className="secondary-button" onClick={applyLayerTemplate}>Apply / synchronize standards</button>
          <input placeholder="New layer name" value={newLayerName} onChange={e => setNewLayerName(e.target.value)} style={{ width: 150 }}/><button className="secondary-button" onClick={addDraftLayer}>Add layer</button>
          {drafting.layers.map(item => <span key={item.name} style={{ display: "inline-flex", alignItems: "center", gap: 4, border: "1px solid #ccd5d2", padding: 4, borderRadius: 5, fontSize: 11, flexWrap: "wrap" }}><input type="color" value={item.color} onChange={e => setDrafting(v => ({ ...v, layers: v.layers.map(l => l.name === item.name ? { ...l, color: e.target.value } : l) }))} style={{ width: 22, height: 20, padding: 0 }}/><button onClick={() => setDrafting(v => ({ ...v, layers: v.layers.map(l => l.name === item.name ? { ...l, visible: !l.visible } : l) }))}>{item.visible ? "●" : "○"} {item.name}</button><label><input type="checkbox" checked={item.locked} onChange={e => setDrafting(v => ({ ...v, layers: v.layers.map(l => l.name === item.name ? { ...l, locked: e.target.checked } : l) }))}/>Lock</label><label><input type="checkbox" checked={item.plot} onChange={e => setDrafting(v => ({ ...v, layers: v.layers.map(l => l.name === item.name ? { ...l, plot: e.target.checked } : l) }))}/>Plot</label><select value={item.lineType} onChange={e => setDrafting(v => ({ ...v, layers: v.layers.map(l => l.name === item.name ? { ...l, lineType: e.target.value as typeof item.lineType } : l) }))}><option>CONTINUOUS</option><option>DASHED</option><option>CENTER</option><option>HIDDEN</option><option>PHANTOM</option></select><input aria-label="Lineweight mm" type="number" min="0" max="2.11" step="0.05" value={item.lineWeightMm} onChange={e => setDrafting(v => ({ ...v, layers: v.layers.map(l => l.name === item.name ? { ...l, lineWeightMm: Number(e.target.value) } : l) }))} style={{ width: 48 }}/></span>)}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8, marginTop: 10 }}>
          <label>Dimension text height (mm)<input type="number" min="0.5" step="0.1" value={dimensionStyle.textHeightMm} onChange={e => setDimensionStyle(v => ({ ...v, textHeightMm: Number(e.target.value) }))}/></label>
          <label>Arrow size (mm)<input type="number" min="0.5" step="0.1" value={dimensionStyle.arrowSizeMm} onChange={e => setDimensionStyle(v => ({ ...v, arrowSizeMm: Number(e.target.value) }))}/></label>
          <label>Extension offset (mm)<input type="number" min="0" step="0.1" value={dimensionStyle.extensionOffsetMm} onChange={e => setDimensionStyle(v => ({ ...v, extensionOffsetMm: Number(e.target.value) }))}/></label>
          <label>Extension beyond (mm)<input type="number" min="0.1" step="0.1" value={dimensionStyle.extensionBeyondMm} onChange={e => setDimensionStyle(v => ({ ...v, extensionBeyondMm: Number(e.target.value) }))}/></label>
          <label>Dimension unit<select value={dimensionStyle.unit} onChange={e => setDimensionStyle(v => ({ ...v, unit: e.target.value as "m"|"mm" }))}><option value="m">metres</option><option value="mm">millimetres</option></select></label>
          <label>Zero suppression<select value={dimensionStyle.zeroSuppress} onChange={e => setDimensionStyle(v => ({ ...v, zeroSuppress: e.target.value as DimensionStyle["zeroSuppress"] }))}><option value="none">None</option><option value="leading">Leading</option><option value="trailing">Trailing</option><option value="both">Both</option></select></label>
          <label>Tolerance mode<select value={dimensionStyle.tolerance.mode} onChange={e => setDimensionStyle(v => ({ ...v, tolerance: { ...v.tolerance, mode: e.target.value as DimensionStyle["tolerance"]["mode"] } }))}><option value="none">None</option><option value="symmetric">Symmetric</option><option value="deviation">Deviation</option></select></label>
          <label>Upper / symmetric tolerance<input type="number" min="0" step="any" value={dimensionStyle.tolerance.upper} onChange={e => setDimensionStyle(v => ({ ...v, tolerance: { ...v.tolerance, upper: Number(e.target.value), lower: v.tolerance.mode === "symmetric" ? Number(e.target.value) : v.tolerance.lower } }))}/></label>
          <label>Lower tolerance<input type="number" min="0" step="any" value={dimensionStyle.tolerance.lower} onChange={e => setDimensionStyle(v => ({ ...v, tolerance: { ...v.tolerance, lower: Number(e.target.value) } }))}/></label>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8, marginTop: 12 }}>
          <label>New revision<input value={revisionDraft.revision} onChange={e => setRevisionDraft(v => ({ ...v, revision: e.target.value }))} placeholder="P02 / C01"/></label>
          <label>Revision date<input type="date" value={revisionDraft.date} onChange={e => setRevisionDraft(v => ({ ...v, date: e.target.value }))}/></label>
          <label>Change description<input value={revisionDraft.description} onChange={e => setRevisionDraft(v => ({ ...v, description: e.target.value }))} placeholder="Describe drawing changes"/></label>
          <label>Drawn by<input value={revisionDraft.drawnBy} onChange={e => setRevisionDraft(v => ({ ...v, drawnBy: e.target.value }))}/></label>
          <label>Checked by<input value={revisionDraft.checkedBy} onChange={e => setRevisionDraft(v => ({ ...v, checkedBy: e.target.value }))}/></label>
          <label>Approved by<input value={revisionDraft.approvedBy} onChange={e => setRevisionDraft(v => ({ ...v, approvedBy: e.target.value }))}/></label>
          <button className="secondary-button" onClick={addRevisionEntry}>Add revision record</button>
        </div>
        {drafting.revisionHistory?.length > 0 && <div style={{ overflowX: "auto", marginTop: 8 }}><strong>Revision history</strong><table style={{ width: "100%", fontSize: 11 }}><thead><tr>{["Rev","Date","Description","Drawn","Checked","Approved","Status"].map(x => <th key={x}>{x}</th>)}</tr></thead><tbody>{drafting.revisionHistory.map((r,i) => <tr key={r.revision+i}><td>{r.revision}</td><td>{r.date}</td><td>{r.description}</td><td>{r.drawnBy}</td><td>{r.checkedBy}</td><td>{r.approvedBy}</td><td>{r.status}</td></tr>)}</tbody></table></div>}
        {drafting.annotations.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>{drafting.annotations.map(item => <button key={item.id} className="secondary-button" onClick={() => removeAnnotation(item.id)}>Delete {item.kind} · {item.id.slice(0,6)}</button>)}</div>}
        <div style={{display:'flex',flexWrap:'wrap',gap:7,alignItems:'center',borderTop:'1px solid #d8e1df',paddingTop:9,marginTop:9}}>
          <strong style={{fontSize:12}}>Layer visibility</strong>
          {layerNames.map(name=><button key={name} className={hiddenLayers.includes(name)?'secondary-button':'primary-button'} onClick={()=>setHiddenLayers(current=>current.includes(name)?current.filter(item=>item!==name):[...current,name])} style={{padding:'6px 9px',fontSize:11}}>{hiddenLayers.includes(name)?'Show':'Hide'} {name}</button>)}
        </div>
      </div>
        </div>}
        {ribbonTab==='Water Network' && <div className="aquacad-ribbon-extra" data-cad-ribbon-panel="water-network">
      <div className="panel" style={{ padding: 14 }}>
        <span className="eyebrow muted">WATER ENGINEERING OBJECTS</span>
        <h3 style={{ margin: '5px 0' }}>Network component library</h3>
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>Choose Place, then click in the drawing. Pipes need two snapped clicks; fittings and equipment need one. A verified CAD scale is required so plan coordinates are stored in metres. Confirm elevations against the project survey datum.</p>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {(['pipe','bend','tee','reducer','valve','pump','tank','chamber','hydrant','meter','air-valve','washout','reservoir','source','junction'] as WaterComponentKind[]).map(kind => <button key={kind} className={activeWaterTool===kind?'primary-button':'secondary-button'} onClick={() => addWaterComponent(kind)}>Place {kind}</button>)}
          {activeWaterTool === 'pipe' && waterDraft.length >= 2 && <button className="primary-button" onClick={() => commitWaterPlacement('pipe', waterDraft)}>Finish pipe route ({waterDraft.length} points)</button>}
          {activeWaterTool && <button className="secondary-button" onClick={()=>{setActiveWaterTool(null);setWaterDraft([]);setMessage('Water component placement cancelled.');}}>Cancel placement</button>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 1fr) minmax(180px, 2fr)', gap: 10, marginTop: 12 }}>
          <label style={{ fontSize: 12 }}>Component register
            <select value={selectedWaterId} onChange={event => setSelectedWaterId(event.target.value)} style={{ display: 'block', width: '100%', marginTop: 4 }}>
              <option value="">Select component</option>
              {waterCad.components.map(item => <option key={item.id} value={item.id}>{item.id} · {item.kind}</option>)}
            </select>
            <span className="muted">{waterCad.components.length} water objects in this project</span>
          </label>
          {selectedWaterComponent ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(125px,1fr))', gap: 8 }}>
            <label style={{ fontSize: 12 }}>Tag<input value={selectedWaterComponent.properties.tag} onChange={e => updateWaterProperties({ tag: e.target.value })} style={{ display: 'block', width: '100%' }} /></label>
            <label style={{ fontSize: 12 }}>Nominal diameter (mm)<input type="number" min="1" value={selectedWaterComponent.properties.nominalDiameterMm ?? ''} onChange={e => updateWaterProperties({ nominalDiameterMm: Number(e.target.value) })} style={{ display: 'block', width: '100%' }} /></label>
            {selectedWaterComponent.kind === 'pipe' ? <>
              <label style={{ fontSize: 12 }}>Internal bore (mm)<input type="number" min="1" value={selectedWaterComponent.properties.internalDiameterMm ?? ''} onChange={e => updateWaterProperties({ internalDiameterMm: Number(e.target.value) })} style={{ display: 'block', width: '100%' }} /></label>
              <label style={{ fontSize: 12 }}>Verified outside diameter / OD (mm)<input type="number" min="1" value={selectedWaterComponent.properties.externalDiameterMm ?? ''} onChange={e => updateWaterProperties({ externalDiameterMm: e.target.value === '' ? undefined : Number(e.target.value) })} style={{ display: 'block', width: '100%' }} /></label>
              <label style={{ fontSize: 12 }}>Material<select value={selectedWaterComponent.properties.material || 'HDPE'} onChange={e => updateWaterProperties({ material: e.target.value as WaterCadComponent['properties']['material'] })} style={{ display: 'block', width: '100%' }}><option>HDPE</option><option>DI</option><option>uPVC</option><option>steel</option><option>concrete</option><option>GRP</option><option>other</option></select></label>
              <label style={{ fontSize: 12 }}>Inlet invert (m)<input type="number" step="any" value={selectedWaterComponent.properties.invertInletM ?? ''} onChange={e => updateWaterProperties({ invertInletM: Number(e.target.value) })} style={{ display: 'block', width: '100%' }} /></label>
              <label style={{ fontSize: 12 }}>Outlet invert (m)<input type="number" step="any" value={selectedWaterComponent.properties.invertOutletM ?? ''} onChange={e => updateWaterProperties({ invertOutletM: Number(e.target.value) })} style={{ display: 'block', width: '100%' }} /></label>
              <label style={{ fontSize: 12 }}>Flow (m³/h)<input type="number" min="0" step="any" value={selectedWaterComponent.properties.flowM3h ?? ''} onChange={e => updateWaterProperties({ flowM3h: Number(e.target.value) })} style={{ display: 'block', width: '100%' }} /></label>
              <label style={{ fontSize: 12 }}>Hazen-Williams C<input type="number" min="1" step="any" value={selectedWaterComponent.properties.roughness ?? 140} onChange={e => updateWaterProperties({ roughness: Number(e.target.value) })} style={{ display: 'block', width: '100%' }} /></label>
              <label style={{ fontSize: 12 }}>Minor-loss coefficient K<input type="number" min="0" step="any" value={selectedWaterComponent.properties.minorLossCoefficient ?? 0} onChange={e => updateWaterProperties({ minorLossCoefficient: Number(e.target.value) })} style={{ display: 'block', width: '100%' }} /></label>
              <label style={{ fontSize: 12 }}>Pressure class<input value={selectedWaterComponent.properties.pressureClass || ''} onChange={e => updateWaterProperties({ pressureClass: e.target.value })} style={{ display: 'block', width: '100%' }} /></label>
            </> : null}
            <div style={{ display: 'grid', gap: 7, gridColumn: '1 / -1' }}>
              <strong style={{ fontSize: 12 }}>Survey / route geometry vertices · metres</strong>
              {selectedWaterComponent.geometry.map((point, index) => <div key={index} style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(90px,1fr)) auto', gap: 6, alignItems: 'end' }}>
                <label style={{ fontSize: 11 }}>V{index + 1} X<input type="number" step="any" value={point.x} onChange={e => setWaterCad(current => ({ ...current, components: current.components.map(item => item.id === selectedWaterId ? { ...item, geometry: item.geometry.map((vertex, vertexIndex) => vertexIndex === index ? { ...vertex, x: Number(e.target.value) } : vertex) } : item) }))} style={{ display: 'block', width: '100%' }} /></label>
                <label style={{ fontSize: 11 }}>Y<input type="number" step="any" value={point.y} onChange={e => setWaterCad(current => ({ ...current, components: current.components.map(item => item.id === selectedWaterId ? { ...item, geometry: item.geometry.map((vertex, vertexIndex) => vertexIndex === index ? { ...vertex, y: Number(e.target.value) } : vertex) } : item) }))} style={{ display: 'block', width: '100%' }} /></label>
                <label style={{ fontSize: 11 }}>Pipe Z (m)<input type="number" step="any" value={point.z ?? ''} onChange={e => setWaterCad(current => ({ ...current, components: current.components.map(item => item.id === selectedWaterId ? { ...item, geometry: item.geometry.map((vertex, vertexIndex) => vertexIndex === index ? { ...vertex, z: e.target.value === '' ? undefined : Number(e.target.value) } : vertex) } : item) }))} style={{ display: 'block', width: '100%' }} /></label>
                <label style={{ fontSize: 11 }}>Ground RL<input type="number" step="any" value={point.groundLevelM ?? ''} onChange={e => setWaterCad(current => ({ ...current, components: current.components.map(item => item.id === selectedWaterId ? { ...item, geometry: item.geometry.map((vertex, vertexIndex) => vertexIndex === index ? { ...vertex, groundLevelM: e.target.value === '' ? undefined : Number(e.target.value) } : vertex) } : item) }))} style={{ display: 'block', width: '100%' }} /></label>
                <label style={{ fontSize: 11 }}>Invert RL<input type="number" step="any" value={point.invertLevelM ?? ''} onChange={e => setWaterCad(current => ({ ...current, components: current.components.map(item => item.id === selectedWaterId ? { ...item, geometry: item.geometry.map((vertex, vertexIndex) => vertexIndex === index ? { ...vertex, invertLevelM: e.target.value === '' ? undefined : Number(e.target.value) } : vertex) } : item) }))} style={{ display: 'block', width: '100%' }} /></label>
                {selectedWaterComponent.kind === 'pipe' && selectedWaterComponent.geometry.length > 2 && index > 0 && index < selectedWaterComponent.geometry.length - 1 ? <button className="secondary-button" onClick={() => setWaterCad(current => ({ ...current, components: current.components.map(item => item.id === selectedWaterId ? { ...item, geometry: item.geometry.filter((_, vertexIndex) => vertexIndex !== index) } : item) }))}>Remove</button> : <span />}
              </div>)}
              {selectedWaterComponent.kind === 'pipe' ? <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12 }}>
                <span>Plan length: <strong>{componentPlanLength(selectedWaterComponent).toFixed(3)} m</strong></span>
                <span>3D length: <strong>{component3dLength(selectedWaterComponent).toFixed(3)} m</strong></span>
              </div> : null}
            </div>
            {selectedWaterComponent.kind === 'pipe' ? <>
              <label style={{ fontSize: 12 }}>From network node<select value={selectedWaterComponent.fromNodeId || ''} onChange={e => { const to = selectedWaterComponent.toNodeId || ''; if (e.target.value && to) { try { setWaterCad(current => connectPipeEndpoints(current, selectedWaterId, e.target.value, to)); } catch(error) { setMessage(error instanceof Error ? error.message : 'Connection failed.'); } } else setWaterCad(current => ({ ...current, components: current.components.map(item => item.id === selectedWaterId ? { ...item, fromNodeId: e.target.value || undefined } : item) })); }} style={{ display: 'block', width: '100%' }}><option value="">Unconnected</option>{waterCad.components.filter(item => ['junction','source','tank','reservoir'].includes(item.kind) && item.id !== selectedWaterId).map(item => <option key={item.id} value={item.id}>{item.id} · {item.kind}</option>)}</select></label>
              <label style={{ fontSize: 12 }}>To network node<select value={selectedWaterComponent.toNodeId || ''} onChange={e => { const from = selectedWaterComponent.fromNodeId || ''; if (from && e.target.value) { try { setWaterCad(current => connectPipeEndpoints(current, selectedWaterId, from, e.target.value)); } catch(error) { setMessage(error instanceof Error ? error.message : 'Connection failed.'); } } else setWaterCad(current => ({ ...current, components: current.components.map(item => item.id === selectedWaterId ? { ...item, toNodeId: e.target.value || undefined } : item) })); }} style={{ display: 'block', width: '100%' }}><option value="">Unconnected</option>{waterCad.components.filter(item => ['junction','source','tank','reservoir'].includes(item.kind) && item.id !== selectedWaterId).map(item => <option key={item.id} value={item.id}>{item.id} · {item.kind}</option>)}</select></label>
            </> : null}
            {selectedWaterComponent.kind === 'pipe' ? <>
              <label style={{ fontSize: 12 }}>Ground level at start (m RL)<input type="number" step="any" value={selectedWaterComponent.properties.groundStartM ?? ''} onChange={e => updateWaterProperties({ groundStartM: e.target.value === '' ? undefined : Number(e.target.value) })} style={{ display: 'block', width: '100%' }} /></label>
              <label style={{ fontSize: 12 }}>Ground level at end (m RL)<input type="number" step="any" value={selectedWaterComponent.properties.groundEndM ?? ''} onChange={e => updateWaterProperties({ groundEndM: e.target.value === '' ? undefined : Number(e.target.value) })} style={{ display: 'block', width: '100%' }} /></label>
              <label style={{ fontSize: 12 }}>Invert at inlet (m RL)<input type="number" step="any" value={selectedWaterComponent.properties.invertInletM ?? ''} onChange={e => updateWaterProperties({ invertInletM: e.target.value === '' ? undefined : Number(e.target.value) })} style={{ display: 'block', width: '100%' }} /></label>
              <label style={{ fontSize: 12 }}>Invert at outlet (m RL)<input type="number" step="any" value={selectedWaterComponent.properties.invertOutletM ?? ''} onChange={e => updateWaterProperties({ invertOutletM: e.target.value === '' ? undefined : Number(e.target.value) })} style={{ display: 'block', width: '100%' }} /></label>
              <label style={{ fontSize: 12 }}>External diameter (mm)<input type="number" min="1" step="any" value={selectedWaterComponent.properties.externalDiameterMm ?? selectedWaterComponent.properties.nominalDiameterMm ?? ''} onChange={e => updateWaterProperties({ externalDiameterMm: e.target.value === '' ? undefined : Number(e.target.value) })} style={{ display: 'block', width: '100%' }} /></label>
            </> : null}
            {['bend','tee','reducer'].includes(selectedWaterComponent.kind) ? <label style={{ fontSize: 12 }}>Fitting orientation (degrees from +X)<input type="number" step="any" value={selectedWaterComponent.properties.rotationDeg ?? 0} onChange={e => updateWaterProperties({ rotationDeg: Number(e.target.value) })} style={{ display: 'block', width: '100%' }} /></label> : null}
            {selectedWaterComponent.kind === 'bend' ? <>
              <label style={{ fontSize: 12 }}>Bend angle (degrees)<input type="number" min="0.1" max="179.9" step="any" value={selectedWaterComponent.properties.bendAngleDeg ?? 90} onChange={e => updateWaterProperties({ bendAngleDeg: Number(e.target.value) })} style={{ display: 'block', width: '100%' }} /></label>
              <label style={{ fontSize: 12 }}>Bend radius (m)<input type="number" min="0" step="any" value={selectedWaterComponent.properties.bendRadiusM ?? 0.5} onChange={e => updateWaterProperties({ bendRadiusM: Number(e.target.value) })} style={{ display: 'block', width: '100%' }} /></label>
            </> : null}
            {selectedWaterComponent.kind === 'tee' ? <label style={{ fontSize: 12 }}>Branch diameter (mm)<input type="number" min="1" value={selectedWaterComponent.properties.branchDiameterMm ?? ''} onChange={e => updateWaterProperties({ branchDiameterMm: Number(e.target.value) })} style={{ display: 'block', width: '100%' }} /></label> : null}
            {selectedWaterComponent.kind === 'reducer' ? <label style={{ fontSize: 12 }}>Outlet diameter (mm)<input type="number" min="1" value={selectedWaterComponent.properties.outletDiameterMm ?? ''} onChange={e => updateWaterProperties({ outletDiameterMm: Number(e.target.value) })} style={{ display: 'block', width: '100%' }} /></label> : null}
            {selectedWaterComponent.kind === 'valve' ? <>
              <label style={{ fontSize: 12 }}>Valve type<select value={selectedWaterComponent.properties.valveType || 'gate'} onChange={e => updateWaterProperties({ valveType: e.target.value as WaterCadComponent['properties']['valveType'] })} style={{ display: 'block', width: '100%' }}><option value="gate">Gate</option><option value="butterfly">Butterfly</option><option value="check">Check / non-return</option><option value="PRV">Pressure reducing (PRV)</option><option value="PSV">Pressure sustaining (PSV)</option><option value="air-release">Air release</option><option value="washout">Washout</option><option value="control">Control valve</option></select></label>
              <label style={{ fontSize: 12 }}>Valve setting<input type="number" step="any" value={selectedWaterComponent.properties.valveSetting ?? 100} onChange={e => updateWaterProperties({ valveSetting: Number(e.target.value) })} style={{ display: 'block', width: '100%' }} /></label>
            </> : null}
            {selectedWaterComponent.kind === 'pump' ? <>
              <label style={{ fontSize: 12 }}>Duty flow (m³/h)<input type="number" min="0" step="any" value={selectedWaterComponent.properties.pumpDutyFlowM3h ?? ''} onChange={e => updateWaterProperties({ pumpDutyFlowM3h: Number(e.target.value) })} style={{ display: 'block', width: '100%' }} /></label>
              <label style={{ fontSize: 12 }}>Duty head (m)<input type="number" min="0" step="any" value={selectedWaterComponent.properties.pumpDutyHeadM ?? ''} onChange={e => updateWaterProperties({ pumpDutyHeadM: Number(e.target.value) })} style={{ display: 'block', width: '100%' }} /></label>
              <label style={{ fontSize: 12 }}>Efficiency (%)<input type="number" min="1" max="100" step="any" value={selectedWaterComponent.properties.pumpEfficiencyPct ?? 75} onChange={e => updateWaterProperties({ pumpEfficiencyPct: Number(e.target.value) })} style={{ display: 'block', width: '100%' }} /></label>
            </> : null}
            {['tank','reservoir'].includes(selectedWaterComponent.kind) ? <>
              <label style={{ fontSize: 12 }}>Capacity (m³)<input type="number" min="0" step="any" value={selectedWaterComponent.properties.tankCapacityM3 ?? ''} onChange={e => updateWaterProperties({ tankCapacityM3: Number(e.target.value) })} style={{ display: 'block', width: '100%' }} /></label>
              <label style={{ fontSize: 12 }}>Operating level (m)<input type="number" step="any" value={selectedWaterComponent.properties.tankOperatingLevelM ?? ''} onChange={e => updateWaterProperties({ tankOperatingLevelM: Number(e.target.value) })} style={{ display: 'block', width: '100%' }} /></label>
              <label style={{ fontSize: 12 }}>Tank diameter (m)<input type="number" min="0" step="any" value={selectedWaterComponent.properties.tankDiameterM ?? ''} onChange={e => updateWaterProperties({ tankDiameterM: Number(e.target.value) })} style={{ display: 'block', width: '100%' }} /></label>
            </> : null}
            {selectedWaterComponent.kind === 'chamber' ? <>
              <label style={{ fontSize: 12 }}>Length (m)<input type="number" min="0" step="any" value={selectedWaterComponent.properties.chamberLengthM ?? ''} onChange={e => updateWaterProperties({ chamberLengthM: Number(e.target.value) })} style={{ display: 'block', width: '100%' }} /></label>
              <label style={{ fontSize: 12 }}>Width (m)<input type="number" min="0" step="any" value={selectedWaterComponent.properties.chamberWidthM ?? ''} onChange={e => updateWaterProperties({ chamberWidthM: Number(e.target.value) })} style={{ display: 'block', width: '100%' }} /></label>
              <label style={{ fontSize: 12 }}>Depth (m)<input type="number" min="0" step="any" value={selectedWaterComponent.properties.chamberDepthM ?? ''} onChange={e => updateWaterProperties({ chamberDepthM: Number(e.target.value) })} style={{ display: 'block', width: '100%' }} /></label>
            </> : null}
            <label style={{ fontSize: 12 }}>Notes<input value={selectedWaterComponent.properties.notes || ''} onChange={e => updateWaterProperties({ notes: e.target.value })} style={{ display: 'block', width: '100%' }} /></label>
            <button className="secondary-button" onClick={() => { setWaterCad(current => ({ ...current, components: current.components.filter(item => item.id !== selectedWaterId) })); setSelectedWaterId(''); }}>Delete component</button>
          </div> : <p className="muted" style={{ fontSize: 12 }}>Select an object to edit its engineering schedule. Additional object-specific properties will be added in the next implementation pass.</p>}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <button className="secondary-button" onClick={validateWaterTopology} disabled={!waterCad.components.length}>Validate network</button>
          <button className="primary-button" onClick={downloadEpanetInput} disabled={!waterCad.components.length}>Export EPANET INP</button>
          <button className="secondary-button" onClick={downloadWaterBoq} disabled={!waterCad.components.length}>Export preliminary BOQ CSV</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 8, marginTop: 12 }}>
          <label style={{ fontSize: 12 }}>Connect port A
            <select value={portA} onChange={e => setPortA(e.target.value)} style={{ display: 'block', width: '100%' }}>
              <option value="">Select port</option>
              {waterCad.components.flatMap(item => getWaterPorts(item)).map(port => <option key={port.id} value={port.id}>{port.id} · {port.role} · DN{port.diameterMm ?? '—'}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 12 }}>Connect port B
            <select value={portB} onChange={e => setPortB(e.target.value)} style={{ display: 'block', width: '100%' }}>
              <option value="">Select port</option>
              {waterCad.components.flatMap(item => getWaterPorts(item)).map(port => <option key={port.id} value={port.id}>{port.id} · {port.role}</option>)}
            </select>
          </label>
          <button className="secondary-button" style={{ alignSelf: 'end' }} disabled={!portA || !portB} onClick={() => { try { setWaterCad(current => connectWaterPorts(current, portA, portB, 0.05)); setPortA(''); setPortB(''); setMessage('Network ports connected within 0.05 m tolerance.'); } catch(error) { setMessage(error instanceof Error ? error.message : 'Port connection failed.'); } }}>Connect ports</button>
        </div>
        <p className="muted" style={{ fontSize: 11, margin: '5px 0' }}>Direct port connection tolerance: 50 mm. Port coordinates are not moved automatically. Existing connections remain in the project document.</p>
        {selectedWaterComponent?.kind === 'pipe' && <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <strong style={{ fontSize: 13 }}>Longitudinal profile · {selectedWaterComponent.id}</strong>
          <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse', marginTop: 6 }}>
            <thead><tr>{['Chainage (m)','Ground RL (m)','Invert RL (m)','Crown RL (m)','Cover (m)'].map(label => <th key={label} style={{ textAlign: 'right', padding: 5 }}>{label}</th>)}</tr></thead>
            <tbody>{(terrainGrid && waterCad.horizontalCrs===terrainGrid.crs && waterCad.horizontalUnits==='m' ? buildTerrainAwarePipeProfile(selectedWaterComponent,terrainGrid,terrainProfileSpacingM) : buildPipeLongitudinalProfile(selectedWaterComponent)).map((point, index) => <tr key={index}>{[point.chainageM, point.groundLevelM, point.invertLevelM, point.crownLevelM, point.coverDepthM].map((value, i) => <td key={i} style={{ textAlign: 'right', padding: 5 }}>{value === null ? '—' : value.toFixed(3)}</td>)}</tr>)}</tbody>
          </table>
          <p className="muted" style={{ fontSize: 11 }}>{terrainGrid && waterCad.horizontalCrs===terrainGrid.crs && waterCad.horizontalUnits==='m' ? 'Ground RL is sampled from the aligned terrain grid at the selected spacing. Invert levels are interpolated between the specified pipe endpoint inverts.' : 'Without a CRS-aligned terrain grid, ground and invert values use only entered endpoint levels; unsurveyed intermediate ground is not inferred.'}</p>
        </div>}
        <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <strong style={{ fontSize: 13 }}>Preliminary material and fitting schedule</strong>
          <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse', marginTop: 6 }}>
            <thead><tr><th style={{ textAlign: 'left', padding: 5 }}>Description</th><th style={{ textAlign: 'right', padding: 5 }}>Unit</th><th style={{ textAlign: 'right', padding: 5 }}>Quantity</th></tr></thead>
            <tbody>{buildPreliminaryBoq(waterCad).map((row, index) => <tr key={row.code + index}><td style={{ padding: 5 }}>{row.description}</td><td style={{ textAlign: 'right', padding: 5 }}>{row.unit}</td><td style={{ textAlign: 'right', padding: 5 }}>{row.quantity.toFixed(2)}</td></tr>)}</tbody>
          </table>
          <p className="muted" style={{ fontSize: 11 }}>Excavation is a preliminary rectangular trench estimate using 0.6 m width × 1.2 m depth. It excludes bedding, shoring, fittings allowances, dewatering, reinstatement and wastage.</p>
        </div>
        <div style={{ borderTop: '1px solid #d8e1df', marginTop: 14, paddingTop: 12 }}>
          <span className="eyebrow muted">TERRAIN + EPANET INTEGRATION</span>
          <h4 style={{ margin: '5px 0' }}>Elevation-aware network and hydraulic results</h4>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            <button className="secondary-button" onClick={() => terrainFileRef.current?.click()}>Import terrain grid JSON</button>
            <button className="secondary-button" onClick={() => downloadWaterFile('rayanaqua-terrain-grid-template.json',JSON.stringify({width:3,height:3,originX:0,originY:0,cellSizeX:10,cellSizeY:10,elevationsM:[100,101,102,99,100,101,98,99,100],crs:'LOCAL_METRIC',verticalDatum:'Project datum'},null,2),'application/json')}>Download terrain JSON template</button>
            <button className="secondary-button" onClick={() => {setEpanetImportMode('replace');epanetFileRef.current?.click();}}>Import EPANET INP (replace)</button>
            <button className="secondary-button" onClick={() => {setEpanetImportMode('merge');epanetFileRef.current?.click();}}>Merge EPANET back (preserve CAD)</button>
            <button className="secondary-button" onClick={downloadEpanetInput}>Export CAD → EPANET INP</button>
            <button className="primary-button" onClick={() => {if(!onSendToEpanet){setMessage('Project EPANET handoff is unavailable.');return;}const exported=exportWaterNetworkToEpanet(waterCad);if(exported.warnings.some(w=>w.startsWith('EPANET ID collision')||w.startsWith('EPANET node ID collision'))){setMessage('CAD-to-EPANET transfer blocked: resolve duplicate EPANET IDs first. '+exported.warnings.join(' '));return;}if(exported.warnings.length&&!window.confirm('The CAD network has '+exported.warnings.length+' export warning(s). Some objects may not transfer. Continue to EPANET?\n\n'+exported.warnings.slice(0,8).join('\n')))return;onSendToEpanet(exported.input,exported.idMap);setMessage('CAD network sent to the project EPANET editor. Review the imported network and save it to synchronize hydraulic results back to CAD/GIS.');}}>Send CAD network to EPANET</button>
            <button className="primary-button" onClick={runProjectHydraulics} disabled={simulationBusy || !waterCad.components.length}>{simulationBusy ? 'Running EPANET…' : 'Run EPANET simulation'}</button>
            <button className="secondary-button" onClick={() => hydraulicResultsFileRef.current?.click()}>Import hydraulic results JSON</button>
            <button className="secondary-button" onClick={() => { const issues = buildTerrainIssues(waterCad); setMessage('Terrain check: ' + issues.length + ' issue(s). ' + issues.slice(0,5).map(issue => issue.componentId + ': ' + issue.message).join(' ')); }}>Check terrain cover</button>
          </div>
          <p className="muted" style={{ fontSize: 11, margin: '6px 0' }}>Terrain JSON requires width, height, originX/Y, cellSizeX/Y, row-major elevationsM (origin is the first sample; rows advance +Y), crs and verticalDatum. Values must be metres in the same projected CRS and vertical datum as this water network. {terrainGrid ? 'Terrain loaded · '+terrainGrid.width+' × '+terrainGrid.height+' · '+terrainGrid.crs+' · datum '+terrainGrid.verticalDatum : 'No terrain surface loaded. Import a regular-grid elevation JSON in project metres.'} {hydraulicResults ? ' · Hydraulic results at '+hydraulicResults.timeSeconds+' s' : ' · No hydraulic results loaded.'}</p>
          <p className="muted" style={{fontSize:11}}>{waterCad.components.filter(component=>component.kind==='pipe'&&component.geometry.some(point=>!Number.isFinite(point.z)||!Number.isFinite(point.invertLevelM))).length} pipe(s) still lack full surveyed/terrain-derived centreline and invert levels. They are schematic at baseline in 3D; EPANET node elevations are not substituted for pipe inverts.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end', marginTop: 8 }}>
            <label style={{ fontSize: 12 }}>Simulation duration (hours)<input type="number" min="0" step="1" value={(waterCad.epanetTimes?.durationSeconds??0)/3600} onChange={e=>setWaterCad(current=>({...current,epanetTimes:{...current.epanetTimes,durationSeconds:Math.max(0,Number(e.target.value))*3600}}))} style={{display:'block',width:110}} /></label>
            <label style={{ fontSize: 12 }}>Hydraulic step (minutes)<input type="number" min="1" step="1" value={(waterCad.epanetTimes?.hydraulicStepSeconds??3600)/60} onChange={e=>setWaterCad(current=>({...current,epanetTimes:{...current.epanetTimes,hydraulicStepSeconds:Math.max(60,Number(e.target.value)*60)}}))} style={{display:'block',width:110}} /></label>
            <label style={{ fontSize: 12 }}>Headloss formula<select value={waterCad.epanetHeadlossFormula??'H-W'} onChange={e=>setWaterCad(current=>({...current,epanetHeadlossFormula:e.target.value as WaterCadDocument['epanetHeadlossFormula']}))} style={{display:'block'}}><option value="H-W">Hazen-Williams</option><option value="D-W">Darcy-Weisbach</option><option value="C-M">Chezy-Manning</option></select></label>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end', marginTop: 8 }}>
            <label style={{ fontSize: 12 }}>Target crown cover (m)<input type="number" min="0" step="0.05" value={terrainCoverM} onChange={e => setTerrainCoverM(Number(e.target.value))} style={{ display: 'block', width: 100 }}/></label>
            <label style={{ fontSize: 12 }}>Profile sample spacing (m)<input type="number" min="0.1" step="0.5" value={terrainProfileSpacingM} onChange={e => setTerrainProfileSpacingM(Number(e.target.value))} style={{ display: 'block', width: 100 }}/></label>
            <button className="primary-button" onClick={applyTerrainToSelectedPipe} disabled={!terrainGrid || selectedWaterComponent?.kind !== 'pipe'}>Route selected pipe to cover</button>
            <label style={{ fontSize: 12 }}>Drawing overlay<select value={hydraulicMetric} onChange={e => changeHydraulicMetric(e.target.value as HydraulicOverlayMetric)} style={{ display: 'block' }}><option value="pressureM">Node pressure (m)</option><option value="flowLps">Link flow (L/s)</option><option value="velocityMs">Velocity (m/s)</option><option value="headlossM">Headloss (m)</option></select></label>
          </div>
          {hydraulicReport && <button className="secondary-button" onClick={() => downloadWaterFile('RayanAqua-EPANET-report.rpt',hydraulicReport,'text/plain')}>Download EPANET report</button>}
          {hydraulicResultSeries.length>1 && <label style={{ fontSize: 12, display: 'block', marginTop: 8 }}>Simulation timestep
            <select value={hydraulicTimeIndex} onChange={e=>selectHydraulicTime(Number(e.target.value))} style={{ display: 'block' }}>
              {hydraulicResultSeries.map((result,index)=><option key={result.timeSeconds+'-'+index} value={index}>{result.timeSeconds} seconds</option>)}
            </select>
          </label>}
          {hydraulicOverlay && <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <strong style={{ fontSize: 12 }}>Hydraulic overlay · {hydraulicOverlay.metric} · t={hydraulicOverlay.timeSeconds}s · range {hydraulicOverlay.min?.toFixed(2) ?? '—'} to {hydraulicOverlay.max?.toFixed(2) ?? '—'}</strong>
            <table style={{ width: '100%', fontSize: 11 }}><thead><tr><th align="left">Network ID</th><th align="right">Value</th><th align="left">Status</th></tr></thead><tbody>{hydraulicOverlay.items.map(item => <tr key={item.componentId}><td>{item.componentId}</td><td align="right">{item.label}</td><td style={{ color: item.colour }}>{item.severity}</td></tr>)}</tbody></table>
            <p className="muted" style={{ fontSize: 10 }}>Simulation is run locally by the bundled OWA-EPANET engine. Colours are applied to matching network components in the 2D and 3D drawings. Imported results JSON is also supported.</p>
          </div>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 8, marginTop: 10 }}>
        <label style={{ display: 'block', fontSize: 12 }}>Project horizontal CRS (declare only if verified)
          <input value={waterCad.horizontalCrs || ''} onChange={e => setWaterCad(current => ({ ...current, horizontalCrs: e.target.value.trim() }))} placeholder="e.g. EPSG:32737 or LOCAL_METRIC" style={{ display: 'block', width: '100%' }} />
          <span className="muted">Do not assign an EPSG code unless the stored coordinates already use it; no CRS transformation is performed here.</span>
        </label>
        <label style={{ display: 'block', fontSize: 12 }}>Horizontal coordinate units
          <select value={waterCad.horizontalUnits || 'unknown'} onChange={e => setWaterCad(current => ({ ...current, horizontalUnits: e.target.value as WaterCadDocument['horizontalUnits'] }))} style={{ display: 'block', width: '100%' }}><option value="m">Metres</option><option value="ft">Feet</option><option value="unknown">Unknown / unreferenced</option></select>
        </label>
        <label style={{ display: 'block', fontSize: 12 }}>Project vertical datum / level reference
          <input value={waterCad.verticalDatum} onChange={e => setWaterCad(current => ({ ...current, verticalDatum: e.target.value }))} style={{ display: 'block', width: '100%' }} />
          <span className="muted">Must match the terrain datum; no vertical datum transformation is performed.</span>
        </label>
        </div>
        {terrainGrid && <p className="muted" style={{fontSize:11}}>Terrain CRS: {terrainGrid.crs}. {waterCad.horizontalCrs===terrainGrid.crs && waterCad.horizontalUnits==='m' && waterCad.verticalDatum===terrainGrid.verticalDatum ? 'Horizontal CRS, metre units and vertical datum match.' : 'CRS, units or vertical datum do not match; terrain routing and co-registered 3D terrain are disabled until coordinates and levels are properly transformed.'}</p>}
      </div>
        </div>}
        </div>
        <div className="aquacad-quickbar"><span>Model: {view.toUpperCase()}</span><span>{shapes.length} entities · {counts.routes} routes · {counts.structures} structures · {counts.circles} circular items</span><span>{waterCad.components.length} water objects</span><span>{units}</span><span>{snapEnabled?'OSNAP ON':'OSNAP OFF'}</span></div>

      </div>


      <div className="aquacad-document-tabs" role="tablist" aria-label="Open drawings">
        <button className="aquacad-document-tab active" role="tab" aria-selected="true">▧ {projectId ? 'Current project drawing' : 'Untitled drawing'} <span>×</span></button>
        <button className="aquacad-document-add" type="button" title="New drawing" onClick={()=>{setShapes([]);setSelectedShapeIds([]);setDraft([]);setMessage('New drawing started.');}}>＋</button>
      </div>

      {view === '2d' ? (
        <div className="panel aquacad-canvas-layout" style={{ padding: 12 }}>
          <div className="aquacad-dock aquacad-left-dock">
            <div className="aquacad-dock-heading">Properties</div>
            <div className="aquacad-property-list">
              <div><span>Selection</span><strong>{selectedShape ? selectedShape.type.toUpperCase() : selectedWaterComponent ? selectedWaterComponent.kind.toUpperCase() : 'None'}</strong></div>
              <div><span>Layer</span><strong>{selectedShape?.layer || layer}</strong></div>
              {selectedShape && <><div><span>Entity ID</span><strong>{selectedShape.id.slice(0,10)}</strong></div><div><span>Vertices</span><strong>{selectedShape.points.length}</strong></div></>}
              {selectedWaterComponent && <><div><span>Network ID</span><strong>{selectedWaterComponent.id}</strong></div><div><span>Type</span><strong>{selectedWaterComponent.kind}</strong></div></>}
              {!selectedShape && !selectedWaterComponent && <p>Select a drawing entity or water-network object to inspect its properties.</p>}
            </div>
            {selectedShape && <div className="aquacad-property-editor" style={{display:'grid',gap:7,marginTop:10}}>
              <div className="aquacad-dock-heading">Selected entity · {selectedShape.type.toUpperCase()}</div>
              <button className="secondary-button" onClick={deleteSelectedShape}>Delete selected</button>
              <label>Layer <input value={selectedShape.layer} onChange={e=>updateSelected({layer:e.target.value})}/></label>
              {selectedShape.points.map((point,index)=><div key={index} style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
                <label>Point {index+1} X <input type="number" step="any" value={point.x} onChange={e=>updateSelected({points:selectedShape.points.map((p,i)=>i===index?{...p,x:Number(e.target.value)}:p)})}/></label>
                <label>Y <input type="number" step="any" value={point.y} onChange={e=>updateSelected({points:selectedShape.points.map((p,i)=>i===index?{...p,y:Number(e.target.value)}:p)})}/></label>
              </div>)}
              {selectedShape.type==='circle' && <label>Radius <input type="number" min="0.001" step="any" value={selectedShape.radius||1} onChange={e=>updateSelected({radius:Number(e.target.value)})}/></label>}
              <small>{selectedMetrics}</small>
              {selectedShape.type==='line' && <button className="secondary-button" onClick={calibrateSelectedLine}>Calibrate scale from this line</button>}
            </div>}
            <div className="aquacad-dock-heading">Layers</div>
            <div className="aquacad-layer-list">
              {drafting.layers.map(item=><button key={item.name} className={layer===item.name?'active':''} onClick={()=>setLayer(item.name)}><span className="aquacad-layer-swatch" style={{background:item.color}}/>{item.name}<small>{item.locked?'LOCKED':item.visible?'ON':'OFF'}</small></button>)}
            </div>
          </div>
          <div className="aquacad-drawing-stage">
<svg
            ref={svgRef}
            tabIndex={0}
            role="application"
            aria-label="AquaCAD drawing canvas. Use Control or Command Z to undo, Shift Control or Command Z to redo, and Escape to cancel the active draft."
            viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
            onClick={handleCanvasClick}
            onDoubleClick={() => { if (mode === 'polyline' && draft.length > 1) finishPolyline(false); }}
            onKeyDown={event => {
              const target = event.target as HTMLElement;
              if (target.closest('input,textarea,select,button,[contenteditable="true"]')) return;
              const key = event.key.toLowerCase();
              if ((event.ctrlKey || event.metaKey) && key === 'z') {
                event.preventDefault();
                setHistory(current => event.shiftKey ? redoHistory(current) : undoHistory(current));
              } else if ((event.ctrlKey || event.metaKey) && key === 'y') {
                event.preventDefault();
                setHistory(current => redoHistory(current));
              } else if (key === 'delete' || key === 'backspace') {
                event.preventDefault();
                deleteSelectedShape();
              } else if (key === 'enter' && mode === 'polyline' && draft.length > 1) {
                event.preventDefault();
                finishPolyline(false);
              } else if (key === 'escape') {
                event.preventDefault();
                setDraft([]);
                setWaterDraft([]);
                setAnnotationDraft([]);
                setPreviewShapes(null);
                setDraftTool('none');
                setActiveWaterTool(null);
                setLibraryPlacementActive(false);
                setMode('select');
                setMessage('Active CAD command cancelled.');
              }
            }}
            onWheel={event => {
              event.preventDefault();
              const anchor = toSvgPoint(event.currentTarget, event.clientX, event.clientY);
              const factor = Math.exp(event.deltaY * 0.001);
              setViewBox(current => {
                const nextWidth = Math.max(5, Math.min(20000, current.width * factor));
                const nextHeight = nextWidth * current.height / current.width;
                const rx = (anchor.x - current.x) / current.width;
                const ry = (anchor.y - current.y) / current.height;
                return { x: anchor.x - rx * nextWidth, y: anchor.y - ry * nextHeight, width: nextWidth, height: nextHeight };
              });
            }}
            onPointerDown={event => {
              if (!panMode && mode==='select' && event.button===0 && !(event.target as SVGElement).closest('[data-shape-id]')) {
                const start=toSvgPoint(event.currentTarget,event.clientX,event.clientY);
                selectionRef.current={pointerId:event.pointerId,start,current:start};
                event.currentTarget.setPointerCapture(event.pointerId);
                setSelectionBox({start,end:start});
                return;
              }
              if (panMode || event.button === 1) {
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                panRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, viewBox };
              }
            }}
            onPointerUp={event => {
              if (panRef.current?.pointerId === event.pointerId) {
                panRef.current = null;
                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
              }
              if (selectionRef.current?.pointerId === event.pointerId) {
                const end = selectionRef.current.current;
                const start = selectionRef.current.start;
                setLastSelectionWindow({minX:Math.min(start.x,end.x),minY:Math.min(start.y,end.y),maxX:Math.max(start.x,end.x),maxY:Math.max(start.y,end.y)});
                if (Math.hypot(end.x-start.x,end.y-start.y)>2) suppressSelectionClick.current=true;
                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                const left=Math.min(start.x,end.x), right=Math.max(start.x,end.x), top=Math.min(start.y,end.y), bottom=Math.max(start.y,end.y);
                const crossing=end.x<start.x;
                const hits=selectEntitiesInWindow(visibleShapes,{minX:left,minY:top,maxX:right,maxY:bottom},crossing).map(shape=>shape.id);
                setSelectedShapeIds(hits); setSelectedShapeId(hits[0]||''); setMessage(`${hits.length} entities ${crossing?'crossing':'inside'}-selected.`);
                selectionRef.current=null; setSelectionBox(null);
              }
            }}
            onPointerCancel={() => { panRef.current = null; selectionRef.current=null; setSelectionBox(null); }}
            onPointerMove={handlePointerMove}
            onPointerLeave={handlePointerLeave}
            style={{
              width: '100%',
              height: 'min(62vh, 650px)',
              minHeight: 340,
              backgroundColor: '#1e252b',
              border: '1px solid #46515b',
              borderRadius: 8,
              cursor: panMode ? 'grab' : (mode !== 'select' || draftTool !== 'none') ? 'crosshair' : 'default',
              touchAction: 'none',
            }}
          >
            <defs><pattern id="cad-grid" width={gridSize} height={gridSize} patternUnits="userSpaceOnUse"><path d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`} fill="none" stroke="#35414b" strokeWidth={Math.max(viewBox.width / 1000, 0.2)} /></pattern></defs>
            <rect x={viewBox.x} y={viewBox.y} width={viewBox.width} height={viewBox.height} fill="url(#cad-grid)" pointerEvents="none" />
            {renderedShapes}
            {selectedShapes.map(shape => <g key={'grips-'+shape.id} pointerEvents="none">
              {shape.type === 'circle' ? <>
                <circle cx={shape.points[0].x} cy={shape.points[0].y} r="4" fill="#ffffff" stroke="#176b9a" strokeWidth="1.5"/>
                <circle cx={shape.points[0].x+(shape.radius||12)} cy={shape.points[0].y} r="4" fill="#ffffff" stroke="#176b9a" strokeWidth="1.5"/>
              </> : shape.type === 'rect' ? (() => { const [a,b]=shape.points; return [a,{x:b.x,y:a.y},b,{x:a.x,y:b.y}].map((point,index)=><rect key={index} x={point.x-3.5} y={point.y-3.5} width="7" height="7" fill="#ffffff" stroke="#176b9a" strokeWidth="1.5"/>); })() : shape.points.map((point,index)=><rect key={index} x={point.x-3.5} y={point.y-3.5} width="7" height="7" fill="#ffffff" stroke="#176b9a" strokeWidth="1.5"/>)}
            </g>)}
            {renderedWaterComponents}
            {renderedAnnotations}
            {waterDraft.length>0 && <polyline points={waterDraft.map(p=>p.x+','+p.y).join(' ')} fill="none" stroke="#d59b42" strokeWidth="3" strokeDasharray="6 4" pointerEvents="none"/>}
            {selectionBox && <rect x={Math.min(selectionBox.start.x,selectionBox.end.x)} y={Math.min(selectionBox.start.y,selectionBox.end.y)} width={Math.abs(selectionBox.end.x-selectionBox.start.x)} height={Math.abs(selectionBox.end.y-selectionBox.start.y)} fill={selectionBox.end.x<selectionBox.start.x?'rgba(30,130,190,.12)':'rgba(20,150,110,.12)'} stroke={selectionBox.end.x<selectionBox.start.x?'#2684c7':'#15966e'} strokeDasharray="6 4" pointerEvents="none" />}
            {previewShapes && previewShapes.map(shape => shape.type==='circle' ? <circle key={'preview-'+shape.id} cx={shape.points[0].x} cy={shape.points[0].y} r={shape.radius||12} fill="none" stroke="#d59b42" strokeWidth="2" strokeDasharray="5 4" pointerEvents="none"/> : shape.type==='polyline' ? <path key={'preview-'+shape.id} d={polylineSvgPath(shape)} fill="none" stroke="#d59b42" strokeWidth="2" strokeDasharray="5 4" pointerEvents="none"/> : <polyline key={'preview-'+shape.id} points={(shape.type==='rect'?[shape.points[0],{x:shape.points[1].x,y:shape.points[0].y},shape.points[1],{x:shape.points[0].x,y:shape.points[1].y},shape.points[0]]:shape.points).map(p=>p.x+','+p.y).join(' ')} fill="none" stroke="#d59b42" strokeWidth="2" strokeDasharray="5 4" pointerEvents="none"/>)}
            {draft.map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="5" fill="#d59b42" />)}
            {draft.length > 1 && <polyline points={draft.map(point => point.x + ',' + point.y).join(' ')} fill="none" stroke="#d59b42" strokeDasharray="7 5" />}
            {cursorPoint && mode !== 'select' && (
              <g pointerEvents="none">
                {snapMarker
                  ? <><circle cx={cursorPoint.x} cy={cursorPoint.y} r="8" fill="none" stroke="#d04d3f" strokeWidth="2" /><path d={`M ${cursorPoint.x - 12} ${cursorPoint.y} L ${cursorPoint.x + 12} ${cursorPoint.y} M ${cursorPoint.x} ${cursorPoint.y - 12} L ${cursorPoint.x} ${cursorPoint.y + 12}`} stroke="#d04d3f" strokeWidth="1.5" /></>
                  : <circle cx={cursorPoint.x} cy={cursorPoint.y} r="3" fill="#d59b42" />}
              </g>
            )}
          </svg>
          </div>
          <div className="aquacad-dock aquacad-right-dock">
            <div className="aquacad-dock-heading">Project Explorer</div>
            <div className="aquacad-project-tree">
              <div className="aquacad-project-root">▾ Current drawing</div>
              <button onClick={()=>setSelectedShapeIds([])}>CAD entities <small>{shapes.length}</small></button>
              <button onClick={()=>setMessage('Water network components in this project')}>Water network <small>{waterCad.components.length}</small></button>
              <div className="aquacad-project-root">▾ Network objects</div>
              {waterCad.components.slice(0,80).map(component=><button key={component.id} className={selectedWaterId===component.id?'active':''} onClick={()=>setSelectedWaterId(component.id)}><span>{component.kind}</span><small>{component.id}</small></button>)}
              {waterCad.components.length===0 && <p>No water components yet. Use the Water Network ribbon to add equipment.</p>}
            </div>
          </div>

        </div>
      ) : (
        <div className="panel" style={{ padding: 12 }}>
          <strong>Interactive 3D model viewport</strong>
          <span className="muted" style={{ fontSize: 12 }}> Drag to orbit · scroll/pinch to zoom</span>
          <div ref={hostRef} style={{ width: '100%', height: 'min(65vh, 620px)', minHeight: 350, marginTop: 10, borderRadius: 8, overflow: 'hidden' }} />
          <p className="muted" style={{ fontSize: 12 }}>
            {waterCad.horizontalUnits==='unknown'
              ? 'Plan coordinates are unreferenced and their horizontal scale is provisional; terrain alignment is disabled until units and CRS are verified.'
              : terrainGrid && waterCad.horizontalUnits==='m' && waterCad.horizontalCrs===terrainGrid.crs && waterCad.verticalDatum===terrainGrid.verticalDatum
                ? 'Terrain surface is co-registered to the project CRS and vertical datum. Pipe routes use stored Z/invert levels or connected node elevations; EPANET node elevations are not surveyed pipe inverts.'
                : '3D engineering visualization uses the project coordinate units and available Z/invert or hydraulic node elevations. Import and align terrain to generate surveyed ground profiles; unverified elevations must not be used for construction.'}
            {' '}This is not structural analysis or a full BIM model.
          </p>
        </div>
      )}

      {message && <div className="alert">{message}</div>}
      <div className="aquacad-commandbar">
        <div className="aquacad-status-controls">
          <span className="aquacad-status-label">MODEL</span><strong>{view.toUpperCase()}</strong>
          <span className="aquacad-status-separator" />
          <button className={snapEnabled ? 'is-on' : ''} onClick={() => setSnapEnabled(v => !v)} title="Toggle object snaps">OSNAP {snapEnabled ? 'ON' : 'OFF'}</button>
          <button className={gridSnapEnabled ? 'is-on' : ''} onClick={() => setGridSnapEnabled(v => !v)} title="Toggle grid snap">GRID {gridSnapEnabled ? 'ON' : 'OFF'}</button>
          <button className={orthoEnabled ? 'is-on' : ''} onClick={() => setOrthoEnabled(v => !v)} title="Toggle orthographic drawing">ORTHO {orthoEnabled ? 'ON' : 'OFF'}</button>
          <button className={polarEnabled ? 'is-on' : ''} onClick={() => setPolarEnabled(v => !v)} title="Toggle polar tracking">POLAR {polarEnabled ? 'ON' : 'OFF'}</button>
          <label className="aquacad-status-setting">STEP <input type="number" min="0.1" step="any" value={gridSize} onChange={event => setGridSize(Math.max(0.1, Number(event.target.value) || 10))}/></label>
          <label className="aquacad-status-setting">ANGLE <select value={polarIncrement} onChange={event => setPolarIncrement(Number(event.target.value))}><option value={5}>5°</option><option value={10}>10°</option><option value={15}>15°</option><option value={22.5}>22.5°</option><option value={30}>30°</option><option value={45}>45°</option><option value={90}>90°</option></select></label>
          <label className="aquacad-status-setting">UNITS <select value={units} disabled={!calibratedMetresPerUnit} onChange={event => setUnits(event.target.value)}><option value="m">m</option><option value="mm">mm</option></select></label>
          <span className="aquacad-status-count">{shapes.length} ENTITIES</span>
        </div>
        <div className="aquacad-command-history">{message || (snapMarker && mode !== 'select' ? 'Snap: ' + snapMarker.kind : 'Command ready. Select a ribbon tool or enter a command.')}</div>
        <form className="aquacad-command-input" onSubmit={event => {
          event.preventDefault();
          const cmd = commandLine.trim().toLowerCase();
          if (['l','line'].includes(cmd)) { setMode('line'); setDraft([]); setMessage('LINE: specify first point in drawing.'); }
          else if (['pl','pline','polyline'].includes(cmd)) { setMode('polyline'); setDraft([]); setMessage('PLINE: specify first point in drawing.'); }
          else if (['c','circle'].includes(cmd)) { setMode('circle'); setDraft([]); setMessage('CIRCLE: choose construction method, then specify its points.'); }
          else if (['el','ellipse'].includes(cmd)) { setMode('ellipse'); setDraft([]); setMessage('ELLIPSE: specify opposite bounding corners.'); }
          else if (['a','arc'].includes(cmd)) { setMode('arc'); setDraft([]); setMessage('ARC: choose 3-point or centre-start-angle construction.'); }
          else if (['rec','rect','rectangle'].includes(cmd)) { setMode('rect'); setDraft([]); setMessage('RECTANGLE: specify first corner.'); }
          else if (['e','erase','delete'].includes(cmd)) { deleteSelectedShape(); }
          else if (cmd === 'u' || cmd === 'undo') { setHistory(current => undoHistory(current)); }
          else if (cmd === 'redo') { setHistory(current => redoHistory(current)); }
          else if (['z','zoom'].includes(cmd)) { setViewBox({x:0,y:0,width:WIDTH,height:HEIGHT}); }
          else if (['osnap','snap'].includes(cmd)) { setSnapEnabled(v => !v); }
          else if (cmd === 'ortho') { setOrthoEnabled(v => !v); }
          else if (cmd === 'grid') { setGridSnapEnabled(v => !v); }
          else if (cmd === 'save') { saveDrawing(); }
          else if (cmd === 'help' || cmd === '?') { setMessage('Commands: LINE (L), PLINE (PL), CIRCLE (C), ELLIPSE (EL), ARC (A), RECTANGLE (REC), ERASE (E), UNDO (U), REDO, ZOOM (Z), OSNAP, ORTHO, GRID, SAVE.'); }
          else if (cmd) { setMessage('Unknown command: ' + commandLine + '. Type HELP for available commands.'); }
          setCommandLine('');
        }}>
          <span>⌕</span><input value={commandLine} onChange={event => setCommandLine(event.target.value)} placeholder="Search commands or type a command… (HELP)" aria-label="Search or enter CAD command"/><kbd>↵</kbd>
        </form>
      </div>
    </div>
  );
}
