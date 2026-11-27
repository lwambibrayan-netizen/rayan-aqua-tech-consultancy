import type { HydraulicResults } from './water-epanet-bridge';
import type { WaterCadComponent, WaterCadDocument } from './water-cad';
export type HydraulicOverlayMetric='pressureM'|'flowLps'|'velocityMs'|'headlossM';
export type HydraulicOverlayItem={componentId:string;value:number|null;label:string;colour:string;severity:'normal'|'warning'|'critical';direction?:'forward'|'reverse'|'stagnant'};
export type HydraulicOverlay={metric:HydraulicOverlayMetric;timeSeconds:number;items:HydraulicOverlayItem[];min:number|null;max:number|null};
const finite=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n);
export function buildHydraulicOverlay(document:WaterCadDocument,results:HydraulicResults,metric:HydraulicOverlayMetric,limits:{minimum?:number;maximum?:number}={}):HydraulicOverlay {
 const source=metric==='pressureM'?results.nodes:results.links;
 const ids=new Set(document.components.map(c=>c.id));
 const components=new Map(document.components.map(component=>[component.id,component]));
 const items=source.filter(item=>ids.has(item.id)).map(item=>{
  const raw=(item as unknown as Record<string,unknown>)[metric];const value=finite(raw)?raw:null;
  const component=components.get(item.id);
  const minimum=limits.minimum ?? (metric==='velocityMs'&&component?.kind==='pipe'?component.properties.velocityMinMs:undefined);
  const maximum=limits.maximum ?? (metric==='velocityMs'&&component?.kind==='pipe'?component.properties.velocityMaxMs:undefined);
  const severity:HydraulicOverlayItem['severity']=value===null?'warning':minimum!==undefined&&value<minimum||maximum!==undefined&&value>maximum?'critical':'normal';
  const colour=value===null?'#8a8f98':severity==='critical'?'#d43b35':metric==='flowLps'?'#1678c8':metric==='velocityMs'?'#d58a24':'#15936d';
  return {componentId:item.id,value,label:value===null?'No result':value.toFixed(2),colour,severity,...(metric==='flowLps'&&value!==null?{direction:(value>0?'forward':value<0?'reverse':'stagnant') as 'forward'|'reverse'|'stagnant'}:{})};
 });
 const values=items.flatMap(item=>item.value===null?[]:[item.value]);
 return {metric,timeSeconds:results.timeSeconds,items,min:values.length?values.reduce((a,b)=>Math.min(a,b),Infinity):null,max:values.length?values.reduce((a,b)=>Math.max(a,b),-Infinity):null};
}
export function hydraulicValueForComponent(overlay:HydraulicOverlay,component:WaterCadComponent):HydraulicOverlayItem|undefined{return overlay.items.find(item=>item.componentId===component.id);}
