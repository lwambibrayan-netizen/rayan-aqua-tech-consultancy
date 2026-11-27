import { useEffect, useMemo, useState } from 'react';
import { ClipboardList, Download, Plus, RefreshCw, Save, Trash2 } from 'lucide-react';

type Item = {
  id: string;
  section: string;
  code: string;
  description: string;
  unit: string;
  quantity: number;
  rate: number;
  source: string;
  review?: boolean;
};
type Props = {
  projectTitle: string;
  initialData?: any;
  hydraulicNetwork?: any;
  gisFeatures?: any[];
  onSave: (data: unknown) => Promise<void>;
};
const money = (value: number) => new Intl.NumberFormat('en-KE', {
  style: 'currency', currency: 'KES', maximumFractionDigits: 2,
}).format(Number.isFinite(value) ? value : 0);
const id = () => globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
const safeNumber = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;
const clean = (value: unknown, fallback = 'Not specified') => String(value ?? '').trim() || fallback;

function lineLengthMetres(coordinates: number[][]): number {
  const rad = (value: number) => value * Math.PI / 180;
  let total = 0;
  for (let i = 1; i < coordinates.length; i++) {
    const [lon1, lat1] = coordinates[i - 1];
    const [lon2, lat2] = coordinates[i];
    const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
    total += 6371008.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  return total;
}
function deriveItems(network: any, gisFeatures: any[]): { items: Item[]; notes: string[]; origin: string } {
  const items: Item[] = [];
  const notes: string[] = [];
  const nodes = Array.isArray(network?.nodes) ? network.nodes : [];
  const links = Array.isArray(network?.links) ? network.links : [];
  const pipes = links.filter((link: any) => link.kind === 'pipe');
  const grouped = new Map<string, { quantity: number; diameter: string; material: string; pressureClass: string; count: number }>();
  pipes.forEach((pipe: any) => {
    const diameter = safeNumber(pipe.diameter);
    const material = clean(pipe.material || pipe.pipeMaterial);
    const pressureClass = clean(pipe.pressureClass || pipe.pnClass);
    const key = [diameter || 'unknown', material, pressureClass].join('|');
    const current = grouped.get(key) || { quantity: 0, diameter: diameter ? String(diameter) : 'Not specified', material, pressureClass, count: 0 };
    current.quantity += Math.max(0, safeNumber(pipe.length));
    current.count += 1;
    grouped.set(key, current);
  });
  grouped.forEach(group => items.push({
    id: id(), section: 'Pipelines', code: 'PIPE-' + group.diameter,
    description: group.diameter === 'Not specified'
      ? 'Pipeline · diameter not specified · ' + group.material + ' · ' + group.pressureClass
      : group.diameter + ' mm pipeline · ' + group.material + ' · ' + group.pressureClass,
    unit: 'm', quantity: Number(group.quantity.toFixed(3)), rate: 0,
    source: 'EPANET pipe links (' + group.count + ' link(s)); summed model lengths',
    review: group.material === 'Not specified' || group.pressureClass === 'Not specified' || group.diameter === 'Not specified' || group.quantity <= 0,
  }));
  if (pipes.length) {
    if (pipes.some((pipe: any) => safeNumber(pipe.length) <= 0)) {
      notes.push('One or more EPANET pipe links have zero or missing length. Their pipeline quantities are not suitable for procurement until the model lengths are completed.');
    }
    const adjacency = new Map<string, Array<{ neighbour: any; link: any }>>();
    const nodeById = new Map<string, any>(nodes.map((node: any) => [String(node.id), node] as [string, any]));
    pipes.forEach((pipe: any) => {
      if (!adjacency.has(pipe.from)) adjacency.set(pipe.from, []);
      if (!adjacency.has(pipe.to)) adjacency.set(pipe.to, []);
      adjacency.get(pipe.from)!.push({ neighbour: nodeById.get(pipe.to), link: pipe });
      adjacency.get(pipe.to)!.push({ neighbour: nodeById.get(pipe.from), link: pipe });
    });
    adjacency.forEach((connections, nodeId) => {
      const node = nodeById.get(nodeId);
      const degree = connections.length;
      // Classify branch fittings using both topology and nominal diameters.
      // Unequal diameters at a branch are treated as a reducing fitting, not a tee plus an extra reducer.
      const connectedDiameters = connections
        .map(({ link }) => safeNumber(link.diameter))
        .filter((diameter: number) => diameter > 0);
      const distinctDiameters = Array.from(new Set(connectedDiameters)).sort((a: number, b: number) => a - b);
      const mixedSizes = distinctDiameters.length > 1;
      if (mixedSizes) {
        notes.push(nodeId + ': connected pipes have different nominal diameters (' + distinctDiameters.join(', ') + ' mm); verify fitting type, orientation and reducer arrangement against the detailed design.');
      }
      if (degree === 3) {
        items.push({
          id: id(), section: mixedSizes ? 'Fittings – review' : 'Fittings',
          code: mixedSizes ? 'REDUCING-TEE' : 'TEE',
          description: (mixedSizes ? 'Reducing tee' : 'Equal tee') + ' at network node ' + nodeId + (mixedSizes ? ' · connected sizes ' + distinctDiameters.join(' / ') + ' mm' : ''),
          unit: 'No.', quantity: 1, rate: 0,
          source: 'EPANET pipe topology: 3 incident pipe links' + (mixedSizes ? '; mixed nominal diameters' : ''),
          review: mixedSizes,
        });
      } else if (degree === 4) {
        items.push({ id: id(), section: 'Fittings – review', code: mixedSizes ? 'REDUCING-CROSS' : 'CROSS', description: (mixedSizes ? 'Mixed-diameter four-way fitting' : 'Cross fitting') + ' at network node ' + nodeId, unit: 'No.', quantity: 1, rate: 0, source: 'EPANET pipe topology: 4 incident pipe links', review: true });
        notes.push(nodeId + ': four-way connection detected; confirm whether a cross, reducing cross or combination of tees is specified.');
      } else if (degree === 2 && mixedSizes) {
        items.push({
          id: id(), section: 'Fittings – review', code: 'REDUCER-' + nodeId,
          description: 'Reducer / diameter transition at ' + nodeId + ' · ' + distinctDiameters.join(' to ') + ' mm',
          unit: 'No.', quantity: 1, rate: 0,
          source: 'EPANET pipe connectivity and nominal diameters; confirm concentric/eccentric type and orientation',
          review: true,
        });
      } else if (degree > 4) {
        notes.push(nodeId + ': ' + degree + ' connected pipe links; fitting arrangement is non-standard and requires engineer detailing.');
        items.push({ id: id(), section: 'Fittings – review', code: 'NODE-' + nodeId, description: 'Fitting arrangement at ' + nodeId + ' (' + degree + ' pipe connections) – engineer to detail', unit: 'Set', quantity: 1, rate: 0, source: 'EPANET pipe topology; no fitting type assumed', review: true });
      } else if (degree === 2 && node && Number.isFinite(Number(node.x)) && Number.isFinite(Number(node.y))) {
        const vectors = connections.map(({ neighbour }) => neighbour ? [safeNumber(neighbour.x) - safeNumber(node.x), safeNumber(neighbour.y) - safeNumber(node.y)] : null);
        if (vectors.every((v: any) => v && Math.hypot(v[0], v[1]) > 0)) {
          const [a, b] = vectors as number[][];
          const cosine = Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1]) / (Math.hypot(...a) * Math.hypot(...b))));
          const deflection = Math.round(180 - Math.acos(cosine) * 180 / Math.PI);
          if (deflection >= 15) {
            items.push({ id: id(), section: 'Fittings – review', code: 'BEND-' + deflection, description: 'Possible ' + deflection + '° bend at node ' + nodeId + ' – verify from surveyed route geometry', unit: 'No.', quantity: 1, rate: 0, source: 'Approximate EPANET schematic node coordinates; not a fabrication angle', review: true });
            notes.push(nodeId + ': possible ' + deflection + '° change in direction; confirm bend angle from GIS/survey geometry before procurement.');
          }
        }
      } else if (degree === 1 && node?.kind === 'J') {
        notes.push(nodeId + ': dead-end junction detected; confirm whether an end cap, washout or future extension is required. No fitting has been assumed.');
      }
    });
    links.filter((link: any) => link.kind === 'valve').forEach((valve: any) => {
      const valveType = clean(valve.valveType, 'Valve');
      items.push({ id: id(), section: 'Valves and appurtenances', code: valveType.toUpperCase() + '-' + clean(valve.id, '1'), description: valveType + ' valve · ' + clean(valve.id), unit: 'No.', quantity: 1, rate: 0, source: 'EPANET valve link ' + clean(valve.id) });
    });
    links.filter((link: any) => link.kind === 'pump').forEach((pump: any) => {
      items.push({ id: id(), section: 'Mechanical equipment', code: 'PUMP-' + clean(pump.id), description: 'Pump set · ' + clean(pump.id), unit: 'No.', quantity: 1, rate: 0, source: 'EPANET pump link ' + clean(pump.id), review: true });
    });
    if (!items.some(item => item.section === 'Fittings' || item.section === 'Fittings – review')) notes.push('No tee, cross or bend fittings were derived. Confirm whether the network contains all physical junctions and route deflections.');
    return { items, notes, origin: 'EPANET hydraulic network' };
  }

  const gisLines = (Array.isArray(gisFeatures) ? gisFeatures : []).filter((feature: any) =>
    String(feature?.properties?.category || feature?.category || '').toLowerCase() === 'pipeline' &&
    (feature?.geometry?.type === 'LineString' || feature?.type === 'LineString')
  );
  const gisGroups = new Map<string, { quantity: number; diameter: string; material: string; count: number }>();
  gisLines.forEach((feature: any) => {
    const properties = feature.properties || {};
    const coordinates = feature.geometry?.coordinates || feature.coordinates;
    const length = safeNumber(properties.length_m || properties.length) || (Array.isArray(coordinates) ? lineLengthMetres(coordinates) : 0);
    const diameter = safeNumber(properties.diameter_mm || properties.diameter);
    const material = clean(properties.material);
    const key = [diameter || 'unknown', material].join('|');
    const group = gisGroups.get(key) || { quantity: 0, diameter: diameter ? String(diameter) : 'Not specified', material, count: 0 };
    group.quantity += Math.max(0, length); group.count += 1; gisGroups.set(key, group);
  });
  gisGroups.forEach(group => items.push({
    id: id(), section: 'Pipelines', code: 'GIS-PIPE-' + group.diameter,
    description: (group.diameter === 'Not specified' ? 'Pipeline · diameter not specified' : group.diameter + ' mm pipeline') + ' · ' + group.material,
    unit: 'm', quantity: Number(group.quantity.toFixed(3)), rate: 0,
    source: 'GIS saved LineString geometry (' + group.count + ' feature(s)); geodesic length',
    review: group.diameter === 'Not specified' || group.material === 'Not specified',
  }));
  if (gisLines.length) notes.push('Fittings cannot be reliably inferred from GIS line endpoints alone. Import or save a connected EPANET network to generate a topology-based fitting schedule.');
  return { items, notes, origin: gisLines.length ? 'GIS pipeline geometry (no EPANET network saved)' : 'No saved hydraulic or pipeline geometry' };
}

