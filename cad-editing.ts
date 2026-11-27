import type { Point2D } from './cad-geometry';

export type CadEditableEntity = {
  id: string;
  type: 'line' | 'polyline' | 'rect' | 'circle';
  points: Point2D[];
  radius?: number;
  layer: string;
};
export type CadWindow = { minX: number; minY: number; maxX: number; maxY: number };

const finite = (n: number) => Number.isFinite(n);
const clonePoint = (p: Point2D): Point2D => ({ x: p.x, y: p.y });
const assertPoint = (p: Point2D) => {
  if (!finite(p.x) || !finite(p.y)) throw new Error('CAD coordinates must be finite.');
};
const newId = () => globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);

export function moveEntities<T extends CadEditableEntity>(entities: T[], delta: Point2D): T[] {
  assertPoint(delta);
  return entities.map(e => ({ ...e, points: e.points.map(p => ({ x: p.x + delta.x, y: p.y + delta.y })) }));
}
export function copyEntities<T extends CadEditableEntity>(entities: T[], delta: Point2D, makeEntityId: () => string = newId): T[] {
  return moveEntities(entities, delta).map(e => ({ ...e, id: makeEntityId() }));
}
function transformedPoints<T extends CadEditableEntity>(entity: T, transform: (p: Point2D) => Point2D): T {
  if (entity.type === 'rect') {
    const [a, b] = entity.points;
    const corners = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }].map(transform);
    const closed = [...corners, clonePoint(corners[0])];
    return { ...entity, type: 'polyline', points: closed } as T;
  }
  return { ...entity, points: entity.points.map(transform) };
}
export function rotateEntities<T extends CadEditableEntity>(entities: T[], pivot: Point2D, degrees: number): T[] {
  assertPoint(pivot);
  if (!finite(degrees)) throw new Error('Rotation angle must be finite.');
  const a = degrees * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return entities.map(e => transformedPoints(e, p => {
    const x = p.x - pivot.x, y = p.y - pivot.y;
    return { x: pivot.x + x * c - y * s, y: pivot.y + x * s + y * c };
  }));
}
export function mirrorEntities<T extends CadEditableEntity>(entities: T[], axisStart: Point2D, axisEnd: Point2D): T[] {
  assertPoint(axisStart); assertPoint(axisEnd);
  const dx = axisEnd.x - axisStart.x, dy = axisEnd.y - axisStart.y, d2 = dx * dx + dy * dy;
  if (d2 <= Number.EPSILON) throw new Error('Mirror axis must have non-zero length.');
  return entities.map(e => transformedPoints(e, p => {
    const t = ((p.x - axisStart.x) * dx + (p.y - axisStart.y) * dy) / d2;
    const q = { x: axisStart.x + t * dx, y: axisStart.y + t * dy };
    return { x: 2 * q.x - p.x, y: 2 * q.y - p.y };
  }));
}
export function stretchEntities<T extends CadEditableEntity>(entities: T[], window: CadWindow, delta: Point2D): T[] {
  assertPoint(delta);
  const bounds = [window.minX, window.minY, window.maxX, window.maxY];
  if (!bounds.every(finite) || window.minX > window.maxX || window.minY > window.maxY) {
    throw new Error('Stretch window bounds must be finite and ordered.');
  }
  return entities.map(e => ({ ...e, points: e.points.map(p =>
    p.x >= window.minX && p.x <= window.maxX && p.y >= window.minY && p.y <= window.maxY
      ? { x: p.x + delta.x, y: p.y + delta.y } : clonePoint(p)) }));
}
export function rectangularArray<T extends CadEditableEntity>(
  entities: T[], rows: number, columns: number, rowSpacing: number, columnSpacing: number,
  makeEntityId: () => string = newId,
): T[] {
  if (!Number.isInteger(rows) || rows < 1 || !Number.isInteger(columns) || columns < 1) throw new Error('Array rows and columns must be positive integers.');
  if (!finite(rowSpacing) || !finite(columnSpacing)) throw new Error('Array spacing must be finite.');
  const result: T[] = [];
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    if (row === 0 && col === 0) continue;
    const copy = moveEntities(entities, { x: col * columnSpacing, y: row * rowSpacing });
    result.push(...copy.map(e => ({ ...e, id: makeEntityId() })));
  }
  return result;
}

function infiniteLineIntersection(a: Point2D, b: Point2D, c: Point2D, d: Point2D): Point2D | null {
  const r = { x: b.x - a.x, y: b.y - a.y }, s = { x: d.x - c.x, y: d.y - c.y };
  const cross = (u: Point2D, v: Point2D) => u.x * v.y - u.y * v.x;
  const den = cross(r, s);
  if (Math.abs(den) < 1e-12) return null;
  const t = cross({ x: c.x - a.x, y: c.y - a.y }, s) / den;
  return { x: a.x + t * r.x, y: a.y + t * r.y };
}
const dist = (a: Point2D, b: Point2D) => Math.hypot(a.x - b.x, a.y - b.y);

