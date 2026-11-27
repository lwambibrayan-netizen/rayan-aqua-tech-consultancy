import { createWaterComponent, type WaterCadDocument, type WaterCadComponent, type WaterComponentKind } from './water-cad';
import { getWaterPorts, type NetworkDocument } from './water-network-engineering';

export type EpanetImportResult = { document: NetworkDocument; warnings: string[] };
const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n);
const num=(v:string|undefined,fallback=0)=>{const n=Number(v);return v!==undefined&&Number.isFinite(n)?n:fallback;};
const safe=(s:string)=>s.replace(/[^A-Za-z0-9_.-]/g,'_').slice(0,31)||'ID';
type Row={section:string; values:string[]; line:number};
const supported=new Set(['JUNCTIONS','RESERVOIRS','TANKS','PIPES','PUMPS','VALVES','COORDINATES','CURVES','OPTIONS','STATUS','DEMANDS','PATTERNS','EMITTERS','VERTICES','TIMES']);
export function importEpanetInp(input:string, verticalDatum='EPANET imported elevations'):EpanetImportResult {
  const warnings:string[]=[];
  const rows:Row[]=[]; let section='';
  input.replace(/\r/g,'').split('\n').forEach((raw,index)=>{
    const line=raw.trim(); if(!line||line.startsWith(';')) return;
    const header=line.match(/^\[([^\]]+)\]$/);
    if(header){section=header[1].toUpperCase();if(!supported.has(section)) warnings.push('Unsupported EPANET section ['+section+'] was not imported.');return;}
    if(!section||line.startsWith(';')) return;
    const dataLine=line.split(';')[0].trim();
    if(!dataLine)return;
    rows.push({section,values:dataLine.split(/\s+/),line:index+1});
  });
  const bySection=(name:string)=>rows.filter(row=>row.section===name);
  const coordinates=new Map<string,{x:number;y:number}>();
  bySection('COORDINATES').forEach(r=>{if(r.values.length>=3)coordinates.set(safe(r.values[0]),{x:num(r.values[1]),y:num(r.values[2])});});
  const vertices=new Map<string,Array<{x:number;y:number}>>();
  bySection('VERTICES').forEach(r=>{if(r.values.length>=3){const id=safe(r.values[0]);const list=vertices.get(id)??[];list.push({x:num(r.values[1]),y:num(r.values[2])});vertices.set(id,list);}});
  const parseTime=(value:string|undefined,fallback:number)=>{if(!value)return fallback;const parts=value.split(':').map(Number);if(parts.some(part=>!Number.isFinite(part)))return fallback;return parts.length===1?parts[0]*3600:parts[0]*3600+(parts[1]??0)*60+(parts[2]??0);};
  const unitLine=bySection('OPTIONS').find(r=>r.values[0]?.toUpperCase()==='UNITS');
  const flowUnit=(unitLine?.values[1]??'LPS').toUpperCase();
  const usUnits=['CFS','GPM','MGD','IMGD','AFD'].includes(flowUnit);
  const flowToM3h=(value:number)=>flowUnit==='LPS'?value*3.6:flowUnit==='LPM'?value*0.06:flowUnit==='MLD'?value*41.6666667:flowUnit==='CMH'?value:flowUnit==='CMD'?value/24:flowUnit==='GPM'?value*0.2271247:flowUnit==='CFS'?value*101.940647:flowUnit==='CMS'?value*3600:flowUnit==='MGD'?value*157.72549:flowUnit==='IMGD'?value*189.4204:flowUnit==='AFD'?value*51.395:value*3.6;
  const lengthToM=(value:number)=>usUnits?value*0.3048:value;
  const diameterToMm=(value:number)=>usUnits?value*25.4:value;
  const headToM=(value:number)=>usUnits?value*0.3048:value;
  const pressureToM=(value:number)=>usUnits?value*0.70307:value;
  const flowToLps=(value:number)=>flowToM3h(value)*1000/3600;
  const emitterToLpsSqrtM=(value:number)=>value*flowToLps(1)/Math.sqrt(usUnits?0.70307:1);
  const optionValue=(key:string,fallback:string)=>bySection('OPTIONS').find(r=>r.values[0]?.toUpperCase()===key)?.values[1]??fallback;
  const headlossRaw=optionValue('HEADLOSS','H-W').toUpperCase();
  const headlossFormula=headlossRaw==='D-W'?'D-W':headlossRaw==='C-M'?'C-M':'H-W';
  const timeRows=new Map(bySection('TIMES').map(row=>[row.values.slice(0,-1).join(' ').toUpperCase(),row.values[row.values.length-1]]));
  const times=(key:string,fallback:number)=>parseTime(timeRows.get(key),fallback);
  const epanetTimes={durationSeconds:times('DURATION',0),hydraulicStepSeconds:times('HYDRAULIC TIMESTEP',3600),patternStepSeconds:times('PATTERN TIMESTEP',3600),patternStartSeconds:times('PATTERN START',0),reportStepSeconds:times('REPORT TIMESTEP',3600),reportStartSeconds:times('REPORT START',0)};
  const linkStatuses=new Map<string,'OPEN'|'CLOSED'>();
  bySection('STATUS').forEach(row=>{
    const status=(row.values[1]??'').toUpperCase();
    if(status==='OPEN'||status==='CLOSED')linkStatuses.set(safe(row.values[0]),status);
    else if(row.values.length>1)warnings.push('Unsupported numeric/active link status for '+row.values[0]+' at line '+row.line+' was not preserved.');
  });
  const patternMap=new Map<string,number[]>();
  bySection('PATTERNS').forEach(r=>{const id=safe(r.values[0]);const values=patternMap.get(id)??[];values.push(...r.values.slice(1).map(Number).filter(Number.isFinite));patternMap.set(id,values);});
  const nodes=new Map<string,WaterCadComponent>();
  const addNode=(idRaw:string,kind:WaterComponentKind,elevation:number|null,extra?:{flow?:number;level?:number;diameter?:number;head?:number;demandPatternId?:string;headPatternId?:string})=>{
    const id=safe(idRaw); if(nodes.has(id)){warnings.push('Duplicate node '+id+' at import line; duplicate skipped.');return;}
    const xy=coordinates.get(id)??{x:nodes.size*10,y:0};
    const c=createWaterComponent(kind,id,xy.x,xy.y); if(elevation!==null)c.properties.hydraulicElevationM=elevation; if(extra?.head!==undefined)c.properties.hydraulicHeadM=extra.head; if(extra?.demandPatternId)c.properties.demandPatternId=safe(extra.demandPatternId); if(extra?.headPatternId)c.properties.hydraulicHeadPatternId=safe(extra.headPatternId);
    if(extra?.flow!==undefined)c.properties.flowM3h=extra.flow;
    if(extra?.level!==undefined)c.properties.tankOperatingLevelM=extra.level;
    if(extra?.diameter!==undefined)c.properties.tankDiameterM=extra.diameter;
    nodes.set(id,c);
  };
  bySection('JUNCTIONS').forEach(r=>{if(r.values.length<2){warnings.push('Malformed junction at line '+r.line+'.');return;}addNode(r.values[0],'junction',headToM(num(r.values[1])),{flow:flowToM3h(num(r.values[2])),demandPatternId:r.values[3]});});
  bySection('DEMANDS').forEach(r=>{const node=nodes.get(safe(r.values[0]));if(!node||r.values.length<2){warnings.push('Secondary demand at line '+r.line+' references a missing node or is malformed.');return;}const demand={flowM3h:flowToM3h(num(r.values[1])),patternId:r.values[2]?safe(r.values[2]):undefined};node.properties.additionalDemands=[...(node.properties.additionalDemands??[]),demand];});
  bySection('EMITTERS').forEach(r=>{const node=nodes.get(safe(r.values[0]));if(!node||r.values.length<2){warnings.push('Emitter at line '+r.line+' references a missing node or is malformed.');return;}node.properties.emitterCoefficient=emitterToLpsSqrtM(num(r.values[1]));});
  bySection('RESERVOIRS').forEach(r=>{if(r.values.length<2){warnings.push('Malformed reservoir at line '+r.line+'.');return;}addNode(r.values[0],'reservoir',null,{head:headToM(num(r.values[1])),headPatternId:r.values[2]});});
  bySection('TANKS').forEach(r=>{
    if(r.values.length<6){warnings.push('Malformed tank at line '+r.line+'.');return;}
    addNode(r.values[0],'tank',headToM(num(r.values[1])),{level:headToM(num(r.values[2])),diameter:usUnits?num(r.values[5])*0.3048:num(r.values[5])});
    const tank=nodes.get(safe(r.values[0]));
    if(tank){
      tank.properties.tankMinLevelM=headToM(num(r.values[3]));
      tank.properties.tankMaxLevelM=headToM(num(r.values[4]));
      tank.properties.tankMinVolumeM3=usUnits?num(r.values[6])*0.0283168466:num(r.values[6]);
    }
  });
  const components=[...nodes.values()];
  const addLink=(idRaw:string,kind:WaterComponentKind,fromRaw:string,toRaw:string,diameterMm:number,props:Partial<WaterCadComponent['properties']>={},intermediate:Array<{x:number;y:number}>=[])=>{
    const from=nodes.get(safe(fromRaw)),to=nodes.get(safe(toRaw));
    if(!from||!to){warnings.push('Link '+idRaw+' references a missing node and was skipped.');return;}
    const id=safe(idRaw);if(components.some(c=>c.id===id)){warnings.push('Duplicate link ID '+id+' was skipped.');return;}
    const c=createWaterComponent(kind,id,from.geometry[0].x,from.geometry[0].y);
    c.geometry=[{...from.geometry[0]},...intermediate.map(point=>({...point})),{...to.geometry[0]}];c.fromNodeId=from.id;c.toNodeId=to.id;
    if(kind!=='pipe') c.customPorts=[
      {id:'INLET',point:{...from.geometry[0]},role:'inlet',diameterMm:diameterMm||undefined},
      {id:'OUTLET',point:{...to.geometry[0]},role:'outlet',diameterMm:diameterMm||undefined},
    ];
    c.properties={...c.properties,tag:id,nominalDiameterMm:diameterMm||c.properties.nominalDiameterMm,...props};
    if(kind==='pipe'){c.properties.internalDiameterMm=diameterMm;c.properties.externalDiameterMm=undefined;}
    components.push(c);
  };
  bySection('PIPES').forEach(r=>{
    if(r.values.length<6){warnings.push('Malformed pipe at line '+r.line+'.');return;}
    const length=lengthToM(num(r.values[3]));const diameter=diameterToMm(num(r.values[4]));
    if(!(length>0)||!(diameter>0)){warnings.push('Pipe '+r.values[0]+' has invalid length or diameter and was skipped.');return;}
    const checkValve=(r.values[7]??'OPEN').toUpperCase()==='CV';
    addLink(r.values[0],checkValve?'valve':'pipe',r.values[1],r.values[2],diameter,{hydraulicLengthM:length,roughness:num(r.values[5],130),minorLossCoefficient:num(r.values[6]),initialStatus:checkValve?linkStatuses.get(safe(r.values[0])):((linkStatuses.get(safe(r.values[0]))??r.values[7]??'OPEN').toUpperCase()==='CLOSED'?'CLOSED':'OPEN'),valveType:checkValve?'check':undefined,description:'Imported from EPANET'},vertices.get(safe(r.values[0]))??[]);
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
      initialStatus:linkStatuses.get(safe(r.values[0]))??'OPEN',
      epanetPumpCurveId:curveId,
      pumpCurvePoints:points,
      pumpPowerKw:powerIndex>=0?num(r.values[powerIndex+1])*(usUnits?0.745699872:1):undefined,
      pumpSpeedMultiplier:speedIndex>=0?num(r.values[speedIndex+1],1):undefined,
      pumpSpeedPattern:patternIndex>=0?safe(r.values[patternIndex+1]):undefined,
      pumpDutyFlowM3h:points?.length===1?points[0].flowM3h:undefined,
      pumpDutyHeadM:points?.length===1?points[0].headM:undefined
    });
    if(curveId&&!points?.length)warnings.push('Pump '+r.values[0]+' references missing curve '+curveId+'; add or repair its pump curve before simulation.');
    if(!curveId&&powerIndex<0)warnings.push('Pump '+r.values[0]+' uses a non-HEAD/POWER or unsupported pump definition; manual pump model review is required.');
  });
  const usedPumpCurves=new Set(bySection('PUMPS').map(r=>{const index=r.values.findIndex(value=>value.toUpperCase()==='HEAD');return index>=0?safe(r.values[index+1]??''):'';}));
  [...pumpCurves.keys()].filter(id=>!usedPumpCurves.has(id)).forEach(id=>warnings.push('Curve '+id+' is not referenced by a supported HEAD pump; curve type and data were not preserved.'));
  bySection('VALVES').forEach(r=>{
    if(r.values.length<5){warnings.push('Malformed valve at line '+r.line+'.');return;}
    const type=r.values[4].toUpperCase();const map:Record<string,WaterCadComponent['properties']['valveType']>={PRV:'PRV',PSV:'PSV',PBV:'PBV',FCV:'FCV',TCV:'TCV',GPV:'GPV',PCV:'PCV'};
    const rawSetting=num(r.values[5]);const setting=type==='FCV'?flowToM3h(rawSetting)*1000/3600:['PRV','PSV','PBV'].includes(type)?pressureToM(rawSetting):rawSetting;
    addLink(r.values[0],'valve',r.values[1],r.values[2],diameterToMm(num(r.values[3])),{valveType:map[type]??'control',valveSetting:setting,minorLossCoefficient:num(r.values[6]),initialStatus:linkStatuses.get(safe(r.values[0]))??'OPEN',description:'Imported EPANET '+type+' valve'});
    if(!map[type]||type==='GPV'||type==='PCV')warnings.push('Valve '+r.values[0]+' type '+type+' requires a supported curve/engine mapping review before re-export.');
  });
  const referenced=new Set(rows.filter(r=>['PIPES','PUMPS','VALVES'].includes(r.section)).flatMap(r=>r.values.slice(1,3)).map(safe));
  const missingCoordinates=[...referenced].filter(id=>!coordinates.has(id));
  if(missingCoordinates.length)warnings.push('No [COORDINATES] entry for '+missingCoordinates.length+' network node(s). Synthetic layout positions were assigned; spatial geometry must be surveyed or imported before engineering 3D use.');
  if(coordinates.size)warnings.push('EPANET [COORDINATES] have no guaranteed CRS or unit metadata. They are retained as unreferenced plan coordinates; assign or transform the project CRS before terrain overlay or metric 3D routing. EPANET node elevations are retained separately as hydraulic elevations, not treated as pipe inverts.');
  const referencedPatterns=components.flatMap(component=>[component.properties.demandPatternId,component.properties.pumpSpeedPattern,component.properties.hydraulicHeadPatternId]).filter((value):value is string=>!!value);
  referencedPatterns.forEach(id=>{if(!patternMap.has(id))warnings.push('Pattern '+id+' is referenced but its [PATTERNS] definition is missing.');});
  if(!components.length)warnings.push('No supported hydraulic nodes were found.');
  return {document:{schemaVersion:1,units:'m',verticalDatum,horizontalCrs:'UNREFERENCED',horizontalUnits:'unknown',components,epanetPatterns:[...patternMap].map(([id,multipliers])=>({id,multipliers})),epanetHeadlossFormula:headlossFormula,epanetSpecificGravity:num(optionValue('SPECIFIC GRAVITY','1'),1),epanetViscosity:num(optionValue('VISCOSITY','1'),1),epanetTrials:num(optionValue('TRIALS','40'),40),epanetAccuracy:num(optionValue('ACCURACY','0.001'),0.001),epanetTimes},warnings};
}
export type HydraulicNodeResult={id:string;pressureM?:number;headM?:number;demandLps?:number;quality?:number};
export type HydraulicLinkResult={id:string;flowLps?:number;velocityMs?:number;headlossM?:number;status?:string};
export type HydraulicResults={timeSeconds:number;nodes:HydraulicNodeResult[];links:HydraulicLinkResult[]};
/** Converts saved OWA-EPANET snapshots into CAD/GIS overlay frames without changing solver values. */
export function epanetSimulationToHydraulicSeries(simulation:unknown):HydraulicResults[] {
  if(!simulation||typeof simulation!=='object')return [];
  const source=simulation as Record<string,any>;
  const snapshots=Array.isArray(source.snapshots)?source.snapshots:[];
  const frames:HydraulicResults[]=snapshots.map((snapshot:any)=>{
    const hours=Number(snapshot?.timeHours);
    if(!Number.isFinite(hours)||hours<0)return null;
    return {
      timeSeconds:Math.round(hours*3600),
      nodes:(Array.isArray(snapshot.nodes)?snapshot.nodes:[]).filter((node:any)=>node&&typeof node.id==='string').map((node:any)=>({id:node.id,...(Number.isFinite(Number(node.pressure))?{pressureM:Number(node.pressure)}:{}),...(Number.isFinite(Number(source.nodeHeads?.[node.id]))?{headM:Number(source.nodeHeads[node.id])}:{})})),
      links:(Array.isArray(snapshot.links)?snapshot.links:[]).filter((link:any)=>link&&typeof link.id==='string').map((link:any)=>({id:link.id,...(Number.isFinite(Number(link.flow))?{flowLps:Number(link.flow)}:{}),...(Number.isFinite(Number(link.velocity))?{velocityMs:Number(link.velocity)}:{}),...(Number.isFinite(Number(link.headloss))?{headlossM:Number(link.headloss)}:{}),...(typeof link.status==='string'?{status:link.status}:{})}))
    };
  }).filter((frame):frame is HydraulicResults=>frame!==null);
  if(frames.length)return frames.sort((a,b)=>a.timeSeconds-b.timeSeconds);
  const nodes=Array.isArray(source.nodes)?source.nodes:[];
  const links=Array.isArray(source.links)?source.links:[];
  const fallbackTime=Number(source.simulationHours??0)*3600;
  if(!nodes.length&&!links.length)return [];
  return [{
    timeSeconds:Number.isFinite(fallbackTime)&&fallbackTime>=0?Math.round(fallbackTime):0,
    nodes:nodes.filter((node:any)=>node&&typeof node.id==='string').map((node:any)=>({id:node.id,...(Number.isFinite(Number(node.pressure))?{pressureM:Number(node.pressure)}:{}),...(Number.isFinite(Number(node.head))?{headM:Number(node.head)}:{})})),
    links:links.filter((link:any)=>link&&typeof link.id==='string').map((link:any)=>({id:link.id,...(Number.isFinite(Number(link.flow))?{flowLps:Number(link.flow)}:{}),...(Number.isFinite(Number(link.velocity))?{velocityMs:Number(link.velocity)}:{}),...(Number.isFinite(Number(link.headloss))?{headlossM:Number(link.headloss)}:{}),...(typeof link.status==='string'?{status:link.status}:{})}))
  }];
}
export function mergeEpanetRoundTrip(base:WaterCadDocument,imported:WaterCadDocument):WaterCadDocument {
  const original=new Map(base.components.map(c=>[c.id,c]));
  const hydraulicKinds=new Set<WaterComponentKind>(['pipe','pump','valve','junction','source','tank','reservoir']);
  const importedIds=new Set(imported.components.map(c=>c.id));
  const propertyKeys:Partial<Record<WaterComponentKind,Array<keyof WaterCadComponent['properties']>>> = {
    pipe:['nominalDiameterMm','internalDiameterMm','hydraulicLengthM','roughness','minorLossCoefficient','initialStatus'],
    pump:['pumpCurvePoints','epanetPumpCurveId','pumpDutyFlowM3h','pumpDutyHeadM','pumpPowerKw','pumpSpeedMultiplier','pumpSpeedPattern'],
    valve:['valveType','valveSetting','nominalDiameterMm','internalDiameterMm','hydraulicLengthM'],
    junction:['hydraulicElevationM','flowM3h','demandPatternId','additionalDemands','emitterCoefficient'],
    source:['hydraulicHeadM','hydraulicHeadPatternId','hydraulicElevationM'],
    reservoir:['hydraulicHeadM','hydraulicHeadPatternId','hydraulicElevationM'],
    tank:['hydraulicElevationM','tankOperatingLevelM','tankMinLevelM','tankMaxLevelM','tankDiameterM','tankMinVolumeM3'],
  };
  const mergedImported=imported.components.map(component=>{
    const prior=original.get(component.id);if(!prior)return component;
    const properties={...prior.properties};
    for(const key of propertyKeys[component.kind]??[]) {
      const value=component.properties[key];
      if(value!==undefined)(properties as unknown as Record<string,unknown>)[key]=value;
    }
    const geometry=component.geometry.map(point=>{
      const match=prior.geometry.find(old=>Math.abs(old.x-point.x)<1e-6&&Math.abs(old.y-point.y)<1e-6);
      return match?{...match,...point}:point;
    });
    return {...prior,...component,geometry,properties,customPorts:component.customPorts??prior.customPorts};
  });
  const preservedCadOnly=base.components.filter(component=>!importedIds.has(component.id)&&!hydraulicKinds.has(component.kind));
  const components=[...mergedImported,...preservedCadOnly];
  const validPorts=new Set(components.flatMap(component=>getWaterPorts(component).map(port=>port.id)));
  const connections=(base.connections??[]).filter(connection=>validPorts.has(connection.aPortId)&&validPorts.has(connection.bPortId));
  const usedPorts=new Set(connections.flatMap(connection=>[connection.aPortId,connection.bPortId]));
  const nodeById=new Map(components.filter(component=>['junction','source','tank','reservoir'].includes(component.kind)).map(component=>[component.id,component]));
  let sequence=connections.length;
  for(const link of mergedImported.filter(component=>['pipe','pump','valve'].includes(component.kind))){
    const linkPorts=getWaterPorts(link);
    const endpoints:[string|undefined,string|undefined]=[link.fromNodeId,link.toNodeId];
    endpoints.forEach((nodeId,index)=>{
      const node=nodeId?nodeById.get(nodeId):undefined;
      const linkPort=linkPorts[index],nodePort=node?getWaterPorts(node)[0]:undefined;
      if(!linkPort||!nodePort||usedPorts.has(linkPort.id)||usedPorts.has(nodePort.id))return;
      const id='CON-EPANET-'+(++sequence).toString().padStart(4,'0');
      connections.push({id,aPortId:linkPort.id,bPortId:nodePort.id});
      usedPorts.add(linkPort.id);usedPorts.add(nodePort.id);
    });
  }
  const importedNodes=imported.components.filter(component=>['junction','source','tank','reservoir'].includes(component.kind));
  const matchedNodes=importedNodes.filter(component=>original.has(component.id));
  const matchedNetwork=matchedNodes.length>0&&matchedNodes.every(component=>{
    const prior=original.get(component.id);
    const a=prior?.geometry[0],b=component.geometry[0];
    return !!a&&!!b&&Math.hypot(a.x-b.x,a.y-b.y)<0.001;
  });
  return {
    ...base,...imported,components,connections,
    horizontalCrs:matchedNetwork&&base.horizontalCrs?base.horizontalCrs:imported.horizontalCrs,
    horizontalUnits:matchedNetwork&&base.horizontalUnits?base.horizontalUnits:imported.horizontalUnits,
    verticalDatum:matchedNetwork?base.verticalDatum:imported.verticalDatum,
  };
}

