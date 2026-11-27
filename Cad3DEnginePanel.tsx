import { useEffect, useMemo, useRef, useState } from 'react';
import { createHistory, pushHistory, undoHistory, redoHistory } from './cad-geometry';
import { moveEntities, copyEntities, rotateEntities, mirrorEntities, stretchEntities, rectangularArray, trimLine, extendLine, offsetLine, offsetPolyline, selectEntitiesInWindow, chamferPolylineCorner, filletPolylineCorner } from './cad-editing';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Download, FileUp, Layers3, Save, Crosshair } from 'lucide-react';
import { api } from './client';

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
    getSegments([shape]).forEach(([a, b]) => candidates.push({ point: nearestPointOnSegment(cursor, a, b), kind: 'NEAREST' }));
    if (shape.type === 'line' || shape.type === 'polyline') {
      for (let i = 0; i < shape.points.length - 1; i++) {
        const segment=shape.type==='polyline'
          ? bulgeSegmentPoints(shape.points[i],shape.points[i+1],shape.bulges?.[i]||0,2)
          : [shape.points[i],shape.points[i+1]];
        candidates.push({ point: segment[Math.floor(segment.length/2)], kind: 'MIDPOINT' });
      }
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
    if (mode === 'select') {
      setLastSelectionWindow(null);
      const target = (event.target as SVGElement).closest('[data-shape-id]') as SVGElement | null;
      const id = target?.getAttribute('data-shape-id') || '';
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
      const data = file.name.toLowerCase().endsWith('.json')
        ? JSON.parse(text).shapes
        : importDxf(text);
      if (!Array.isArray(data) || !data.length) throw new Error('No supported drawing entities in this file.');
      setShapes(current => [...current, ...data]);
      setMessage('Imported ' + data.length + ' drawing entities.');
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
        units,
        schemaVersion: 1,
        coordinateSystem: calibratedMetresPerUnit ? 'calibrated-local-grid' : 'legacy-unscaled-drawing-units',
        calibratedMetresPerUnit,
        viewport: viewBox,
        format: 'RayanAqua CAD v3',
        updatedAt: new Date().toISOString(),
      });
      setMessage('Drawing saved to this project. It will be available when you sign in again.');
    } catch (error) {
      setMessage(error instanceof Error ? 'Save failed: ' + error.message : 'Drawing could not be saved. Please retry.');
    } finally {
      setBusy(false);
    }
  }

  function downloadDxf() {
    const url = URL.createObjectURL(new Blob([exportDxf(shapes)], { type: 'application/dxf' }));
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
              cursor: panMode ? 'grab' : mode === 'select' ? 'default' : 'crosshair',
              touchAction: 'none',
            }}
          >
            <defs><pattern id="cad-grid" width={gridSize} height={gridSize} patternUnits="userSpaceOnUse"><path d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`} fill="none" stroke="#e5ece9" strokeWidth={Math.max(viewBox.width / 1000, 0.2)} /></pattern></defs>
            <rect x={viewBox.x} y={viewBox.y} width={viewBox.width} height={viewBox.height} fill="url(#cad-grid)" pointerEvents="none" />
            {renderedShapes}
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
