import { useEffect, useMemo, useRef, useState } from 'react';
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

function exportDxf(shapes: Shape[]) {
  const output = [
    '0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '6', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
  ];
  shapes.forEach(shape => {
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
      shape.points.forEach(point => output.push('10', String(point.x), '20', String(point.y)));
    }
  });
  return output.concat(['0', 'ENDSEC', '0', 'EOF']).join('\n');
}

function importDxf(source: string): Shape[] {
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
      let x: number | null = null;
      entity.values.forEach(([code, value]) => {
        if (code === '10') x = Number(value);
        if (code === '20' && x !== null) {
          points.push({ x, y: Number(value) });
          x = null;
        }
      });
      if (points.length > 1) result.push({ id: makeId(), type: 'polyline', points, layer });
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
    if (shape.type === 'line' || shape.type === 'polyline') {
      for (let i = 0; i < shape.points.length - 1; i++) {
        const a = shape.points[i];
        const b = shape.points[i + 1];
        candidates.push({ point: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, kind: 'MIDPOINT' });
      }
    }
  });
  return candidates;
}

function findSnap(svg: SVGSVGElement, cursor: Point2D, shapes: Shape[], enabled: boolean): SnapPoint | null {
  if (!enabled) return null;
  let best: SnapPoint | null = null;
  getSnapCandidates(shapes, cursor).forEach(candidate => {
    const distance = screenDistance(svg, cursor, candidate.point);
    if (distance <= SNAP_PIXELS && (!best || distance < best.distance)) {
      best = { ...candidate, distance };
    }
  });
  return best;
}

