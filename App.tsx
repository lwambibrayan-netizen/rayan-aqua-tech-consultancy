import { useEffect, useMemo, useRef, useState } from 'react';
import EpanetEnginePanel from './EpanetEnginePanel';
import GisEnginePanel from './GisEnginePanel';
import Cad3DEnginePanel from './Cad3DEnginePanel';
import BoqEnginePanel from './BoqEnginePanel';
import { api, auth } from './client';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  BookOpen,
  Box,
  Calculator,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Cloud,
  Compass,
  FileText,
  FolderKanban,
  Gauge,
  Layers3,
  LogOut,
  MapPinned,
  Menu,
  Plus,
  Ruler,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Waves,
  X,
} from 'lucide-react';

type User = { userId: string; name?: string; email?: string; picture?: string };
type Project = {
  id: string;
  title: string;
  location: string;
  projectType: string;
  client: string;
  status: string;
  description: string;
  createdAt: string;
  updatedAt: string;
};
type Section =
  | 'Overview'
  | 'Projects'
  | 'Project workspace'
  | 'Hydraulic design'
  | 'GIS workspace'
  | 'CAD & 3D workspace'
  | 'BOQ'
  | 'Reports'
  | 'Engineering tools';
type Doc = { data: any; version: number } | null;

const nav = [
  { name: 'Overview' as Section, icon: BarChart3 },
  { name: 'Projects' as Section, icon: FolderKanban },
  { name: 'Project workspace' as Section, icon: Layers3 },
  { name: 'Hydraulic design' as Section, icon: Waves },
  { name: 'GIS workspace' as Section, icon: MapPinned },
  { name: 'CAD & 3D workspace' as Section, icon: Box },
  { name: 'BOQ' as Section, icon: ClipboardList },
  { name: 'Reports' as Section, icon: FileText },
  { name: 'Engineering tools' as Section, icon: Calculator },
];