export default function BoqEnginePanel({ projectTitle, initialData, hydraulicNetwork, gisFeatures = [], onSave }: Props) {
  const [items, setItems] = useState<Item[]>(Array.isArray(initialData?.items) ? initialData.items : []);
  const [notes, setNotes] = useState<string[]>(Array.isArray(initialData?.notes) ? initialData.notes : []);
  const [contingencyPct, setContingencyPct] = useState(safeNumber(initialData?.contingencyPct));
  const [expanded, setExpanded] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (initialData) {
      setItems(Array.isArray(initialData.items) ? initialData.items : []);
      setNotes(Array.isArray(initialData.notes) ? initialData.notes : []);
      setContingencyPct(safeNumber(initialData.contingencyPct));
    }
  }, [initialData]);
  const subtotal = useMemo(() => items.reduce((sum, item) => sum + Math.max(0, safeNumber(item.quantity)) * Math.max(0, safeNumber(item.rate)), 0), [items]);
  const contingency = subtotal * Math.max(0, contingencyPct) / 100;
  const total = subtotal + contingency;

  function generate() {
    const result = deriveItems(hydraulicNetwork, gisFeatures);
    setItems(result.items);
    setNotes(result.notes);
    setMessage('Generated ' + result.items.length + ' quantity line(s) from ' + result.origin + '. Enter verified local rates before treating this as a cost estimate.');
  }
  function addManual() {
    setItems(rows => [...rows, { id: id(), section: 'Manual items', code: 'MANUAL', description: '', unit: 'No.', quantity: 1, rate: 0, source: 'Engineer-entered quantity' }]);
  }
  function update(itemId: string, patch: Partial<Item>) {
    setItems(rows => rows.map(item => item.id === itemId ? { ...item, ...patch } : item));
  }
  function exportCsv() {
    const rows = [
      ['RayanAqua BOQ', projectTitle], ['Section', 'Code', 'Description', 'Unit', 'Quantity', 'Rate KES', 'Amount KES', 'Quantity source', 'Review required'],
      ...items.map(item => [item.section, item.code, item.description, item.unit, String(item.quantity), String(item.rate), String(item.quantity * item.rate), item.source, item.review ? 'YES' : 'NO']),
      [], ['Sub-total', '', '', '', '', '', String(subtotal)], ['Contingency %', '', '', '', '', String(contingencyPct), String(contingency)], ['Total KES', '', '', '', '', '', String(total)],
    ];
    const csv = rows.map(row => row.map(value => '"' + String(value ?? '').replace(/"/g, '""') + '"').join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'rayanaqua-boq.csv'; anchor.click(); URL.revokeObjectURL(url);
  }
  async function save() {
    setBusy(true); setMessage('');
    try {
      await onSave({ version: 2, projectTitle, currency: 'KES', items, notes, subtotal, contingencyPct, contingency, total, generatedFrom: hydraulicNetwork?.links?.length ? 'EPANET' : 'GIS', updatedAt: new Date().toISOString() });
      setMessage('BOQ saved to this project.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'BOQ could not be saved.');
    } finally { setBusy(false); }
  }
  const sections = Array.from(new Set(items.map(item => item.section)));
  const reviewCount = items.filter(item => item.review).length;
  return (
    <section className="module-layout">
      <div className="panel boq-panel">
        <div className="panel-heading">
          <div><span className="eyebrow muted">AUTOMATIC QUANTITIES · COST SCHEDULE</span><h2>Design-linked bill of quantities</h2><p className="muted">Project: {projectTitle}</p></div>
          <button className="secondary-button" onClick={generate}><RefreshCw size={15} /> Generate from design</button>
        </div>
        <div className="tools-grid">
          <div className="metric-card"><small>BOQ subtotal</small><strong>{money(subtotal)}</strong></div>
          <div className="metric-card"><small>Contingency</small><strong>{money(contingency)}</strong></div>
          <div className="metric-card"><small>Estimated total</small><strong>{money(total)}</strong></div>
        </div>
        <div className="field-grid">
          <label>Contingency (%)<input type="number" min="0" max="100" step="0.5" value={contingencyPct} onChange={event => setContingencyPct(Math.max(0, Math.min(100, safeNumber(event.target.value))))} /></label>
        </div>
        {notes.length > 0 && <div className="notice-panel"><ClipboardList size={18} /><div><strong>Engineering review notes</strong><ul>{notes.map((note, index) => <li key={index}>{note}</li>)}</ul></div></div>}
        <div className="panel-heading"><h3>Measured items</h3><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button className="secondary-button" onClick={addManual}><Plus size={15} /> Add manual item</button><button className="secondary-button" onClick={exportCsv} disabled={!items.length}><Download size={15} /> Export CSV</button></div></div>
        {!items.length ? <div className="empty-inline">No quantities yet. Generate from the saved EPANET network or GIS pipeline geometry, or add a manual item.</div> :
          <div className="table-wrap"><table className="boq-table"><thead><tr><th>Section</th><th>Item / description</th><th>Unit</th><th>Quantity</th><th>Rate (KES)</th><th>Amount</th><th>Source / review</th><th /></tr></thead><tbody>
            {items.map(item => <tr key={item.id}>
              <td>{item.section}<div className="muted">{item.code}</div></td>
              <td><input value={item.description} onChange={event => update(item.id, { description: event.target.value })} /></td>
              <td><input value={item.unit} onChange={event => update(item.id, { unit: event.target.value })} /></td>
              <td><input type="number" min="0" step="any" value={item.quantity} onChange={event => update(item.id, { quantity: Math.max(0, safeNumber(event.target.value)) })} /></td>
              <td><input type="number" min="0" step="any" value={item.rate} onChange={event => update(item.id, { rate: Math.max(0, safeNumber(event.target.value)) })} /></td>
              <td className="amount-cell">{money(item.quantity * item.rate)}</td>
              <td className="muted">{item.source}{item.review ? <div className="status-pill">Engineer review</div> : null}</td>
              <td><button className="icon-button" aria-label="Remove BOQ item" onClick={() => setItems(rows => rows.filter(row => row.id !== item.id))}><Trash2 size={15} /></button></td>
            </tr>)}
          </tbody></table></div>}
        <div className="boq-total"><span>Project estimate · KES</span><strong>{money(total)}</strong></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button className="primary-button" onClick={save} disabled={busy}><Save size={16} /> {busy ? 'Saving…' : 'Save BOQ to project'}</button><button className="secondary-button" onClick={() => setExpanded(!expanded)}>{expanded ? 'Hide' : 'Show'} assumptions</button></div>
        {expanded && <p className="muted">Pipe lengths and fitting counts are derived from the saved EPANET network. A three-way pipe node is counted as a tee; a four-way node is flagged for confirmation. Bends are only suggestions from schematic coordinates and must be verified against surveyed route geometry. Unknown pipe material, pressure class or diameter is explicitly flagged. Valve and pump counts come from actual network components. GIS-only line lengths are geodesic estimates; no fittings are invented from unconnected endpoints. Excavation, bedding, backfill, labour, transport and installation are not yet auto-measured; add them as manual items using verified project dimensions. Enter verified supplier/contract rates; all rates default to KES 0.</p>}
      </div>
    </section>
  );
}