export default function Cad3DEnginePanel({ projectId, initialData, gisFeatures = [], onSave }: Props) {
  const [shapes, setShapes] = useState<Shape[]>(initialData?.shapes || []);
  const [mode, setMode] = useState<'select' | 'line' | 'polyline' | 'rect' | 'circle'>('select');
  const [draft, setDraft] = useState<Point2D[]>([]);
  const [view, setView] = useState<'2d' | '3d'>('2d');
  const [layer, setLayer] = useState('WATER_NETWORK');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [units, setUnits] = useState('m');
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [snapMarker, setSnapMarker] = useState<SnapPoint | null>(null);
  const [selectedShapeId, setSelectedShapeId] = useState('');
  const [cursorPoint, setCursorPoint] = useState<Point2D | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setShapes(initialData?.shapes || []);
    setDraft([]);
  }, [initialData]);

  const counts = useMemo(() => ({
    routes: shapes.filter(shape => shape.type === 'line' || shape.type === 'polyline').length,
    structures: shapes.filter(shape => shape.type === 'rect').length,
    circles: shapes.filter(shape => shape.type === 'circle').length,
  }), [shapes]);

  function pointerPosition(event: React.PointerEvent<SVGSVGElement>) {
    const raw = toSvgPoint(event.currentTarget, event.clientX, event.clientY);
    const snapped = findSnap(event.currentTarget, raw, shapes, snapEnabled);
    return { raw, snapped };
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const { raw, snapped } = pointerPosition(event);
    setCursorPoint(snapped?.point || raw);
    setSnapMarker(snapped);
  }

  function handlePointerLeave() {
    setSnapMarker(null);
    setCursorPoint(null);
  }

  function handleCanvasClick(event: React.MouseEvent<SVGSVGElement>) {
    if (mode === 'select') {
      const target = (event.target as SVGElement).closest('[data-shape-id]') as SVGElement | null;
      setSelectedShapeId(target?.getAttribute('data-shape-id') || '');
      setMessage(target ? 'Entity selected. Edit its properties in the inspector.' : 'No entity selected.');
      return;
    }
    const raw = toSvgPoint(event.currentTarget, event.clientX, event.clientY);
    const snapped = findSnap(event.currentTarget, raw, shapes, snapEnabled);
    const point = snapped?.point || raw;

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
      ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon'].includes(feature.geometry?.type)
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

  function updateSelected(patch: Partial<Shape>) {
    if (!selectedShapeId) return;
    setShapes(rows => rows.map(shape => shape.id === selectedShapeId ? { ...shape, ...patch } : shape));
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
        format: 'RayanAqua CAD v2',
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
          shape.points.map(point => new THREE.Vector3(point.x - 500, 3, point.y - 325))
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

  const renderedShapes = shapes.map(shape => {
    const color = shape.layer === 'WATER_NETWORK' ? '#167b78' : '#c08c3c';
    if (shape.type === 'circle') {
      return <circle data-shape-id={shape.id} key={shape.id} cx={shape.points[0].x} cy={shape.points[0].y} r={shape.radius || 12} fill="none" stroke={selectedShapeId === shape.id ? '#d04d3f' : color} strokeWidth={selectedShapeId === shape.id ? 4 : 2.5} />;
    }
    if (shape.type === 'rect') {
      const a = shape.points[0];
      const b = shape.points[1];
      return <rect data-shape-id={shape.id} key={shape.id} x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} fill="none" stroke={selectedShapeId === shape.id ? '#d04d3f' : color} strokeWidth={selectedShapeId === shape.id ? 4 : 2.5} />;
    }
    if (shape.type === 'line') {
      return <line data-shape-id={shape.id} key={shape.id} x1={shape.points[0].x} y1={shape.points[0].y} x2={shape.points[1].x} y2={shape.points[1].y} stroke={selectedShapeId === shape.id ? '#d04d3f' : color} strokeWidth={selectedShapeId === shape.id ? 5 : 3} />;
    }
    return <polyline data-shape-id={shape.id} key={shape.id} points={shape.points.map(point => point.x + ',' + point.y).join(' ')} fill="none" stroke={selectedShapeId === shape.id ? '#d04d3f' : color} strokeWidth={selectedShapeId === shape.id ? 5 : 3} />;
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
          <label>Units <select value={units} onChange={event => setUnits(event.target.value)}><option value="m">metres</option><option value="mm">millimetres</option></select></label>
          <button className={snapEnabled ? 'primary-button' : 'secondary-button'} onClick={() => setSnapEnabled(value => !value)}><Crosshair size={15} /> Object snap: {snapEnabled ? 'ON' : 'OFF'}</button>
        </div>
      </div>

      {view === '2d' ? (
        <div className="panel" style={{ padding: 12 }}>
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
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            onClick={handleCanvasClick}
            onPointerMove={handlePointerMove}
            onPointerLeave={handlePointerLeave}
            style={{
              width: '100%',
              height: 'min(62vh, 650px)',
              minHeight: 340,
              backgroundColor: '#fbfdfc',
              backgroundImage: 'linear-gradient(#e8efec 1px, transparent 1px), linear-gradient(90deg, #e8efec 1px, transparent 1px)',
              backgroundSize: '25px 25px',
              border: '1px solid #dce5e2',
              borderRadius: 8,
              cursor: mode === 'select' ? 'default' : 'crosshair',
              touchAction: 'pan-y',
            }}
          >
            {renderedShapes}
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
            Object snap finds circle centres and nearest points on circle edges, line endpoints, polyline vertices and midpoints. Move the pointer close to a target; the red marker shows the snap point. Tap to place.
          </p>
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
        {selectedShape.type==='line' && <small>Length: {Math.hypot(selectedShape.points[1].x-selectedShape.points[0].x,selectedShape.points[1].y-selectedShape.points[0].y).toFixed(3)} {units}</small>}
      </div>}
      {message && <div className="alert">{message}</div>}
      <div className="panel" style={{ padding: 14 }}>
        <strong>Drawing inventory</strong>
        <p className="muted">{shapes.length} entities · {counts.routes} routes · {counts.structures} structures · {counts.circles} circular items</p>
      </div>
    </div>
  );
}