const money = (value: number) =>
  new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [section, setSection] = useState<Section>('Overview');
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState('');
  const [openedId, setOpenedId] = useState('');
  const [gisImportToken, setGisImportToken] = useState(0);
  const [pendingGisFeatures, setPendingGisFeatures] = useState<any[] | null>(null);
  const documentLoadRef = useRef(0);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [docLoading, setDocLoading] = useState(false);
  const [hydraulicDoc, setHydraulicDoc] = useState<Doc>(null);
  const [gisDoc, setGisDoc] = useState<Doc>(null);
  const [boqDoc, setBoqDoc] = useState<Doc>(null);
  const [reportDoc, setReportDoc] = useState<Doc>(null);
  const [calculationDoc, setCalculationDoc] = useState<Doc>(null);
  const [drawingDoc, setDrawingDoc] = useState<Doc>(null);
  const [flow, setFlow] = useState('12');
  const [diameter, setDiameter] = useState('160');
  const [length, setLength] = useState('1200');
  const [hwC, setHwC] = useState('140');
  const [boqItems, setBoqItems] = useState<
    Array<{
      id: string;
      description: string;
      unit: string;
      qty: number;
      rate: number;
    }>
  >([]);
  const [reportText, setReportText] = useState('');
  const [newProject, setNewProject] = useState({
    title: '',
    location: '',
    projectType: 'Water supply',
    client: '',
    description: '',
  });

  const activeProject = projects.find(p => p.id === openedId) ?? null;
  const selectedProject = projects.find(p => p.id === activeId) ?? null;
  const filteredProjects = useMemo(
    () =>
      projects.filter(p =>
        [p.title, p.location, p.client, p.projectType]
          .join(' ')
          .toLowerCase()
          .includes(search.toLowerCase())
      ),
    [projects, search]
  );

  const q = Number(flow) / 1000;
  const d = Number(diameter) / 1000;
  const l = Number(length);
  const c = Number(hwC);
  const velocity = d > 0 ? (4 * q) / (Math.PI * d * d) : 0;
  const headloss =
    q > 0 && d > 0 && c > 0 && l >= 0
      ? (10.67 * l * Math.pow(q, 1.852)) /
        (Math.pow(c, 1.852) * Math.pow(d, 4.871))
      : 0;
  const gradient = l > 0 ? (headloss / l) * 1000 : 0;
  const totalBoq = boqItems.reduce(
    (sum, item) => sum + item.qty * item.rate,
    0
  );

  async function loadProjects() {
    setLoading(true);
    setErrorMessage('');
    try {
      const response = await api.get('/api/projects');
      const rows = (response.data.projects ?? []) as Project[];
      setProjects(rows);
      setActiveId(current =>
        current && rows.some(p => p.id === current)
          ? current
          : (rows[0]?.id ?? '')
      );
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Could not load your projects.'
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let alive = true;
    auth
      .getUser()
      .then(async current => {
        if (!alive) return;
        setUser(current);
        setAuthReady(true);
        if (current) await loadProjects();
      })
      .catch(() => {
        if (alive) {
          setAuthReady(true);
          setErrorMessage(
            'Your sign-in session could not be restored. Please try signing in again.'
          );
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  async function submitEmailAuth(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthBusy(true);
    setErrorMessage('');
    setNotice('');
    try {
      if (authMode === 'signup') {
        const confirmationRequired = await auth.signUpWithPassword(authEmail.trim(), authPassword);
        setNotice(
          confirmationRequired
            ? 'Account created. Check your email to confirm your address before signing in.'
            : 'Account created and signed in successfully.'
        );
      } else {
        await auth.signInWithPassword(authEmail.trim(), authPassword);
        const current = await auth.getUser();
        setUser(current);
        if (current) await loadProjects();
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Email authentication failed. Please retry.'
      );
    } finally {
      setAuthBusy(false);
    }
  }

  async function signIn() {
    setAuthBusy(true);
    setErrorMessage('');
    setNotice('');
    try {
      await auth.signInWithGoogle();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Google sign-in could not start. Please retry.'
      );
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOut() {
    await auth.signOut();
    setUser(null);
    setProjects([]);
    setActiveId('');
    setOpenedId('');
    setSection('Overview');
    setHydraulicDoc(null);
    setGisDoc(null);
    setBoqDoc(null);
    setReportDoc(null);
    setCalculationDoc(null);
  }

  async function createProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!newProject.title.trim()) {
      setErrorMessage('Enter a project name before saving.');
      return;
    }
    setLoading(true);
    setErrorMessage('');
    try {
      const response = await api.post('/api/projects', {
        ...newProject,
        status: 'Planning',
      });
      const created = response.data.project as Project;
      setProjects(current => [created, ...current]);
      setActiveId(created.id);
      setOpenedId(created.id);
      setShowCreate(false);
      setNewProject({
        title: '',
        location: '',
        projectType: 'Water supply',
        client: '',
        description: '',
      });
      setSection('Project workspace');
      setNotice('Project workspace created.');
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Project could not be created.'
      );
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(status: string) {
    if (!activeProject) return;
    try {
      const response = await api.put('/api/projects/' + activeProject.id, {
        status,
      });
      const updated = response.data.project as Project;
      setProjects(rows => rows.map(p => (p.id === updated.id ? updated : p)));
      setNotice('Project status updated.');
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Status update failed.'
      );
    }
  }

  async function deleteProject(project: Project) {
    if (
      !window.confirm(
        'Delete ' +
          project.title +
          ' and its saved project documents? This cannot be undone.'
      )
    )
      return;
    try {
      await api.delete('/api/projects/' + project.id);
      const next = projects.filter(p => p.id !== project.id);
      setProjects(next);
      setActiveId(next[0]?.id ?? '');
      if (openedId === project.id) {
        documentLoadRef.current += 1;
        setOpenedId('');
        setSection('Projects');
        setHydraulicDoc(null);
        setGisDoc(null);
        setBoqDoc(null);
        setReportDoc(null);
        setCalculationDoc(null);
      }
      setNotice('Project deleted.');
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Project could not be deleted.'
      );
    }
  }

  async function loadDocument(
    kind: 'hydraulic' | 'boq' | 'report' | 'gis' | 'calculations' | 'drawing',
    projectId: string,
    requestId: number
  ) {
    setDocLoading(true);
    try {
      const response = await api.get(
        '/api/projects/' + projectId + '/docs/' + kind
      );
      if (requestId !== documentLoadRef.current) return;
      const document = response.data.document as Doc;
      if (kind === 'hydraulic') {
        setHydraulicDoc(document);
        if (document?.data) {
          setFlow(String(document.data.flow ?? '12'));
          setDiameter(String(document.data.diameter ?? '160'));
          setLength(String(document.data.length ?? '1200'));
          setHwC(String(document.data.hwC ?? '140'));
        }
      }
      if (kind === 'gis') setGisDoc(document);
      if (kind === 'boq') {
        setBoqDoc(document);
        setBoqItems(document?.data?.items ?? []);
      }
      if (kind === 'report') {
        setReportDoc(document);
        setReportText(document?.data?.text ?? '');
      }
      if (kind === 'calculations') setCalculationDoc(document);
      if (kind === 'drawing') setDrawingDoc(document);
    } catch (error) {
      if (requestId === documentLoadRef.current) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'Could not load project document.'
        );
      }
    } finally {
      if (requestId === documentLoadRef.current) setDocLoading(false);
    }
  }

  useEffect(() => {
    if (!user || !openedId) return;
    const requestId = ++documentLoadRef.current;
    setHydraulicDoc(null);
    setGisDoc(null);
    setBoqDoc(null);
    setReportDoc(null);
    setCalculationDoc(null);
    setDrawingDoc(null);
    loadDocument('hydraulic', openedId, requestId);
    loadDocument('gis', openedId, requestId);
    loadDocument('boq', openedId, requestId);
    loadDocument('report', openedId, requestId);
    loadDocument('calculations', openedId, requestId);
    loadDocument('drawing', openedId, requestId);
  }, [openedId, user?.userId]);

  async function saveDocument(
    kind: 'hydraulic' | 'boq' | 'report' | 'gis' | 'calculations' | 'drawing',
    data: unknown
  ) {
    if (!activeProject) {
      setErrorMessage('Choose a project before saving project work.');
      return;
    }
    try {
      const response = await api.post(
        '/api/projects/' + activeProject.id + '/docs/' + kind,
        { data }
      );
      const document = response.data.document;
      if (kind === 'hydraulic') setHydraulicDoc(document);
      if (kind === 'gis') setGisDoc(document);
      if (kind === 'boq') setBoqDoc(document);
      if (kind === 'report') setReportDoc(document);
      if (kind === 'calculations') setCalculationDoc(document);
      if (kind === 'drawing') setDrawingDoc(document);
      setNotice('Saved to ' + activeProject.title + '.');
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Document could not be saved.'
      );
      throw error;
    }
  }

  function openProject(projectId: string) {
    documentLoadRef.current += 1;
    setGisImportToken(0);
    setPendingGisFeatures(null);
    setHydraulicDoc(null);
    setGisDoc(null);
    setBoqDoc(null);
    setReportDoc(null);
    setCalculationDoc(null);
    setDrawingDoc(null);
    setActiveId(projectId);
    setOpenedId(projectId);
    setSection('Project workspace');
    setMobileNav(false);
    setErrorMessage('');
  }

  function openLinkedEpanet(currentFeatures?: any[]) {
    if (!activeProject) return;
    const savedFeatures = gisDoc?.data?.featureCollection?.features ?? [];
    const featuresToImport = Array.isArray(currentFeatures) && currentFeatures.length
      ? currentFeatures
      : savedFeatures;
    if (!featuresToImport.length) {
      setErrorMessage('This project has no GIS draft yet. Open GIS and draw at least two hydraulic nodes and one connecting pipeline.');
      setSection('GIS workspace');
      return;
    }
    setPendingGisFeatures(featuresToImport);
    setGisImportToken(value => value + 1);
    setSection('Engineering tools');
    setMobileNav(false);
    setNotice('Opening EPANET with the latest GIS draft features.');
  }

  function closeProject() {
    if (!window.confirm('Close this project workspace and return to the main dashboard? Saved work will remain in the project.')) return;
    documentLoadRef.current += 1;
    setOpenedId('');
    setSection('Overview');
    setHydraulicDoc(null);
    setGisDoc(null);
    setBoqDoc(null);
    setReportDoc(null);
    setCalculationDoc(null);
    setDrawingDoc(null);
  }

  function openSection(next: Section) {
    setSection(next);
    setMobileNav(false);
    setErrorMessage('');
  }

  if (!authReady) {
    return (
      <div className="boot-screen">
        <div className="boot-mark">
          <Waves size={28} />
        </div>
        <p>Preparing your engineering workspace…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <main className="login-shell">
        <div className="login-art">
          <div className="brand-lockup">
            <span className="brand-symbol">
              <Waves size={22} />
            </span>
            <span>
              RayanAqua<span className="brand-light"> / TECH</span>
            </span>
          </div>
          <div className="login-message">
            <span className="eyebrow">
              WATER SYSTEMS · ENGINEERING · DELIVERY
            </span>
            <h1>
              Design with clarity.
              <br />
              <em>Deliver with confidence.</em>
            </h1>
            <p>
              A focused workspace for water infrastructure projects, hydraulic
              design, quantities and engineering documentation.
            </p>
          </div>
          <div className="login-bottom">
            <span>ENGINEERING WORKSPACE</span>
            <span>KENYA · EAST AFRICA</span>
          </div>
        </div>
        <div className="login-panel">
          <div className="login-card">
            <span className="eyebrow muted">YOUR PROJECT OFFICE</span>
            <h2>Welcome to RayanAqua.</h2>
            <p>
              Sign in to open your private engineering workspace. Your project
              records are isolated to your account.
            </p>
            <form className="auth-form" onSubmit={submitEmailAuth}>
              <label htmlFor="auth-email">Email address</label>
              <input id="auth-email" type="email" autoComplete="email" required value={authEmail} onChange={e => setAuthEmail(e.target.value)} placeholder="engineer@company.com" />
              <label htmlFor="auth-password">Password</label>
              <input id="auth-password" type="password" autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'} minLength={8} required value={authPassword} onChange={e => setAuthPassword(e.target.value)} placeholder="At least 8 characters" />
              <button className="primary-button full" type="submit" disabled={authBusy}>
                {authBusy ? 'Please wait…' : authMode === 'signup' ? 'Create engineer account' : 'Sign in with email'}
              </button>
            </form>
            <div className="auth-switch">
              {authMode === 'signin' ? "New to RayanAqua? " : 'Already registered? '}
              <button type="button" onClick={() => { setAuthMode(authMode === 'signin' ? 'signup' : 'signin'); setErrorMessage(''); setNotice(''); }}>
                {authMode === 'signin' ? 'Create an account' : 'Sign in'}
              </button>
            </div>
            <div className="auth-divider"><span>OR</span></div>
            <button className="secondary-button full auth-google" onClick={signIn} disabled={authBusy}>
              Continue with Google <ChevronRight size={17} />
            </button>
            {notice && <div className="alert success">{notice}</div>}
            {errorMessage && <div className="alert error">{errorMessage}</div>}
            <div className="login-security">
              <ShieldCheck size={17} />
              <span>Authenticated access · Private project records</span>
            </div>
          </div>
          <div className="login-foot">
            RayanAqua Tech Consultancy <span>© {new Date().getFullYear()}</span>
          </div>
        </div>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className={'sidebar ' + (mobileNav ? 'sidebar-open' : '')}>
        <div className="brand-lockup">
          <span className="brand-symbol">
            <Waves size={22} />
          </span>
          <span>
            RayanAqua<span className="brand-light"> / TECH</span>
          </span>
        </div>
        <div className="workspace-label">
          ENGINEERING OFFICE <span className="live-dot" />
        </div>
        <div className="side-nav">
          <span className="nav-caption">WORKSPACE</span>
          {nav.map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.name}
                className={
                  'nav-item ' + (section === item.name ? 'active' : '')
                }
                onClick={() => openSection(item.name)}
              >
                <Icon size={18} />
                <span>{item.name}</span>
                {section === item.name && <span className="nav-indicator" />}
              </button>
            );
          })}
        </div>
        <div className="sidebar-bottom">
          <div className="account-card">
            <div className="avatar">
              {(user.name || user.email || 'E').slice(0, 1).toUpperCase()}
            </div>
            <div className="account-copy">
              <strong>{user.name || 'Engineer'}</strong>
              <span>{user.email || 'Signed in'}</span>
            </div>
            <button
              className="icon-button"
              aria-label="Sign out"
              onClick={signOut}
            >
              <LogOut size={16} />
            </button>
          </div>
          <div className="side-foot">
            <ShieldCheck size={14} /> Private workspace
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="mobile-menu icon-button"
              onClick={() => setMobileNav(!mobileNav)}
              aria-label="Open navigation"
            >
              <Menu size={20} />
            </button>
            <div>
              <div className="breadcrumb">
                RAYANAQUA <span>/</span> {section.toUpperCase()}
              </div>
              <div className="top-title">{section}</div>
            </div>
          </div>
          <div className="top-actions">
            <span className="cloud-status">
              <span className="live-dot" /> Cloud workspace
            </span>
            {activeProject && <button className="secondary-button small" onClick={closeProject}><LogOut size={15} /> Close project</button>}
            <button
              className="primary-button small"
              onClick={() => setShowCreate(true)}
            >
              <Plus size={16} /> New project
            </button>
          </div>
        </header>

        <div className="page-content">
          {errorMessage && (
            <div className="alert error">
              <span>{errorMessage}</span>
              <button onClick={() => setErrorMessage('')}>
                <X size={15} />
              </button>
            </div>
          )}
          {notice && (
            <div className="alert success">
              <Check size={15} />
              <span>{notice}</span>
              <button onClick={() => setNotice('')}>
                <X size={15} />
              </button>
            </div>
          )}

          {section === 'Overview' && (
            <>
              <div className="welcome-row">
                <div>
                  <span className="eyebrow muted">PROJECT CONTROL CENTRE</span>
                  <h1>
                    Good to have you back
                    {user.name ? ', ' + user.name.split(' ')[0] : ''}.
                  </h1>
                  <p>
                    Keep your water infrastructure work moving from concept to
                    delivery.
                  </p>
                </div>
                <div className="date-chip">
                  <Compass size={16} /> Taita Taveta · Kenya
                </div>
              </div>
              <div className="metric-grid">
                <div className="metric-card">
                  <div className="metric-top">
                    <span>Active projects</span>
                    <FolderKanban size={18} />
                  </div>
                  <strong>
                    {projects.filter(p => p.status === 'In progress').length}
                  </strong>
                  <small>Currently in delivery</small>
                </div>
                <div className="metric-card">
                  <div className="metric-top">
                    <span>Project portfolio</span>
                    <Layers3 size={18} />
                  </div>
                  <strong>{projects.length}</strong>
                  <small>Across your workspace</small>
                </div>
                <div className="metric-card">
                  <div className="metric-top">
                    <span>Planning stage</span>
                    <Activity size={18} />
                  </div>
                  <strong>
                    {projects.filter(p => p.status === 'Planning').length}
                  </strong>
                  <small>Awaiting next actions</small>
                </div>
                <div className="metric-card accent-metric">
                  <div className="metric-top">
                    <span>Data protection</span>
                    <ShieldCheck size={18} />
                  </div>
                  <strong>Private</strong>
                  <small>Account-scoped records</small>
                </div>
              </div>
              <div className="section-heading">
                <div>
                  <span className="eyebrow muted">YOUR PORTFOLIO</span>
                  <h2>Recent projects</h2>
                </div>
                <button
                  className="text-button"
                  onClick={() => openSection('Projects')}
                >
                  View all <ArrowUpRight size={15} />
                </button>
              </div>
              <ProjectCards
                projects={projects.slice(0, 3)}
                onOpen={openProject}
                onCreate={() => setShowCreate(true)}
              />
              <div className="lower-grid">
                <div className="panel feature-panel">
                  <div className="panel-icon">
                    <Gauge size={20} />
                  </div>
                  <div>
                    <span className="eyebrow muted">HYDRAULIC DESIGN</span>
                    <h3>From flow to headloss.</h3>
                    <p>
                      Run preliminary pipe sizing and Hazen–Williams headloss
                      calculations within a project workspace.
                    </p>
                    <button
                      className="text-button"
                      onClick={() => openSection('Hydraulic design')}
                    >
                      Open hydraulic tools <ArrowUpRight size={15} />
                    </button>
                  </div>
                </div>
                <div className="panel status-panel">
                  <div className="panel-heading">
                    <h3>Cloud capability status</h3>
                    <span className="status-pill">Operational core</span>
                  </div>
                  <CapabilityLine
                    label="Private project workspace"
                    status="Available"
                  />
                  <CapabilityLine
                    label="Project documents"
                    status="Available"
                  />
                  <CapabilityLine
                    label="Hydraulic design calculator"
                    status="Available"
                  />
                  <CapabilityLine
                    label="EPANET / WNTR solver"
                    status="Not connected"
                  />
                  <CapabilityLine label="Interactive GIS mapping and GeoJSON" status="Available" />
                  <CapabilityLine label="Native QGIS / PostGIS processing" status="Not connected" />
                  <CapabilityLine
                    label="Full CAD / 3D clash engine"
                    status="Not connected"
                  />
                </div>
              </div>
            </>
          )}

          {section === 'Projects' && (
            <>
              <div className="page-intro">
                <div>
                  <span className="eyebrow muted">PROJECT REGISTER</span>
                  <h1>Engineering projects</h1>
                  <p>
                    Organise studies, designs, construction packages and client
                    work.
                  </p>
                </div>
                <button
                  className="primary-button"
                  onClick={() => setShowCreate(true)}
                >
                  <Plus size={17} /> Create project
                </button>
              </div>
              <div className="toolbar">
                <div className="search-box">
                  <Search size={17} />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search projects, clients or locations"
                  />
                </div>
                <span className="result-count">
                  {filteredProjects.length} projects
                </span>
              </div>
              {loading ? (
                <div className="empty-state">Loading your projects…</div>
              ) : (
                <ProjectCards
                  projects={filteredProjects}
                  onOpen={openProject}
                  onCreate={() => setShowCreate(true)}
                  selectedId={activeId}
                />
              )}
              {selectedProject && (
                <div className="panel project-detail">
                  <div className="detail-heading">
                    <div>
                      <span className="eyebrow muted">SELECTED PROJECT</span>
                      <h2>{selectedProject.title}</h2>
                      <p>
                        {selectedProject.location || 'Location not set'} ·{' '}
                        {selectedProject.projectType}
                      </p>
                    </div>
                    <button
                      className="danger-button"
                      onClick={() => deleteProject(selectedProject)}
                    >
                      <Trash2 size={15} /> Delete
                    </button>
                  </div>
                  <div className="detail-grid">
                    <div>
                      <label>Client / organisation</label>
                      <strong>{selectedProject.client || 'Not specified'}</strong>
                    </div>
                    <div>
                      <label>Created</label>
                      <strong>
                        {new Date(selectedProject.createdAt).toLocaleDateString()}
                      </strong>
                    </div>
                    <div>
                      <label>Project status</label>
                      <select
                        value={selectedProject.status}
                        onChange={e => updateStatus(e.target.value)}
                      >
                        <option>Planning</option>
                        <option>In progress</option>
                        <option>On hold</option>
                        <option>Completed</option>
                      </select>
                    </div>
                  </div>
                  <p className="detail-description">
                    {selectedProject.description ||
                      'Add a project description when you create or update this project.'}
                  </p>
                  <div className="detail-actions">
                    <button className="primary-button" onClick={() => openProject(selectedProject.id)}><FolderKanban size={16} /> Open project workspace</button>
                    <button
                      className="secondary-button"
                      onClick={() => openSection('Hydraulic design')}
                    >
                      <Waves size={16} /> Hydraulic design
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => openSection('BOQ')}
                    >
                      <ClipboardList size={16} /> Bill of quantities
                    </button>
                    <button
                      className="secondary-button"
                      onClick={() => openSection('Reports')}
                    >
                      <FileText size={16} /> Reports
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {section === 'Project workspace' && (
            <div className="module-layout">
              <div className="page-intro">
                <div><span className="eyebrow muted">ACTIVE ENGINEERING PROJECT</span><h1>{activeProject?.title || 'Project workspace'}</h1><p>All tools below are connected to this project's own saved documents and calculations.</p></div>
              </div>
              {activeProject ? <>
                <div className="active-project-strip"><span><FolderKanban size={17} /> {activeProject.title} · {activeProject.location || 'Location not set'}</span><span className="status-pill">{activeProject.status}</span></div>
                <div className="tools-grid project-launch-grid">
                  <ToolCard icon={<MapPinned size={21} />} title="Saved GIS draft" text={gisDoc ? 'Open and continue editing this project’s saved geographic network.' : 'Open GIS to create and save this project’s first network draft.'} status={gisDoc ? 'Saved version ' + gisDoc.version : 'GIS draft needed'} onClick={() => openSection('GIS workspace')} />
                  <ToolCard icon={<Waves size={21} />} title="Linked EPANET network editor" text="Open the saved GIS network in EPANET, edit hydraulic components, simulate and synchronize changes back to GIS." status={hydraulicDoc ? 'Hydraulic model saved' : gisDoc ? 'Ready to import GIS' : 'Save GIS draft first'} onClick={openLinkedEpanet} />
                  <ToolCard icon={<Box size={21} />} title="CAD & 3D engineering workspace" text="Draft 2D engineering drawings, exchange DXF files, bring in GIS geometry and inspect a conceptual 3D model." status={drawingDoc ? 'Saved version ' + drawingDoc.version : 'New drawing'} onClick={() => openSection('CAD & 3D workspace')} />
                  <ToolCard icon={<Gauge size={21} />} title="Hydraulic design calculator" text="Calculate preliminary pipe velocity, headloss and hydraulic gradient." status="Available" onClick={() => openSection('Hydraulic design')} />
                  <ToolCard icon={<Calculator size={21} />} title="Demand & tank calculators" text="Estimate project water demand and preliminary storage capacity." status="Available" onClick={() => openSection('Engineering tools')} />
                  <ToolCard icon={<ClipboardList size={21} />} title="Bill of quantities" text="Prepare and save project quantities and cost schedules." status="Available" onClick={() => openSection('BOQ')} />
                  <ToolCard icon={<FileText size={21} />} title="Reports" text="Keep design basis, assumptions, calculations and recommendations." status="Available" onClick={() => openSection('Reports')} />
                </div>
              </> : <ChooseProject projects={projects} onChoose={openProject} />}
            </div>
          )}

          {section === 'Hydraulic design' && (
            <div className="module-layout">
              <div className="page-intro">
                <div>
                  <span className="eyebrow muted">
                    PRELIMINARY HYDRAULIC DESIGN
                  </span>
                  <h1>Hydraulic design</h1>
                  <p>
                    Calculate pipe velocity, Hazen–Williams headloss and
                    hydraulic gradient.
                  </p>
                </div>
              </div>
              {!activeProject ? (
                <ChooseProject projects={projects} onChoose={openProject} />
              ) : (
                <>
                  <div className="active-project-strip">
                    <span>
                      <Waves size={17} /> {activeProject.title}
                    </span>
                    <span className="status-pill">{activeProject.status}</span>
                  </div>
                  <div className="engineering-grid">
                    <div className="panel calculator-panel">
                      <div className="panel-heading">
                        <div>
                          <span className="eyebrow muted">PIPE HYDRAULICS</span>
                          <h2>Hazen–Williams calculation</h2>
                        </div>
                        <span className="formula-tag">SI units</span>
                      </div>
                      <div className="field-grid">
                        <Field
                          label="Design flow"
                          unit="L/s"
                          value={flow}
                          onChange={setFlow}
                        />
                        <Field
                          label="Internal diameter"
                          unit="mm"
                          value={diameter}
                          onChange={setDiameter}
                        />
                        <Field
                          label="Pipe length"
                          unit="m"
                          value={length}
                          onChange={setLength}
                        />
                        <Field
                          label="Hazen–Williams C"
                          unit="—"
                          value={hwC}
                          onChange={setHwC}
                        />
                      </div>
                      <div className="formula-note">
                        Headloss: h = 10.67 L Q<sup>1.852</sup> / (C
                        <sup>1.852</sup> D<sup>4.871</sup>)
                      </div>
                      <button
                        className="primary-button"
                        onClick={() =>
                          saveDocument('hydraulic', {
                            flow,
                            diameter,
                            length,
                            hwC,
                            velocity,
                            headloss,
                            gradient,
                            method: 'Hazen-Williams',
                          })
                        }
                      >
                        <Save size={16} /> Save calculation to project
                      </button>
                      <p className="save-meta">
                        {hydraulicDoc
                          ? 'Saved version ' + hydraulicDoc.version
                          : 'Not yet saved to this project'}
                      </p>
                    </div>
                    <div className="results-panel">
                      <span className="eyebrow">CALCULATED RESULTS</span>
                      <div className="result-main">
                        <span>Flow velocity</span>
                        <strong>
                          {Number.isFinite(velocity)
                            ? velocity.toFixed(3)
                            : '—'}{' '}
                          <small>m/s</small>
                        </strong>
                      </div>
                      <div className="result-row">
                        <span>Headloss</span>
                        <strong>
                          {Number.isFinite(headloss)
                            ? headloss.toFixed(3)
                            : '—'}{' '}
                          m
                        </strong>
                      </div>
                      <div className="result-row">
                        <span>Hydraulic gradient</span>
                        <strong>
                          {Number.isFinite(gradient)
                            ? gradient.toFixed(3)
                            : '—'}{' '}
                          m/km
                        </strong>
                      </div>
                      <div className="result-row">
                        <span>Pressure loss equivalent</span>
                        <strong>{(headloss * 0.0980665).toFixed(3)} bar</strong>
                      </div>
                      <div className="result-foot">
                        <CircleHelp size={15} /> Preliminary single-pipe
                        calculation. Confirm design criteria, fittings, minor
                        losses, pressure class and transient conditions
                        separately.
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {section === 'CAD & 3D workspace' && (
            <div className="module-layout">
              <div className="page-intro"><div><span className="eyebrow muted">COMPUTER-AIDED DESIGN</span><h1>CAD & 3D workspace</h1><p>Project-centred 2D drafting, DXF exchange and interactive 3D geometry inspection.</p></div></div>
              {!activeProject ? <ChooseProject projects={projects} onChoose={openProject} /> : <>
                <div className="active-project-strip"><span><Box size={17} /> {activeProject.title}</span><span className="status-pill">{drawingDoc ? 'Saved version ' + drawingDoc.version : 'Unsaved drawing'}</span></div>
                <Cad3DEnginePanel projectId={activeProject.id} initialData={drawingDoc?.data} gisFeatures={gisDoc?.data?.featureCollection?.features ?? []} onSave={data => saveDocument('drawing', data)} />
              </>}
            </div>
          )}

          {section === 'GIS workspace' && (
            <div className="module-layout">
              <div className="page-intro">
                <div>
                  <span className="eyebrow muted">GEOSPATIAL ENGINEERING</span>
                  <h1>GIS workspace</h1>
                  <p>Map water sources, reservoirs, tanks, junctions and pipeline routes. Measure geometries and exchange GeoJSON project data.</p>
                </div>
              </div>
              {!activeProject ? (
                <ChooseProject projects={projects} onChoose={openProject} />
              ) : (
                <>
                  <div className="active-project-strip">
                    <span><MapPinned size={17} /> {activeProject.title}</span>
                    <span className="status-pill">{gisDoc ? 'Saved version ' + gisDoc.version : 'GIS draft'}</span>
                  </div>
                  <GisEnginePanel projectId={activeProject.id} projectTitle={activeProject.title} initialData={gisDoc?.data} hydraulicNetwork={hydraulicDoc?.data?.network} hydraulicSimulation={hydraulicDoc?.data?.simulation} onSave={data => saveDocument('gis', data)} onSendToEpanet={openLinkedEpanet} />
                </>
              )}
              <div className="notice-panel">
                <ShieldCheck size={19} />
                <div>
                  <strong>GIS processing scope</strong>
                  <p>Interactive mapping, editable feature layers, GeoJSON exchange and geometry measurements run in this workspace. Full QGIS/PyQGIS Processing for DEM terrain analysis, watershed delineation and advanced raster processing still requires a connected QGIS processing runtime; those capabilities are not represented as active here.</p>
                </div>
              </div>
            </div>
          )}

          {section === 'BOQ' && (
            <div className="module-layout">
              <div className="page-intro">
                <div>
                  <span className="eyebrow muted">AUTOMATIC QUANTITIES · COST PLANNING</span>
                  <h1>Bill of quantities</h1>
                  <p>Generate pipeline quantities and topology-based fitting schedules from this project's saved engineering design, then apply verified KES rates.</p>
                </div>
              </div>
              {!activeProject ? (
                <ChooseProject projects={projects} onChoose={openProject} />
              ) : (
                <>
                  <div className="active-project-strip">
                    <span><ClipboardList size={17} /> {activeProject.title}</span>
                    <span className="status-pill">{boqDoc ? 'Saved version ' + boqDoc.version : 'Draft BOQ'}</span>
                  </div>
                  <BoqEnginePanel
                    projectTitle={activeProject.title}
                    initialData={boqDoc?.data}
                    hydraulicNetwork={hydraulicDoc?.data?.network}
                    gisFeatures={gisDoc?.data?.featureCollection?.features ?? []}
                    onSave={data => saveDocument('boq', data)}
                  />
                </>
              )}
            </div>
          )}

          {section === 'Reports' && (
            <div className="module-layout">
              <div className="page-intro">
                <div>
                  <span className="eyebrow muted">
                    ENGINEERING DOCUMENTATION
                  </span>
                  <h1>Project reports</h1>
                  <p>
                    Prepare and save design notes, assumptions, findings and
                    recommendations.
                  </p>
                </div>
              </div>
              {!activeProject ? (
                <ChooseProject projects={projects} onChoose={openProject} />
              ) : (
                <>
                  <div className="active-project-strip">
                    <span>
                      <FileText size={17} /> {activeProject.title}
                    </span>
                    <span className="status-pill">
                      {reportDoc
                        ? 'Saved version ' + reportDoc.version
                        : 'Draft report'}
                    </span>
                  </div>
                  <div className="panel report-panel">
                    <div className="panel-heading">
                      <div>
                        <span className="eyebrow muted">REPORT WORKSPACE</span>
                        <h2>Technical report notes</h2>
                      </div>
                      <button
                        className="secondary-button"
                        onClick={() =>
                          setReportText(
                            text =>
                              text ||
                              'PROJECT: ' +
                                activeProject.title +
                                '\nLOCATION: ' +
                                activeProject.location +
                                '\n\n1. PURPOSE\n\n2. DESIGN BASIS\n\n3. CALCULATIONS\n\n4. FINDINGS\n\n5. RECOMMENDATIONS\n'
                          )
                        }
                      >
                        <Plus size={15} /> Insert structure
                      </button>
                    </div>
                    <textarea
                      className="report-editor"
                      value={reportText}
                      onChange={e => setReportText(e.target.value)}
                      placeholder="Write the project background, design basis, assumptions, calculations, results, risks and recommendations…"
                    />
                    <div className="report-footer">
                      <span>
                        {reportText.length.toLocaleString()} characters
                      </span>
                      <button
                        className="primary-button"
                        onClick={() =>
                          saveDocument('report', { text: reportText })
                        }
                      >
                        <Save size={16} /> Save report notes
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {section === 'Engineering tools' && (
            <div className="module-layout">
              <div className="page-intro">
                <div>
                  <span className="eyebrow muted">DESIGN REFERENCE</span>
                  <h1>Engineering tools</h1>
                  <p>
                    Cloud-ready calculation utilities and specialist engine
                    availability.
                  </p>
                </div>
              </div>
              {!activeProject ? <ChooseProject projects={projects} onChoose={openProject} /> : <>
              <div className="active-project-strip"><span><Calculator size={17} /> {activeProject.title}</span><span className="status-pill">Project calculations</span></div>
              <ProjectCalculators initialData={calculationDoc?.data} onSave={data => saveDocument('calculations', data)} />
              <EpanetEnginePanel
                projectTitle={activeProject.title}
                initialData={hydraulicDoc?.data?.network ? { ...hydraulicDoc.data.network, simulation: hydraulicDoc.data.simulation ?? null } : undefined}
                gisFeatures={pendingGisFeatures ?? gisDoc?.data?.featureCollection?.features ?? []}
                gisImportToken={gisImportToken}
                onSave={data => saveDocument('hydraulic', data)}
              />
              </>}
              <div className="tools-grid">
                <ToolCard
                  icon={<Ruler size={21} />}
                  title="Pipe velocity"
                  text="Convert flow and internal diameter into average pipe velocity."
                  status="Available"
                />
                <ToolCard
                  icon={<Gauge size={21} />}
                  title="Hazen–Williams"
                  text="Estimate friction headloss and hydraulic gradient for a single pipe."
                  status="Available"
                />
                <ToolCard
                  icon={<MapPinned size={21} />}
                  title="GIS / spatial analysis"
                  text="QGIS processing, PostGIS layers, reprojection and spatial exports."
                  status="Engine not connected"
                />
                <ToolCard
                  icon={<Box size={21} />}
                  title="CAD / 3D coordination"
                  text="DXF and DWG conversion, OBJ export and 3D clash checking."
                  status="Engine not connected"
                />
                <ToolCard
                  icon={<Activity size={21} />}
                  title="EPANET network simulation"
                  text="Draw a water network from scratch, edit components, run OWA-EPANET and review pressure/velocity diagnostics."
                  status="Available"
                />
                <ToolCard
                  icon={<Cloud size={21} />}
                  title="Project document store"
                  text="Private project calculations, BOQ and report notes stored in your cloud workspace."
                  status="Available"
                />
              </div>
              <div className="notice-panel">
                <ShieldCheck size={19} />
                <div>
                  <strong>Engineering integrity</strong>
                  <p>
                    EPANET simulations run with the OWA-EPANET engine. Full QGIS/PyQGIS and the original Python CAD services are not hosted in this AppDeploy runtime yet. Do not use preliminary calculations or unreviewed simulation output as an issued-for-construction design.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {mobileNav && (
        <button
          className="mobile-scrim"
          onClick={() => setMobileNav(false)}
          aria-label="Close navigation"
        />
      )}
      {showCreate && (
        <div className="modal-backdrop" onClick={() => setShowCreate(false)}>
          <form
            className="modal-card"
            onSubmit={createProject}
            onClick={e => e.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow muted">NEW WORKSPACE</span>
                <h2>Create a project</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setShowCreate(false)}
              >
                <X size={18} />
              </button>
            </div>
            <label>Project name *</label>
            <input
              autoFocus
              value={newProject.title}
              onChange={e =>
                setNewProject({ ...newProject, title: e.target.value })
              }
              placeholder="e.g. Voi Water Supply Phase 1"
            />
            <label>Location</label>
            <input
              value={newProject.location}
              onChange={e =>
                setNewProject({ ...newProject, location: e.target.value })
              }
              placeholder="Town, county, country"
            />
            <label>Project type</label>
            <select
              value={newProject.projectType}
              onChange={e =>
                setNewProject({ ...newProject, projectType: e.target.value })
              }
            >
              <option>Water supply</option>
              <option>Pipeline design</option>
              <option>Borehole development</option>
              <option>Dam / water storage</option>
              <option>Wastewater</option>
              <option>Irrigation</option>
              <option>Other engineering</option>
            </select>
            <label>Client / organisation</label>
            <input
              value={newProject.client}
              onChange={e =>
                setNewProject({ ...newProject, client: e.target.value })
              }
              placeholder="Optional"
            />
            <label>Project description</label>
            <textarea
              value={newProject.description}
              onChange={e =>
                setNewProject({ ...newProject, description: e.target.value })
              }
              placeholder="Scope, objectives or design notes"
              rows={3}
            />
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setShowCreate(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="primary-button"
                disabled={loading}
              >
                <Plus size={16} /> Create project
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function ProjectCards({
  projects,
  onOpen,
  onCreate,
  selectedId,
}: {
  projects: Project[];
  onOpen: (id: string) => void;
  onCreate: () => void;
  selectedId?: string;
}) {
  if (!projects.length)
    return (
      <div className="empty-state">
        <div className="empty-icon">
          <FolderKanban size={25} />
        </div>
        <h3>No projects in your workspace yet</h3>
        <p>
          Create your first project to start organising the engineering work.
        </p>
        <button className="primary-button" onClick={onCreate}>
          <Plus size={16} /> Create first project
        </button>
      </div>
    );
  return (
    <div className="project-grid">
      {projects.map((project, index) => (
        <button
          key={project.id}
          className={
            'project-card ' + (selectedId === project.id ? 'selected' : '')
          }
          onClick={() => onOpen(project.id)}
        >
          <div className="project-card-top">
            <span className="project-type">{project.projectType}</span>
            <span
              className={
                'status-dot status-' +
                project.status.toLowerCase().replaceAll(' ', '-')
              }
            />
          </div>
          <h3>{project.title}</h3>
          <p>{project.location || 'Location not specified'}</p>
          <div className="project-card-foot">
            <span>{project.client || 'Independent project'}</span>
            <span>{new Date(project.updatedAt).toLocaleDateString()}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

function CapabilityLine({ label, status }: { label: string; status: string }) {
  return (
    <div className="capability-line">
      <span>{label}</span>
      <span className={status === 'Available' ? 'cap-yes' : 'cap-no'}>
        {status}
      </span>
    </div>
  );
}
function Field({
  label,
  unit,
  value,
  onChange,
}: {
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="engineering-field">
      <span>{label}</span>
      <div>
        <input
          type="number"
          min="0"
          value={value}
          onChange={e => onChange(e.target.value)}
        />
        <small>{unit}</small>
      </div>
    </label>
  );
}
function ChooseProject({
  projects,
  onChoose,
}: {
  projects: Project[];
  onChoose: (id: string) => void;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <FolderKanban size={25} />
      </div>
      <h3>Choose a project first</h3>
      <p>Engineering calculations and documents are saved against a project.</p>
      {projects.length ? (
        <select
          className="choose-select"
          defaultValue=""
          onChange={e => onChoose(e.target.value)}
        >
          <option value="" disabled>
            Select a project
          </option>
          {projects.map(p => (
            <option value={p.id} key={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      ) : (
        <span>Create a project to continue.</span>
      )}
    </div>
  );
}
function ToolCard({
  icon,
  title,
  text,
  status,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  status: string;
  onClick?: () => void;
}) {
  return (
    <div className="tool-card" role={onClick ? 'button' : undefined} onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      <div className="tool-icon">{icon}</div>
      <div className="tool-copy">
        <h3>{title}</h3>
        <p>{text}</p>
        <span
          className={
            status === 'Available'
              ? 'tool-status available'
              : 'tool-status pending'
          }
        >
          {status}
        </span>
      </div>
    </div>
  );
}


function ProjectCalculators({
  initialData,
  onSave,
}: {
  initialData?: any;
  onSave: (data: unknown) => Promise<void>;
}) {
  const [population, setPopulation] = useState('25000');
  const [perCapita, setPerCapita] = useState('100');
  const [nonDomestic, setNonDomestic] = useState('20');
  const [losses, setLosses] = useState('20');
  const [peakDay, setPeakDay] = useState('1.5');
  const [storageHours, setStorageHours] = useState('12');
  const [fireReserve, setFireReserve] = useState('0');
  const [emergencyReserve, setEmergencyReserve] = useState('0');
  const [tankDiameter, setTankDiameter] = useState('12');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!initialData) return;
    const d = initialData.demand || {};
    const t = initialData.tank || {};
    if (d.population !== undefined) setPopulation(String(d.population));
    if (d.perCapita !== undefined) setPerCapita(String(d.perCapita));
    if (d.nonDomestic !== undefined) setNonDomestic(String(d.nonDomestic));
    if (d.losses !== undefined) setLosses(String(d.losses));
    if (d.peakDay !== undefined) setPeakDay(String(d.peakDay));
    if (t.storageHours !== undefined) setStorageHours(String(t.storageHours));
    if (t.fireReserve !== undefined) setFireReserve(String(t.fireReserve));
    if (t.emergencyReserve !== undefined) setEmergencyReserve(String(t.emergencyReserve));
    if (t.diameter !== undefined) setTankDiameter(String(t.diameter));
  }, [initialData]);

  const pop = Math.max(0, Number(population) || 0);
  const pc = Math.max(0, Number(perCapita) || 0);
  const nd = Math.max(0, Number(nonDomestic) || 0) / 100;
  const loss = Math.min(99.9, Math.max(0, Number(losses) || 0)) / 100;
  const peak = Math.max(0, Number(peakDay) || 0);
  const netDaily = pop * pc * (1 + nd);
  const grossDaily = loss < 1 ? netDaily / (1 - loss) : 0;
  const averageLps = grossDaily / 86400;
  const peakDayM3 = grossDaily * peak / 1000;
  const hours = Math.max(0, Number(storageHours) || 0);
  const fire = Math.max(0, Number(fireReserve) || 0);
  const emergency = Math.max(0, Number(emergencyReserve) || 0);
  const balanceStorage = grossDaily / 1000 * hours / 24;
  const requiredTank = balanceStorage + fire + emergency;
  const diameter = Math.max(0, Number(tankDiameter) || 0);
  const waterDepth = diameter > 0 ? requiredTank / (Math.PI * diameter * diameter / 4) : 0;

  const snapshot = {
    demand: { population: pop, perCapita: pc, nonDomestic: nd * 100, losses: loss * 100, peakDay, netDailyLpd: netDaily, grossDailyLpd: grossDaily, averageLps, peakDayM3 },
    tank: { storageHours: hours, fireReserve: fire, emergencyReserve: emergency, diameter, balancingStorageM3: balanceStorage, requiredCapacityM3: requiredTank, indicativeWaterDepthM: waterDepth },
  };

  async function save() {
    setSaving(true);
    try {
      await onSave(snapshot);
    } finally {
      setSaving(false);
    }
  }

  const inputStyle: React.CSSProperties = { width: '100%', padding: 10, border: '1px solid #d7e2df', borderRadius: 8, background: '#fff', color: '#193b43' };
  const field = (label: string, value: string, setter: (v: string) => void, unit: string) => (
    <label className="engineering-field" key={label}>
      <span>{label} <small>{unit}</small></span>
      <input type="number" min="0" step="any" style={inputStyle} value={value} onChange={e => setter(e.target.value)} />
    </label>
  );

  return (
    <div className="engineering-grid project-calculator-grid">
      <div className="panel calculator-panel">
        <div className="panel-heading"><div><span className="eyebrow muted">WATER DEMAND</span><h2>Demand calculator</h2></div><span className="formula-tag">SI units</span></div>
        <div className="field-grid">
          {field('Design population', population, setPopulation, 'persons')}
          {field('Per-capita demand', perCapita, setPerCapita, 'L/person/day')}
          {field('Non-domestic allowance', nonDomestic, setNonDomestic, '%')}
          {field('Distribution losses / NRW', losses, setLosses, '%')}
          {field('Peak-day factor', peakDay, setPeakDay, 'factor')}
        </div>
        <div className="result-row"><span>Net average demand</span><strong>{(netDaily / 1000).toFixed(2)} m³/day</strong></div>
        <div className="result-row"><span>Gross production demand</span><strong>{(grossDaily / 1000).toFixed(2)} m³/day</strong></div>
        <div className="result-row"><span>Average design flow</span><strong>{averageLps.toFixed(3)} L/s</strong></div>
        <div className="result-row"><span>Peak-day volume</span><strong>{peakDayM3.toFixed(2)} m³/day</strong></div>
        <p className="result-foot">Preliminary demand estimate. Confirm applicable Kenyan design criteria, institutional and industrial schedules, fire demand, growth horizon and source operating hours.</p>
        <button className="primary-button" onClick={save} disabled={saving}><Save size={16} /> Save demand calculation to project</button>
      </div>
      <div className="panel calculator-panel">
        <div className="panel-heading"><div><span className="eyebrow muted">STORAGE DESIGN</span><h2>Tank sizing calculator</h2></div><span className="formula-tag">m³</span></div>
        <div className="field-grid">
          {field('Gross daily demand', (grossDaily / 1000).toFixed(2), () => {}, 'm³/day · from demand calculator')}
          {field('Balancing storage period', storageHours, setStorageHours, 'hours')}
          {field('Fire reserve', fireReserve, setFireReserve, 'm³')}
          {field('Emergency reserve', emergencyReserve, setEmergencyReserve, 'm³')}
          {field('Proposed internal diameter', tankDiameter, setTankDiameter, 'm')}
        </div>
        <div className="result-row"><span>Balancing storage</span><strong>{balanceStorage.toFixed(2)} m³</strong></div>
        <div className="result-row"><span>Required nominal capacity</span><strong>{requiredTank.toFixed(2)} m³</strong></div>
        <div className="result-row"><span>Indicative cylindrical water depth</span><strong>{diameter > 0 ? waterDepth.toFixed(2) + ' m' : 'Enter diameter'}</strong></div>
        <p className="result-foot">Preliminary volume check only. Confirm operating levels, dead storage, freeboard, tank configuration, structural design, inlet/outlet arrangement and fire authority requirements.</p>
        <button className="primary-button" onClick={save} disabled={saving}><Save size={16} /> Save tank sizing to project</button>
      </div>
    </div>
  );
}

export default App;
