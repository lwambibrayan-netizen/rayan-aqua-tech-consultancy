import React, { useMemo, useState } from 'react';
import EpanetEnginePanel from './EpanetEnginePanel';
import { Activity, AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Beaker, CheckCircle2, CircleDot, ClipboardList, Clock3, FilePlus2, Gauge, Layers3, Move, Network, Play, Save, Settings2, ShieldCheck, SlidersHorizontal, Trash2, Waves, ZoomIn, ZoomOut } from 'lucide-react';

type Props = React.ComponentProps<typeof EpanetEnginePanel>;
type Tab = 'Home' | 'Draw' | 'Edit' | 'Hydraulics' | 'Controls' | 'Simulation' | 'Results' | 'GIS & CAD' | 'View' | 'Reports';
type DisplayTab = 'Home' | 'Network' | 'Hydraulics' | 'Analysis' | 'Output' | 'GIS';
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
 const [tab,setTab]=useState<DisplayTab>('Home');
 const [message,setMessage]=useState('Ready · all EPANET commands are grouped in the ribbon');
 const tabs=['Home','Network','Hydraulics','Analysis','Output','GIS'] as const;
 const tabMap:Record<(typeof tabs)[number],Tab>={Home:'Home',Network:'Draw',Hydraulics:'Hydraulics',Analysis:'Simulation',Output:'Results',GIS:'GIS & CAD'};
 const [commandInput,setCommandInput]=useState('');
 const [statusToggles,setStatusToggles]=useState({SNAP:true,GRID:true,ORTHO:false});
 const active=useMemo<Command[]>(()=>commands[tabMap[tab]],[tab,tabMap]);
 const execute=(item:Command)=>{
  const root=document.getElementById('rayan-epanet-workspace');if(!root)return;
  const target=item.target;
  const actionByTarget:Record<string,string>={'Select':'select','Junction':'J','Reservoir':'R','Tank':'T','Pipe':'pipe','Pump':'pump','Valve':'valve','Check valve':'checkValve','Run EPANET':'run','Save design':'save','Clear all':'clear','Example network':'example','Import EPANET .inp':'import-inp','Import GIS network':'import-gis','Export .inp':'export-inp','Export EPANET .inp':'export-inp'};
  const action=actionByTarget[target];
  if(action){
   const button=root.querySelector('[data-epanet-action="'+action+'"]') as HTMLButtonElement|null;
   if(!button){setMessage(item.label+' · command is not available in the current workspace');return;}
   if(button.disabled){setMessage(item.label+' · unavailable until required inputs are ready');return;}
   button.click();setMessage(item.label+' · EPANET command executed');
   if(action==='run')root.querySelector('[data-epanet-region="results"]')?.scrollIntoView({behavior:'smooth',block:'start'});
   return;
  }
  if(target==='@quality'||target==='@leakage')setTab('Analysis');
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
 return <div id="rayan-epanet-workspace" className="ra-epanet-workspace" data-active-tab={tab}>
  <style>{`
  .ra-epanet-workspace{--ra-ink:#16233f;--ra-muted:#5d6c8a;--ra-line:#c9d4e5;--ra-accent:#0b6fd6;color:var(--ra-ink);min-width:0;padding:0 0 8px;background:#e9eef5;font:12px/1.4 "Segoe UI",system-ui,sans-serif}
  .ra-epanet-ribbon{border:1px solid #c9d4e5;border-radius:0;background:#f8fafd;box-shadow:none}
  .ra-epanet-titlebar{justify-content:flex-start;padding:5px 10px;background:#dde5f0;color:#16233f;border-bottom:1px solid #c9d4e5}
  .ra-epanet-titlebar:before{content:"R";display:grid;place-items:center;flex:0 0 26px;width:26px;height:26px;border-radius:5px;background:#0b6fd6;color:#fff;font-weight:900;font-size:17px}
  .ra-epanet-titlebar strong{font-size:12px}.ra-epanet-titlebar small{color:#5d6c8a;font-size:10px}
  .ra-epanet-titlebar>span{margin-left:auto!important;color:#176b58!important}
  .ra-epanet-menubar{padding:2px 6px;background:#f8fafd;border:0;border-bottom:1px solid #c9d4e5;border-radius:0}
  .ra-epanet-menubar button{padding:3px 10px;color:#16233f;font-size:11px}
  .ra-epanet-tabs{padding:3px 8px 0;background:#f8fafd;border-bottom:1px solid #c9d4e5}
  .ra-epanet-tab{padding:5px 14px;color:#5d6c8a;font-size:11px}
  .ra-epanet-tab[aria-selected=true]{background:#e9eef5;color:#16233f;border:1px solid #c9d4e5;border-bottom:0}
  .ra-epanet-group-label{display:none}
  .ra-epanet-commandbar{gap:0;min-height:74px;padding:6px 8px;background:#e9eef5}
  .ra-epanet-command{flex:0 0 64px;gap:3px;padding:4px 5px;border-right:1px solid #c9d4e5;border-radius:0;background:transparent;color:#16233f;font-size:10px}
  .ra-epanet-command svg{color:#0b6fd6;width:20px;height:20px}
  .ra-epanet-command small{display:none}
  .ra-epanet-status{display:none}
  .ra-epanet-body{grid-template-columns:230px minmax(0,1fr);gap:0;padding-top:0;align-items:stretch;min-height:480px}
  .ra-epanet-browser{border:0;border-right:1px solid #c9d4e5;border-radius:0;background:#f8fafd;min-height:480px}
  .ra-epanet-browser h3{padding:5px 10px;background:#dde5f0;color:#16233f;border-bottom:1px solid #c9d4e5;border-radius:0}
  .ra-epanet-browser section{border-bottom:1px solid #c9d4e5}
  .ra-epanet-browser button{color:#16233f}
  .ra-epanet-engine>section:not([data-epanet-region="design-review"]){grid-template-columns:minmax(0,1fr) 250px;gap:0;padding:0!important;border:0!important;border-radius:0!important;background:#1c2128!important;box-shadow:none!important;align-items:stretch;min-height:480px}
  .ra-epanet-engine>section:not([data-epanet-region="design-review"])>[data-epanet-region="drawing"]{grid-column:1;min-width:0;margin:0!important;padding:8px!important;border:0!important;border-radius:0!important;background:#1c2128!important;color:#cfd8e6}
  .ra-epanet-engine>section:not([data-epanet-region="design-review"])>[data-epanet-region="drawing"]>div:first-child{color:#cfd8e6}
  .ra-epanet-engine>section:not([data-epanet-region="design-review"])>[data-epanet-region="drawing"] svg{background-color:#1c2128!important;border:0!important;border-radius:0!important}
  .ra-epanet-engine>section:not([data-epanet-region="design-review"])>[data-epanet-region="drawing"] svg text{fill:#cfd8e6!important}
  .ra-epanet-engine>section:not([data-epanet-region="design-review"])>[data-epanet-region="properties"]{grid-column:2;display:block;min-width:0;margin:0!important;padding:0!important;border-left:1px solid #c9d4e5;background:#f8fafd}
  .ra-epanet-engine>section:not([data-epanet-region="design-review"])>[data-epanet-region="properties"]>div{margin:0!important;padding:10px!important;border:0!important;border-bottom:1px solid #c9d4e5!important;border-radius:0!important;box-shadow:none!important;background:#f8fafd!important}
  .ra-epanet-engine>section:not([data-epanet-region="design-review"])>[data-epanet-region="properties"] strong{color:#16233f}
  .ra-epanet-commandline{margin:0;padding:4px 10px;border:0;border-top:1px solid #c9d4e5;border-radius:0;background:#f8fafd}
  .ra-epanet-commandline b{color:#0b6fd6}
  .ra-epanet-commandline input{color:#16233f}
  .ra-epanet-modeltabs{display:flex;gap:0;background:#dde5f0;border-top:1px solid #c9d4e5}
  .ra-epanet-modeltabs button{padding:4px 14px;border:0;border-right:1px solid #c9d4e5;background:transparent;color:#5d6c8a;font-size:10px;cursor:pointer}
  .ra-epanet-modeltabs button[aria-pressed=true]{background:#e9eef5;color:#16233f;font-weight:800}
  .ra-epanet-statusbar{margin:0;padding:3px 8px;border:0;border-top:1px solid #c9d4e5;border-radius:0;background:#dde5f0}
  .ra-epanet-statusbar button{padding:2px 8px;color:#5d6c8a}
  .ra-epanet-statusbar button[aria-pressed=true]{background:#0b6fd6;color:#fff}
  .ra-epanet-statusbar span{font-size:10px;color:#5d6c8a}
  .ra-epanet-bottom{display:none!important}
  @media(max-width:900px){.ra-epanet-body{grid-template-columns:190px minmax(0,1fr)}.ra-epanet-engine>section:not([data-epanet-region="design-review"]){grid-template-columns:minmax(0,1fr) 220px}}
  @media(max-width:760px){.ra-epanet-body{grid-template-columns:minmax(0,1fr)}.ra-epanet-browser{min-height:0;max-height:180px;border-right:0;border-bottom:1px solid #c9d4e5}.ra-epanet-engine>section:not([data-epanet-region="design-review"]){grid-template-columns:minmax(0,1fr)}.ra-epanet-engine>section:not([data-epanet-region="design-review"])>[data-epanet-region="drawing"],.ra-epanet-engine>section:not([data-epanet-region="design-review"])>[data-epanet-region="properties"]{grid-column:1}.ra-epanet-engine>section:not([data-epanet-region="design-review"])>[data-epanet-region="properties"]{border-left:0;border-top:1px solid #c9d4e5}.ra-epanet-engine>section:not([data-epanet-region="design-review"])>[data-epanet-region="drawing"] svg{min-width:0!important}}
  @media(max-width:640px){.ra-epanet-titlebar{align-items:center;flex-direction:row}.ra-epanet-command{flex-basis:58px}.ra-epanet-commandline{gap:5px}.ra-epanet-statusbar{overflow-x:auto}}
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
  .ra-epanet-menubar{display:flex;gap:3px;align-items:center;padding:4px 9px;background:#fff;border:1px solid var(--ra-line);border-bottom:0;overflow-x:auto}.ra-epanet-menubar button{border:0;background:transparent;color:#48636a;padding:5px 11px;border-radius:5px;font-size:11px;cursor:pointer}.ra-epanet-menubar button:hover{background:#eaf3ef}
  .ra-epanet-body{display:grid;grid-template-columns:205px minmax(0,1fr);gap:10px;padding-top:10px;align-items:start}.ra-epanet-engine>section:not([data-epanet-region="design-review"]){min-width:0}.ra-epanet-engine>section:not([data-epanet-region="design-review"])>[data-epanet-region="intro"],.ra-epanet-engine>section:not([data-epanet-region="design-review"])>[data-epanet-region="tools"]{display:none!important}.ra-epanet-workspace[data-active-tab="Analysis"] .ra-epanet-engine>section:not([data-epanet-region="design-review"])>[data-epanet-region="analysis-config"]{display:block!important}.ra-epanet-workspace:not([data-active-tab="Analysis"]) .ra-epanet-engine>section:not([data-epanet-region="design-review"])>[data-epanet-region="analysis-config"]{display:none!important}
  .ra-epanet-browser{border:1px solid var(--ra-line);border-radius:10px;background:#f8fbfa;overflow:hidden;min-width:0}.ra-epanet-browser h3{margin:0;padding:9px 11px;background:#dfe9e5;color:#294950;font-size:10px;letter-spacing:.09em}.ra-epanet-browser section{padding:8px 9px;border-bottom:1px solid #e2ebe7}.ra-epanet-browser strong{display:block;color:#71868a;font-size:9px;letter-spacing:.08em;margin:0 0 5px}.ra-epanet-browser button{display:flex;justify-content:space-between;width:100%;padding:5px 6px;border:0;border-radius:5px;background:transparent;color:#294950;font-size:11px;text-align:left;cursor:pointer}.ra-epanet-browser button:hover{background:#e8f3ee}
  .ra-epanet-commandline{display:flex;align-items:center;gap:8px;margin-top:10px;padding:7px 10px;border:1px solid var(--ra-line);background:#f8fbfa;border-radius:8px}.ra-epanet-commandline b{font:700 11px Consolas,monospace;color:#147b6b}.ra-epanet-commandline input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:#23454d;font:12px Consolas,monospace}.ra-epanet-commandline button{border:1px solid #cbdcd5;border-radius:5px;padding:4px 9px;background:#fff;color:#23454d;font-size:10px;cursor:pointer}
  .ra-epanet-statusbar{display:flex;gap:4px;align-items:center;overflow-x:auto;margin-top:5px;padding:5px 8px;background:#e6eeea;border:1px solid #d2dfd9;border-radius:6px;white-space:nowrap}.ra-epanet-statusbar button{border:0;border-radius:4px;padding:3px 8px;background:transparent;color:#60777a;font:10px Consolas,monospace;cursor:pointer}.ra-epanet-statusbar button[aria-pressed=true]{background:#147b6b;color:#fff}.ra-epanet-statusbar span{margin-left:auto;color:#587178;font:10px Consolas,monospace}
  .ra-epanet-engine>section:not([data-epanet-region="design-review"]){display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,340px);gap:12px;padding:14px!important;border-radius:0 0 13px 13px!important;border-top:0!important;align-items:start}
  .ra-epanet-engine>section:not([data-epanet-region="design-review"])>*{min-width:0;grid-column:1/-1}.ra-epanet-engine [data-epanet-region="engine-actions"]{display:none!important}
  .ra-epanet-engine>section:not([data-epanet-region="design-review"])>[data-epanet-region="drawing"]{grid-column:1;min-width:0}
  .ra-epanet-engine>section:not([data-epanet-region="design-review"])>[data-epanet-region="properties"]{grid-column:2;display:grid;grid-template-columns:minmax(0,1fr);gap:12px;align-content:start;min-width:0}
  .ra-epanet-engine>section:not([data-epanet-region="design-review"])>[data-epanet-region="properties"]>div{min-width:0}
  .ra-epanet-bottom{position:sticky;bottom:0;z-index:30;display:flex;align-items:center;gap:5px;overflow-x:auto;padding:7px 9px;border:1px solid #cbdcd5;border-radius:12px;background:rgba(248,252,250,.97);box-shadow:0 -5px 20px rgba(20,55,55,.10);backdrop-filter:blur(12px);margin-top:12px}
  .ra-epanet-bottom-label{flex:0 0 auto;font-size:9px;font-weight:900;letter-spacing:.08em;color:#6b8282;padding:0 8px}
  .ra-epanet-quick{display:flex;align-items:center;justify-content:center;gap:6px;flex:0 0 auto;padding:9px 12px;border:1px solid #dce8e2;border-radius:8px;background:#fff;color:#23464c;font-size:11px;font-weight:800;cursor:pointer}
  .ra-epanet-quick svg{color:#147b6b}.ra-epanet-quick:hover{background:#eaf6f0;border-color:#9fcdbb}
  .ra-epanet-commandline{margin-top:9px}.ra-epanet-statusbar{margin-bottom:6px}.ra-epanet-body svg{max-width:100%}
  @media(max-width:900px){.ra-epanet-body{grid-template-columns:170px minmax(0,1fr)}}
  @media(max-width:760px){.ra-epanet-body{grid-template-columns:minmax(0,1fr)}.ra-epanet-browser{display:block;max-height:190px;overflow:auto}.ra-epanet-engine>section:not([data-epanet-region="design-review"]){grid-template-columns:minmax(0,1fr)}.ra-epanet-engine>section:not([data-epanet-region="design-review"])>[data-epanet-region="drawing"],.ra-epanet-engine>section:not([data-epanet-region="design-review"])>[data-epanet-region="properties"]{grid-column:1}}
  @media(max-width:640px){.ra-epanet-titlebar{align-items:flex-start;flex-direction:column}.ra-epanet-commandbar{min-height:82px}.ra-epanet-command{flex-basis:86px}.ra-epanet-bottom{margin-left:-2px;margin-right:-2px}.ra-epanet-quick{padding:9px 10px}}
  `}</style>
  <div className="ra-epanet-ribbon">
   <div className="ra-epanet-titlebar"><div><strong>RAYAN AQUATECH · EPANET HYDRAULIC DESIGN</strong><small>Complete hydraulic modelling workspace · {props.projectTitle||'unsaved project'}</small></div><span style={{fontSize:10,fontWeight:800,color:'#a9e2cf'}}>● OWA-EPANET ENGINE</span></div>
   <div className="ra-epanet-menubar">{['File','Edit','View','Project','Report','Tools','Window','Help'].map(name=><button key={name} type="button" onClick={()=>{const destinations:Record<string,DisplayTab>={File:'Home',Edit:'Network',View:'Network',Project:'Home',Report:'Output',Tools:'Analysis',Window:'GIS'};if(name==='Help')setMessage('Use ribbon commands or type RUN, SAVE, PIPE, JUNCTION, TANK, RESERVOIR, PUMP, VALVE or ZOOM IN.');else setTab(destinations[name]);}}>{name}</button>)}</div>
   <div className="ra-epanet-tabs" role="tablist" aria-label="EPANET tool ribbon">{tabs.map(name=><button key={name} type="button" role="tab" aria-selected={tab===name} className="ra-epanet-tab" onClick={()=>setTab(name)}>{name}</button>)}</div>
   <div className="ra-epanet-group-label">{tab} tools · select a command to open or activate it</div>
   <div className="ra-epanet-commandbar" role="toolbar" aria-label={tab+' commands'}>{active.map(item=>renderCommand(item))}</div>
   <div className="ra-epanet-status"><span style={{color:'#168775'}}>●</span>{message}<span>Project model · SI units</span></div>
  </div>
  <div className="ra-epanet-body">
   <aside className="ra-epanet-browser" aria-label="Project browser">
    <h3>PROJECT BROWSER</h3>
    <section><strong>NETWORK COMPONENTS</strong>
     <button type="button" onClick={()=>execute({label:'Network drawing',hint:'Open drawing canvas',target:'@drawing',icon:Network})}>Network drawing <span>↗</span></button>
     {(['Junction','Reservoir','Tank','Pipe','Pump','Valve','Check valve','Select'] as const).map(name=><button key={name} type="button" onClick={()=>execute({label:name,hint:'Activate '+name+' tool',target:name,icon:Network})}>{name}<span>›</span></button>)}
    </section>
    <section><strong>MODEL DATA</strong>
     <button type="button" onClick={()=>execute({label:'Component properties',hint:'Open properties',target:'@properties',icon:SlidersHorizontal})}>Component properties <span>›</span></button>
     <button type="button" onClick={()=>execute({label:'Hydraulic settings',hint:'Open settings',target:'@settings',icon:Settings2})}>Hydraulic settings <span>›</span></button>
     <button type="button" onClick={()=>{setTab('Analysis');execute({label:'Demand patterns',hint:'Open analysis configuration',target:'@patterns',icon:Activity})}}>Patterns & curves <span>›</span></button>
     <button type="button" onClick={()=>{setTab('Analysis');execute({label:'Control rules',hint:'Open control rules',target:'@rule-controls',icon:SlidersHorizontal})}}>Controls & rules <span>›</span></button>
    </section>
    <section><strong>ANALYSIS & OUTPUT</strong>
     <button type="button" onClick={()=>setTab('Analysis')}>Water quality & leakage <span>›</span></button>
     <button type="button" onClick={()=>execute({label:'Simulation results',hint:'Open results',target:'@results',icon:Activity})}>Simulation results <span>›</span></button>
     <button type="button" onClick={()=>setTab('Output')}>Reports & exports <span>›</span></button>
    </section>
   </aside>
   <div className="ra-epanet-engine"><EpanetEnginePanel {...props} drawingAids={{snap:statusToggles.SNAP,grid:statusToggles.GRID,ortho:statusToggles.ORTHO}}/></div>
  </div>
  <div className="ra-epanet-commandline" role="search">
   <b>COMMAND</b>
   <input aria-label="EPANET command line" value={commandInput} onChange={e=>setCommandInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){const q=commandInput.trim().toLowerCase();const aliases:Record<string,string>={run:'Run EPANET',save:'Save design',pipe:'Pipe',junction:'Junction',tank:'Tank',reservoir:'Reservoir',pump:'Pump',valve:'Valve',select:'Select','zoom in':'Zoom in','zoom out':'Zoom out','zoom e':'Fit drawing',results:'Simulation results',properties:'Properties'};if(q==='help'){setMessage('Commands: RUN, SAVE, PIPE, JUNCTION, TANK, RESERVOIR, PUMP, VALVE, SELECT, ZOOM IN, ZOOM OUT, ZOOM E, RESULTS, PROPERTIES.');}else{const label=aliases[q]||q;const item=Object.values(commands).flat().find(x=>x.label.toLowerCase()===label.toLowerCase()||x.target.toLowerCase()===label.toLowerCase());if(item)execute(item);else setMessage('Unknown command: '+commandInput);}setCommandInput('');}}} placeholder="RUN, SAVE, PIPE, JUNCTION, ZOOM IN…"/>
   <button type="button" onClick={()=>{const q=commandInput.trim().toLowerCase();const aliases:Record<string,string>={run:'Run EPANET',save:'Save design',pipe:'Pipe',junction:'Junction',tank:'Tank',reservoir:'Reservoir',pump:'Pump',valve:'Valve',select:'Select','zoom in':'Zoom in','zoom out':'Zoom out','zoom e':'Fit drawing',results:'Simulation results',properties:'Properties'};const label=aliases[q]||q;const item=Object.values(commands).flat().find(x=>x.label.toLowerCase()===label.toLowerCase()||x.target.toLowerCase()===label.toLowerCase());if(item)execute(item);else setMessage('Unknown command: '+commandInput);setCommandInput('');}}>Execute</button>
  </div>
  <div className="ra-epanet-modeltabs" role="tablist" aria-label="Drawing sheets"><button type="button" aria-pressed="true">Model</button><button type="button" aria-pressed="false">Layout1</button><button type="button" aria-label="Add layout" disabled>+</button></div>
  <div className="ra-epanet-statusbar" role="toolbar" aria-label="Drafting and model status">
   {(['SNAP','GRID','ORTHO'] as const).map(name=><button key={name} type="button" aria-pressed={statusToggles[name]} onClick={()=>setStatusToggles(v=>({...v,[name]:!v}))}>{name}</button>)}
   <span>OSNAP · NODE PICK ACTIVE</span><span>SI UNITS · {props.projectTitle||'UNSAVED PROJECT'} · OWA-EPANET</span>
  </div>
 </div>;
}
