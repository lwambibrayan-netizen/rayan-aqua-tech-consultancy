import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  ArrowRight, ArrowUpRight, Activity, CheckCircle2, ChevronDown, Droplets,
  Gauge, Layers3, Mail, MapPinned, Menu, Moon, Network, Ruler, ShieldCheck,
  Sun, Waves, X, MessageCircle, Send, DraftingCompass, Building2, Sprout,
  Mountain, Workflow, FileText
} from 'lucide-react';

type Props = {
  authMode: 'signin' | 'signup';
  setAuthMode: (mode: 'signin' | 'signup') => void;
  authEmail: string;
  setAuthEmail: (value: string) => void;
  authPassword: string;
  setAuthPassword: (value: string) => void;
  authBusy: boolean;
  onSubmitAuth: (event: FormEvent<HTMLFormElement>) => void;
  onGoogleSignIn: () => void;
  errorMessage: string;
  notice: string;
};

function BrandMark({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" role="img" aria-label="Rayan AquaTech water engineering emblem">
      <path d="M32 4C24 16 12 27 12 39a20 20 0 0 0 40 0C52 27 40 16 32 4Z" fill="#D9F1FF" stroke="#167BB5" strokeWidth="2.5"/>
      <path d="M17 40c7-5 12-5 19 0s12 5 18 0" stroke="#167BB5" strokeWidth="3" strokeLinecap="round"/>
      <path d="M20 46c7-4 12-4 18 0s10 4 15 1" stroke="#0B426D" strokeWidth="2.3" strokeLinecap="round"/>
      <path d="M27 35V20h12v15M25 20h16M30 20v-5h6v5M33 15V11" stroke="#0B426D" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M39 31h8v5h-8M47 33.5h5M49.5 31v5" stroke="#0B426D" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M23 35h-5v5" stroke="#0B426D" strokeWidth="2.2" strokeLinecap="round"/>
      <path d="M29 27h8" stroke="#167BB5" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );
}

const services = [
  { icon: Droplets, title: 'Water supply & storage', copy: 'Distribution networks, pumping systems, reservoirs, tanks and transmission pipelines.' },
  { icon: Mountain, title: 'Groundwater development', copy: 'Borehole planning, pump selection, abstraction layouts and source assessments.' },
  { icon: Sprout, title: 'Irrigation systems', copy: 'Water conveyance, field distribution, storage and practical irrigation planning.' },
  { icon: Workflow, title: 'Wastewater & drainage', copy: 'Collection networks, stormwater conveyance, drainage layouts and system assessments.' },
  { icon: Gauge, title: 'Hydraulic modelling', copy: 'Network simulation, pressure and velocity checks, headloss and design alternatives.' },
  { icon: MapPinned, title: 'GIS, CAD & planning', copy: 'Spatial analysis, route planning, engineering drawings, terrain profiles and reports.' },
];

