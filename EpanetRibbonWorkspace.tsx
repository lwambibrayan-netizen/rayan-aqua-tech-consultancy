import React, { useMemo, useState } from 'react';
import EpanetEnginePanel from './EpanetEnginePanel';
import { Activity, ArrowDownToLine, ArrowUpFromLine, CheckCircle2, CircleDot, ClipboardList, FilePlus2, Gauge, Layers3, Move, Network, Play, Save, Settings2, ZoomIn, ZoomOut } from 'lucide-react';

type Props = React.ComponentProps<typeof EpanetEnginePanel>;
type Tab = 'Home' | 'Draw' | 'Edit' | 'Hydraulics' | 'Simulation' | 'Analysis' | 'GIS & CAD' | 'View' | 'Reports';

const commands: Record<Tab, { label: string; hint: string; target?: string; icon: React.ComponentType<any> }[]> = {
  Home: [{label:'Save design',hint:'Save this project network',target:'Save design',icon:Save},{label:'Example network',hint:'Load a sample network',target:'Example network',icon:Network},{label:'Import .inp',hint:'Open an EPANET input file',target:'Import EPANET .inp',icon:ArrowUpFromLine},{label:'Export .inp',hint:'Export the native EPANET model',target:'Export .inp',icon:ArrowDownToLine}],
  Draw: [{label:'Select',hint:'Select and inspect components',target:'Select',icon:Move},{label:'Junction',hint:'Place a demand junction',target:'Junction',icon:CircleDot},{label:'Reservoir',hint:'Place a fixed-head source',target:'Reservoir',icon:Activity},{label:'Tank',hint:'Place a storage tank',target:'Tank',icon:Layers3},{label:'Pipe',hint:'Connect two nodes with a pipe',target:'Pipe',icon:Network},{label:'Pump',hint:'Connect a pump between nodes',target:'Pump',icon:Gauge},{label:'Valve',hint:'Place a control valve',target:'Valve',icon:Settings2},{label:'Check valve',hint:'Add a check-valve link',target:'Check valve',icon:CheckCircle2}],
  Edit: [{label:'Select component',hint:'Choose an object on the network',target:'Select',icon:Move},{label:'Component properties',hint:'Jump to the properties inspector',target:'Component properties',icon:Settings2},{label:'Remove selected',hint:'Use the selected component delete control',target:'Component properties',icon:ClipboardList}],
  Hydraulics: [{label:'Simulation settings',hint:'Duration, timestep and design criteria',target:'Simulation settings & criteria',icon:Settings2},{label:'Water quality',hint:'Configure chemical, age or source tracing',target:'Water quality & leakage analysis',icon:Activity},{label:'Leakage analysis',hint:'Configure emitter coefficients',target:'Water quality & leakage analysis',icon:Gauge}],
  Simulation: [{label:'Run EPANET',hint:'Run the OWA-EPANET solver after validation',target:'Run EPANET',icon:Play},{label:'Results',hint:'Review simulation outputs',target:'EPANET simulation results',icon:Activity}],
  Analysis: [{label:'Pressure results',hint:'Review node pressure compliance',target:'EPANET simulation results',icon:Gauge},{label:'Velocity & flow',hint:'Review link velocity and flow',target:'Pipe, pump and valve results',icon:Activity},{label:'Diagnostics',hint:'Review engineering warnings and suggestions',target:'Design review suggestions',icon:ClipboardList}],
  'GIS & CAD': [{label:'Import GIS network',hint:'Create a hydraulic model from project GIS features',target:'Import GIS network',icon:Layers3},{label:'Import CAD model',hint:'Use the existing CAD-to-EPANET handoff when supplied',target:'Import EPANET .inp',icon:Network}],
  View: [{label:'Network drawing',hint:'Focus the network canvas',target:'Network drawing',icon:Network},{label:'Zoom in',hint:'Magnify the network drawing',target:'__zoom_in__',icon:ZoomIn},{label:'Zoom out',hint:'Show more of the network drawing',target:'__zoom_out__',icon:ZoomOut},{label:'Fit drawing',hint:'Reset the drawing to its full view',target:'__fit__',icon:Move},{label:'Properties inspector',hint:'Focus component properties',target:'Component properties',icon:Settings2},{label:'Simulation settings',hint:'Focus model settings',target:'Simulation settings & criteria',icon:ClipboardList}],
  Reports: [{label:'Design report',hint:'Download the simulation design report',target:'Download design report',icon:ClipboardList},{label:'Compliance CSV',hint:'Download pressure and velocity checks',target:'Download compliance CSV',icon:ArrowDownToLine}],
};

