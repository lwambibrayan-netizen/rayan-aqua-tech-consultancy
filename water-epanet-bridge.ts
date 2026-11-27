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
  const unitLine=bySection('OPTIONS').find(r=>r.values[0]?.toUpperCase()==='UNITS');
  const flowUnit=(unitLine?.values[1]??'LPS').toUpperCase();
  const usUnits=['CFS','GPM','MGD','IMGD','AFD'].includes(flowUnit);
  const flowToM3h=(value:number)=>flowUnit==='LPS'?value*3.6:flowUnit==='LPM'?value*0.06:flowUnit==='MLD'?value*41.6666667:flowUnit==='CMH'?value:flowUnit==='CMD'?value/24:flowUnit==='GPM'?value*0.2271247:flowUnit==='CFS'?value*101.940647:flowUnit==='CMS'?value*3600:flowUnit==='MGD'?value*157.72549:flowUnit==='IMGD'?value*189.4204:flowUnit==='AFD'?value*51.395:value*3.6;
  const lengthToM=(value:number)=>usUnits?value*0.3048:value;
  const diameterToMm=(value:number)=>usUnits?value*25.4:value;
  const headToM=(value:number)=>usUnits?value*0.3048:value;
  const nodes=new Map<string,WaterCadComponent>();
  const addNode=(idRaw:string,kind:WaterComponentKind,elevation:number,extra?:{flow?:number;level?:number;diameter?:number;head?:number})=>{
    const id=safe(idRaw); if(nodes.has(id)){warnings.push('Duplicate node '+id+' at import line; duplicate skipped.');return;}
    const xy=coordinates.get(id)??{x:nodes.size*10,y:0};
    const c=createWaterComponent(kind,id,xy.x,xy.y); c.properties.hydraulicElevationM=elevation; if(extra?.head!==undefined)c.properties.hydraulicHeadM=extra.head;
    if(extra?.flow!==undefined)c.properties.flowM3h=extra.flow;
    if(extra?.level!==undefined)c.properties.tankOperatingLevelM=extra.level;
    if(extra?.diameter!==undefined)c.properties.tankDiameterM=extra.diameter;
    nodes.set(id,c);
  };
  bySection('JUNCTIONS').forEach(r=>{if(r.values.length<2){warnings.push('Malformed junction at line '+r.line+'.');return;}addNode(r.values[0],'junction',headToM(num(r.values[1])),{flow:flowToM3h(num(r.values[2]))});});
  bySection('RESERVOIRS').forEach(r=>{if(r.values.length<2){warnings.push('Malformed reservoir at line '+r.line+'.');return;}addNode(r.values[0],'reservoir',headToM(num(r.values[1])),{head:headToM(num(r.values[1]))});});
  bySection('TANKS').forEach(r=>{if(r.values.length<6){warnings.push('Malformed tank at line '+r.line+'.');return;}addNode(r.values[0],'tank',headToM(num(r.values[1])),{level:headToM(num(r.values[2])),diameter:usUnits?num(r.values[5])*0.3048:num(r.values[5])});
  bySection('TANKS').forEach(r=>{const tank=nodes.get(safe(r.values[0]));if(tank){tank.properties.tankMinLevelM=headToM(num(r.values[3]));tank.properties.tankMaxLevelM=headToM(num(r.values[4]));tank.properties.tankMinVolumeM3=usUnits?num(r.values[6])*0.0283168466:num(r.values[6]);}});});
  const components=[...nodes.values()];
  const addLink=(idRaw:string,kind:WaterComponentKind,fromRaw:string,toRaw:string,diameterMm:number,props:Partial<WaterCadComponent['properties']>={})=>{
    const from=nodes.get(safe(fromRaw)),to=nodes.get(safe(toRaw));
    if(!from||!to){warnings.push('Link '+idRaw+' references a missing node and was skipped.');return;}
    const id=safe(idRaw);if(components.some(c=>c.id===id)){warnings.push('Duplicate link ID '+id+' was skipped.');return;}
    const c=createWaterComponent(kind,id,from.geometry[0].x,from.geometry[0].y);
    c.geometry=[{...from.geometry[0]},{...to.geometry[0]}];c.fromNodeId=from.id;c.toNodeId=to.id;
    if(kind!=='pipe') c.customPorts=[
      {id:'INLET',point:{...from.geometry[0]},role:'inlet',diameterMm:diameterMm||undefined},
      {id:'OUTLET',point:{...to.geometry[0]},role:'outlet',diameterMm:diameterMm||undefined},
    ];
    c.properties={...c.properties,tag:id,nominalDiameterMm:diameterMm||c.properties.nominalDiameterMm,...props};
    if(kind==='pipe')c.properties.internalDiameterMm=diameterMm;
    components.push(c);
  };
  bySection('PIPES').forEach(r=>{
    if(r.values.length<6){warnings.push('Malformed pipe at line '+r.line+'.');return;}
    const length=lengthToM(num(r.values[3]));const diameter=diameterToMm(num(r.values[4]));
    if(!(length>0)||!(diameter>0)){warnings.push('Pipe '+r.values[0]+' has invalid length or diameter and was skipped.');return;}
    const checkValve=(r.values[7]??'OPEN').toUpperCase()==='CV';
    addLink(r.values[0],checkValve?'valve':'pipe',r.values[1],r.values[2],diameter,{hydraulicLengthM:length,roughness:num(r.values[5],130),minorLossCoefficient:num(r.values[6]),initialStatus:checkValve?undefined:((r.values[7]??'OPEN').toUpperCase()==='CLOSED'?'CLOSED':'OPEN'),valveType:checkValve?'check':undefined,description:'Imported from EPANET'});
  });
  const pumpCurves=new Map<string,Array<{flowM3h:number;headM:number}>>();
  bySection('CURVES').forEach(r=>{if(r.values.length>=3){const id=safe(r.values[0]);const points=pumpCurves.get(id)??[];points.push({flowM3h:flowToM3h(num(r.values[1])),headM:headToM(num(r.values[2]))});pumpCurves.set(id,points);}});
  bySection('PUMPS').forEach(r=>{
    if(r.values.length<3){warnings.push('Malformed pump at line '+r.line+'.');return;}
    const headIndex=r.values.findIndex(value=>value.toUpperCase()==='HEAD');
    const powerIndex=r.values.findIndex(value=>value.toUpperCase()==='POWER');
    const speedIndex=r.values.findIndex(value=>value.toUpperCase()==='SPEED');
    const patternIndex=r.values.findIndex(value=>value.toUpperCase()==='PATTERN');
    const curveId=headIndex>=0?r.values[headIndex+1]:undefined;
    const points=curveId?pumpCurves.get(safe(curveId)):undefined;
    addLink(r.values[0],'pump',r.values[1],r.values[2],0,{
      description:'Imported from EPANET pump link',
      epanetPumpCurveId:curveId,
      pumpCurvePoints:points,
      pumpPowerKw:powerIndex>=0?num(r.values[powerIndex+1])*(usUnits?0.745699872:1):undefined,
      pumpSpeedMultiplier:speedIndex>=0?num(r.values[speedIndex+1],1):undefined,
      pumpSpeedPattern:patternIndex>=0?r.values[patternIndex+1]:undefined,
      pumpDutyFlowM3h:points?.length===1?points[0].flowM3h:undefined,
      pumpDutyHeadM:points?.length===1?points[0].headM:undefined
    });
    if(curveId&&!points?.length)warnings.push('Pump '+r.values[0]+' references missing curve '+curveId+'; add or repair its pump curve before simulation.');
    if(!curveId&&powerIndex<0)warnings.push('Pump '+r.values[0]+' uses a non-HEAD/POWER or unsupported pump definition; manual pump model review is required.');
  });
  bySection('VALVES').forEach(r=>{
    if(r.values.length<5){warnings.push('Malformed valve at line '+r.line+'.');return;}
    const type=r.values[4].toUpperCase();const map:Record<string,WaterCadComponent['properties']['valveType']>={PRV:'PRV',PSV:'PSV',PBV:'PBV',FCV:'FCV',TCV:'TCV',GPV:'GPV',PCV:'PCV'};
    const rawSetting=num(r.values[5]);const setting=type==='FCV'?flowToM3h(rawSetting)*1000/3600:['PRV','PSV','PBV'].includes(type)?headToM(rawSetting):rawSetting;
    addLink(r.values[0],'valve',r.values[1],r.values[2],diameterToMm(num(r.values[3])),{valveType:map[type]??'control',valveSetting:setting,description:'Imported EPANET '+type+' valve'});
    if(!map[type]||type==='GPV'||type==='PCV')warnings.push('Valve '+r.values[0]+' type '+type+' requires a supported curve/engine mapping review before re-export.');
  });
  const referenced=new Set(rows.filter(r=>['PIPES','PUMPS','VALVES'].includes(r.section)).flatMap(r=>r.values.slice(1,3)).map(safe));
  const missingCoordinates=[...referenced].filter(id=>!coordinates.has(id));
  if(missingCoordinates.length)warnings.push('No [COORDINATES] entry for '+missingCoordinates.length+' network node(s). Synthetic layout positions were assigned; spatial geometry must be surveyed or imported before engineering 3D use.');
  if(coordinates.size)warnings.push('EPANET [COORDINATES] have no guaranteed CRS or unit metadata. They are retained as unreferenced plan coordinates; assign or transform the project CRS before terrain overlay or metric 3D routing. EPANET node elevations are retained separately as hydraulic elevations, not treated as pipe inverts.');
  if(!components.length)warnings.push('No supported hydraulic nodes were found.');
  return {document:{schemaVersion:1,units:'m',verticalDatum,horizontalCrs:'UNREFERENCED',horizontalUnits:'unknown',components},warnings};
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
