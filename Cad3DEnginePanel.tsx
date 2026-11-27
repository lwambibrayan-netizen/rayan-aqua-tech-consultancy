import { useEffect, useMemo, useRef, useState } from 'react';
import { createHistory, pushHistory, undoHistory, redoHistory } from './cad-geometry';
import { moveEntities, copyEntities, rotateEntities, mirrorEntities, stretchEntities, rectangularArray, trimLine, extendLine, offsetLine, offsetPolyline, selectEntitiesInWindow, chamferPolylineCorner, filletPolylineCorner } from './cad-editing';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Download, FileUp, Layers3, Save, Crosshair } from 'lucide-react';
import { api } from './client';
import { connectPipeEndpoints, createWaterComponent, component3dLength, componentPlanLength, type WaterCadComponent, type WaterCadDocument, type WaterComponentKind } from './water-cad';
import { createDraftingDocument, makeLinearDimension, measureDimension, formatDimension, sheetDimensionsMm, validateDraftingDocument, type DraftingDocument, type DraftAnnotation } from './cad-drafting';
import { exportDraftingDxf, importDraftingDxf } from './cad-dxf';
import { buildBendCentreline, buildPipeLongitudinalProfile, buildPreliminaryBoq, buildReducerCentreline, buildTeeCentreline, connectWaterPorts, exportWaterNetworkToEpanet, getWaterPorts, validateWaterNetworkTopology } from './water-network-engineering';

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

