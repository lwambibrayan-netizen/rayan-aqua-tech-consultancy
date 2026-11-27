import type { WaterComponentKind } from './water-cad';

export type CadPoint = { x: number; y: number };
export type CadPrimitive =
  | { kind:'line'; a:CadPoint; b:CadPoint; layer:string }
  | { kind:'circle'; center:CadPoint; radius:number; layer:string }
  | { kind:'polyline'; points:CadPoint[]; closed?:boolean; layer:string };
export type EngineeringBlockDefinition = {
  name:string;
  category:'pipework'|'valve'|'equipment'|'structure'|'instrument';
  description:string;
  units:'mm';
  basePoint:CadPoint;
  ports:Array<{id:string;point:CadPoint;directionDeg:number;nominalDiameterMm?:number}>;
  defaultProperties:Record<string,string|number|boolean>;
  primitives:CadPrimitive[];
  waterKind?:WaterComponentKind;
};
export type BlockInsert = {blockName:string;at:CadPoint;rotationDeg:number;scaleX:number;scaleY:number;layer:string;properties:Record<string,string|number|boolean>};
const line=(x1:number,y1:number,x2:number,y2:number,layer='SYMBOL')=>({kind:'line' as const,a:{x:x1,y:y1},b:{x:x2,y:y2},layer});
const circle=(x:number,y:number,r:number,layer='SYMBOL')=>({kind:'circle' as const,center:{x,y},radius:r,layer});
const poly=(points:CadPoint[],layer='SYMBOL',closed=false)=>({kind:'polyline' as const,points,layer,closed});
const port=(id:string,x:number,y:number,directionDeg:number,nominalDiameterMm=100)=>({id,point:{x,y},directionDeg,nominalDiameterMm});
export const ENGINEERING_BLOCK_LIBRARY:EngineeringBlockDefinition[]=[
 {name:'PIPE_BREAK',category:'pipework',description:'Conventional double-line pipe break symbol',units:'mm',basePoint:{x:0,y:0},ports:[port('in',-100,0,180),port('out',100,0,0)],defaultProperties:{nominalDiameterMm:100,material:'HDPE'},primitives:[line(-100,0,-18,0),line(18,0,100,0),line(-18,-18,18,18),line(-18,18,18,-18)],waterKind:'pipe'},
 {name:'GATE_VALVE',category:'valve',description:'Plan symbol for a gate valve with two connection ports',units:'mm',basePoint:{x:0,y:0},ports:[port('in',-100,0,180),port('out',100,0,0)],defaultProperties:{valveType:'gate',nominalDiameterMm:100},primitives:[line(-100,0,-25,0),line(25,0,100,0),poly([{x:-25,y:-30},{x:0,y:0},{x:-25,y:30}], 'SYMBOL'),poly([{x:25,y:-30},{x:0,y:0},{x:25,y:30}], 'SYMBOL'),line(0,0,0,48),circle(0,58,10)] ,waterKind:'valve'},
 {name:'CHECK_VALVE',category:'valve',description:'Plan symbol for a non-return/check valve',units:'mm',basePoint:{x:0,y:0},ports:[port('in',-100,0,180),port('out',100,0,0)],defaultProperties:{valveType:'check',nominalDiameterMm:100},primitives:[line(-100,0,-25,0),line(25,0,100,0),poly([{x:-25,y:-30},{x:25,y:0},{x:-25,y:30}], 'SYMBOL'),line(25,-35,25,35)],waterKind:'valve'},
 {name:'PRV',category:'valve',description:'Pressure reducing valve with downstream pressure setting',units:'mm',basePoint:{x:0,y:0},ports:[port('in',-100,0,180),port('out',100,0,0)],defaultProperties:{valveType:'PRV',valveSetting:3,nominalDiameterMm:100},primitives:[line(-100,0,-28,0),line(28,0,100,0),circle(0,0,28),line(-18,-18,18,18),line(-18,18,18,-18),line(0,28,0,65),circle(0,76,10)],waterKind:'valve'},
 {name:'PUMP_CENTRIFUGAL',category:'equipment',description:'Centrifugal pump plan symbol with suction and discharge ports',units:'mm',basePoint:{x:0,y:0},ports:[port('suction',-100,0,180),port('discharge',0,100,90)],defaultProperties:{pumpDutyFlowM3h:15,pumpDutyHeadM:40,pumpEfficiencyPct:75},primitives:[line(-100,0,-42,0),circle(0,0,42),poly([{x:-20,y:-24},{x:24,y:0},{x:-20,y:24}], 'SYMBOL'),line(0,42,0,100)],waterKind:'pump'},
 {name:'TANK_CIRCULAR',category:'structure',description:'Circular water tank footprint',units:'mm',basePoint:{x:0,y:0},ports:[port('outlet',0,-100,270)],defaultProperties:{tankCapacityM3:100,tankType:'ground'},primitives:[circle(0,0,100),circle(0,0,92),line(-100,0,100,0),line(0,-100,0,100)],waterKind:'tank'},
 {name:'AIR_VALVE',category:'instrument',description:'Air release valve on pipeline',units:'mm',basePoint:{x:0,y:0},ports:[port('main',-80,0,180),port('main-out',80,0,0)],defaultProperties:{nominalDiameterMm:50,valveType:'air-release'},primitives:[line(-80,0,-18,0),line(18,0,80,0),circle(0,0,18),line(0,18,0,52),circle(0,62,10)],waterKind:'air-valve'},
 {name:'WASHOUT',category:'valve',description:'Pipeline washout/drain valve symbol',units:'mm',basePoint:{x:0,y:0},ports:[port('main-in',-80,0,180),port('main-out',80,0,0),port('drain',0,-80,270)],defaultProperties:{nominalDiameterMm:50,valveType:'washout'},primitives:[line(-80,0,-18,0),line(18,0,80,0),circle(0,0,18),line(0,-18,0,-80)],waterKind:'washout'},
 {name:'METER',category:'instrument',description:'Inline flow meter symbol',units:'mm',basePoint:{x:0,y:0},ports:[port('in',-80,0,180),port('out',80,0,0)],defaultProperties:{nominalDiameterMm:100},primitives:[line(-80,0,-28,0),line(28,0,80,0),circle(0,0,28),line(-14,-14,14,14)] ,waterKind:'meter'},
 {name:'MANHOLE',category:'structure',description:'Circular access chamber symbol',units:'mm',basePoint:{x:0,y:0},ports:[],defaultProperties:{chamberLengthM:1.2,chamberWidthM:1.0,chamberDepthM:1.5},primitives:[circle(0,0,60),circle(0,0,52)],waterKind:'chamber'}
];
export function getEngineeringBlock(name:string):EngineeringBlockDefinition {
 const found=ENGINEERING_BLOCK_LIBRARY.find(item=>item.name===name);
 if(!found)throw new Error('Unknown engineering block: '+name);
 return {...found,basePoint:{...found.basePoint},ports:found.ports.map(p=>({...p,point:{...p.point}})),primitives:found.primitives.map(p=>p.kind==='line'?{...p,a:{...p.a},b:{...p.b}}:p.kind==='circle'?{...p,center:{...p.center}}:{...p,points:p.points.map(q=>({...q}))}),defaultProperties:{...found.defaultProperties}};
}
export function validateEngineeringBlock(block:EngineeringBlockDefinition):string[] {
 const issues:string[]=[];
 if(!block.name.trim())issues.push('Block name is required.');
 if(block.units!=='mm')issues.push('Engineering library blocks must use millimetres.');
 const ids=new Set<string>();
 for(const p of block.ports){if(!p.id.trim()||ids.has(p.id))issues.push('Port IDs must be unique and non-empty.');ids.add(p.id);if(![p.point.x,p.point.y,p.directionDeg].every(Number.isFinite))issues.push('Port geometry must be finite.');if(p.nominalDiameterMm!==undefined&&(!Number.isFinite(p.nominalDiameterMm)||p.nominalDiameterMm<=0))issues.push('Port diameter must be positive.');}
 for(const p of block.primitives){const pts=p.kind==='line'?[p.a,p.b]:p.kind==='circle'?[p.center]:p.points;if(pts.some(q=>!Number.isFinite(q.x)||!Number.isFinite(q.y)))issues.push('Primitive coordinates must be finite.');if(p.kind==='circle'&&(!Number.isFinite(p.radius)||p.radius<=0))issues.push('Circle radius must be positive.');if(p.kind==='polyline'&&p.points.length<2)issues.push('Polyline needs at least two points.');}
 return issues;
}
export function instantiateEngineeringBlock(insert:BlockInsert,library:EngineeringBlockDefinition[]=ENGINEERING_BLOCK_LIBRARY):CadPrimitive[] {
 const block=library.find(item=>item.name===insert.blockName);
 if(!block)throw new Error('Unknown engineering block: '+insert.blockName);
 if(![insert.at.x,insert.at.y,insert.rotationDeg,insert.scaleX,insert.scaleY].every(Number.isFinite)||insert.scaleX===0||insert.scaleY===0)throw new Error('Block insertion transform is invalid.');
 const angle=insert.rotationDeg*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
 const map=(p:CadPoint):CadPoint=>{const x=(p.x-block.basePoint.x)*insert.scaleX,y=(p.y-block.basePoint.y)*insert.scaleY;return{x:insert.at.x+x*c-y*s,y:insert.at.y+x*s+y*c};};
 return block.primitives.map(p=>p.kind==='line'?{...p,a:map(p.a),b:map(p.b),layer:insert.layer||p.layer}:p.kind==='circle'?{...p,center:map(p.center),radius:p.radius*Math.sqrt(Math.abs(insert.scaleX*insert.scaleY)),layer:insert.layer||p.layer}:{...p,points:p.points.map(map),layer:insert.layer||p.layer});
}
export function instantiateEngineeringPorts(insert:BlockInsert,block:EngineeringBlockDefinition):EngineeringBlockDefinition['ports'] {
 const angle=insert.rotationDeg*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
 return block.ports.map(p=>{const x=(p.point.x-block.basePoint.x)*insert.scaleX,y=(p.point.y-block.basePoint.y)*insert.scaleY;return {...p,point:{x:insert.at.x+x*c-y*s,y:insert.at.y+x*s+y*c},directionDeg:p.directionDeg+insert.rotationDeg};});
}
