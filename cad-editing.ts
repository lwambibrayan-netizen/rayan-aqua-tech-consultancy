import type { Point2D } from './cad-geometry';

export type CadEditableEntity = {
  id: string;
  type: 'line' | 'polyline' | 'rect' | 'circle';
  points: Point2D[];
  radius?: number;
  /** DXF LWPOLYLINE bulge per segment: tan(includedAngle / 4). */
  bulges?: number[];
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
  return entities.map(e => {
    const mirrored=transformedPoints(e, p => {
      const t = ((p.x - axisStart.x) * dx + (p.y - axisStart.y) * dy) / d2;
      const q = { x: axisStart.x + t * dx, y: axisStart.y + t * dy };
      return { x: 2 * q.x - p.x, y: 2 * q.y - p.y };
    });
    return {...mirrored,bulges:e.bulges?.map(value=>-value)};
  });
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

function bulgeArcData(a:Point2D,b:Point2D,bulge:number) {
  const dx=b.x-a.x,dy=b.y-a.y,chord=Math.hypot(dx,dy);
  if(chord<=1e-12||Math.abs(bulge)<=1e-12)return null;
  const offset=chord*(1-bulge*bulge)/(4*bulge);
  const center={x:(a.x+b.x)/2-dy/chord*offset,y:(a.y+b.y)/2+dx/chord*offset};
  return {center,radius:chord*(1+bulge*bulge)/(4*Math.abs(bulge)),start:Math.atan2(a.y-center.y,a.x-center.x),sweep:4*Math.atan(bulge)};
}
function angleOnArc(angle:number,start:number,sweep:number) {
  const tau=Math.PI*2,mod=(v:number)=>(v%tau+tau)%tau;
  return sweep>=0?mod(angle-start)<=sweep+1e-9:mod(start-angle)<=-sweep+1e-9;
}
function arcWithinWindow(a:Point2D,b:Point2D,bulge:number,inside:(p:Point2D)=>boolean) {
  const arc=bulgeArcData(a,b,bulge); if(!arc)return inside(a)&&inside(b);
  if(!inside(a)||!inside(b))return false;
  for(const angle of [0,Math.PI/2,Math.PI,Math.PI*1.5]) if(angleOnArc(angle,arc.start,arc.sweep)) {
    if(!inside({x:arc.center.x+arc.radius*Math.cos(angle),y:arc.center.y+arc.radius*Math.sin(angle)}))return false;
  }
  return true;
}
function arcIntersectsWindow(a:Point2D,b:Point2D,bulge:number,window:CadWindow,inside:(p:Point2D)=>boolean) {
  if(inside(a)||inside(b))return true;
  const arc=bulgeArcData(a,b,bulge); if(!arc)return false;
  const edges:Array<[Point2D,Point2D]>=[
    [{x:window.minX,y:window.minY},{x:window.maxX,y:window.minY}],
    [{x:window.maxX,y:window.minY},{x:window.maxX,y:window.maxY}],
    [{x:window.maxX,y:window.maxY},{x:window.minX,y:window.maxY}],
    [{x:window.minX,y:window.maxY},{x:window.minX,y:window.minY}],
  ];
  for(const [p,q] of edges) {
    const dx=q.x-p.x,dy=q.y-p.y,fx=p.x-arc.center.x,fy=p.y-arc.center.y;
    const A=dx*dx+dy*dy,B=2*(fx*dx+fy*dy),C=fx*fx+fy*fy-arc.radius*arc.radius;
    const discriminant=B*B-4*A*C;
    if(A<=1e-18||discriminant< -1e-9)continue;
    const root=Math.sqrt(Math.max(0,discriminant));
    for(const t of [(-B-root)/(2*A),(-B+root)/(2*A)]) if(t>=-1e-9&&t<=1+1e-9) {
      const hit={x:p.x+t*dx,y:p.y+t*dy};
      if(angleOnArc(Math.atan2(hit.y-arc.center.y,hit.x-arc.center.x),arc.start,arc.sweep))return true;
    }
  }
  return false;
}
/** Exact window/crossing selection for linework, rectangles, circles and bulged circular arcs. */
export function selectEntitiesInWindow<T extends CadEditableEntity>(entities:T[],window:CadWindow,crossing:boolean):T[] {
  const values=[window.minX,window.minY,window.maxX,window.maxY];
  if(!values.every(finite)||window.minX>window.maxX||window.minY>window.maxY)throw new Error('Selection window bounds must be finite and ordered.');
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
    const den=cross(r,s);if(Math.abs(den)<1e-12)return false;
    const t=cross(q,s)/den,u=cross(q,r)/den;
    return t>=-1e-9&&t<=1+1e-9&&u>=-1e-9&&u<=1+1e-9;
  };
  return entities.filter(entity=>{
    if(entity.type==='circle'){
      const c=entity.points[0],r=entity.radius||0;if(!finite(r)||r<0)return false;
      if(!crossing)return c.x-r>=window.minX&&c.x+r<=window.maxX&&c.y-r>=window.minY&&c.y+r<=window.maxY;
      const q={x:Math.max(window.minX,Math.min(c.x,window.maxX)),y:Math.max(window.minY,Math.min(c.y,window.maxY))};
      return dist(c,q)<=r+1e-9;
    }
    let points=entity.points,segments:Array<[Point2D,Point2D]>=[],arcs:Array<{a:Point2D;b:Point2D;bulge:number}>=[];
    if(entity.type==='rect'){
      const [a,b]=entity.points;points=[a,{x:b.x,y:a.y},b,{x:a.x,y:b.y}];segments=points.map((v,i)=>[v,points[(i+1)%4]]);
    }else if(entity.type==='line')segments=[[entity.points[0],entity.points[1]]];
    else {
      for(let i=0;i<entity.points.length-1;i++){
        const a=entity.points[i],b=entity.points[i+1],bulge=entity.bulges?.[i]||0;
        if(Math.abs(bulge)>1e-12)arcs.push({a,b,bulge});else segments.push([a,b]);
      }
    }
    if(!crossing)return points.length>0&&points.every(inside)&&arcs.every(arc=>arcWithinWindow(arc.a,arc.b,arc.bulge,inside));
    return points.some(inside)||segments.some(([a,b])=>edges.some(([c,d])=>hit(a,b,c,d)))||arcs.some(arc=>arcIntersectsWindow(arc.a,arc.b,arc.bulge,window,inside));
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


/** Offset an open polyline with exact parallel segments and bounded miter joins. */
export function offsetPolyline<T extends CadEditableEntity>(entity:T,distance:number,side:1|-1=1,miterLimit=10):T {
  if(entity.type!=='polyline'||entity.points.length<2)throw new Error('OFFSET polyline requires at least two vertices.');
  if(entity.bulges?.some(value=>Math.abs(value)>1e-12))throw new Error('OFFSET of curved polylines is not supported yet; the drawing geometry was left unchanged.');
  if(!finite(distance)||distance<0||!finite(miterLimit)||miterLimit<1)throw new Error('OFFSET distance and miter limit must be valid non-negative values.');
  const closed=dist(entity.points[0],entity.points[entity.points.length-1])<=1e-9;
  const pts=closed?entity.points.slice(0,-1):entity.points;
  if(closed&&pts.length<3)throw new Error('OFFSET closed polyline requires at least three distinct vertices.');
  const segmentCount=closed?pts.length:pts.length-1;
  const shifted:Array<[Point2D,Point2D]>=Array.from({length:segmentCount},(_,i)=>{
    const a=pts[i],b=pts[(i+1)%pts.length],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);
    if(len<=Number.EPSILON)throw new Error('Cannot offset a polyline with a zero-length segment.');
    const nx=-dy/len*distance*side,ny=dx/len*distance*side;
    return [{x:a.x+nx,y:a.y+ny},{x:b.x+nx,y:b.y+ny}];
  });
  const result:Point2D[]=[];
  const firstVertex=closed?0:1,lastVertex=closed?pts.length:pts.length-1;
  if(!closed)result.push(shifted[0][0]);
  for(let i=firstVertex;i<lastVertex;i++){
    const previous=shifted[(i-1+segmentCount)%segmentCount],next=shifted[i%segmentCount];
    const previousEnd=previous[1],nextStart=next[0];
    let hit=infiniteLineIntersection(previous[0],previousEnd,nextStart,next[1]);
    if(!hit&&dist(previousEnd,nextStart)<=1e-8)hit={x:(previousEnd.x+nextStart.x)/2,y:(previousEnd.y+nextStart.y)/2};
    if(!hit)throw new Error('OFFSET failed: adjacent segments are parallel but not collinear.');
    if(dist(hit,pts[i])>Math.max(distance,1e-9)*miterLimit+1e-8)throw new Error('OFFSET failed: corner miter exceeds the safety limit.');
    result.push(hit);
  }
  if(closed)result.push(clonePoint(result[0]));
  else result.push(shifted[shifted.length-1][1]);
  if(closed){
    const signedArea=(points:Point2D[])=>points.reduce((sum,point,index)=>{
      const next=points[(index+1)%points.length];
      return sum+point.x*next.y-next.x*point.y;
    },0)/2;
    const inputArea=signedArea(pts),outputArea=signedArea(result.slice(0,-1));
    const inputMagnitude=Math.abs(inputArea),outputMagnitude=Math.abs(outputArea);
    const inwardOffset=inputArea*side>0;
    if(inputMagnitude<=1e-10||outputMagnitude<=1e-10||inputArea*outputArea<=0||
      (inwardOffset&&outputMagnitude>=inputMagnitude-1e-9)||(!inwardOffset&&outputMagnitude<=inputMagnitude+1e-9)) {
      throw new Error('OFFSET failed: the closed boundary is degenerate or the offset collapses/inverts the polygon.');
    }
    if(inwardOffset&&distance>1e-9){
      const insidePolygon=(point:Point2D)=>{
        let inside=false;
        for(let i=0,j=pts.length-1;i<pts.length;j=i++){
          const a=pts[i],b=pts[j];
          if(((a.y>point.y)!==(b.y>point.y))&&point.x<(b.x-a.x)*(point.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
        }
        return inside;
      };
      const distanceToSegment=(point:Point2D,a:Point2D,b:Point2D)=>{
        const dx=b.x-a.x,dy=b.y-a.y,len2=dx*dx+dy*dy;
        const t=len2?Math.max(0,Math.min(1,((point.x-a.x)*dx+(point.y-a.y)*dy)/len2)):0;
        return Math.hypot(point.x-(a.x+t*dx),point.y-(a.y+t*dy));
      };
      const remainsValid=result.slice(0,-1).every(point=>insidePolygon(point)&&
        Math.min(...pts.map((a,index)=>distanceToSegment(point,a,pts[(index+1)%pts.length])))+1e-8>=distance);
      if(!remainsValid)throw new Error('OFFSET failed: inward offset exceeds the polygon inradius and collapses the boundary.');
    }
    const edges=result.slice(0,-1).map((point,index)=>[point,result[index+1]] as [Point2D,Point2D]);
    for(let i=0;i<edges.length;i++)for(let j=i+1;j<edges.length;j++){
      if(j===i+1||(i===0&&j===edges.length-1))continue;
      if(segmentIntersection(edges[i][0],edges[i][1],edges[j][0],edges[j][1])) {
        throw new Error('OFFSET failed: the resulting closed boundary self-intersects.');
      }
    }
  }
  return {...entity,id:newId(),points:result};
}

export function chamferPolylineCorner<T extends CadEditableEntity>(entity: T, cornerIndex: number, distance: number): T {
  if (entity.type !== 'polyline' || !Number.isInteger(cornerIndex) || cornerIndex <= 0 || cornerIndex >= entity.points.length - 1) throw new Error('CHAMFER requires an internal polyline corner.');
  if (!finite(distance) || distance <= 0) throw new Error('Chamfer distance must be positive and finite.');
  if (entity.bulges?.some(value => Math.abs(value) > 1e-12)) throw new Error('CHAMFER currently requires straight adjacent polyline segments.');
  const pts = entity.points, prev = pts[cornerIndex - 1], corner = pts[cornerIndex], next = pts[cornerIndex + 1];
  const lenA = dist(prev, corner), lenB = dist(corner, next);
  if (!lenA || !lenB || distance >= lenA || distance >= lenB) throw new Error('Chamfer distance is too large for the adjacent segments.');
  const a = { x: corner.x + (prev.x - corner.x) * distance / lenA, y: corner.y + (prev.y - corner.y) * distance / lenA };
  const b = { x: corner.x + (next.x - corner.x) * distance / lenB, y: corner.y + (next.y - corner.y) * distance / lenB };
  const points=[...pts.slice(0, cornerIndex), a, b, ...pts.slice(cornerIndex + 1)].map(clonePoint);
  const bulges=entity.bulges ? Array(Math.max(0,points.length-1)).fill(0) : undefined;
  return { ...entity, points, ...(bulges ? {bulges} : {}) };
}
export function filletPolylineCorner<T extends CadEditableEntity>(entity:T,cornerIndex:number,radius:number):T {
  if(entity.type!=='polyline'||!Number.isInteger(cornerIndex)||cornerIndex<=0||cornerIndex>=entity.points.length-1)throw new Error('FILLET requires an internal polyline corner.');
  if(!finite(radius)||radius<=0)throw new Error('Fillet radius must be positive and finite.');
  if(entity.bulges?.some(value=>Math.abs(value)>1e-12))throw new Error('FILLET currently requires straight adjacent polyline segments.');
  const pts=entity.points,p0=pts[cornerIndex-1],p1=pts[cornerIndex],p2=pts[cornerIndex+1];
  const v1={x:p0.x-p1.x,y:p0.y-p1.y},v2={x:p2.x-p1.x,y:p2.y-p1.y};
  const l1=Math.hypot(v1.x,v1.y),l2=Math.hypot(v2.x,v2.y);
  if(!l1||!l2)throw new Error('Cannot fillet a zero-length segment.');
  const u1={x:v1.x/l1,y:v1.y/l1},u2={x:v2.x/l2,y:v2.y/l2};
  const angle=Math.acos(Math.max(-1,Math.min(1,u1.x*u2.x+u1.y*u2.y)));
  if(angle<1e-6||Math.PI-angle<1e-6)throw new Error('FILLET requires a non-collinear corner.');
  const tangent=radius/Math.tan(angle/2);
  if(tangent>=l1||tangent>=l2)throw new Error('Fillet radius is too large for the adjacent segments.');
  const start={x:p1.x+u1.x*tangent,y:p1.y+u1.y*tangent};
  const end={x:p1.x+u2.x*tangent,y:p1.y+u2.y*tangent};
  const bisector={x:u1.x+u2.x,y:u1.y+u2.y},bl=Math.hypot(bisector.x,bisector.y);
  const centerDistance=radius/Math.sin(angle/2);
  const center={x:p1.x+bisector.x/bl*centerDistance,y:p1.y+bisector.y/bl*centerDistance};
  const startAngle=Math.atan2(start.y-center.y,start.x-center.x);
  let sweep=Math.atan2(end.y-center.y,end.x-center.x)-startAngle;
  while(sweep>Math.PI)sweep-=2*Math.PI;
  while(sweep< -Math.PI)sweep+=2*Math.PI;
  const points=[...pts.slice(0,cornerIndex),start,end,...pts.slice(cornerIndex+1)].map(clonePoint);
  const bulges=Array(Math.max(0,points.length-1)).fill(0);
  // One non-zero bulge encodes the exact circular arc between tangent points.
  bulges[cornerIndex]=Math.tan(sweep/4);
  return {...entity,points,bulges};
}

/** Validate entity structure before persistence, exchange or a destructive edit. */
export function validateCadEntities(entities: CadEditableEntity[]): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  entities.forEach((entity, index) => {
    const label = entity.id || `entity[${index}]`;
    if (!entity.id || ids.has(entity.id)) issues.push(`${label}: missing or duplicate entity ID.`);
    ids.add(entity.id);
    if (!['line','polyline','rect','circle'].includes(entity.type)) issues.push(`${label}: unsupported entity type.`);
    if (typeof entity.layer !== 'string' || !entity.layer.trim()) issues.push(`${label}: layer name must not be empty.`);
    if (!Array.isArray(entity.points)) { issues.push(`${label}: points must be an array.`); return; }
    entity.points.forEach((point, pointIndex) => {
      if (!point || !finite(point.x) || !finite(point.y)) issues.push(`${label}: point ${pointIndex + 1} has non-finite coordinates.`);
    });
    const validPoints=entity.points.every(point=>point&&finite(point.x)&&finite(point.y));
    if (entity.type === 'line') {
      if (entity.points.length !== 2) issues.push(`${label}: a line must have exactly two points.`);
      else if(validPoints&&dist(entity.points[0],entity.points[1])<=1e-12)issues.push(`${label}: a line must have non-zero length.`);
    }
    if (entity.type === 'rect') {
      if (entity.points.length !== 2) issues.push(`${label}: a rectangle must have exactly two corner points.`);
      else if(validPoints&&(Math.abs(entity.points[0].x-entity.points[1].x)<=1e-12||Math.abs(entity.points[0].y-entity.points[1].y)<=1e-12))issues.push(`${label}: a rectangle must have non-zero width and height.`);
    }
    if (entity.type === 'polyline') {
      if (entity.points.length < 2) issues.push(`${label}: a polyline requires at least two points.`);
      if(validPoints)for(let pointIndex=0;pointIndex<entity.points.length-1;pointIndex++)if(dist(entity.points[pointIndex],entity.points[pointIndex+1])<=1e-12)issues.push(`${label}: consecutive polyline vertices must not coincide (segment ${pointIndex+1}).`);
    }
    if (entity.type === 'circle' && (entity.points.length !== 1 || !finite(entity.radius ?? NaN) || (entity.radius ?? 0) <= 0)) {
      issues.push(`${label}: a circle requires one centre point and a positive finite radius.`);
    }
    if (entity.bulges && (entity.type !== 'polyline' || !(entity.bulges.length === Math.max(0, entity.points.length - 1) || entity.bulges.length === entity.points.length) || entity.bulges.some(value => !finite(value)))) {
      issues.push(`${label}: polyline bulges must be finite and match the segment count.`);
    }
  });
  return issues;
}

/**
 * Edit a vertex grip without mutating the source entity.
 * Circle grip index 0 moves its centre; index 1 changes its radius using the supplied point.
 */
export function editEntityGrip<T extends CadEditableEntity>(entity: T, gripIndex: number, point: Point2D): T {
  assertPoint(point);
  if (!Number.isInteger(gripIndex) || gripIndex < 0) throw new Error('Grip index must be a non-negative integer.');
  if (entity.type === 'circle') {
    if (gripIndex === 0) return { ...entity, points: [clonePoint(point)] };
    if (gripIndex === 1) {
      const radius = dist(entity.points[0], point);
      if (radius <= Number.EPSILON) throw new Error('Circle radius must be greater than zero.');
      return { ...entity, radius };
    }
    throw new Error('Circle grip index must be 0 (centre) or 1 (radius).');
  }
  if (gripIndex >= entity.points.length) throw new Error('Grip index is outside the entity vertex range.');
  const points = entity.points.map((current, index) => index === gripIndex ? clonePoint(point) : clonePoint(current));
  if (entity.type === 'rect') {
    const [a,b] = points;
    return { ...entity, type: 'rect', points: [a,b] } as T;
  }
  return { ...entity, points } as T;
}

/** Scale geometry about a base point; non-uniform scaling of circular arcs is rejected. */
export function scaleEntities<T extends CadEditableEntity>(
  entities: T[], basePoint: Point2D, scaleX: number, scaleY = scaleX,
): T[] {
  assertPoint(basePoint);
  if (!finite(scaleX) || !finite(scaleY) || scaleX === 0 || scaleY === 0) {
    throw new Error('Scale factors must be finite and non-zero.');
  }
  return entities.map(entity => {
    const nonUniform = Math.abs(Math.abs(scaleX) - Math.abs(scaleY)) > 1e-10;
    if ((entity.type === 'circle' || entity.bulges?.some(value => Math.abs(value) > 1e-12)) && nonUniform) {
      throw new Error('Non-uniform scaling of circles or bulged circular arcs is not supported; use uniform scaling to preserve exact geometry.');
    }
    const points = entity.points.map(point => ({
      x: basePoint.x + (point.x - basePoint.x) * scaleX,
      y: basePoint.y + (point.y - basePoint.y) * scaleY,
    }));
    const radius = entity.type === 'circle' ? (entity.radius ?? 0) * Math.abs(scaleX) : entity.radius;
    const bulges = entity.bulges?.map(value => scaleX * scaleY < 0 ? -value : value);
    return { ...entity, points, ...(radius === undefined ? {} : { radius }), ...(bulges === undefined ? {} : { bulges }) };
  });
}

/** Trim one straight segment of an open polyline against a finite linear cutting edge. */
export function trimPolylineSegment<T extends CadEditableEntity>(
  entity: T, cutter: CadEditableEntity, pickPoint: Point2D, segmentIndex: number,
): T {
  if (entity.type !== 'polyline' || cutter.type !== 'line' || !Number.isInteger(segmentIndex) ||
      segmentIndex < 0 || segmentIndex >= entity.points.length - 1) {
    throw new Error('TRIM polyline requires an open polyline segment and a linear cutting edge.');
  }
  assertPoint(pickPoint);
  if (Math.abs(entity.bulges?.[segmentIndex] ?? 0) > 1e-12) throw new Error('TRIM of a curved polyline segment is not supported yet.');
  const a=entity.points[segmentIndex],b=entity.points[segmentIndex+1];
  const hit=segmentIntersection(a,b,cutter.points[0],cutter.points[1]);
  if(!hit)throw new Error('TRIM failed: the selected polyline segment does not intersect the finite cutting edge.');
  const points=entity.points.map(clonePoint);
  if(dist(pickPoint,a)<=dist(pickPoint,b))points[segmentIndex]=hit;
  else points[segmentIndex+1]=hit;
  return {...entity,points};
}

/** Extend one endpoint of a straight polyline segment to a finite linear boundary. */
export function extendPolylineSegment<T extends CadEditableEntity>(
  entity: T, boundary: CadEditableEntity, endpoint: 0 | 1, segmentIndex: number,
): T {
  if(entity.type!=='polyline'||boundary.type!=='line'||!Number.isInteger(segmentIndex)||
    segmentIndex<0||segmentIndex>=entity.points.length-1) {
    throw new Error('EXTEND polyline requires an open polyline segment and a linear boundary.');
  }
  if(Math.abs(entity.bulges?.[segmentIndex]??0)>1e-12)throw new Error('EXTEND of a curved polyline segment is not supported yet.');
  const segment:CadEditableEntity={id:entity.id,type:'line',points:[entity.points[segmentIndex],entity.points[segmentIndex+1]],layer:entity.layer};
  const extended=extendLine(segment,boundary,endpoint);
  const points=entity.points.map(clonePoint);
  points[segmentIndex]=clonePoint(extended.points[0]);
  points[segmentIndex+1]=clonePoint(extended.points[1]);
  return {...entity,points};
}

