/** Pure geometry helpers for professional CAD dimension tools.
 * Coordinates are model-space metres. Paper sizes remain millimetres in the caller.
 */
export type DimensionPoint = { x: number; y: number };
export type DimensionLine = { a: DimensionPoint; b: DimensionPoint };
export type DimensionArc = { center: DimensionPoint; radius: number; startAngleRad: number; endAngleRad: number };
export type AngularDimensionGeometry = {
  firstExtension: DimensionLine;
  secondExtension: DimensionLine;
  arc: DimensionArc;
  dimensionLine: DimensionLine;
  angleRad: number;
  labelPoint: DimensionPoint;
};
export type RadialDimensionGeometry = {
  centerMark: DimensionLine[];
  leader: DimensionLine;
  radius: number;
  labelPoint: DimensionPoint;
};
export type DiameterDimensionGeometry = RadialDimensionGeometry & { diameter: number; oppositePoint: DimensionPoint };
export type OrdinateDimensionGeometry = {
  originExtension: DimensionLine;
  featureExtension: DimensionLine;
  dimensionLine: DimensionLine;
  value: number;
  labelPoint: DimensionPoint;
};
const finitePoint = (p: DimensionPoint) => Number.isFinite(p.x) && Number.isFinite(p.y);
const distance = (a: DimensionPoint,b: DimensionPoint) => Math.hypot(b.x-a.x,b.y-a.y);
const add = (a: DimensionPoint,b: DimensionPoint): DimensionPoint => ({x:a.x+b.x,y:a.y+b.y});
const sub = (a: DimensionPoint,b: DimensionPoint): DimensionPoint => ({x:a.x-b.x,y:a.y-b.y});
const scale = (a: DimensionPoint,s:number): DimensionPoint => ({x:a.x*s,y:a.y*s});
const unit = (a: DimensionPoint): DimensionPoint => { const n=Math.hypot(a.x,a.y); if(n<=1e-12) throw new Error('Dimension direction cannot be zero.'); return scale(a,1/n); };
const rotate = (p:DimensionPoint,angle:number):DimensionPoint => ({x:p.x*Math.cos(angle)-p.y*Math.sin(angle),y:p.x*Math.sin(angle)+p.y*Math.cos(angle)});
function assertPoint(p:DimensionPoint,label:string){if(!finitePoint(p))throw new Error(label+' coordinates must be finite.');}
export function calculateAngularDimension(vertex:DimensionPoint,first:DimensionPoint,second:DimensionPoint,radiusM:number):AngularDimensionGeometry {
  assertPoint(vertex,'Vertex');assertPoint(first,'First ray');assertPoint(second,'Second ray');
  if(!Number.isFinite(radiusM)||radiusM<=0)throw new Error('Angular dimension radius must be positive.');
  const u=unit(sub(first,vertex)),v=unit(sub(second,vertex));
  let start=Math.atan2(u.y,u.x),end=Math.atan2(v.y,v.x);
  let sweep=(end-start+Math.PI*2)%(Math.PI*2);
  if(sweep>Math.PI){const temp=start;start=end;end=temp;sweep=Math.PI*2-sweep;}
  const mid=start+sweep/2;
  const arcStart=add(vertex,scale({x:Math.cos(start),y:Math.sin(start)},radiusM));
  const arcEnd=add(vertex,scale({x:Math.cos(end),y:Math.sin(end)},radiusM));
  const labelPoint=add(vertex,scale({x:Math.cos(mid),y:Math.sin(mid)},radiusM*1.18));
  return {firstExtension:{a:first,b:arcStart},secondExtension:{a:second,b:arcEnd},arc:{center:{...vertex},radius:radiusM,startAngleRad:start,endAngleRad:end},dimensionLine:{a:arcStart,b:arcEnd},angleRad:sweep,labelPoint};
}
export function calculateRadiusDimension(center:DimensionPoint,edge:DimensionPoint,leaderPoint:DimensionPoint):RadialDimensionGeometry {
  assertPoint(center,'Circle center');assertPoint(edge,'Circle edge');assertPoint(leaderPoint,'Leader point');
  const radius=distance(center,edge);if(radius<=1e-12)throw new Error('Radius dimension requires a non-zero radius.');
  if(distance(center,leaderPoint)<=1e-12)throw new Error('Radius leader cannot end at the circle center.');
  return {centerMark:[{a:{x:center.x- radius*.08,y:center.y},b:{x:center.x+radius*.08,y:center.y}},{a:{x:center.x,y:center.y-radius*.08},b:{x:center.x,y:center.y+radius*.08}}],leader:{a:center,b:leaderPoint},radius,labelPoint:leaderPoint};
}
export function calculateDiameterDimension(center:DimensionPoint,edge:DimensionPoint,leaderPoint:DimensionPoint):DiameterDimensionGeometry {
  const radial=calculateRadiusDimension(center,edge,leaderPoint);
  const direction=unit(sub(edge,center)),oppositePoint=sub(center,scale(direction,radial.radius));
  return {...radial,diameter:radial.radius*2,oppositePoint,leader:{a:oppositePoint,b:leaderPoint}};
}
export function calculateOrdinateDimension(origin:DimensionPoint,feature:DimensionPoint,axis:'x'|'y',offsetM:number):OrdinateDimensionGeometry {
  assertPoint(origin,'Ordinate origin');assertPoint(feature,'Ordinate feature');
  if(!Number.isFinite(offsetM)||offsetM===0)throw new Error('Ordinate dimension offset must be finite and non-zero.');
  const value=axis==='x'?feature.x-origin.x:feature.y-origin.y;
  const sign=Math.sign(offsetM),leaderGap=Math.abs(offsetM);
  if(axis==='x'){
    const y=feature.y+sign*leaderGap;
    return {originExtension:{a:origin,b:{x:origin.x,y}},featureExtension:{a:feature,b:{x:feature.x,y}},dimensionLine:{a:{x:origin.x,y},b:{x:feature.x,y}},value,labelPoint:{x:(origin.x+feature.x)/2,y}};
  }
  const x=feature.x+sign*leaderGap;
  return {originExtension:{a:origin,b:{x,y:origin.y}},featureExtension:{a:feature,b:{x,y:feature.y}},dimensionLine:{a:{x,y:origin.y},b:{x,y:feature.y}},value,labelPoint:{x,y:(origin.y+feature.y)/2}};
}
/** Generates repeated parallel dimensions from a shared datum (baseline). */
export function calculateBaselineDimensions(origin:DimensionPoint,features:DimensionPoint[],offsetM:number,axis:'x'|'y'='x'):OrdinateDimensionGeometry[] {
  return features.map(feature=>calculateOrdinateDimension(origin,feature,axis,offsetM));
}
/** Generates consecutive aligned dimensions between each adjacent point (chain). */
export function calculateChainDimensions(points:DimensionPoint[],offsetM:number):DimensionLine[] {
  if(!Number.isFinite(offsetM))throw new Error('Chain dimension offset must be finite.');
  if(points.length<2)throw new Error('A chain dimension needs at least two points.');
  points.forEach((p,i)=>assertPoint(p,'Chain point '+(i+1)));
  const lines:DimensionLine[]=[];
  for(let i=0;i<points.length-1;i++){
    const a=points[i],b=points[i+1],d=sub(b,a),n=unit({x:-d.y,y:d.x}),shift=scale(n,offsetM);
    if(distance(a,b)<=1e-12)throw new Error('Chain dimensions cannot contain zero-length segments.');
    lines.push({a:add(a,shift),b:add(b,shift)});
  }
  return lines;
}
