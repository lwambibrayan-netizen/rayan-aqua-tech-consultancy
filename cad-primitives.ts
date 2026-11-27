export type CadPoint = { x: number; y: number };
export type CadCircle = { id: string; type: 'circle'; points: [CadPoint]; radius: number; layer: string };
export type CadPolyline = { id: string; type: 'polyline'; points: CadPoint[]; bulges?: number[]; layer: string };

function distance(a: CadPoint, b: CadPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
function validPoint(point: CadPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}
function circumcentre(a: CadPoint, b: CadPoint, c: CadPoint): CadPoint {
  if (![a,b,c].every(validPoint)) throw new Error('Circle/arc points must be finite.');
  const d = 2 * (a.x*(b.y-c.y) + b.x*(c.y-a.y) + c.x*(a.y-b.y));
  if (Math.abs(d) < 1e-10) throw new Error('The three points are collinear; choose three distinct points on the circle.');
  const aa=a.x*a.x+a.y*a.y, bb=b.x*b.x+b.y*b.y, cc=c.x*c.x+c.y*c.y;
  return {
    x:(aa*(b.y-c.y)+bb*(c.y-a.y)+cc*(a.y-b.y))/d,
    y:(aa*(c.x-b.x)+bb*(a.x-c.x)+cc*(b.x-a.x))/d,
  };
}
export function circleFromCenterRadius(center: CadPoint, radiusPoint: CadPoint, id: string, layer: string): CadCircle {
  const radius=distance(center,radiusPoint);
  if (!validPoint(center) || !validPoint(radiusPoint) || !Number.isFinite(radius) || radius <= 1e-9) throw new Error('Circle radius must be greater than zero.');
  return { id, type:'circle', points:[{...center}], radius, layer };
}
export function circleFromDiameter(first: CadPoint, second: CadPoint, id: string, layer: string): CadCircle {
  const radius=distance(first,second)/2;
  if (!validPoint(first) || !validPoint(second) || radius <= 1e-9) throw new Error('Circle diameter must be greater than zero.');
  return { id, type:'circle', points:[{x:(first.x+second.x)/2,y:(first.y+second.y)/2}], radius, layer };
}
export function circleFromThreePoints(a: CadPoint, b: CadPoint, c: CadPoint, id: string, layer: string): CadCircle {
  const center=circumcentre(a,b,c);
  return circleFromCenterRadius(center,a,id,layer);
}
export function ellipseFromBounds(first: CadPoint, opposite: CadPoint, id: string, layer: string, segments=64): CadPolyline {
  if (![first,opposite].every(validPoint) || !Number.isInteger(segments) || segments < 16 || segments > 512) throw new Error('Ellipse bounds or segment count are invalid.');
  const rx=Math.abs(opposite.x-first.x)/2, ry=Math.abs(opposite.y-first.y)/2;
  if (rx <= 1e-9 || ry <= 1e-9) throw new Error('Ellipse major and minor axes must both be greater than zero.');
  const cx=(first.x+opposite.x)/2, cy=(first.y+opposite.y)/2;
  const points=Array.from({length:segments+1},(_,i)=>{
    const angle=2*Math.PI*i/segments;
    return {x:cx+rx*Math.cos(angle),y:cy+ry*Math.sin(angle)};
  });
  points[points.length-1]={...points[0]};
  return {id,type:'polyline',points,bulges:Array(segments+1).fill(0),layer};
}
export function arcFromThreePoints(start: CadPoint, through: CadPoint, end: CadPoint, id: string, layer: string): CadPolyline {
  const center=circumcentre(start,through,end);
  const a=Math.atan2(start.y-center.y,start.x-center.x);
  const m=Math.atan2(through.y-center.y,through.x-center.x);
  const b=Math.atan2(end.y-center.y,end.x-center.x);
  const tau=2*Math.PI, mod=(v:number)=>(v%tau+tau)%tau;
  const ccw=mod(b-a), middle=mod(m-a);
  const sweep=middle<=ccw+1e-10?ccw:ccw-tau;
  if (Math.abs(sweep)<1e-9 || Math.abs(Math.abs(sweep)-tau)<1e-9) throw new Error('Arc points do not define a valid sweep.');
  return {id,type:'polyline',points:[{...start},{...end}],bulges:[Math.tan(sweep/4),0],layer};
}

export function arcFromCenterStartAngle(center: CadPoint, start: CadPoint, sweepDegrees: number, id: string, layer: string): CadPolyline {
  if (![center,start].every(validPoint) || !Number.isFinite(sweepDegrees) || Math.abs(sweepDegrees) < 0.001 || Math.abs(sweepDegrees) >= 360) {
    throw new Error('Arc centre, start point and sweep angle must define a non-zero arc smaller than 360 degrees.');
  }
  const dx=start.x-center.x, dy=start.y-center.y, radius=Math.hypot(dx,dy);
  if (radius <= 1e-9) throw new Error('Arc radius must be greater than zero.');
  const sweep=sweepDegrees*Math.PI/180, cos=Math.cos(sweep), sin=Math.sin(sweep);
  const end={x:center.x+dx*cos-dy*sin,y:center.y+dx*sin+dy*cos};
  return {id,type:'polyline',points:[{...start},end],bulges:[Math.tan(sweep/4),0],layer};
}