function segmentIntersection(a: Point2D, b: Point2D, c: Point2D, d: Point2D): Point2D | null {
  const r = { x: b.x - a.x, y: b.y - a.y }, s = { x: d.x - c.x, y: d.y - c.y };
  const cross = (u: Point2D, v: Point2D) => u.x * v.y - u.y * v.x;
  const den = cross(r, s);
  if (Math.abs(den) < 1e-12) return null;
  const q = { x: c.x - a.x, y: c.y - a.y };
  const t = cross(q, s) / den, u = cross(q, r) / den;
  const eps = 1e-9;
  if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) return null;
  return { x: a.x + t * r.x, y: a.y + t * r.y };
}

/** Exact geometric window/crossing selection for supported line, polyline, rectangle and circle entities. */
export function selectEntitiesInWindow<T extends CadEditableEntity>(entities:T[], window:CadWindow, crossing:boolean):T[] {
  const values=[window.minX,window.minY,window.maxX,window.maxY];
  if(!values.every(finite)||window.minX>window.maxX||window.minY>window.maxY) throw new Error('Selection window bounds must be finite and ordered.');
  const inside=(p:Point2D)=>p.x>=window.minX&&p.x<=window.maxX&&p.y>=window.minY&&p.y<=window.maxY;
  const edges:Array<[Point2D,Point2D]>=[
    [{x:window.minX,y:window.minY},{x:window.maxX,y:window.minY}],
    [{x:window.maxX,y:window.minY},{x:window.maxX,y:window.maxY}],
    [{x:window.maxX,y:window.maxY},{x:window.minX,y:window.maxY}],
    [{x:window.minX,y:window.maxY},{x:window.minX,y:window.minY}],
  ];
  const hit=(a:Point2D,b:Point2D,c:Point2D,d:Point2D)=>{
    const cross=(u:Point2D,v:Point2D)=>u.x*v.y-u.y*v.x;
    const r={x:b.x-a.x,y:b.y-a.y},s={x:d.x-c.x,y:d.y-c.y},q={x:c.x-a.x,y:c.y-a.y};
    const den=cross(r,s); if(Math.abs(den)<1e-12)return false;
    const t=cross(q,s)/den,u=cross(q,r)/den;
    return t>=-1e-9&&t<=1+1e-9&&u>=-1e-9&&u<=1+1e-9;
  };
  return entities.filter(entity=>{
    if(entity.type==='circle'){
      const c=entity.points[0],r=entity.radius||0;
      if(!finite(r)||r<0)return false;
      if(!crossing)return c.x-r>=window.minX&&c.x+r<=window.maxX&&c.y-r>=window.minY&&c.y+r<=window.maxY;
      const q={x:Math.max(window.minX,Math.min(c.x,window.maxX)),y:Math.max(window.minY,Math.min(c.y,window.maxY))};
      return dist(c,q)<=r+1e-9;
    }
    let points=entity.points;
    let segments:Array<[Point2D,Point2D]>=[];
    if(entity.type==='rect'){
      const [a,b]=entity.points; points=[a,{x:b.x,y:a.y},b,{x:a.x,y:b.y}];
      segments=points.map((v,i)=>[v,points[(i+1)%4]]);
    }else if(entity.type==='line')segments=[[entity.points[0],entity.points[1]]];
    else segments=entity.points.slice(1).map((v,i)=>[entity.points[i],v]);
    if(!crossing)return points.length>0&&points.every(inside);
    return points.some(inside)||segments.some(([a,b])=>edges.some(([c,d])=>hit(a,b,c,d)));
  });
}

export function trimLine<T extends CadEditableEntity>(line: T, cutter: CadEditableEntity, pickPoint: Point2D): T {
  if (line.type !== 'line' || cutter.points.length < 2) throw new Error('TRIM currently requires a line and a linear cutting edge.');
  assertPoint(pickPoint);
  const [a, b] = line.points;
  const hit = segmentIntersection(a, b, cutter.points[0], cutter.points[1]);
  if (!hit) throw new Error('TRIM failed: the selected line does not intersect the finite cutting edge.');
  const removeStart = dist(pickPoint, a) <= dist(pickPoint, b);
  const points = [clonePoint(a), clonePoint(b)];
  points[removeStart ? 0 : 1] = hit;
  return { ...line, points };
}
export function extendLine<T extends CadEditableEntity>(line: T, boundary: CadEditableEntity, endpoint: 0 | 1 = 1): T {
  if (line.type !== 'line' || boundary.points.length < 2) throw new Error('EXTEND currently requires a line and a linear boundary.');
  const [a, b] = line.points;
  const hit = segmentIntersection(a, b, boundary.points[0], boundary.points[1]);
  if (!hit) {
    // Intersect the endpoint's outward ray with the finite boundary segment.
    const origin = endpoint === 0 ? a : b;
    const other = endpoint === 0 ? b : a;
    const far = { x: origin.x + (origin.x - other.x) * 1e6, y: origin.y + (origin.y - other.y) * 1e6 };
    const rayHit = segmentIntersection(origin, far, boundary.points[0], boundary.points[1]);
    if (!rayHit) throw new Error('EXTEND failed: no forward intersection with the finite boundary.');
    return { ...line, points: endpoint === 0 ? [rayHit, clonePoint(b)] : [clonePoint(a), rayHit] };
  }
  const origin = endpoint === 0 ? a : b;
  const other = endpoint === 0 ? b : a;
  const dot = (hit.x-origin.x)*(origin.x-other.x)+(hit.y-origin.y)*(origin.y-other.y);
  if (dot <= 0) throw new Error('EXTEND failed: boundary is not beyond the selected endpoint.');
  return { ...line, points: endpoint === 0 ? [hit, clonePoint(b)] : [clonePoint(a), hit] };
}
export function offsetLine<T extends CadEditableEntity>(line: T, distance: number, side: 1 | -1 = 1): T {
  if (line.type !== 'line' || !finite(distance) || distance < 0) throw new Error('OFFSET requires a line and a non-negative finite distance.');
  const [a, b] = line.points;
  const length = dist(a, b);
  if (length <= Number.EPSILON) throw new Error('Cannot offset a zero-length line.');
  const nx = -(b.y - a.y) / length * distance * side;
  const ny = (b.x - a.x) / length * distance * side;
  return { ...line, id: newId(), points: [{ x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny }] };
}

