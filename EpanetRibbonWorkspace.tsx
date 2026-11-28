import React, { useMemo, useState } from 'react';
import EpanetEnginePanel from './EpanetEnginePanel';
import { Activity, AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Beaker, CheckCircle2, CircleDot, ClipboardList, Clock3, FilePlus2, Gauge, Layers3, Move, Network, Play, Save, Settings2, ShieldCheck, SlidersHorizontal, Trash2, Waves, ZoomIn, ZoomOut } from 'lucide-react';

type Props = React.ComponentProps<typeof EpanetEnginePanel>;
type Tab = 'Home' | 'Draw' | 'Edit' | 'Hydraulics' | 'Controls' | 'Simulation' | 'Results' | 'GIS & CAD' | 'View' | 'Reports';
type Command = {label:string;hint:string;target:string;icon:React.ComponentType<any>;group?:string};
const commands:Record<Tab,Command[]> = {
 Home:[
  {label:'Save design',hint:'Save this project network and results',target:'Save design',icon:Save},
  {label:'Run EPANET',hint:'Validate and solve the current model',target:'Run EPANET',icon:Play},
  {label:'New blank model',hint:'Clear the current network',target:'Clear all',icon:FilePlus2},
  {label:'Load example',hint:'Load the sample network',target:'Example network',icon:Network},
  {label:'Import .inp',hint:'Open a native EPANET input file',target:'Import EPANET .inp',icon:ArrowUpFromLine},
  {label:'Export .inp',hint:'Export the native model',target:'Export .inp',icon:ArrowDownToLine},
  {label:'Network canvas',hint:'Go to the model drawing area',target:'@drawing',icon:Layers3},
  {label:'Model settings',hint:'Duration, patterns and design criteria',target:'@settings',icon:Settings2}
 ],
 Draw:[
  {label:'Select',hint:'Select and inspect a component',target:'Select',icon:Move},
  {label:'Junction',hint:'Place a demand junction',target:'Junction',icon:CircleDot},
  {label:'Reservoir',hint:'Place a fixed-head source',target:'Reservoir',icon:Waves},
  {label:'Tank',hint:'Place a storage tank',target:'Tank',icon:Layers3},
  {label:'Pipe',hint:'Connect two network nodes',target:'Pipe',icon:Network},
  {label:'Pump',hint:'Connect a pump between nodes',target:'Pump',icon:Gauge},
  {label:'Valve',hint:'Place a control valve',target:'Valve',icon:Settings2},
  {label:'Check valve',hint:'Add a check-valve link',target:'Check valve',icon:CheckCircle2},
  {label:'Drawing area',hint:'Open the network canvas',target:'@drawing',icon:Move}
 ],
 Edit:[
  {label:'Select component',hint:'Activate selection mode',target:'Select',icon:Move},
  {label:'Properties',hint:'Edit node or link engineering data',target:'@properties',icon:SlidersHorizontal},
  {label:'Delete selection',hint:'Remove selected node or link',target:'@delete',icon:Trash2},
  {label:'Node data',hint:'Elevation, demand, levels and coordinates',target:'@properties',icon:CircleDot},
  {label:'Link data',hint:'Diameter, length, roughness, curve and status',target:'@properties',icon:Network}
 ],
 Hydraulics:[
  {label:'Model settings',hint:'Duration and hydraulic timestep',target:'@settings',icon:Settings2},
  {label:'Demand patterns',hint:'Shared and individual demand multipliers',target:'@patterns',icon:Activity},
  {label:'Pressure criteria',hint:'Minimum and maximum pressure limits',target:'@criteria',icon:Gauge},
  {label:'Velocity criteria',hint:'Minimum and maximum pipe velocity',target:'@criteria',icon:Gauge},
  {label:'Headloss formula',hint:'Hazen-Williams, Darcy-Weisbach or Chezy-Manning',target:'@criteria',icon:Waves},
  {label:'Pump energy',hint:'Efficiency, tariff and operating hours',target:'@energy',icon:Gauge},
  {label:'Water quality',hint:'Chemical, age and source-tracing setup',target:'@quality',icon:Beaker},
  {label:'Leakage model',hint:'Configure EPANET emitter coefficients',target:'@leakage',icon:AlertTriangle}
 ],
 Controls:[
  {label:'Tank-level controls',hint:'Automatic pump or link operation by tank level',target:'@tank-controls',icon:Waves},
  {label:'Timed controls',hint:'Schedule links by elapsed simulation time',target:'@time-controls',icon:Clock3},
  {label:'Rule controls',hint:'Advanced conditional EPANET rules',target:'@rule-controls',icon:SlidersHorizontal},
  {label:'Add tank control',hint:'Create a tank-level control rule',target:'Add tank control',icon:FilePlus2},
  {label:'Add timed control',hint:'Create a timed link action',target:'Add timed control',icon:Clock3},
  {label:'Add rule control',hint:'Create an advanced rule',target:'Add rule control',icon:FilePlus2}
 ],
 Simulation:[
  {label:'Pre-run checks',hint:'Review model validation messages',target:'@validation',icon:ShieldCheck},
  {label:'Run hydraulics',hint:'Execute OWA-EPANET simulation',target:'Run EPANET',icon:Play},
  {label:'Simulation settings',hint:'Configure duration and timestep',target:'@settings',icon:Settings2},
  {label:'Clear model',hint:'Start with an empty network',target:'Clear all',icon:Trash2}
 ],
 Results:[
  {label:'Simulation results',hint:'Pressure, tank and link results',target:'@results',icon:Activity},
  {label:'Pressure compliance',hint:'Review node pressure checks',target:'@results',icon:Gauge},
  {label:'Velocity & flow',hint:'Review pipe velocity, flow and headloss',target:'@results',icon:Waves},
  {label:'Pump energy report',hint:'Review simulated energy and cost',target:'@results',icon:Gauge},
  {label:'Water quality results',hint:'Review residual, age or tracing results',target:'@results',icon:Beaker},
  {label:'Design diagnostics',hint:'Review engineering suggestions',target:'@results',icon:AlertTriangle},
  {label:'Native EPANET report',hint:'Open the solver report',target:'@native-report',icon:ClipboardList}
 ],
 'GIS & CAD':[
  {label:'Import GIS network',hint:'Create a hydraulic network from project GIS features',target:'Import GIS network',icon:Layers3},
  {label:'Import EPANET .inp',hint:'Load an EPANET model file',target:'Import EPANET .inp',icon:ArrowUpFromLine},
  {label:'Export EPANET .inp',hint:'Export a compatible EPANET input file',target:'Export .inp',icon:ArrowDownToLine}
 ],
 View:[
  {label:'Zoom in',hint:'Magnify the drawing',target:'__zoom_in__',icon:ZoomIn},
  {label:'Zoom out',hint:'Show more of the drawing',target:'__zoom_out__',icon:ZoomOut},
  {label:'Fit drawing',hint:'Reset the canvas view',target:'__fit__',icon:Move},
  {label:'Drawing canvas',hint:'Focus the network drawing',target:'@drawing',icon:Network},
  {label:'Properties panel',hint:'Focus component inspector',target:'@properties',icon:Settings2},
  {label:'Simulation results',hint:'Focus results panel',target:'@results',icon:Activity}
 ],
 Reports:[
  {label:'Design report',hint:'Download the hydraulic design report',target:'Download design report',icon:ClipboardList},
  {label:'Compliance CSV',hint:'Download node and link compliance data',target:'Download compliance CSV',icon:ArrowDownToLine},
  {label:'Native solver report',hint:'Open EPANET report text',target:'@native-report',icon:ClipboardList}
 ]
};
const bottomCommands:Command[]=[
 {label:'Select',hint:'Selection mode',target:'Select',icon:Move},
 {label:'Pipe',hint:'Draw a pipe',target:'Pipe',icon:Network},
 {label:'Properties',hint:'Edit selected component',target:'@properties',icon:SlidersHorizontal},
 {label:'Settings',hint:'Model settings',target:'@settings',icon:Settings2},
 {label:'Run',hint:'Run EPANET',target:'Run EPANET',icon:Play},
 {label:'Results',hint:'Simulation results',target:'@results',icon:Activity},
 {label:'Save',hint:'Save design',target:'Save design',icon:Save}
];
export default function EpanetRibbonWorkspace(props:Props){
 const [tab,setTab]=useState<Tab>('Home');
 const [message,setMessage]=useState('Ready · all EPANET commands are grouped in the ribbon');
 const tabs=Object.keys(commands) as Tab[];
 const active=useMemo(()=>commands[tab],[tab]);
 const execute=(item:Command)=>{
  const root=document.getElementById('rayan-epanet-workspace');if(!root)return;
  const target=item.target;
  const regions:Record<string,string>={'@drawing':'drawing','@properties':'properties','@settings':'settings','@analysis':'analysis-config','@results':'results','@validation':'validation','@patterns':'patterns','@criteria':'criteria','@energy':'energy','@quality':'quality','@leakage':'leakage','@tank-controls':'tank-controls','@time-controls':'time-controls','@rule-controls':'rule-controls','@native-report':'native-report'};
  if(target==='__zoom_in__'||target==='__zoom_out__'||target==='__fit__'){
   const svg=root.querySelector('svg[aria-label="Sketch your water distribution network"]') as SVGSVGElement|null;
   if(!svg){setMessage(item.label+' · drawing canvas not available');return;}
   if(target==='__fit__')svg.setAttribute('viewBox','0 0 900 420');else{const v=(svg.getAttribute('viewBox')||'0 0 900 420').trim().split(/[ ,]+/).map(Number);const [x,y,w,h]=v.length===4&&v.every(Number.isFinite)?v:[0,0,900,420];const f=target==='__zoom_in__'?.8:1.25;const nw=Math.max(180,Math.min(1800,w*f)),nh=Math.max(84,Math.min(840,h*f));svg.setAttribute('viewBox',`${x+(w-nw)/2} ${y+(h-nh)/2} ${nw} ${nh}`);}
   setMessage(item.label+' · drawing view updated');return;
  }
  if(target==='@delete'){
   const remove=root.querySelector('[data-epanet-region="properties"] button[aria-label="Delete selected component"]') as HTMLButtonElement|null;
   const fallback=Array.from(root.querySelectorAll('[data-epanet-region="properties"] button')).find(b=>(b.textContent||'').toLowerCase().includes('delete')) as HTMLButtonElement|undefined;
   const btn=remove||fallback;if(btn&&!btn.disabled){btn.click();setMessage('Delete selection · command activated');}else setMessage('Select a node or link first; use the remove icon in Properties.');return;
  }
  if(target.startsWith('@')){
   const region=regions[target];let el=region?root.querySelector('[data-epanet-region="'+region+'"]') as HTMLElement|null:null;
   if(!el&&target==='@settings')el=Array.from(root.querySelectorAll('strong')).find(x=>(x.textContent||'').includes('Simulation settings'))?.parentElement as HTMLElement||null;
   if(!el&&target==='@native-report')el=root.querySelector('details') as HTMLElement|null;
   if(!el&&target==='@validation')el=Array.from(root.querySelectorAll('strong')).find(x=>(x.textContent||'').includes('Pre-run checks'))?.parentElement as HTMLElement||null;
   if(!el&&target==='@patterns')el=Array.from(root.querySelectorAll('label')).find(x=>(x.textContent||'').includes('Shared fallback demand pattern')) as HTMLElement||null;
   if(!el&&target==='@criteria')el=Array.from(root.querySelectorAll('button')).find(x=>(x.textContent||'').includes('pressure / velocity criteria'))?.parentElement as HTMLElement||null;
   if(!el&&target==='@energy')el=Array.from(root.querySelectorAll('strong')).find(x=>(x.textContent||'').includes('Pump energy assumptions'))?.parentElement as HTMLElement||null;
   if(!el&&target==='@tank-controls')el=Array.from(root.querySelectorAll('strong')).find(x=>(x.textContent||'').includes('Automatic tank-level pump controls'))?.parentElement as HTMLElement||null;
   if(!el&&target==='@time-controls')el=Array.from(root.querySelectorAll('strong')).find(x=>(x.textContent||'').includes('Time-based link controls'))?.parentElement as HTMLElement||null;
   if(!el&&target==='@rule-controls')el=Array.from(root.querySelectorAll('strong')).find(x=>(x.textContent||'').includes('Advanced EPANET rule controls'))?.parentElement as HTMLElement||null;
   if(!el&&target==='@quality'){const b=Array.from(root.querySelectorAll('button')).find(x=>(x.textContent||'').trim()==='Water Quality') as HTMLButtonElement|undefined;b?.click();el=root.querySelector('[data-epanet-region="analysis-config"]') as HTMLElement|null;}
   if(!el&&target==='@leakage'){const b=Array.from(root.querySelectorAll('button')).find(x=>(x.textContent||'').trim()==='Leakage Detection') as HTMLButtonElement|undefined;b?.click();el=root.querySelector('[data-epanet-region="analysis-config"]') as HTMLElement|null;}
   if(el){el.scrollIntoView({behavior:'smooth',block:'center'});setMessage(item.label+' · panel opened');}else setMessage(item.label+' · available in the EPANET workspace when its required model/results exist');return;
  }
  const candidates=Array.from(root.querySelectorAll('button,strong,h2,h3,summary')) as HTMLElement[];
  const found=candidates.find(el=>{const t=(el.innerText||el.textContent||'').trim().toLowerCase();return t===target.toLowerCase()||(el instanceof HTMLButtonElement&&t.startsWith(target.toLowerCase()));});
  if(!found){setMessage(item.label+' · unavailable until the required model or results exist');return;}
  if(found instanceof HTMLButtonElement){if(found.disabled){setMessage(item.label+' · unavailable until required inputs are ready');return;}found.click();}else found.scrollIntoView({behavior:'smooth',block:'center'});
  setMessage(item.label+' · command activated');
 };
 const renderCommand=(item:Command,compact=false)=>{const Icon=item.icon;return <button key={item.label} type="button" className={compact?'ra-epanet-quick':'ra-epanet-command'} title={item.hint} onClick={()=>execute(item)}><Icon size={compact?17:20}/><span>{item.label}</span>{!compact?<small>{item.hint}</small>:null}</button>};
 return <div id="rayan-epanet-workspace" className="ra-epanet-workspace">
  <style>{`
  .ra-epanet-workspace{--ra-ink:#12333d;--ra-muted:#637b80;--ra-line:#d7e3df;--ra-accent:#147b6b;color:var(--ra-ink);min-width:0;padding-bottom:68px}
  .ra-epanet-ribbon{border:1px solid var(--ra-line);border-radius:13px 13px 0 0;background:#f8fbfa;overflow:hidden;box-shadow:0 5px 18px rgba(20,55,55,.06)}
  .ra-epanet-titlebar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 15px;background:#12333d;color:#fff}
  .ra-epanet-titlebar strong{font-size:14px;letter-spacing:.02em}.ra-epanet-titlebar small{display:block;color:#c4d7d5;font-size:11px;margin-top:3px}
  .ra-epanet-tabs{display:flex;gap:2px;overflow-x:auto;padding:5px 8px 0;border-bottom:1px solid var(--ra-line);background:#edf4f1;scrollbar-width:thin}
  .ra-epanet-tab{white-space:nowrap;border:0;border-bottom:3px solid transparent;background:transparent;color:#48636a;padding:10px 13px;font-size:12px;font-weight:750;cursor:pointer}
  .ra-epanet-tab[aria-selected=true]{color:#0e695d;border-bottom-color:#168775;background:#fff}
  .ra-epanet-group-label{padding:7px 12px 0;color:#829397;text-transform:uppercase;letter-spacing:.1em;font-size:9px;font-weight:800}
  .ra-epanet-commandbar{display:flex;gap:5px;align-items:stretch;overflow-x:auto;padding:8px 10px 10px;background:#fff;min-height:92px;scrollbar-width:thin}
  .ra-epanet-command{display:flex;flex:0 0 96px;flex-direction:column;align-items:center;justify-content:center;gap:5px;border:1px solid transparent;border-radius:8px;background:#fff;color:#23454d;padding:7px 5px;cursor:pointer;font-size:11px;font-weight:750}
  .ra-epanet-command:hover{border-color:#b9d8ce;background:#eff8f4}.ra-epanet-command svg{color:#147b6b}
  .ra-epanet-command small{font-size:9px;font-weight:500;color:#71868a;text-align:center;line-height:1.2}
  .ra-epanet-status{display:flex;align-items:center;gap:7px;border:1px solid var(--ra-line);border-top:0;background:#f5f9f7;padding:7px 12px;color:#587178;font-size:10px}
  .ra-epanet-status span:last-child{margin-left:auto}
  .ra-epanet-body{padding-top:12px}
  .ra-epanet-body>section{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,340px);gap:12px;padding:14px!important;border-radius:0 0 13px 13px!important;border-top:0!important;align-items:start}
  .ra-epanet-body>section>*{min-width:0;grid-column:1/-1}
  .ra-epanet-body>section>[data-epanet-region="drawing"]{grid-column:1;min-width:0}
  .ra-epanet-body>section>[data-epanet-region="properties"]{grid-column:2;display:grid;grid-template-columns:minmax(0,1fr);gap:12px;align-content:start;min-width:0}
  .ra-epanet-body>section>[data-epanet-region="properties"]>div{min-width:0}
  .ra-epanet-bottom{position:sticky;bottom:0;z-index:30;display:flex;align-items:center;gap:5px;overflow-x:auto;padding:7px 9px;border:1px solid #cbdcd5;border-radius:12px;background:rgba(248,252,250,.97);box-shadow:0 -5px 20px rgba(20,55,55,.10);backdrop-filter:blur(12px);margin-top:12px}
  .ra-epanet-bottom-label{flex:0 0 auto;font-size:9px;font-weight:900;letter-spacing:.08em;color:#6b8282;padding:0 8px}
  .ra-epanet-quick{display:flex;align-items:center;justify-content:center;gap:6px;flex:0 0 auto;padding:9px 12px;border:1px solid #dce8e2;border-radius:8px;background:#fff;color:#23464c;font-size:11px;font-weight:800;cursor:pointer}
  .ra-epanet-quick svg{color:#147b6b}.ra-epanet-quick:hover{background:#eaf6f0;border-color:#9fcdbb}
  .ra-epanet-body svg{max-width:100%}
  @media(max-width:760px){.ra-epanet-body>section{grid-template-columns:minmax(0,1fr)}.ra-epanet-body>section>[data-epanet-region="drawing"],.ra-epanet-body>section>[data-epanet-region="properties"]{grid-column:1}}
  @media(max-width:640px){.ra-epanet-titlebar{align-items:flex-start;flex-direction:column}.ra-epanet-commandbar{min-height:82px}.ra-epanet-command{flex-basis:86px}.ra-epanet-bottom{margin-left:-2px;margin-right:-2px}.ra-epanet-quick{padding:9px 10px}}
  `}</style>
  <div className="ra-epanet-ribbon">
   <div className="ra-epanet-titlebar"><div><strong>RAYAN AQUATECH · EPANET HYDRAULIC DESIGN</strong><small>Complete hydraulic modelling workspace · {props.projectTitle||'unsaved project'}</small></div><span style={{fontSize:10,fontWeight:800,color:'#a9e2cf'}}>● OWA-EPANET ENGINE</span></div>
   <div className="ra-epanet-tabs" role="tablist" aria-label="EPANET tool ribbon">{tabs.map(name=><button key={name} type="button" role="tab" aria-selected={tab===name} className="ra-epanet-tab" onClick={()=>setTab(name)}>{name}</button>)}</div>
   <div className="ra-epanet-group-label">{tab} tools · select a command to open or activate it</div>
   <div className="ra-epanet-commandbar" role="toolbar" aria-label={tab+' commands'}>{active.map(item=>renderCommand(item))}</div>
   <div className="ra-epanet-status"><span style={{color:'#168775'}}>●</span>{message}<span>Project model · SI units</span></div>
  </div>
  <div className="ra-epanet-body"><EpanetEnginePanel {...props}/></div>
  <div className="ra-epanet-bottom" role="toolbar" aria-label="EPANET quick access dock"><span className="ra-epanet-bottom-label">QUICK ACCESS</span>{bottomCommands.map(item=>renderCommand(item,true))}</div>
 </div>;
}
