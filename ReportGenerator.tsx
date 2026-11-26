import { useEffect, useMemo, useState } from 'react';
import { Printer, Save } from 'lucide-react';

type Props = {
  project: any;
  hydraulic?: any;
  gis?: any;
  gisDrafts?: any[];
  boq?: any;
  calculations?: any;
  drawing?: any;
  savedReport?: any;
  onSave: (data: unknown) => Promise<void>;
};
const num = (value: any) => value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const fmt = (value: any, digits = 2) => {
  const n = num(value);
  return n === null ? 'Not recorded' : n.toLocaleString('en-KE', { maximumFractionDigits: digits });
};
const text = (value: any, fallback = 'Not recorded') => value === undefined || value === null || String(value).trim() === '' ? fallback : String(value);
const rows = (value: any) => Array.isArray(value) ? value : [];
const money = (value: any) => {
  const n = num(value);
  return n === null ? 'Not priced' : new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 2 }).format(n);
};
const sectionTitle = (title: string) => <h2 className="generated-report-section-title">{title}</h2>;

export default function ReportGenerator({ project, hydraulic, gis, gisDrafts = [], boq, calculations, drawing, savedReport, onSave }: Props) {
  const [notes, setNotes] = useState(String(savedReport?.text || ''));
  const [saving, setSaving] = useState(false);
  useEffect(() => { setNotes(String(savedReport?.text || '')); }, [project?.id, savedReport?.text]);
  const network = hydraulic?.network ?? hydraulic ?? {};
  const simulation = hydraulic?.simulation ?? hydraulic?.results ?? network?.simulation ?? null;
  const nodes = rows(network?.nodes);
  const links = rows(network?.links);
  const junctions = nodes.filter((n: any) => n.kind === 'J');
  const reservoirs = nodes.filter((n: any) => n.kind === 'R');
  const tanks = nodes.filter((n: any) => n.kind === 'T');
  const pipes = links.filter((l: any) => l.kind === 'pipe');
  const pumps = links.filter((l: any) => l.kind === 'pump');
  const valves = links.filter((l: any) => l.kind === 'valve');
  const totalPipeLength = pipes.reduce((sum: number, p: any) => sum + (num(p.length) || 0), 0);
  const totalDemand = junctions.reduce((sum: number, n: any) => sum + (num(n.demand) || 0), 0);
  const resultNodes = rows(simulation?.nodes);
  const resultLinks = rows(simulation?.links);
  const pressureChecks = resultNodes.map((n: any) => {
    const value = num(n.pressure), min = num(n.minPressure) ?? num(network?.settings?.minPressure), max = num(n.maxPressure) ?? num(network?.settings?.maxPressure);
    return value === null || min === null || max === null ? 'unassessed' : value >= min && value <= max ? 'pass' : 'fail';
  });
  const pressurePass = pressureChecks.filter((x: string) => x === 'pass').length;
  const pressureFail = pressureChecks.filter((x: string) => x === 'fail').length;
  const pressureUnassessed = pressureChecks.filter((x: string) => x === 'unassessed').length;
  const pipeResults = resultLinks.filter((l: any) => l.kind === 'pipe');
  const velocityChecks = pipeResults.map((l: any) => {
    const value = num(l.velocity), min = num(l.minVelocity) ?? num(network?.settings?.minVelocity), max = num(l.maxVelocity) ?? num(network?.settings?.maxVelocity);
    return value === null || min === null || max === null ? 'unassessed' : value >= min && value <= max ? 'pass' : 'fail';
  });
  const velocityPass = velocityChecks.filter((x: string) => x === 'pass').length;
  const velocityFail = velocityChecks.filter((x: string) => x === 'fail').length;
  const velocityUnassessed = velocityChecks.filter((x: string) => x === 'unassessed').length;
  const gisFeatures = rows(gis?.featureCollection?.features ?? gis?.features);
  const savedGisDrafts = rows(gisDrafts);
  const boqItems = rows(boq?.items ?? boq?.lines);
  const boqTotal = boqItems.reduce((sum: number, item: any) => sum + (num(item.quantity ?? item.qty) || 0) * (num(item.rate) || 0), 0);
  const pricedCount = boqItems.filter((item: any) => num(item.rate) !== null).length;
  const geometryCounts = gisFeatures.reduce((acc: Record<string, number>, feature: any) => {
    const kind = String(feature?.geometry?.type || 'Unspecified');
    acc[kind] = (acc[kind] || 0) + 1;
    return acc;
  }, {});
  const warnings = rows(simulation?.suggestions);
  const simulationReport = text(simulation?.report, '');
  const hasSimulation = Boolean(simulation && (resultNodes.length || resultLinks.length));
  const generatedAt = useMemo(() => new Date().toLocaleString('en-KE', { dateStyle: 'long', timeStyle: 'short' }), []);
  const completeness = [
    ['Project information', Boolean(project?.title)],
    ['Hydraulic network', nodes.length > 0 || links.length > 0],
    ['Hydraulic simulation', hasSimulation],
    ['GIS features', gisFeatures.length > 0],
    ['BOQ', boqItems.length > 0],
    ['Engineering calculations', Boolean(calculations && Object.keys(calculations).length)],
  ];
  const readyCount = completeness.filter((x: any) => x[1]).length;

  async function saveReport() {
    setSaving(true);
    try {
      await onSave({ text: notes, generatedAt: new Date().toISOString(), reportType: 'project-engineering-report', version: 1 });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="generated-report-workspace">
      <div className="report-actions">
        <div>
          <span className="eyebrow muted">PROJECT DOCUMENT GENERATOR</span>
          <h2>Professional engineering report</h2>
          <p>Built from the currently opened project's saved documents and engineering results.</p>
        </div>
        <div className="report-action-buttons">
          <button className="secondary-button" onClick={saveReport} disabled={saving}><Save size={15} /> {saving ? 'Saving…' : 'Save report notes'}</button>
          <button className="primary-button" onClick={() => window.print()}><Printer size={15} /> Print / Save PDF</button>
        </div>
      </div>

      <div className="report-completeness">
        <strong>Source data coverage: {readyCount}/{completeness.length} sections populated</strong>
        <div className="report-coverage-list">
          {completeness.map(([label, present]: any) => <span key={label} className={present ? 'coverage-present' : 'coverage-missing'}>{present ? '✓' : '○'} {label}</span>)}
        </div>
        <small>Missing sections are clearly identified in the report. No missing engineering values are fabricated.</small>
      </div>

      <article className="generated-report" id="project-engineering-report">
        <header className="generated-report-cover">
          <div className="report-brand">RAYANAQUA <span>TECH CONSULTANCY</span></div>
          <div className="report-document-label">ENGINEERING DESIGN REPORT</div>
          <h1>{text(project?.title, 'Untitled project')}</h1>
          <p>{text(project?.projectType, 'Engineering project')} · {text(project?.location, 'Location not specified')}</p>
          <div className="report-cover-meta">
            <span><b>Client</b>{text(project?.client)}</span>
            <span><b>Project status</b>{text(project?.status)}</span>
            <span><b>Report date</b>{generatedAt}</span>
          </div>
          <div className="report-confidential">PROJECT-SPECIFIC TECHNICAL DOCUMENT · CONTROLLED COPY</div>
        </header>

        {sectionTitle('Document control and project particulars')}
        <table className="generated-report-table"><tbody>
          <tr><th>Project title</th><td>{text(project?.title)}</td><th>Project reference</th><td>{text(project?.id)}</td></tr>
          <tr><th>Client</th><td>{text(project?.client)}</td><th>Location</th><td>{text(project?.location)}</td></tr>
          <tr><th>Project type</th><td>{text(project?.projectType)}</td><th>Status</th><td>{text(project?.status)}</td></tr>
          <tr><th>Project description</th><td colSpan={3}>{text(project?.description)}</td></tr>
        </tbody></table>

        {sectionTitle('1. Executive summary')}
        <p>This report summarises the information currently saved against <b>{text(project?.title)}</b>. It consolidates project particulars, available hydraulic network data, simulation outputs, GIS features, BOQ entries and engineering calculation records. The report reflects the selected project's saved records at the time of generation.</p>
        <div className="report-kpi-grid">
          <div><b>{nodes.length}</b><span>Network nodes</span></div>
          <div><b>{links.length}</b><span>Network links</span></div>
          <div><b>{fmt(totalPipeLength / 1000, 3)} km</b><span>Modelled pipe length</span></div>
          <div><b>{fmt(totalDemand, 3)} L/s</b><span>Entered junction demand</span></div>
        </div>

        {sectionTitle('2. Project scope and description')}
        <p>{text(project?.description, 'No project scope or description has been entered.')}</p>

        {sectionTitle('3. Design basis and model configuration')}
        <table className="generated-report-table"><tbody>
          <tr><th>Hydraulic headloss method</th><td>{text(network?.settings?.headloss)}</td><th>Simulation duration</th><td>{num(network?.settings?.duration) === null ? 'Not recorded' : fmt(network.settings.duration, 2) + ' hours'}</td></tr>
          <tr><th>Hydraulic time step</th><td>{num(network?.settings?.step) === null ? 'Not recorded' : fmt(network.settings.step, 2) + ' hours'}</td><th>Pressure limits</th><td>{network?.settings ? fmt(network.settings.minPressure) + ' – ' + fmt(network.settings.maxPressure) + ' m' : 'Not recorded'}</td></tr>
          <tr><th>Velocity limits</th><td>{network?.settings ? fmt(network.settings.minVelocity) + ' – ' + fmt(network.settings.maxVelocity) + ' m/s' : 'Not recorded'}</td><th>Water quality mode</th><td>{text(network?.settings?.qualityMode, 'Not configured')}</td></tr>
        </tbody></table>
        <p className="report-note"><b>Design-basis qualification:</b> Values above are taken from the saved model configuration. Unrecorded assumptions, criteria, standards and approvals must be confirmed by the responsible engineer.</p>

        {sectionTitle('4. Hydraulic network inventory')}
        <table className="generated-report-table"><thead><tr><th>Component</th><th>Count</th><th>Recorded parameters</th></tr></thead><tbody>
          <tr><td>Junctions</td><td>{junctions.length}</td><td>Elevation and entered demand, where saved</td></tr>
          <tr><td>Reservoirs</td><td>{reservoirs.length}</td><td>Reservoir head, where saved</td></tr>
          <tr><td>Tanks</td><td>{tanks.length}</td><td>Levels, diameter and volume settings, where saved</td></tr>
          <tr><td>Pipes</td><td>{pipes.length}</td><td>{fmt(totalPipeLength, 1)} m combined modelled length</td></tr>
          <tr><td>Pumps</td><td>{pumps.length}</td><td>Pump power or curve data, where saved</td></tr>
          <tr><td>Valves</td><td>{valves.length}</td><td>Valve type and setting, where saved</td></tr>
        </tbody></table>
        {pipes.length > 0 && <table className="generated-report-table"><thead><tr><th>Pipe ID</th><th>From → To</th><th>Length (m)</th><th>Diameter (mm)</th><th>Material</th><th>Status</th></tr></thead><tbody>
          {pipes.map((pipe: any, i: number) => <tr key={pipe.id || i}><td>{text(pipe.id)}</td><td>{text(pipe.from)} → {text(pipe.to)}</td><td>{fmt(pipe.length, 2)}</td><td>{fmt(pipe.diameter, 2)}</td><td>{text(pipe.material || pipe.pipeMaterial)}</td><td>{text(pipe.status)}</td></tr>)}
        </tbody></table>}
        {nodes.length === 0 && links.length === 0 && <p className="report-missing">No saved hydraulic network was found for this project.</p>}

        {sectionTitle('5. Hydraulic simulation and compliance results')}
        {hasSimulation ? <>
          <p>Simulation result timestamp: {text(simulation?.at)} · Reported hydraulic periods: {text(simulation?.periods, 'Not recorded')}.</p>
          <div className="report-kpi-grid">
            <div><b>{resultNodes.length}</b><span>Node results</span></div>
            <div><b>{pressurePass}</b><span>Pressure within configured limits</span></div>
            <div><b>{pipeResults.length}</b><span>Pipe velocity checks</span></div>
            <div><b>{velocityFail}</b><span>Pipe velocity checks outside limits</span></div>
          </div>
          <p><b>Pressure check:</b> {pressurePass} of {resultNodes.length} node results are within recorded pressure limits; {pressureFail} are outside those limits and {pressureUnassessed} cannot be assessed from the saved limits.</p>
          <p><b>Velocity check:</b> {velocityPass} of {pipeResults.length} pipe results are within recorded velocity limits; {velocityFail} are outside those limits and {velocityUnassessed} cannot be assessed from the saved limits. Pumps and valves are excluded from pipe velocity compliance counts.</p>
          {resultLinks.length > 0 && <table className="generated-report-table"><thead><tr><th>Link ID</th><th>Type</th><th>Flow</th><th>Velocity (m/s)</th><th>Headloss</th><th>Assessment</th></tr></thead><tbody>
            {resultLinks.map((link: any, i: number) => <tr key={link.id || i}><td>{text(link.id)}</td><td>{text(link.kind)}</td><td>{fmt(link.flow, 3)}</td><td>{fmt(link.velocity, 3)}</td><td>{fmt(link.headloss, 3)}</td><td>{text(link.status)}</td></tr>)}
          </tbody></table>}
          {rows(simulation?.tankResults).length > 0 && <><h3>Tank operating-level checks</h3><table className="generated-report-table"><thead><tr><th>Tank</th><th>Level (m)</th><th>Allowed range (m)</th><th>Assessment</th></tr></thead><tbody>{simulation.tankResults.map((tank: any) => <tr key={tank.id}><td>{tank.id}</td><td>{fmt(tank.level)}</td><td>{fmt(tank.minAllowed)} – {fmt(tank.maxAllowed)}</td><td>{text(tank.assessment)}</td></tr>)}</tbody></table></>}
          {simulationReport && <div className="report-preformatted">{simulationReport}</div>}
          {warnings.length > 0 && <><h3>Engine-generated suggestions and warnings</h3><ul>{warnings.map((warning: any, i: number) => <li key={i}>{String(warning)}</li>)}</ul></>}
        </> : <p className="report-missing">No saved hydraulic simulation results are available for this project. Run and save the network simulation to populate this section.</p>}

        {sectionTitle('6. GIS and spatial information')}
        {gisFeatures.length > 0 ? <>
          <p>The saved GIS project document contains {gisFeatures.length} mapped feature(s). Geometry inventory: {Object.entries(geometryCounts).map(([key, value]) => key + ': ' + value).join(' · ')}.</p>
          <table className="generated-report-table"><thead><tr><th>Feature</th><th>Category</th><th>Geometry</th><th>Recorded attributes</th></tr></thead><tbody>
            {gisFeatures.map((feature: any, i: number) => <tr key={feature.id || i}><td>{text(feature.properties?.name || feature.name, 'Feature ' + (i + 1))}</td><td>{text(feature.properties?.category || feature.category)}</td><td>{text(feature.geometry?.type || feature.type)}</td><td>{Object.entries(feature.properties || {}).filter(([key]) => !['name','category'].includes(key)).map(([key, value]) => key + ': ' + String(value)).join('; ') || 'No additional attributes'}</td></tr>)}
          </tbody></table>
        </> : <p className="report-missing">No saved GIS feature collection was found in the project's main GIS document. Check the GIS workspace and saved draft list.</p>}

        {savedGisDrafts.length > 0 && <><h3>Saved GIS design drafts</h3><table className="generated-report-table"><thead><tr><th>Draft name</th><th>Version</th><th>Feature count</th><th>Last updated</th></tr></thead><tbody>{savedGisDrafts.map((draft: any, i: number) => { const features = rows(draft?.data?.featureCollection?.features ?? draft?.data?.features); return <tr key={draft.id || i}><td>{text(draft.name, 'GIS draft ' + (i + 1))}</td><td>{text(draft.version)}</td><td>{features.length}</td><td>{text(draft.updatedAt)}</td></tr>; })}</tbody></table></>}
 
        {sectionTitle('7. Bill of quantities and cost summary')}
        {boqItems.length > 0 ? <>
          <table className="generated-report-table"><thead><tr><th>Item / description</th><th>Unit</th><th>Quantity</th><th>Rate (KES)</th><th>Amount (KES)</th></tr></thead><tbody>
            {boqItems.map((item: any, i: number) => { const qty = num(item.quantity ?? item.qty) || 0; const rate = num(item.rate); return <tr key={item.id || i}><td>{text(item.description)}</td><td>{text(item.unit)}</td><td>{fmt(qty, 3)}</td><td>{rate === null ? 'Not priced' : money(rate)}</td><td>{rate === null ? 'Not priced' : money(qty * rate)}</td></tr>; })}
          </tbody></table>
          <p className="report-total">Indicative priced BOQ total: {money(boqTotal)} <small>({pricedCount} of {boqItems.length} items have a recorded rate; unpriced items are excluded.)</small></p>
        </> : <p className="report-missing">No saved BOQ line items are available for this project.</p>}

        {sectionTitle('8. Engineering calculations and design records')}
        {calculations && Object.keys(calculations).length > 0 ? <pre className="report-preformatted">{JSON.stringify(calculations, null, 2)}</pre> : <p className="report-missing">No saved engineering calculation record was found for this project.</p>}
        {drawing && Object.keys(drawing).length > 0 ? <><h3>CAD / drawing record</h3><p>Saved drawing document is present. Drawing geometry and detailed schedules should be reviewed in the CAD workspace.</p></> : <p className="report-missing">No saved CAD / drawing document was found for this project.</p>}

        {sectionTitle('9. Engineer’s notes, findings and recommendations')}
        <p>Enter project-specific narrative, site observations, design assumptions, decisions and recommendations below. These notes are saved against the selected project.</p>
        <div className="report-editor-print-hide"><textarea className="report-editor" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add project background, site observations, design assumptions, recommendations, outstanding actions and review comments…" /></div>
        {notes.trim() ? <div className="report-notes-content">{notes}</div> : <p className="report-missing">No additional engineer's notes have been entered.</p>}

        {sectionTitle('10. Limitations, review and approval')}
        <ul>
          <li>This report is generated from records currently saved to this project; it does not independently validate source data or field measurements.</li>
          <li>Missing, incomplete or unverified data are identified rather than estimated.</li>
          <li>GIS analysis, terrain coverage, coordinate reference systems and survey accuracy must be checked against their source datasets.</li>
          <li>BOQ totals are indicative and depend on the completeness of quantities, rates, specifications, fittings, taxes and provisional sums.</li>
          <li>Hydraulic compliance checks use the limits stored in the project model. The responsible engineer must confirm applicable design standards and project criteria.</li>
        </ul>
        <div className="report-signoff-grid"><div><b>Prepared by</b><span>Engineer: __________________________</span><span>Signature: _________________________</span></div><div><b>Checked / approved by</b><span>Engineer: __________________________</span><span>Signature: _________________________</span></div></div>
        <footer className="generated-report-footer">RayanAqua Tech Consultancy · Project report generated {generatedAt} · Project ID: {text(project?.id)}</footer>
      </article>
    </div>
  );
}