export function chamferPolylineCorner<T extends CadEditableEntity>(entity: T, cornerIndex: number, distance: number): T {
  if (entity.type !== 'polyline' || !Number.isInteger(cornerIndex) || cornerIndex <= 0 || cornerIndex >= entity.points.length - 1) throw new Error('CHAMFER requires an internal polyline corner.');
  if (!finite(distance) || distance <= 0) throw new Error('Chamfer distance must be positive and finite.');
  const pts = entity.points, prev = pts[cornerIndex - 1], corner = pts[cornerIndex], next = pts[cornerIndex + 1];
  const lenA = dist(prev, corner), lenB = dist(corner, next);
  if (!lenA || !lenB || distance >= lenA || distance >= lenB) throw new Error('Chamfer distance is too large for the adjacent segments.');
  const a = { x: corner.x + (prev.x - corner.x) * distance / lenA, y: corner.y + (prev.y - corner.y) * distance / lenA };
  const b = { x: corner.x + (next.x - corner.x) * distance / lenB, y: corner.y + (next.y - corner.y) * distance / lenB };
  return { ...entity, points: [...pts.slice(0, cornerIndex), a, b, ...pts.slice(cornerIndex + 1)].map(clonePoint) };
}
export function filletPolylineCorner<T extends CadEditableEntity>(entity: T, cornerIndex: number, radius: number, segments = 8): T {
  if (entity.type !== 'polyline' || !Number.isInteger(cornerIndex) || cornerIndex <= 0 || cornerIndex >= entity.points.length - 1) throw new Error('FILLET requires an internal polyline corner.');
  if (!finite(radius) || radius <= 0 || !Number.isInteger(segments) || segments < 2) throw new Error('Fillet radius and segment count must be positive.');
  const pts = entity.points, p0 = pts[cornerIndex - 1], p1 = pts[cornerIndex], p2 = pts[cornerIndex + 1];
  const v1 = { x: p0.x - p1.x, y: p0.y - p1.y }, v2 = { x: p2.x - p1.x, y: p2.y - p1.y };
  const l1 = Math.hypot(v1.x, v1.y), l2 = Math.hypot(v2.x, v2.y);
  if (!l1 || !l2) throw new Error('Cannot fillet a zero-length segment.');
  const u1 = { x: v1.x / l1, y: v1.y / l1 }, u2 = { x: v2.x / l2, y: v2.y / l2 };
  const angle = Math.acos(Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y)));
  if (angle < 1e-6 || Math.PI - angle < 1e-6) throw new Error('FILLET requires a non-collinear corner.');
  const tangent = radius / Math.tan(angle / 2);
  if (tangent >= l1 || tangent >= l2) throw new Error('Fillet radius is too large for the adjacent segments.');
  const start = { x: p1.x + u1.x * tangent, y: p1.y + u1.y * tangent };
  const end = { x: p1.x + u2.x * tangent, y: p1.y + u2.y * tangent };
  const bisector = { x: u1.x + u2.x, y: u1.y + u2.y };
  const bl = Math.hypot(bisector.x, bisector.y);
  const centerDistance = radius / Math.sin(angle / 2);
  const center = { x: p1.x + bisector.x / bl * centerDistance, y: p1.y + bisector.y / bl * centerDistance };
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  let sweep = Math.atan2(end.y - center.y, end.x - center.x) - startAngle;
  while (sweep > Math.PI) sweep -= 2 * Math.PI;
  while (sweep < -Math.PI) sweep += 2 * Math.PI;
  const arc: Point2D[] = Array.from({ length: segments + 1 }, (_, i) => {
    const a = startAngle + sweep * i / segments;
    return { x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) };
  });
  return { ...entity, points: [...pts.slice(0, cornerIndex), ...arc, ...pts.slice(cornerIndex + 1)].map(clonePoint) };
}