export default function EpanetRibbonWorkspace(props: Props) {
  const [tab, setTab] = useState<Tab>('Home');
  const [commandMessage, setCommandMessage] = useState('Ready · OWA-EPANET hydraulic workspace');
  const tabs = Object.keys(commands) as Tab[];
  const execute = (label: string, target?: string) => {
    const root = document.getElementById('rayan-epanet-workspace');
    if (!root || !target) return;
    const candidates = Array.from(root.querySelectorAll('button, strong, h2, h3, summary')) as HTMLElement[];
    const found = candidates.find(el => (el.innerText || el.textContent || '').trim().toLowerCase() === target.toLowerCase());
    if (!found) { setCommandMessage(label + ' · use the relevant panel below'); return; }
    if (found instanceof HTMLButtonElement) found.click();
    else found.scrollIntoView({behavior:'smooth',block:'center'});
    setCommandMessage(label + ' · command activated');
  };
  const activeCommands = useMemo(() => commands[tab], [tab]);
  return <div id="rayan-epanet-workspace" className="ra-epanet-workspace">
    <style>{`
      .ra-epanet-workspace{--ra-ink:#12333d;--ra-muted:#637b80;--ra-line:#d7e3df;--ra-accent:#147b6b;color:var(--ra-ink);min-width:0}
      .ra-epanet-ribbon{border:1px solid var(--ra-line);border-radius:13px 13px 0 0;background:#f8fbfa;overflow:hidden;box-shadow:0 5px 18px rgba(20,55,55,.06)}
      .ra-epanet-titlebar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 15px;background:#12333d;color:#fff}
      .ra-epanet-titlebar strong{font-size:14px;letter-spacing:.02em}.ra-epanet-titlebar small{display:block;color:#c4d7d5;font-size:11px;margin-top:3px}
      .ra-epanet-tabs{display:flex;gap:2px;overflow-x:auto;padding:5px 8px 0;border-bottom:1px solid var(--ra-line);background:#edf4f1}
      .ra-epanet-tab{white-space:nowrap;border:0;border-bottom:3px solid transparent;background:transparent;color:#48636a;padding:10px 13px;font-size:12px;font-weight:750;cursor:pointer}
      .ra-epanet-tab[aria-selected=true]{color:#0e695d;border-bottom-color:#168775;background:#fff}
      .ra-epanet-commandbar{display:flex;gap:7px;align-items:stretch;overflow-x:auto;padding:10px;background:#fff;min-height:84px}
      .ra-epanet-command{display:flex;flex:0 0 92px;flex-direction:column;align-items:center;justify-content:center;gap:5px;border:1px solid transparent;border-radius:8px;background:#fff;color:#23454d;padding:8px 5px;cursor:pointer;font-size:11px;font-weight:700}
      .ra-epanet-command:hover{border-color:#b9d8ce;background:#eff8f4}.ra-epanet-command svg{color:#147b6b}
      .ra-epanet-command small{font-size:9px;font-weight:500;color:#71868a;text-align:center;line-height:1.2}
      .ra-epanet-status{display:flex;align-items:center;gap:7px;border:1px solid var(--ra-line);border-top:0;background:#f5f9f7;padding:7px 12px;color:#587178;font-size:10px}
      .ra-epanet-status span{margin-left:auto}
      .ra-epanet-body{padding-top:12px}
      .ra-epanet-body>section{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;padding:14px!important;border-radius:0 0 13px 13px!important;border-top:0!important;align-items:start}.ra-epanet-body>section>*{min-width:0;grid-column:1/-1}.ra-epanet-body>section>div:nth-child(6){display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;align-items:start}.ra-epanet-body>section>div:nth-child(6)>div{min-width:0}.ra-epanet-body>section>div:nth-child(7){display:grid;grid-template-columns:minmax(0,1fr);gap:12px;align-content:start}@media(max-width:760px){.ra-epanet-body>section>div:nth-child(6){grid-template-columns:minmax(0,1fr)}}
      .ra-epanet-body svg{max-width:100%}
      @media(max-width:640px){.ra-epanet-titlebar{align-items:flex-start;flex-direction:column}.ra-epanet-commandbar{min-height:78px}.ra-epanet-command{flex-basis:82px}}
    `}</style>
    <div className="ra-epanet-ribbon">
      <div className="ra-epanet-titlebar"><div><strong>RAYAN AQUATECH · HYDRAULIC NETWORK DESIGN</strong><small>EPANET workspace · project: {props.projectTitle || 'unsaved project'}</small></div><span style={{fontSize:10,fontWeight:800,color:'#a9e2cf'}}>● ENGINEERING WORKSPACE</span></div>
      <div className="ra-epanet-tabs" role="tablist" aria-label="EPANET ribbon tabs">
        {tabs.map(name=><button key={name} type="button" role="tab" aria-selected={tab===name} className="ra-epanet-tab" onClick={()=>setTab(name)}>{name}</button>)}
      </div>
      <div className="ra-epanet-commandbar" role="toolbar" aria-label={tab+' commands'}>
        {activeCommands.map(item=>{const Icon=item.icon;return <button key={item.label} type="button" className="ra-epanet-command" title={item.hint} onClick={()=>execute(item.label,item.target)}><Icon size={19}/><span>{item.label}</span><small>{item.hint}</small></button>})}
      </div>
      <div className="ra-epanet-status"><span style={{color:'#168775'}}>●</span>{commandMessage}<span>Project-scoped model · SI engineering units</span></div>
    </div>
    <div className="ra-epanet-body"><EpanetEnginePanel {...props}/></div>
  </div>;
}