function findSnap(svg: SVGSVGElement, cursor: Point2D, shapes: Shape[], enabled: boolean): SnapPoint | null {
  if (!enabled) return null;
  let best: SnapPoint | null = null;
  const candidates = getSnapCandidates(shapes, cursor);
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

export default function Cad3DEnginePanel({ projectId, initialData, gisFeatures = [], onSave }: Props) {
  const [history, setHistory] = useState(() => createHistory<Shape[]>(initialData?.shapes || []));
  const [waterCad, setWaterCad] = useState<WaterCadDocument>(() => initialData?.waterCad || { schemaVersion: 1, units: 'm', verticalDatum: 'Project datum - confirm before design', components: [] });
  const [drafting, setDrafting] = useState<DraftingDocument>(() => createDraftingDocument(initialData?.drafting));
  const [draftTool, setDraftTool] = useState<'none' | 'dimension' | 'text' | 'leader'>('none');
  const [annotationDraft, setAnnotationDraft] = useState<Point2D[]>([]);
  const [annotationText, setAnnotationText] = useState('');
  const [dimensionOffset, setDimensionOffset] = useState(2);
  const [dimensionPrecision, setDimensionPrecision] = useState(3);
  const [newLayerName, setNewLayerName] = useState('');
  const [selectedWaterId, setSelectedWaterId] = useState('');
  const [activeWaterTool, setActiveWaterTool] = useState<WaterComponentKind | null>(null);
  const [waterDraft, setWaterDraft] = useState<Point2D[]>([]);
  const [portA, setPortA] = useState('');
  const [portB, setPortB] = useState('');
  const shapes = history.present;
  function setShapes(next: Shape[] | ((current: Shape[]) => Shape[])) {
    setHistory(current => pushHistory(current, typeof next === 'function' ? next(current.present) : next));
  }
  const [mode, setMode] = useState<'select' | 'line' | 'polyline' | 'rect' | 'circle'>('select');
  const [draft, setDraft] = useState<Point2D[]>([]);
  const [view, setView] = useState<'2d' | '3d'>('2d');
  const [layer, setLayer] = useState('WATER_NETWORK');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [units, setUnits] = useState('m');
  const [calibratedMetresPerUnit, setCalibratedMetresPerUnit] = useState<number | null>(
    Number.isFinite(initialData?.calibratedMetresPerUnit) && initialData.calibratedMetresPerUnit > 0
      ? initialData.calibratedMetresPerUnit : null
  );
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [orthoEnabled, setOrthoEnabled] = useState(false);
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
  const [commandAngle, setCommandAngle] = useState(90);
  const [commandEndpoint, setCommandEndpoint] = useState<0|1>(0);
  const [cornerIndex, setCornerIndex] = useState(1);
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

  useEffect(() => {
    setHistory(createHistory<Shape[]>(initialData?.shapes || []));
    setWaterCad(initialData?.waterCad || { schemaVersion: 1, units: 'm', verticalDatum: 'Project datum - confirm before design', components: [] });
    setDrafting(createDraftingDocument(initialData?.drafting));
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

  function resolveDraftPoint(svg: SVGSVGElement, raw: Point2D) {
    const objectSnap = findSnap(svg, raw, shapes, snapEnabled);
    let point = objectSnap?.point || raw;
    if (!objectSnap && gridSnapEnabled && gridSize > 0) {
      point = { x: Math.round(point.x / gridSize) * gridSize, y: Math.round(point.y / gridSize) * gridSize };
    }
    if (orthoEnabled && draft.length) {
      const anchor = draft[draft.length - 1];
      const dx = point.x - anchor.x;
      const dy = point.y - anchor.y;
      point = Math.abs(dx) >= Math.abs(dy) ? { x: point.x, y: anchor.y } : { x: anchor.x, y: point.y };
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
      if (next.length < 2) { setAnnotationDraft(next); setMessage('First point set. Choose the second point.'); return; }
      if (draftTool === 'dimension') {
        try {
          const item = makeLinearDimension(makeId(), next[0], next[1], dimensionOffset * (calibratedMetresPerUnit || 1), 'DIMENSIONS', dimensionPrecision);
          setDrafting(current => ({ ...current, annotations: [...current.annotations, item] }));
          setMessage('Aligned dimension placed.'); 
        } catch (error) { setMessage(error instanceof Error ? error.message : 'Dimension could not be placed.'); }
      } else {
        const item: DraftAnnotation = { id: makeId(), kind: 'leader', layer: 'ANNOTATION', points: next, text: annotationText || 'Note', textHeightMm: 2.5 };
        setDrafting(current => ({ ...current, annotations: [...current.annotations, item] }));
        setMessage('Leader annotation placed.');
      }
      setDraftTool('none'); setAnnotationDraft([]); return;
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
    const raw = toSvgPoint(event.currentTarget, event.clientX, event.clientY);
    const resolved = resolveDraftPoint(event.currentTarget, raw);
    const snapped = resolved.snapped;
    const point = resolved.point;

    if (mode === 'circle') {
      setShapes(current => [...current, {
        id: makeId(), type: 'circle', points: [point], radius: 12, layer,
      }]);
      setMode('select');
      setMessage('Circle created. Endpoint and centre snapping are available when drawing connected geometry.');
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

  function finishPolyline() {
    if (draft.length > 1) {
      setShapes(current => [...current, { id: makeId(), type: 'polyline', points: draft, layer }]);
    }
    setDraft([]);
    setMode('select');
    setMessage('Polyline finished.');
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
        const imported = importDraftingDxf(text, calibratedMetresPerUnit || 1);
        setShapes(current => [...current, ...imported.shapes]);
        setDrafting(current => {
          const known = new Set(current.layers.map(item => item.name.toUpperCase()));
          const added = imported.layerNames.filter(name => !known.has(name.toUpperCase())).map(name => ({ name, color: '#666666', lineType: 'CONTINUOUS' as const, lineWeightMm: 0.18, visible: true, locked: false, plot: true }));
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
    setMessage(kind === 'pipe' ? 'Click the pipe start and end points. Object snapping is active.' : 'Click the placement point for the ' + kind + '. Object snapping is active.');
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

  function previewDrawing(next: Shape[], label: string) {
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
    if (!selectedShape) return;
    if (!window.confirm('Delete the selected CAD entity?')) return;
    setShapes(rows => rows.filter(shape => shape.id !== selectedShape.id));
    setSelectedShapeId('');
    setMessage('Selected CAD entity deleted.');
  }

  async function saveDrawing() {
    setBusy(true);
    try {
      await onSave({
        shapes,
        waterCad,
        drafting,
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
    setMessage(result.warnings.length ? 'EPANET INP exported with ' + result.warnings.length + ' warning(s): ' + result.warnings.join(' ') : 'EPANET INP exported. Validate and run it in EPANET before design use.');
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

  function addDraftLayer() {
    const name = newLayerName.trim().toUpperCase().replace(/\\s+/g, '_');
    if (!name) return;
    if (drafting.layers.some(item => item.name.toUpperCase() === name)) { setMessage('That layer already exists.'); return; }
    setDrafting(current => ({ ...current, layers: [...current.layers, { name, color: '#555555', lineType: 'CONTINUOUS', lineWeightMm: 0.18, visible: true, locked: false, plot: true }] }));
    setNewLayerName('');
  }
  function validateDrafting() {
    const issues = validateDraftingDocument(drafting);
    setMessage(issues.length ? 'Drafting check: ' + issues.join(' ') : 'Drafting standards check passed. Check the drawing visually before issue.');
  }
  function removeAnnotation(id: string) {
    setDrafting(current => ({ ...current, annotations: current.annotations.filter(item => item.id !== id) }));
  }
  function exportSheetSvg() {
    const { widthMm, heightMm } = sheetDimensionsMm(drafting.sheet);
    const scale = Number(drafting.sheet.scale.split(':')[1]) || 100;
    const modelWidth = widthMm * scale / 1000 / (calibratedMetresPerUnit || 1);
    const modelHeight = heightMm * scale / 1000 / (calibratedMetresPerUnit || 1);
    const visible = drafting.layers.filter(item => item.visible && item.plot);
    const allowed = new Set(visible.map(item => item.name));
    const drawing = shapes.filter(shape => allowed.has(shape.layer || '0')).map(shape => {
      if (shape.type === 'line') return '<line x1="'+shape.points[0].x+'" y1="'+shape.points[0].y+'" x2="'+shape.points[1].x+'" y2="'+shape.points[1].y+'" stroke="'+(drafting.layers.find(x=>x.name===shape.layer)?.color||'#222')+'"/>';
      if (shape.type === 'circle') return '<circle cx="'+shape.points[0].x+'" cy="'+shape.points[0].y+'" r="'+(shape.radius||1)+'" fill="none" stroke="'+(drafting.layers.find(x=>x.name===shape.layer)?.color||'#222')+'"/>';
      const pts = shape.type === 'rect' ? [shape.points[0],{x:shape.points[1].x,y:shape.points[0].y},shape.points[1],{x:shape.points[0].x,y:shape.points[1].y},shape.points[0]] : shape.points;
      return '<polyline points="'+pts.map(p=>p.x+','+p.y).join(' ')+'" fill="none" stroke="'+(drafting.layers.find(x=>x.name===shape.layer)?.color||'#222')+'"/>';
    }).join('');
    const title = [drafting.sheet.company,drafting.sheet.title,drafting.sheet.drawingNumber,'REV '+drafting.sheet.revision,drafting.sheet.status,drafting.sheet.designer,drafting.sheet.checker,drafting.sheet.date].filter(Boolean).join(' | ');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="'+widthMm+'mm" height="'+heightMm+'mm" viewBox="0 0 '+modelWidth+' '+modelHeight+'"><rect x="0" y="0" width="'+modelWidth+'" height="'+modelHeight+'" fill="white" stroke="black" stroke-width="'+(modelWidth/500)+'"/><g transform="translate(0 '+modelHeight+') scale(1 -1)">'+drawing+'</g><text x="'+(modelWidth*.04)+'" y="'+(modelHeight*.96)+'" font-size="'+(modelHeight*.012)+'">'+title.replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</text></svg>';
    downloadWaterFile((drafting.sheet.drawingNumber||'drawing')+'.svg',svg,'image/svg+xml');
  }

  function downloadDxf() {
    const dxf = exportDraftingDxf(shapes, drafting, calibratedMetresPerUnit || 1);
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
    scene.add(new THREE.GridHelper(1000, 20));
    shapes.forEach(shape => {
      const material = new THREE.MeshStandardMaterial({ color: '#167b78' });
      if (shape.type === 'circle') {
        const radius = Math.max(shape.radius || 4, 2);
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 6, 24), material);
        mesh.position.set(shape.points[0].x - 500, 3, shape.points[0].y - 325);
        scene.add(mesh);
      } else if (shape.type === 'rect') {
        const a = shape.points[0];
        const b = shape.points[1];
        const mesh = new THREE.Mesh(
          new THREE.BoxGeometry(Math.max(1, Math.abs(b.x - a.x)), 8, Math.max(1, Math.abs(b.y - a.y))),
          material
        );
        mesh.position.set((a.x + b.x) / 2 - 500, 4, (a.y + b.y) / 2 - 325);
        scene.add(mesh);
      } else if (shape.points.length > 1) {
        const curve = new THREE.CatmullRomCurve3(
          (shape.type==='polyline'?expandedPolylinePoints(shape):shape.points).map(point => new THREE.Vector3(point.x - 500, 3, point.y - 325))
        );
        scene.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 30, 1.8, 8, false), material));
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
  }, [view, shapes]);

  const formatLength = (drawingUnits: number) => calibratedMetresPerUnit
    ? ((drawingUnits * calibratedMetresPerUnit) * (units === 'mm' ? 1000 : 1)).toFixed(3) + ' ' + units
    : drawingUnits.toFixed(3) + ' drawing units (unscaled)';
  const selectedMetrics = selectedShape ? (() => {
    if (selectedShape.type === 'circle') return 'Diameter: ' + formatLength((selectedShape.radius || 0) * 2);
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
  const layerNames = Array.from(new Set(shapes.map(shape => shape.layer || '0'))).sort();
  const visibleShapes = shapes.filter(shape => !hiddenLayers.includes(shape.layer || '0'));
  const renderedWaterComponents = waterCad.components.map(component => {
    const pts = component.geometry.map(point => ({ x: point.x / (calibratedMetresPerUnit || 1), y: point.y / (calibratedMetresPerUnit || 1) }));
    const p = pts[0] || {x:0,y:0};
    const selected = selectedWaterId === component.id;
    const stroke = selected ? '#d04d3f' : '#087e83';
    const sw = Math.max(viewBox.width / 700, 1.2);
    const projectPoints = (points: {x:number;y:number}[]) => points.map(point => ({ x: point.x / (calibratedMetresPerUnit || 1), y: point.y / (calibratedMetresPerUnit || 1) }));
    if (component.kind === 'bend') {
      const arc = projectPoints(buildBendCentreline(component, 20));
      return <g key={component.id} data-water-id={component.id}><polyline points={arc.map(q => q.x + ',' + q.y).join(' ')} fill="none" stroke={stroke} strokeWidth={sw * 3} /><text x={p.x + 5} y={p.y - 6} fontSize={Math.max(viewBox.width / 90, 8)} fill={stroke}>{component.properties.tag}</text></g>;
    }
    if (component.kind === 'tee') {
      const branches = buildTeeCentreline(component).map(projectPoints);
      return <g key={component.id} data-water-id={component.id} fill="none" stroke={stroke} strokeWidth={sw * 3}><polyline points={branches[0].map(q => q.x + ',' + q.y).join(' ')} /><polyline points={branches[1].map(q => q.x + ',' + q.y).join(' ')} /><circle cx={p.x} cy={p.y} r={sw * 2} fill={stroke} /><text x={p.x + 13 * sw} y={p.y} fill={stroke} stroke="none" fontSize={Math.max(viewBox.width / 90, 8)}>{component.properties.tag}</text></g>;
    }
    if (component.kind === 'reducer') {
      const ends = projectPoints(buildReducerCentreline(component));
      const dx = ends[1].x - ends[0].x, dy = ends[1].y - ends[0].y;
      const length = Math.hypot(dx, dy) || 1, nx = -dy / length, ny = dx / length;
      const d1 = (component.properties.nominalDiameterMm ?? 110) / 1000 / (calibratedMetresPerUnit || 1);
      const d2 = (component.properties.outletDiameterMm ?? 90) / 1000 / (calibratedMetresPerUnit || 1);
      const polygon = [[ends[0].x + nx*d1/2, ends[0].y + ny*d1/2], [ends[1].x + nx*d2/2, ends[1].y + ny*d2/2], [ends[1].x - nx*d2/2, ends[1].y - ny*d2/2], [ends[0].x - nx*d1/2, ends[0].y - ny*d1/2]].map(q => q.join(',')).join(' ');
      return <g key={component.id} data-water-id={component.id}><polygon points={polygon} fill="#e4f4f2" stroke={stroke} strokeWidth={sw * 2} /><text x={p.x + 5} y={p.y - 8} fontSize={Math.max(viewBox.width / 90, 8)} fill={stroke}>{component.properties.tag}</text></g>;
    }
    if (component.kind === 'pipe' && pts.length > 1) return <g key={component.id} data-water-id={component.id}><polyline points={pts.map(q=>q.x+','+q.y).join(' ')} fill="none" stroke={stroke} strokeWidth={sw*3} /><text x={p.x+5} y={p.y-6} fontSize={Math.max(viewBox.width/90,8)} fill={stroke}>{component.properties.tag}</text></g>;
    if (component.kind === 'tank' || component.kind === 'reservoir') return <g key={component.id} data-water-id={component.id}><circle cx={p.x} cy={p.y} r={12*sw} fill="#e4f4f2" stroke={stroke} strokeWidth={sw*2}/><text x={p.x+14*sw} y={p.y} fontSize={Math.max(viewBox.width/90,8)} fill={stroke}>{component.properties.tag}</text></g>;
    if (component.kind === 'pump') return <g key={component.id} data-water-id={component.id}><path d={`M ${p.x-10*sw} ${p.y-9*sw} L ${p.x+10*sw} ${p.y} L ${p.x-10*sw} ${p.y+9*sw} Z`} fill="#e4f4f2" stroke={stroke} strokeWidth={sw*2}/><text x={p.x+14*sw} y={p.y} fontSize={Math.max(viewBox.width/90,8)} fill={stroke}>{component.properties.tag}</text></g>;
    const symbol = component.kind === 'valve' ? <path d={`M ${p.x-9*sw} ${p.y-8*sw} L ${p.x} ${p.y} L ${p.x-9*sw} ${p.y+8*sw} M ${p.x+9*sw} ${p.y-8*sw} L ${p.x} ${p.y} L ${p.x+9*sw} ${p.y+8*sw}`} /> : <rect x={p.x-8*sw} y={p.y-8*sw} width={16*sw} height={16*sw} />;
    return <g key={component.id} data-water-id={component.id} fill="none" stroke={stroke} strokeWidth={sw*2}>{symbol}<text x={p.x+13*sw} y={p.y} fontSize={Math.max(viewBox.width/90,8)} fill={stroke} stroke="none">{component.properties.tag}</text></g>;
  });

  const renderedAnnotations = drafting.annotations.filter(item => drafting.layers.find(l => l.name === item.layer)?.visible !== false).map(item => {
    const layerStyle = drafting.layers.find(l => l.name === item.layer);
    const color = layerStyle?.color || '#202020';
    const scale = Number(drafting.sheet.scale.split(':')[1]) || 100;
    const paperHeight = (mm: number) => mm * scale / 1000 / (calibratedMetresPerUnit || 1);
    const toDrawing = (p: Point2D) => ({ x: p.x / (calibratedMetresPerUnit || 1), y: p.y / (calibratedMetresPerUnit || 1) });
    if (item.kind === 'text') { const at = toDrawing(item.at); return <text key={item.id} x={at.x} y={at.y} fontSize={paperHeight(item.heightMm)} fill={color}>{item.text}</text>; }
    if (item.kind === 'leader') { const pts = item.points.map(toDrawing); const last = pts[pts.length - 1]; return <g key={item.id}><polyline points={pts.map(p => p.x + ',' + p.y).join(' ')} fill='none' stroke={color}/><text x={last.x + paperHeight(1.5)} y={last.y - paperHeight(1)} fontSize={paperHeight(item.textHeightMm)} fill={color}>{item.text}</text></g>; }
    const a = toDrawing(item.a), b = toDrawing(item.b);
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length, ny = dx / length, off = item.offsetM / (calibratedMetresPerUnit || 1);
    const p1 = { x: a.x + nx * off, y: a.y + ny * off }, p2 = { x: b.x + nx * off, y: b.y + ny * off };
    const label = item.textOverride || formatDimension(measureDimension(item), item.precision, drafting.sheet.units);
    const h = paperHeight(2.5), mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    return <g key={item.id} fill='none' stroke={color} strokeWidth={Math.max(viewBox.width / 1800, 0.45)}><line x1={a.x} y1={a.y} x2={p1.x} y2={p1.y}/><line x1={b.x} y1={b.y} x2={p2.x} y2={p2.y}/><line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}/><text x={mid.x} y={mid.y - h * 0.2} textAnchor='middle' fontSize={h} fill={color} stroke='none'>{label}</text></g>;
  });
  const renderedShapes = visibleShapes.map(shape => {
    const color = shape.layer === 'WATER_NETWORK' ? '#167b78' : '#c08c3c';
    if (shape.type === 'circle') {
      return <circle data-shape-id={shape.id} key={shape.id} cx={shape.points[0].x} cy={shape.points[0].y} r={shape.radius || 12} fill="none" stroke={selectedShapeIds.includes(shape.id) ? '#d04d3f' : color} strokeWidth={selectedShapeIds.includes(shape.id) ? 4 : 2.5} />;
    }
    if (shape.type === 'rect') {
      const a = shape.points[0];
      const b = shape.points[1];
      return <rect data-shape-id={shape.id} key={shape.id} x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} fill="none" stroke={selectedShapeIds.includes(shape.id) ? '#d04d3f' : color} strokeWidth={selectedShapeIds.includes(shape.id) ? 4 : 2.5} />;
    }
    if (shape.type === 'line') {
      return <line data-shape-id={shape.id} key={shape.id} x1={shape.points[0].x} y1={shape.points[0].y} x2={shape.points[1].x} y2={shape.points[1].y} stroke={selectedShapeId === shape.id ? '#d04d3f' : color} strokeWidth={selectedShapeId === shape.id ? 5 : 3} />;
    }
    return <path data-shape-id={shape.id} key={shape.id} d={polylineSvgPath(shape)} fill="none" stroke={selectedShapeId === shape.id ? '#d04d3f' : color} strokeWidth={selectedShapeId === shape.id ? 5 : 3} />;
  });

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="panel" style={{ padding: 14 }}>
        <span className="eyebrow muted">DRAFTING + MODEL SPACE</span>
        <h2 style={{ margin: '5px 0' }}>CAD & 3D engineering</h2>
        <p className="muted" style={{ fontSize: 13 }}>Project drawing · DXF exchange · interactive model view</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="secondary-button" onClick={() => fileRef.current?.click()}><FileUp size={15} /> Import DXF/JSON</button>
          <button className="secondary-button" onClick={downloadDxf}><Download size={15} /> Export DXF</button>
          <button className="primary-button" onClick={saveDrawing} disabled={busy}><Save size={15} />{busy ? 'Saving…' : 'Save drawing'}</button>
          <button className="secondary-button" onClick={importGisDraft}><Layers3 size={15} /> Bring in GIS draft</button>
        </div>
        <input ref={fileRef} type="file" accept=".dxf,.json" hidden onChange={event => importFile(event.target.files?.[0])} />
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className={view === '2d' ? 'primary-button' : 'secondary-button'} onClick={() => setView('2d')}>2D CAD</button>
          <button className={view === '3d' ? 'primary-button' : 'secondary-button'} onClick={() => setView('3d')}>3D view</button>
          <label>Measurement units <select value={units} disabled={!calibratedMetresPerUnit} onChange={event => setUnits(event.target.value)}><option value="m">metres</option><option value="mm">millimetres</option></select></label>
          <button className={snapEnabled ? 'primary-button' : 'secondary-button'} onClick={() => setSnapEnabled(value => !value)}><Crosshair size={15} /> Object snap: {snapEnabled ? 'ON' : 'OFF'}</button>
          <button className={orthoEnabled ? 'primary-button' : 'secondary-button'} onClick={() => setOrthoEnabled(value => !value)}>Ortho: {orthoEnabled ? 'ON' : 'OFF'}</button>
          <button className={gridSnapEnabled ? 'primary-button' : 'secondary-button'} onClick={() => setGridSnapEnabled(value => !value)}>Grid snap: {gridSnapEnabled ? 'ON' : 'OFF'}</button>
          <button className={panMode ? 'primary-button' : 'secondary-button'} onClick={() => setPanMode(value => !value)}>Pan: {panMode ? 'ON' : 'OFF'}</button>
          <button className="secondary-button" onClick={() => setViewBox({ x: 0, y: 0, width: WIDTH, height: HEIGHT })}>Reset view</button>
          <button className="secondary-button" disabled={!history.past.length} onClick={() => setHistory(current => undoHistory(current))}>Undo</button>
          <button className="secondary-button" disabled={!history.future.length} onClick={() => setHistory(current => redoHistory(current))}>Redo</button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>Grid step (drawing units) <input type="number" min="0.1" step="any" value={gridSize} onChange={event => setGridSize(Math.max(0.1, Number(event.target.value) || 10))} style={{ width: 66, padding: 6 }} /></label>
          <span className="muted" style={{ fontSize: 11 }}>{calibratedMetresPerUnit ? `Calibrated: ${calibratedMetresPerUnit.toPrecision(5)} m per drawing unit` : 'Unscaled legacy drawing · calibrate a known line for real measurements'}</span>
        </div>
      </div>


      <div className="panel" style={{ padding: 14 }}>
        <span className="eyebrow muted">PROFESSIONAL DRAFTING</span>
        <h3 style={{ margin: "5px 0" }}>Dimensions, annotations, layers & drawing sheets</h3>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center" }}>
          <button className={draftTool === "dimension" ? "primary-button" : "secondary-button"} onClick={() => { setDraftTool("dimension"); setAnnotationDraft([]); setMessage("Select two points to dimension."); }}>Aligned dimension</button>
          <button className={draftTool === "text" ? "primary-button" : "secondary-button"} onClick={() => { setDraftTool("text"); setMessage("Click the drawing to place text."); }}>Place text</button>
          <button className={draftTool === "leader" ? "primary-button" : "secondary-button"} onClick={() => { setDraftTool("leader"); setAnnotationDraft([]); setMessage("Click leader arrow point, then text landing point."); }}>Leader</button>
          {draftTool !== "none" && <button className="secondary-button" onClick={() => { setDraftTool("none"); setAnnotationDraft([]); }}>Cancel annotation</button>}
          <label>Text / note <input value={annotationText} onChange={e => setAnnotationText(e.target.value)} style={{ width: 180 }}/></label>
          <label>Dimension offset (m) <input type="number" step="any" value={dimensionOffset} onChange={e => setDimensionOffset(Number(e.target.value))} style={{ width: 75 }}/></label>
          <label>Precision <select value={dimensionPrecision} onChange={e => setDimensionPrecision(Number(e.target.value))}><option value={0}>0</option><option value={1}>0.0</option><option value={2}>0.00</option><option value={3}>0.000</option><option value={4}>0.0000</option></select></label>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 9, marginTop: 12 }}>
          <label>Standard <select value={drafting.standard} onChange={e => setDrafting(v => ({ ...v, standard: e.target.value as DraftingDocument["standard"] }))}><option value="ISO">ISO / EN</option><option value="BS">British Standards</option><option value="ANSI">ANSI / ASME</option></select></label>
          <label>Sheet <select value={drafting.sheet.size} onChange={e => setDrafting(v => ({ ...v, sheet: { ...v.sheet, size: e.target.value as DraftingDocument["sheet"]["size"] } }))}>{["A0","A1","A2","A3","A4","CUSTOM"].map(x => <option key={x}>{x}</option>)}</select></label>
          <label>Orientation <select value={drafting.sheet.orientation} onChange={e => setDrafting(v => ({ ...v, sheet: { ...v.sheet, orientation: e.target.value as "landscape"|"portrait" } }))}><option value="landscape">Landscape</option><option value="portrait">Portrait</option></select></label>
          <label>Plot scale <select value={drafting.sheet.scale} onChange={e => setDrafting(v => ({ ...v, sheet: { ...v.sheet, scale: e.target.value } }))}>{["1:20","1:25","1:50","1:75","1:100","1:150","1:200","1:250","1:500","1:1000","1:2000"].map(x => <option key={x}>{x}</option>)}</select></label>
          <label>Units <select value={drafting.sheet.units} onChange={e => setDrafting(v => ({ ...v, sheet: { ...v.sheet, units: e.target.value as "m"|"mm" } }))}><option value="m">metres</option><option value="mm">millimetres</option></select></label>
          <label>Drawing number <input value={drafting.sheet.drawingNumber} onChange={e => setDrafting(v => ({ ...v, sheet: { ...v.sheet, drawingNumber: e.target.value } }))}/></label>
          <label>Drawing title <input value={drafting.sheet.title} onChange={e => setDrafting(v => ({ ...v, sheet: { ...v.sheet, title: e.target.value } }))}/></label>
          <label>Revision <input value={drafting.sheet.revision} onChange={e => setDrafting(v => ({ ...v, sheet: { ...v.sheet, revision: e.target.value } }))}/></label>
          <label>Status <select value={drafting.sheet.status} onChange={e => setDrafting(v => ({ ...v, sheet: { ...v.sheet, status: e.target.value as DraftingDocument["sheet"]["status"] } }))}>{["PRELIMINARY","FOR REVIEW","FOR APPROVAL","FOR CONSTRUCTION","AS BUILT"].map(x => <option key={x}>{x}</option>)}</select></label>
          <label>Designer <input value={drafting.sheet.designer} onChange={e => setDrafting(v => ({ ...v, sheet: { ...v.sheet, designer: e.target.value } }))}/></label>
          <label>Checker <input value={drafting.sheet.checker} onChange={e => setDrafting(v => ({ ...v, sheet: { ...v.sheet, checker: e.target.value } }))}/></label>
          <label>Approver <input value={drafting.sheet.approver} onChange={e => setDrafting(v => ({ ...v, sheet: { ...v.sheet, approver: e.target.value } }))}/></label>
          <label>Company <input value={drafting.sheet.company} onChange={e => setDrafting(v => ({ ...v, sheet: { ...v.sheet, company: e.target.value } }))}/></label>
          <label>Issue date <input type="date" value={drafting.sheet.date} onChange={e => setDrafting(v => ({ ...v, sheet: { ...v.sheet, date: e.target.value } }))}/></label>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          <button className="secondary-button" onClick={validateDrafting}>Validate drafting</button>
          <button className="secondary-button" onClick={exportSheetSvg}>Export sheet SVG</button>
          <span className="muted" style={{ fontSize: 12 }}>{sheetDimensionsMm(drafting.sheet).widthMm} × {sheetDimensionsMm(drafting.sheet).heightMm} mm · {drafting.annotations.length} annotations</span>
        </div>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
          <input placeholder="New layer name" value={newLayerName} onChange={e => setNewLayerName(e.target.value)} style={{ width: 150 }}/><button className="secondary-button" onClick={addDraftLayer}>Add layer</button>
          {drafting.layers.map(item => <span key={item.name} style={{ display: "inline-flex", alignItems: "center", gap: 4, border: "1px solid #ccd5d2", padding: 4, borderRadius: 5, fontSize: 11 }}><input type="color" value={item.color} onChange={e => setDrafting(v => ({ ...v, layers: v.layers.map(l => l.name === item.name ? { ...l, color: e.target.value } : l) }))} style={{ width: 22, height: 20, padding: 0 }}/><button onClick={() => setDrafting(v => ({ ...v, layers: v.layers.map(l => l.name === item.name ? { ...l, visible: !l.visible } : l) }))}>{item.visible ? "●" : "○"} {item.name}</button><label><input type="checkbox" checked={item.plot} onChange={e => setDrafting(v => ({ ...v, layers: v.layers.map(l => l.name === item.name ? { ...l, plot: e.target.checked } : l) }))}/>Plot</label></span>)}
        </div>
        {drafting.annotations.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>{drafting.annotations.map(item => <button key={item.id} className="secondary-button" onClick={() => removeAnnotation(item.id)}>Delete {item.kind} · {item.id.slice(0,6)}</button>)}</div>}
      </div>

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
            <tbody>{buildPipeLongitudinalProfile(selectedWaterComponent).map((point, index) => <tr key={index}>{[point.chainageM, point.groundLevelM, point.invertLevelM, point.crownLevelM, point.coverDepthM].map((value, i) => <td key={i} style={{ textAlign: 'right', padding: 5 }}>{value === null ? '—' : value.toFixed(3)}</td>)}</tr>)}</tbody>
          </table>
          <p className="muted" style={{ fontSize: 11 }}>Profile values interpolate the entered start/end ground and invert levels. Add surveyed intermediate vertices and levels for a true surveyed profile; blank levels remain blank.</p>
        </div>}
        <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <strong style={{ fontSize: 13 }}>Preliminary material and fitting schedule</strong>
          <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse', marginTop: 6 }}>
            <thead><tr><th style={{ textAlign: 'left', padding: 5 }}>Description</th><th style={{ textAlign: 'right', padding: 5 }}>Unit</th><th style={{ textAlign: 'right', padding: 5 }}>Quantity</th></tr></thead>
            <tbody>{buildPreliminaryBoq(waterCad).map((row, index) => <tr key={row.code + index}><td style={{ padding: 5 }}>{row.description}</td><td style={{ textAlign: 'right', padding: 5 }}>{row.unit}</td><td style={{ textAlign: 'right', padding: 5 }}>{row.quantity.toFixed(2)}</td></tr>)}</tbody>
          </table>
          <p className="muted" style={{ fontSize: 11 }}>Excavation is a preliminary rectangular trench estimate using 0.6 m width × 1.2 m depth. It excludes bedding, shoring, fittings allowances, dewatering, reinstatement and wastage.</p>
        </div>
        <label style={{ display: 'block', marginTop: 10, fontSize: 12 }}>Project vertical datum / level reference
          <input value={waterCad.verticalDatum} onChange={e => setWaterCad(current => ({ ...current, verticalDatum: e.target.value }))} style={{ display: 'block', width: '100%' }} />
        </label>
      </div>

      {view === '2d' ? (
        <div className="panel" style={{ padding: 12 }}>
          <div style={{display:'flex',gap:7,flexWrap:'wrap',marginBottom:10,alignItems:'center'}}>
            <strong>Modify</strong><span className="muted" style={{fontSize:12}}>{selectedShapeIds.length} selected</span>
            <label>Distance <input type="number" value={commandDistance} step="any" onChange={e=>setCommandDistance(Number(e.target.value))} style={{width:75}}/></label>
            <label>Angle ° <input type="number" value={commandAngle} step="any" onChange={e=>setCommandAngle(Number(e.target.value))} style={{width:70}}/></label>
            <label>Endpoint <select value={commandEndpoint} onChange={e=>setCommandEndpoint(Number(e.target.value) as 0|1)}><option value={0}>Start</option><option value={1}>End</option></select></label>
            <label>Corner # <input type="number" min="1" value={cornerIndex} onChange={e=>setCornerIndex(Math.max(1,Number(e.target.value)||1))} style={{width:48}}/></label>
            <button className="secondary-button" disabled={!selectedShapes.length} onClick={()=>{previewDrawing(shapes.map(x=>selectedShapeIds.includes(x.id)?moveEntities([x],{x:commandDistance,y:commandDistance})[0]:x),'MOVE');}}>Preview move</button>
            <button className="primary-button" disabled={!selectedShapes.length} onClick={()=>{previewDrawing(shapes.map(x=>selectedShapeIds.includes(x.id)?moveEntities([x],{x:commandDistance,y:commandDistance})[0]:x),'MOVE');}}>Move</button>
            <button className="secondary-button" disabled={!selectedShapes.length} onClick={()=>{previewDrawing([...shapes,...copyEntities(selectedShapes,{x:commandDistance,y:commandDistance})],'COPY');}}>Copy</button>
            <button className="secondary-button" disabled={!selectedShapes.length} onClick={()=>{const pivot=selectedShapes[0].points[0];previewDrawing(shapes.map(x=>selectedShapeIds.includes(x.id)?rotateEntities([x],pivot,commandAngle)[0]:x),'ROTATE');}}>Rotate</button>
            <button className="secondary-button" disabled={!selectedShapes.length} onClick={()=>{const a=selectedShapes[0].points[0],b={x:a.x,y:a.y+1};previewDrawing(shapes.map(x=>selectedShapeIds.includes(x.id)?mirrorEntities([x],a,b)[0]:x),'MIRROR');}}>Mirror</button>
            <button className="secondary-button" disabled={!selectedShapes.length} onClick={()=>{previewDrawing([...shapes,...rectangularArray(selectedShapes,arrayRows,arrayColumns,arraySpacing,arraySpacing)],'ARRAY');}}>Array</button>
            <label>Rows <input type="number" min="1" value={arrayRows} onChange={e=>setArrayRows(Math.max(1,Number(e.target.value)||1))} style={{width:48}}/></label>
            <label>Cols <input type="number" min="1" value={arrayColumns} onChange={e=>setArrayColumns(Math.max(1,Number(e.target.value)||1))} style={{width:48}}/></label>
            <button className="secondary-button" disabled={!selectedShapes.length||!lastSelectionWindow} onClick={()=>{try{previewDrawing(shapes.map(x=>selectedShapeIds.includes(x.id)?stretchEntities([x],lastSelectionWindow!,{x:commandDistance,y:0})[0]:x),'STRETCH');}catch(e){setMessage(e instanceof Error?e.message:'STRETCH failed.');}}}>Stretch</button>
            <button className="secondary-button" disabled={selectedShapes.length!==1||!['line','polyline'].includes(selectedShapes[0].type)} onClick={()=>{try{const entity=selectedShapes[0];previewDrawing([...shapes,entity.type==='line'?offsetLine(entity,commandDistance):offsetPolyline(entity,commandDistance)],'OFFSET');}catch(e){setMessage(e instanceof Error?e.message:'OFFSET failed.');}}}>Offset</button>
            <button className="secondary-button" disabled={selectedShapes.length!==2||selectedShapes[0].type!=='line'||selectedShapes[1].type!=='line'} onClick={()=>{try{previewDrawing(shapes.map(x=>x.id===selectedShapeId?trimLine(x,selectedShapes.find(item=>item.id!==selectedShapeId)!,x.points[commandEndpoint]):x),'TRIM');}catch(e){setMessage(e instanceof Error?e.message:'TRIM failed.');}}}>Trim</button>
            <button className="secondary-button" disabled={selectedShapes.length!==2||selectedShapes[0].type!=='line'||selectedShapes[1].type!=='line'} onClick={()=>{try{previewDrawing(shapes.map(x=>x.id===selectedShapeId?extendLine(x,selectedShapes.find(item=>item.id!==selectedShapeId)!,commandEndpoint):x),'EXTEND');}catch(e){setMessage(e instanceof Error?e.message:'EXTEND failed.');}}}>Extend</button>
            <button className="secondary-button" disabled={selectedShapes.length!==1||selectedShapes[0].type!=='polyline'} onClick={()=>{try{previewDrawing(shapes.map(x=>x.id===selectedShapes[0].id?chamferPolylineCorner(x,cornerIndex,commandDistance):x),'CHAMFER');}catch(e){setMessage(e instanceof Error?e.message:'CHAMFER failed.');}}}>Chamfer</button>
            <button className="secondary-button" disabled={selectedShapes.length!==1||selectedShapes[0].type!=='polyline'} onClick={()=>{try{previewDrawing(shapes.map(x=>x.id===selectedShapes[0].id?filletPolylineCorner(x,cornerIndex,commandDistance):x),'FILLET');}catch(e){setMessage(e instanceof Error?e.message:'FILLET failed.');}}}>Fillet</button>
            <button className="primary-button" disabled={!previewShapes} onClick={commitPreview}>Apply preview</button>
            <button className="secondary-button" onClick={()=>{setPreviewShapes(null);setMessage('Preview cancelled.');}}>Cancel preview</button>
            <button className="secondary-button" onClick={()=>{setSelectedShapeIds([]);setSelectedShapeId('');}}>Clear selection</button>
          </div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 10 }}>
            {(['select', 'line', 'polyline', 'rect', 'circle'] as const).map(tool => (
              <button key={tool} className={mode === tool ? 'primary-button' : 'secondary-button'} onClick={() => { setMode(tool); setDraft([]); }}>
                {tool}
              </button>
            ))}
            {mode === 'polyline' && draft.length > 1 && <button className="primary-button" onClick={finishPolyline}>Finish polyline</button>}
            <button className="secondary-button" onClick={() => { setShapes([]); setDraft([]); }}>Clear drawing</button>
            <input value={layer} onChange={event => setLayer(event.target.value)} aria-label="CAD layer" style={{ width: 145, padding: 7 }} />
          </div>
          <svg
            ref={svgRef}
            viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
            onClick={handleCanvasClick}
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
              backgroundColor: '#fbfdfc',
              border: '1px solid #dce5e2',
              borderRadius: 8,
              cursor: panMode ? 'grab' : (mode !== 'select' || draftTool !== 'none') ? 'crosshair' : 'default',
              touchAction: 'none',
            }}
          >
            <defs><pattern id="cad-grid" width={gridSize} height={gridSize} patternUnits="userSpaceOnUse"><path d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`} fill="none" stroke="#e5ece9" strokeWidth={Math.max(viewBox.width / 1000, 0.2)} /></pattern></defs>
            <rect x={viewBox.x} y={viewBox.y} width={viewBox.width} height={viewBox.height} fill="url(#cad-grid)" pointerEvents="none" />
            {renderedShapes}
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
          <p className="muted" style={{ fontSize: 12 }}>
            Precision drafting: object snaps include endpoints, centres, circle quadrants, nearest points, midpoints and line intersections. Ortho constrains the next segment horizontally or vertically; grid snap uses the selected drawing-unit interval.
          </p>
          {layerNames.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, alignItems: 'center', marginTop: 8 }}>
            <strong style={{ fontSize: 12 }}>Layers</strong>
            {layerNames.map(name => <button key={name} className={hiddenLayers.includes(name) ? 'secondary-button' : 'primary-button'} onClick={() => setHiddenLayers(current => current.includes(name) ? current.filter(item => item !== name) : [...current, name])} style={{ padding: '6px 9px', fontSize: 11 }}>{hiddenLayers.includes(name) ? 'Show' : 'Hide'} {name}</button>)}
          </div>}
          {snapMarker && mode !== 'select' && <p style={{ fontSize: 12, color: '#b94d43', margin: 0 }}>Snap: {snapMarker.kind}</p>}
        </div>
      ) : (
        <div className="panel" style={{ padding: 12 }}>
          <strong>Interactive 3D model viewport</strong>
          <span className="muted" style={{ fontSize: 12 }}> Drag to orbit · scroll/pinch to zoom</span>
          <div ref={hostRef} style={{ width: '100%', height: 'min(65vh, 620px)', minHeight: 350, marginTop: 10, borderRadius: 8, overflow: 'hidden' }} />
          <p className="muted" style={{ fontSize: 12 }}>Conceptual geometry only; not yet BIM, structural analysis or terrain modelling.</p>
        </div>
      )}

      {selectedShape && view === '2d' && <div className="panel" style={{padding:14,display:'grid',gap:10}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}><strong>Entity properties · {selectedShape.type.toUpperCase()}</strong><button className="secondary-button" onClick={deleteSelectedShape}>Delete selected</button></div>
        <label>Layer <input value={selectedShape.layer} onChange={e=>updateSelected({layer:e.target.value})} /></label>
        {selectedShape.points.map((point,index)=><div key={index} style={{display:'flex',gap:8,flexWrap:'wrap'}}><label>Point {index+1} X <input type="number" step="any" value={point.x} onChange={e=>updateSelected({points:selectedShape.points.map((p,i)=>i===index?{...p,x:Number(e.target.value)}:p)})}/></label><label>Y <input type="number" step="any" value={point.y} onChange={e=>updateSelected({points:selectedShape.points.map((p,i)=>i===index?{...p,y:Number(e.target.value)}:p)})}/></label></div>)}
        {selectedShape.type==='circle' && <label>Radius <input type="number" min="0.001" step="any" value={selectedShape.radius||1} onChange={e=>updateSelected({radius:Number(e.target.value)})}/></label>}
        <small>{selectedMetrics}</small>{selectedShape.type==='line' && <button className="secondary-button" onClick={calibrateSelectedLine}>Calibrate scale from this line</button>}
      </div>}
      {message && <div className="alert">{message}</div>}
      <div className="panel" style={{ padding: 14 }}>
        <strong>Drawing inventory</strong>
        <p className="muted">{shapes.length} entities · {counts.routes} routes · {counts.structures} structures · {counts.circles} circular items</p>
      </div>
    </div>
  );
}