export default function LandingPage(props: Props) {
  const [demand, setDemand] = useState(18);
  const [dark, setDark] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [contact, setContact] = useState({ name: '', email: '', service: 'Water supply & storage', message: '' });
  const [contactMethod, setContactMethod] = useState<'whatsapp' | 'email'>('whatsapp');

  const hydraulic = useMemo(() => {
    const q = demand / 1000;
    const diameter = 0.16;
    const length = 1200;
    const c = 140;
    const velocity = (4 * q) / (Math.PI * diameter * diameter);
    const headloss = (10.67 * length * Math.pow(q, 1.852)) / (Math.pow(c, 1.852) * Math.pow(diameter, 4.871));
    const pressure = Math.max(0, 42 - headloss);
    const velocityOk = velocity >= 0.3 && velocity <= 1.5;
    const pressureOk = pressure >= 15;
    return { velocity, pressure, headloss, compliant: velocityOk && pressureOk, velocityOk, pressureOk };
  }, [demand]);

  const sendContact = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const body = [
      'Rayan AquaTech Consultancy enquiry',
      'Name: ' + contact.name,
      'Email: ' + contact.email,
      'Service: ' + contact.service,
      'Project details: ' + contact.message,
    ].join('\n');
    if (contactMethod === 'whatsapp') {
      window.open('https://wa.me/254716450981?text=' + encodeURIComponent(body), '_blank', 'noopener,noreferrer');
    } else {
      window.location.href = 'mailto:rayanaquatech@gmail.com?subject=' + encodeURIComponent('Engineering consultation enquiry') + '&body=' + encodeURIComponent(body);
    }
  };

  return (
    <main className={dark ? 'ra-site ra-dark' : 'ra-site'} id="top">
      <header className="ra-header">
        <a className="ra-brand" href="#top" aria-label="Rayan AquaTech home">
          <BrandMark size={48} />
          <span><strong>Rayan AquaTech</strong><small>TECH CONSULTANCY</small></span>
        </a>
        <nav className={mobileMenu ? 'ra-nav ra-nav-open' : 'ra-nav'} aria-label="Main navigation">
          <a href="#platform" onClick={() => setMobileMenu(false)}>Engineering tool</a>
          <a href="#services" onClick={() => setMobileMenu(false)}>Services</a>
          <a href="#contact" onClick={() => setMobileMenu(false)}>Contact</a>
        </nav>
        <div className="ra-header-actions">
          <button className="ra-theme-toggle" onClick={() => setDark(!dark)} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}>{dark ? <Sun size={18}/> : <Moon size={18}/>}</button>
          <a className="ra-header-cta" href="#contact">Book a consultation <ArrowUpRight size={16}/></a>
          <button className="ra-menu-toggle" onClick={() => setMobileMenu(!mobileMenu)} aria-label="Toggle menu">{mobileMenu ? <X/> : <Menu/>}</button>
        </div>
      </header>

      <section className="ra-hero">
        <div className="ra-hero-copy">
          <span className="ra-eyebrow"><span/> WATER · INFRASTRUCTURE · DIGITAL ENGINEERING</span>
          <h1>Integrated water engineering and <em>digital infrastructure</em> solutions.</h1>
          <p>We bring engineering consultancy and connected digital tools together to plan, design and analyse water infrastructure with clarity.</p>
          <div className="ra-hero-buttons">
            <a className="ra-button ra-button-primary" href="#workspace-access">Explore the Engineering Tool <ArrowRight size={17}/></a>
            <a className="ra-button ra-button-outline" href="#contact">Book a Consultation</a>
          </div>
          <div className="ra-tagline">DESIGN <i/> ANALYSE <i/> INNOVATE <i/> SUSTAIN</div>
          <div className="ra-hero-foot"><span><ShieldCheck size={16}/> Project-centred engineering</span><span><Activity size={16}/> Data-informed design</span></div>
        </div>
        <div className="ra-hero-art" aria-label="Illustration of a water network and engineering infrastructure">
          <div className="ra-orbit ra-orbit-one"/><div className="ra-orbit ra-orbit-two"/>
          <div className="ra-art-label ra-label-top"><span className="ra-live-dot"/> NETWORK CONCEPT</div>
          <svg className="ra-network-art" viewBox="0 0 600 440" fill="none" role="img" aria-label="Water reservoir and connected pipe network illustration">
            <defs><linearGradient id="raTank" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#D9F1FF"/><stop offset="1" stopColor="#75BDE4"/></linearGradient><linearGradient id="raPipe" x1="0" y1="0" x2="1" y2="0"><stop stopColor="#48A8D8"/><stop offset="1" stopColor="#0B4C79"/></linearGradient></defs>
            <path d="M65 328H535" stroke="#9CC5D9" strokeWidth="2" strokeDasharray="5 8"/>
            <path d="M88 327V280H225V327M225 280H355V327M355 327V256H510V327" stroke="url(#raPipe)" strokeWidth="13" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M88 280H225V327M225 280H355" stroke="#B9E7F8" strokeWidth="3" strokeLinecap="round"/>
            <path d="M225 280V216H355V280" stroke="#167BB5" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M286 216V185" stroke="#167BB5" strokeWidth="7" strokeLinecap="round"/>
            <path d="M268 185H304L299 153H273L268 185Z" fill="url(#raTank)" stroke="#0B426D" strokeWidth="3"/>
            <path d="M274 161H298" stroke="#167BB5" strokeWidth="3"/>
            <path d="M281 153V139H291V153" stroke="#0B426D" strokeWidth="3"/>
            <path d="M355 256V190H445V256" stroke="#167BB5" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M410 190V150" stroke="#167BB5" strokeWidth="7" strokeLinecap="round"/>
            <path d="M392 150H428L423 120H397L392 150Z" fill="url(#raTank)" stroke="#0B426D" strokeWidth="3"/>
            <path d="M398 128H422" stroke="#167BB5" strokeWidth="3"/>
            <circle cx="88" cy="280" r="16" fill="#fff" stroke="#167BB5" strokeWidth="5"/><circle cx="225" cy="280" r="16" fill="#fff" stroke="#167BB5" strokeWidth="5"/><circle cx="355" cy="256" r="16" fill="#fff" stroke="#167BB5" strokeWidth="5"/><circle cx="510" cy="256" r="16" fill="#fff" stroke="#167BB5" strokeWidth="5"/>
            <path d="M218 273L232 287M232 273L218 287" stroke="#0B426D" strokeWidth="3" strokeLinecap="round"/>
            <path d="M348 249L362 263M362 249L348 263" stroke="#0B426D" strokeWidth="3" strokeLinecap="round"/>
            <path d="M70 327V348M50 348H90M490 327V348M470 348H530" stroke="#0B426D" strokeWidth="4" strokeLinecap="round"/>
            <path d="M105 280H205M240 280H340M370 256H495" stroke="#DDF5FF" strokeWidth="2" strokeDasharray="9 8"/>
            <path d="M130 267l10 13-10 13M285 267l10 13-10 13M430 243l10 13-10 13" stroke="#167BB5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M286 216V185M410 190V150" stroke="#0B426D" strokeWidth="2" strokeDasharray="4 5"/>
            <path d="M66 371H534" stroke="#B5D3E0" strokeWidth="2"/>
            <circle cx="88" cy="280" r="28" stroke="#73BDE0" strokeOpacity=".35" strokeWidth="2"/><circle cx="510" cy="256" r="28" stroke="#73BDE0" strokeOpacity=".35" strokeWidth="2"/>
          </svg>
          <div className="ra-art-label ra-label-bottom"><span className="ra-pulse"/> CONNECTED WATER SYSTEMS <b>01 — 06</b></div>
          <div className="ra-float-card"><span className="ra-float-icon"><Gauge size={18}/></span><span><small>HYDRAULIC DESIGN</small><strong>Pressure · Flow · Velocity</strong></span></div>
        </div>
      </section>

      <section className="ra-platform" id="platform">
        <div className="ra-section-intro">
          <span className="ra-eyebrow">THE DIGITAL ENGINEERING PLATFORM</span>
          <h2>Engineering decisions, connected.</h2>
          <p>A preview of the project workspace that brings hydraulic analysis, spatial context and technical drafting into one workflow.</p>
        </div>
        <div className="ra-workspace">
          <div className="ra-workspace-top"><div className="ra-window-dots"><i/><i/><i/></div><span>RAYANAQUA / HYDRAULIC MODEL PREVIEW</span><span className="ra-workspace-status"><b/> LIVE PREVIEW</span></div>
          <div className="ra-workspace-body">
            <aside className="ra-workspace-side"><strong>NETWORK</strong><span className="ra-side-active"><Network size={15}/> Distribution model</span><span><Droplets size={15}/> Reservoir R-01</span><span><Activity size={15}/> Junction J-12</span><span><Workflow size={15}/> Pipe P-104</span><div className="ra-side-legend"><strong>PRESSURE KEY</strong><i/> 15–30 m <i/> 30–45 m <i/> 45+ m</div></aside>
            <div className="ra-model-area">
              <div className="ra-model-heading"><span><small>PROJECT MODEL</small><strong>Water distribution network</strong></span><span className="ra-model-units">SI UNITS · METRES</span></div>
              <svg viewBox="0 0 650 300" className="ra-model-svg" role="img" aria-label="Schematic water distribution pipe network with nodes and pressure labels">
                <defs><pattern id="raGrid" width="26" height="26" patternUnits="userSpaceOnUse"><path d="M26 0H0V26" fill="none" stroke="#dbe8ee" strokeWidth="1"/></pattern></defs>
                <rect width="650" height="300" fill="url(#raGrid)"/>
                <path d="M80 80H255V150H420V75H560M255 150V235H420V150H560M80 80V235H255" stroke="#1685B9" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                <path d="M80 80H255V150H420V75H560M255 150V235H420V150H560M80 80V235H255" stroke="#DDF5FF" strokeWidth="2" strokeDasharray="8 10" fill="none"/>
                <g fill="#fff" stroke="#0B5C8B" strokeWidth="4"><circle cx="80" cy="80" r="12"/><circle cx="255" cy="80" r="10"/><circle cx="255" cy="150" r="12"/><circle cx="420" cy="150" r="12"/><circle cx="420" cy="75" r="10"/><circle cx="560" cy="75" r="12"/><circle cx="80" cy="235" r="10"/><circle cx="255" cy="235" r="10"/><circle cx="420" cy="235" r="10"/><circle cx="560" cy="150" r="10"/></g>
                <g fill="#16435D" fontSize="11" fontWeight="700"><text x="55" y="55">R-01</text><text x="230" y="58">J-04</text><text x="229" y="132">J-12</text><text x="394" y="132">J-18</text><text x="394" y="52">J-21</text><text x="536" y="51">T-02</text><text x="536" y="130">J-25</text></g>
                <g fill="#39758F" fontSize="10"><text x="125" y="69">P-101</text><text x="286" y="138">P-104</text><text x="442" y="65">P-108</text><text x="285" y="225">P-110</text></g>
                <g><rect x="94" y="91" width="70" height="23" rx="6" fill="#E5F4FB"/><text x="129" y="106" textAnchor="middle" fill="#0B5C8B" fontSize="10" fontWeight="700">{hydraulic.pressure.toFixed(1)} m</text><rect x="434" y="164" width="70" height="23" rx="6" fill="#E5F4FB"/><text x="469" y="179" textAnchor="middle" fill="#0B5C8B" fontSize="10" fontWeight="700">{Math.max(0, hydraulic.pressure - 2.4).toFixed(1)} m</text></g>
              </svg>
              <div className="ra-model-legend"><span><i className="ra-legend-pipe"/> Pipe</span><span><i className="ra-legend-node"/> Junction</span><span><i className="ra-legend-tank"/> Storage</span><small>Illustrative network · not a project simulation</small></div>
            </div>
          </div>
          <div className="ra-analysis">
            <div className="ra-demand-control"><div className="ra-control-title"><span><small>DEMAND SCENARIO</small><strong>System demand</strong></span><b>{demand} L/s</b></div><input aria-label="Adjust network demand" type="range" min="4" max="34" step="1" value={demand} onChange={e => setDemand(Number(e.target.value))}/><div className="ra-range-labels"><span>4 L/s · Low</span><span>34 L/s · Peak</span></div></div>
            <div className="ra-metric"><small>EST. RESIDUAL PRESSURE</small><strong>{hydraulic.pressure.toFixed(1)} <em>m</em></strong><span className={hydraulic.pressureOk ? 'ra-metric-good' : 'ra-metric-warn'}>{hydraulic.pressureOk ? 'Within preview range' : 'Below 15 m guide'}</span></div>
            <div className="ra-metric"><small>PIPE VELOCITY</small><strong>{hydraulic.velocity.toFixed(2)} <em>m/s</em></strong><span className={hydraulic.velocityOk ? 'ra-metric-good' : 'ra-metric-warn'}>{hydraulic.velocityOk ? 'Within 0.3–1.5 m/s guide' : hydraulic.velocity < 0.3 ? 'Below 0.3 m/s guide' : 'Above 1.5 m/s guide'}</span></div>
            <div className="ra-compliance"><span className={hydraulic.compliant ? 'ra-compliance-icon ok' : 'ra-compliance-icon warn'}>{hydraulic.compliant ? <CheckCircle2 size={20}/> : <Activity size={20}/>}</span><span><small>DESIGN CHECK</small><strong>{hydraulic.compliant ? 'Within preview limits' : 'Review required'}</strong></span></div>
          </div>
          <p className="ra-preview-note">Interactive concept preview using a simplified single-pipe Hazen–Williams estimate. Values are illustrative, not a validated EPANET project result or final design approval.</p>
        </div>
        <div className="ra-platform-points">
          <article><span><Gauge size={20}/></span><div><strong>Hydraulic modelling</strong><p>Flows, pressure, velocity and network performance.</p></div></article>
          <article><span><MapPinned size={20}/></span><div><strong>GIS & elevation-aware design</strong><p>Spatial routes, terrain context and ground profiles.</p></div></article>
          <article><span><DraftingCompass size={20}/></span><div><strong>CAD & engineering reports</strong><p>Technical drafting, quantities and project documentation.</p></div></article>
        </div>
        <div className="ra-tool-access" id="workspace-access"><div><span className="ra-eyebrow">ENGINEER WORKSPACE</span><h3>Ready to work on a project?</h3><p>Sign in to open your private engineering workspace.</p></div><a className="ra-button ra-button-primary" href="#workspace-login">Open Engineering Tool <ArrowRight size={17}/></a></div>
      </section>

      <section className="ra-services" id="services">
        <div className="ra-section-intro"><span className="ra-eyebrow">CONSULTANCY SERVICES</span><h2>Water infrastructure, from source to system.</h2><p>Practical engineering support for planning, design, analysis and project development.</p></div>
        <div className="ra-services-grid">{services.map((service, index) => { const Icon = service.icon; return <article className="ra-service-card" key={service.title}><span className="ra-service-icon"><Icon size={22}/></span><small>0{index + 1}</small><h3>{service.title}</h3><p>{service.copy}</p><a href="#contact" aria-label={'Enquire about ' + service.title}>Discuss this service <ArrowUpRight size={15}/></a></article>; })}</div>
      </section>

      <section className="ra-contact" id="contact">
        <div className="ra-contact-copy"><span className="ra-eyebrow">START A CONVERSATION</span><h2>Let’s plan your next water project.</h2><p>Tell us what you are planning, where the project is located and what support you need. We’ll follow up to discuss the next steps.</p>
          <div className="ra-direct-links"><a href="mailto:rayanaquatech@gmail.com"><span><Mail size={19}/></span><div><small>EMAIL</small><strong>rayanaquatech@gmail.com</strong></div><ArrowUpRight size={16}/></a><a href="https://wa.me/254716450981" target="_blank" rel="noreferrer"><span><MessageCircle size={19}/></span><div><small>WHATSAPP</small><strong>+254 716 450 981</strong></div><ArrowUpRight size={16}/></a></div>
        </div>
        <form className="ra-contact-form" onSubmit={sendContact}><div className="ra-form-heading"><strong>Project enquiry</strong><span>We usually respond as soon as possible.</span></div><label>Your name<input required value={contact.name} onChange={e => setContact({...contact, name:e.target.value})} placeholder="Full name"/></label><label>Email address<input required type="email" value={contact.email} onChange={e => setContact({...contact, email:e.target.value})} placeholder="you@example.com"/></label><label>Service required<select value={contact.service} onChange={e => setContact({...contact, service:e.target.value})}>{services.map(s => <option key={s.title}>{s.title}</option>)}</select></label><label>Project details<textarea required rows={4} value={contact.message} onChange={e => setContact({...contact, message:e.target.value})} placeholder="Briefly describe your project, location and requirements…"/></label><div className="ra-send-row"><div className="ra-send-choice"><button type="button" className={contactMethod === 'whatsapp' ? 'selected' : ''} onClick={() => setContactMethod('whatsapp')}><MessageCircle size={15}/> WhatsApp</button><button type="button" className={contactMethod === 'email' ? 'selected' : ''} onClick={() => setContactMethod('email')}><Mail size={15}/> Email</button></div><button className="ra-button ra-button-primary" type="submit">Send enquiry <Send size={16}/></button></div><small className="ra-form-note">Your message opens in your selected app so you can review and send it.</small></form>
      </section>

      <footer className="ra-footer"><a className="ra-brand" href="#top"><BrandMark size={40}/><span><strong>Rayan AquaTech</strong><small>TECH CONSULTANCY</small></span></a><span>Design · Analyse · Innovate · Sustain</span><span>© {new Date().getFullYear()} Rayan AquaTech Tech Consultancy</span></footer>

      <a className="ra-whatsapp-float" href="https://wa.me/254716450981" target="_blank" rel="noreferrer" aria-label="Chat with Rayan AquaTech on WhatsApp"><MessageCircle size={25}/></a>

      <div className="ra-login-overlay" id="workspace-login">
        <div className="ra-login-card"><a className="ra-login-close" href="#top" aria-label="Close sign in"><X size={20}/></a><BrandMark size={46}/><span className="ra-eyebrow">PRIVATE ENGINEER ACCESS</span><h2>{props.authMode === 'signin' ? 'Welcome back.' : 'Create your workspace.'}</h2><p>{props.authMode === 'signin' ? 'Sign in to continue to your projects and engineering tools.' : 'Register an engineer account to start a private project workspace.'}</p>
          <form onSubmit={props.onSubmitAuth}><label>Email address<input type="email" autoComplete="email" required value={props.authEmail} onChange={e => props.setAuthEmail(e.target.value)} placeholder="engineer@company.com"/></label><label>Password<input type="password" autoComplete={props.authMode === 'signup' ? 'new-password' : 'current-password'} minLength={8} required value={props.authPassword} onChange={e => props.setAuthPassword(e.target.value)} placeholder="At least 8 characters"/></label><button className="ra-button ra-button-primary ra-login-submit" type="submit" disabled={props.authBusy}>{props.authBusy ? 'Please wait…' : props.authMode === 'signup' ? 'Create engineer account' : 'Sign in to workspace'} <ArrowRight size={17}/></button></form>
          <div className="ra-login-switch">{props.authMode === 'signin' ? 'New to Rayan AquaTech? ' : 'Already registered? '}<button onClick={() => props.setAuthMode(props.authMode === 'signin' ? 'signup' : 'signin')}>{props.authMode === 'signin' ? 'Create an account' : 'Sign in'}</button></div><div className="ra-login-divider">OR</div><button className="ra-button ra-button-outline ra-login-submit" onClick={props.onGoogleSignIn}>Continue with Google <ArrowRight size={16}/></button>{props.notice && <p className="ra-login-notice">{props.notice}</p>}{props.errorMessage && <p className="ra-login-error">{props.errorMessage}</p>}<small className="ra-login-security"><ShieldCheck size={15}/> Authenticated access · Private project records</small>
        </div>
      </div>
    </main>
  );
}
