import { createWaterComponent, type WaterCadDocument, type WaterCadComponent, type WaterComponentKind } from './water-cad';
import type { NetworkDocument } from './water-network-engineering';

export type EpanetImportResult = { document: NetworkDocument; warnings: string[] };
const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n);
const num=(v:string|undefined,fallback=0)=>{const n=Number(v);return v!==undefined&&Number.isFinite(n)?n:fallback;};
const safe=(s:string)=>s.replace(/[^A-Za-z0-9_.-]/g,'_').slice(0,31)||'ID';
type Row={section:string; values:string[]; line:number};
const supported=new Set(['JUNCTIONS','RESERVOIRS','TANKS','PIPES','PUMPS','VALVES','COORDINATES','CURVES','OPTIONS','STATUS','DEMANDS','PATTERNS','EMITTERS','VERTICES']);
export function importEpanetInp(input:string, verticalDatum='EPANET imported elevations'):EpanetImportResult {
  const warnings:string[]=[];
  const rows:Row[]=[]; let section='';
  input.replace(/\r/g,'').split('\n').forEach((raw,index)=>{
    const line=raw.trim(); if(!line||line.startsWith(';')) return;
    const header=line.match(/^\[([^\]]+)\]$/);
    if(header){section=header[1].toUpperCase();if(!supported.has(section)) warnings.push('Unsupported EPANET section ['+section+'] was not imported.');return;}
    if(!section||line.startsWith(';')) return;
    rows.push({section,values:line.split(/\s+/),line:index+1});
  });
  const bySection=(name:string)=>rows.filter(row=>row.section===name);
  const coordinates=new Map<string,{x:number;y:number}>();
  bySection('COORDINATES').forEach(r=>{if(r.values.length>=3)coordinates.set(safe(r.values[0]),{x:num(r.values[1]),y:num(r.values[2])});});
  const nodes=new Map<string,WaterCadComponent>();
  const addNode=(idRaw:string,kind:WaterComponentKind,elevation:number,extra?:{flow?:number;level?:number;diameter?:number})=>{
    const id=safe(idRaw); if(nodes.has(id)){warnings.push('Duplicate node '+id+' at import line; duplicate skipped.');return;}
    const xy=coordinates.get(id)??{x:nodes.size*10,y:0};
    const c=createWaterComponent(kind,id,xy.x,xy.y); c.geometry[0].z=elevation;
    if(extra?.flow!==undefined)c.properties.flowM3h=extra.flow;
    if(extra?.level!==undefined)c.properties.tankOperatingLevelM=extra.level;
    if(extra?.diameter!==undefined)c.properties.tankDiameterM=extra.diameter;
    nodes.set(id,c);
  };
  bySection('JUNCTIONS').forEach(r=>{if(r.values.length<2){warnings.push('Malformed junction at line '+r.line+'.');return;}addNode(r.values[0],'junction',num(r.values[1]),{flow:num(r.values[2])*3.6});});
  bySection('RESERVOIRS').forEach(r=>{if(r.values.length<2){warnings.push('Malformed reservoir at line '+r.line+'.');return;}addNode(r.values[0],'reservoir',num(r.values[1]));});
  bySection('TANKS').forEach(r=>{if(r.values.length<6){warnings.push('Malformed tank at line '+r.line+'.');return;}addNode(r.values[0],'tank',num(r.values[1]),{level:num(r.values[2]),diameter:num(r.values[5])});});
  const components=[...nodes.values()];
  const addLink=(idRaw:string,kind:WaterComponentKind,fromRaw:string,toRaw:string,diameterMm:number,props:Record<string,number|string|undefined>={})=>{
    const from=nodes.get(safe(fromRaw)),to=nodes.get(safe(toRaw));
    if(!from||!to){warnings.push('Link '+idRaw+' references a missing node and was skipped.');return;}
    const id=safe(idRaw);if(components.some(c=>c.id===id)){warnings.push('Duplicate link ID '+id+' was skipped.');return;}
    const c=createWaterComponent(kind,id,from.geometry[0].x,from.geometry[0].y);
    c.geometry=[{...from.geometry[0]},{...to.geometry[0]}];c.fromNodeId=from.id;c.toNodeId=to.id;
    c.properties={...c.properties,tag:id,nominalDiameterMm:diameterMm||c.properties.nominalDiameterMm,...(props as object)};
    if(kind==='pipe')c.properties.internalDiameterMm=diameterMm;
    components.push(c);
  };
  bySection('PIPES').forEach(r=>{if(r.values.length<6){warnings.push('Malformed pipe at line '+r.line+'.');return;}addLink(r.values[0],'pipe',r.values[1],r.values[2],num(r.values[4]),{roughness:num(r.values[5],130),minorLossCoefficient:num(r.values[6]),description:'Imported from EPANET'});});
  bySection('PUMPS').forEach(r=>{if(r.values.length<3){warnings.push('Malformed pump at line '+r.line+'.');return;}addLink(r.values[0],'pump',r.values[1],r.values[2],0,{description:'Imported from EPANET pump link'});if(r.values.slice(3).join(' ').toUpperCase().includes('HEAD'))warnings.push('Pump '+r.values[0]+' curve reference imported as a link; curve data requires review before simulation.');});
  bySection('VALVES').forEach(r=>{
    if(r.values.length<5){warnings.push('Malformed valve at line '+r.line+'.');return;}
    const type=r.values[4].toUpperCase();const map:Record<string,WaterCadComponent['properties']['valveType']>={PRV:'PRV',PSV:'PSV',FCV:'control',TCV:'control',GPV:'control'};
    addLink(r.values[0],'valve',r.values[1],r.values[2],num(r.values[3]),{valveType:map[type]??'control',valveSetting:num(r.values[5]),description:'Imported EPANET '+type+' valve'});
    if(!map[type])warnings.push('Valve '+r.values[0]+' type '+type+' requires manual review.');
  });
  if(!components.length)warnings.push('No supported hydraulic nodes were found.');
  return {document:{schemaVersion:1,units:'m',verticalDatum,components},warnings};
}
export type HydraulicNodeResult={id:string;pressureM?:number;headM?:number;demandLps?:number;quality?:number};
export type HydraulicLinkResult={id:string;flowLps?:number;velocityMs?:number;headlossM?:number;status?:string};
export type HydraulicResults={timeSeconds:number;nodes:HydraulicNodeResult[];links:HydraulicLinkResult[]};
export function mergeEpanetRoundTrip(base:WaterCadDocument,imported:WaterCadDocument):WaterCadDocument {
  const original=new Map(base.components.map(c=>[c.id,c]));
  const merged=imported.components.map(c=>{
    const prior=original.get(c.id);if(!prior)return c;
    return {...c,properties:{...prior.properties,...c.properties},customPorts:prior.customPorts??c.customPorts};
  });
  return {...base,components:merged};
}
