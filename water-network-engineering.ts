import { component3dLength, type WaterCadComponent, type WaterCadDocument, type WaterPoint } from './water-cad';

export type WaterPort = {
  id: string;
  componentId: string;
  index: number;
  point: WaterPoint;
  diameterMm?: number;
  role: 'inlet' | 'outlet' | 'run' | 'branch' | 'node';
};
export type WaterPortConnection = { id: string; aPortId: string; bPortId: string };
export type NetworkDocument = WaterCadDocument & { connections?: WaterPortConnection[] };
export type ProfilePoint = {
  chainageM: number;
  x: number;
  y: number;
  groundLevelM: number | null;
  invertLevelM: number | null;
  crownLevelM: number | null;
  coverDepthM: number | null;
};
export type QuantityLine = {
  code: string;
  description: string;
  unit: 'm' | 'nr' | 'm3';
  quantity: number;
  material?: string;
  nominalDiameterMm?: number;
};
export type EpanetIdMap = { epanetId: string; cadId: string; kind: 'node' | 'link' };
export type EpanetExport = { input: string; warnings: string[]; idMap: EpanetIdMap[] };

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const unit = (v: WaterPoint): WaterPoint => {
  const d = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / d, y: v.y / d };
};
const add = (a: WaterPoint, b: WaterPoint): WaterPoint => ({ x: a.x + b.x, y: a.y + b.y, z: a.z });
const scale = (a: WaterPoint, n: number): WaterPoint => ({ x: a.x * n, y: a.y * n, z: a.z });
const dist = (a: WaterPoint, b: WaterPoint) => Math.hypot(a.x - b.x, a.y - b.y, finite(a.z) && finite(b.z) ? a.z - b.z : 0);
const fmt = (n: number) => Number(n.toFixed(4)).toString();
const fmtTime = (seconds:number) => { const total=Math.max(0,Math.floor(seconds)); return Math.floor(total/3600)+':'+String(Math.floor((total%3600)/60)).padStart(2,'0'); };
const safeId = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 31) || 'N';

function componentAxis(c: WaterCadComponent): WaterPoint {
  const angle = (c.properties.rotationDeg ?? 0) * Math.PI / 180;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

/** Returns true engineering connection ports for pipes and inline/branch fittings. */
export function getWaterPorts(c: WaterCadComponent): WaterPort[] {
  if (c.customPorts?.length) {
    return c.customPorts.map((port, index) => ({
      id: c.id + ':' + port.id,
      componentId: c.id,
      index,
      point: { ...port.point },
      role: port.role,
      diameterMm: port.diameterMm ?? c.properties.nominalDiameterMm,
    }));
  }
  const centre = c.geometry[0] ?? { x: 0, y: 0 };
  const axis = componentAxis(c);
  const perpendicular = { x: -axis.y, y: axis.x };
  const nd = c.properties.nominalDiameterMm;
  const make = (index: number, point: WaterPoint, role: WaterPort['role'], diameter = nd): WaterPort => ({
    id: c.id + ':P' + (index + 1), componentId: c.id, index, point, role, diameterMm: diameter,
  });
  if (c.kind === 'pipe' && c.geometry.length >= 2) {
    return [make(0, c.geometry[0], 'inlet'), make(1, c.geometry[c.geometry.length - 1], 'outlet')];
  }
  if (c.kind === 'bend') {
    const r = c.properties.bendRadiusM ?? 0.5;
    const half = (c.properties.bendAngleDeg ?? 90) * Math.PI / 360;
    const tangent = Math.tan(half);
    const offset = r * tangent;
    const a = add(centre, scale(axis, -offset));
    const b = add(centre, scale(perpendicular, offset));
    return [make(0, a, 'inlet'), make(1, b, 'outlet')];
  }
  if (c.kind === 'tee') {
    const run = c.properties.fittingRunLengthM ?? 1;
    const branch = c.properties.fittingBranchLengthM ?? 0.5;
    return [
      make(0, add(centre, scale(axis, -run / 2)), 'run'),
      make(1, add(centre, scale(axis, run / 2)), 'run'),
      make(2, add(centre, scale(perpendicular, branch)), 'branch', c.properties.branchDiameterMm),
    ];
  }
  if (c.kind === 'reducer') {
    const length = c.properties.fittingLengthM ?? 0.5;
    return [
      make(0, add(centre, scale(axis, -length / 2)), 'inlet'),
      make(1, add(centre, scale(axis, length / 2)), 'outlet', c.properties.outletDiameterMm),
    ];
  }
  if (['valve', 'pump', 'meter'].includes(c.kind)) {
    const half = (c.properties.fittingLengthM ?? 0.5) / 2;
    return [make(0, add(centre, scale(axis, -half)), 'inlet'), make(1, add(centre, scale(axis, half)), 'outlet')];
  }
  if (['junction', 'source', 'tank', 'reservoir', 'hydrant', 'air-valve', 'washout'].includes(c.kind)) {
    return [make(0, centre, 'node')];
  }
  return [];
}

/** Sampled centreline for a bend; the returned points form a circular arc. */
export function buildBendCentreline(c: WaterCadComponent, segments = 16): WaterPoint[] {
  if (c.kind !== 'bend') throw new Error('Bend geometry can only be generated for a bend component.');
  if (!Number.isInteger(segments) || segments < 2) throw new Error('Use at least two arc segments.');
  const centre = c.geometry[0] ?? { x: 0, y: 0 };
  const radius = c.properties.bendRadiusM ?? 0.5;
  const angle = (c.properties.bendAngleDeg ?? 90) * Math.PI / 180;
  const rotation = (c.properties.rotationDeg ?? 0) * Math.PI / 180;
  if (!(radius > 0) || !(angle > 0 && angle < Math.PI)) throw new Error('Bend radius and angle are outside valid ranges.');
  // The centre point is the intersection of the two tangent lines.
  const tangent = Math.tan(angle / 2);
  const tangentDistance = radius * tangent;
  const start = { x: centre.x - Math.cos(rotation) * tangentDistance, y: centre.y - Math.sin(rotation) * tangentDistance };
  const arcCentre = { x: start.x + Math.cos(rotation + Math.PI / 2) * radius, y: start.y + Math.sin(rotation + Math.PI / 2) * radius };
  const startAngle = Math.atan2(start.y - arcCentre.y, start.x - arcCentre.x);
  return Array.from({ length: segments + 1 }, (_, i) => {
    const a = startAngle + angle * i / segments;
    return { x: arcCentre.x + radius * Math.cos(a), y: arcCentre.y + radius * Math.sin(a), z: centre.z };
  });
}

export function buildTeeCentreline(c: WaterCadComponent): WaterPoint[][] {
  if (c.kind !== 'tee') throw new Error('Tee geometry can only be generated for a tee component.');
  const ports = getWaterPorts(c);
  return [[ports[0].point, ports[1].point], [ports[2].point, c.geometry[0]]];
}
export function buildReducerCentreline(c: WaterCadComponent): WaterPoint[] {
  if (c.kind !== 'reducer') throw new Error('Reducer geometry can only be generated for a reducer component.');
  const ports = getWaterPorts(c);
  return [ports[0].point, ports[1].point];
}

export function connectWaterPorts(document: NetworkDocument, aPortId: string, bPortId: string, toleranceM = 0.05): NetworkDocument {
  if (!finite(toleranceM) || toleranceM < 0) throw new Error('Connection tolerance must be a non-negative metre value.');
  if (aPortId === bPortId) throw new Error('A port cannot connect to itself.');
  const ports = document.components.flatMap(getWaterPorts);
  const a = ports.find(p => p.id === aPortId), b = ports.find(p => p.id === bPortId);
  if (!a || !b) throw new Error('Both selected ports must exist in this project.');
  if (a.componentId === b.componentId) throw new Error('Two ports on the same component cannot be joined as a network connection.');
  if (dist(a.point, b.point) > toleranceM) throw new Error('Ports are ' + fmt(dist(a.point, b.point)) + ' m apart; move geometry or use a justified tolerance before connecting.');
  if (finite(a.diameterMm) && finite(b.diameterMm) && Math.abs(a.diameterMm - b.diameterMm) > 1) {
    throw new Error('Port diameters do not match (' + a.diameterMm + ' mm vs ' + b.diameterMm + ' mm). Connect through a correctly sized reducer.');
  }
  const connections = document.connections ?? [];
  if (connections.some(c => c.aPortId === aPortId || c.bPortId === aPortId || c.aPortId === bPortId || c.bPortId === bPortId)) {
    throw new Error('A port is already connected. A port may have only one direct connection.');
  }
  const connection = { id: 'CON-' + (connections.length + 1).toString().padStart(4, '0'), aPortId, bPortId };
  const components = document.components.map(component => ({ ...component }));
  const applyNodeConnection = (pipePortRef: WaterPort, nodePortRef: WaterPort) => {
    const node = components.find(item => item.id === nodePortRef.componentId);
    if (!node || !['junction', 'source', 'tank', 'reservoir'].includes(node.kind)) return;
    const pipe = components.find(item => item.id === pipePortRef.componentId);
    if (!pipe || pipe.kind !== 'pipe') return;
    if (pipePortRef.index === 0) pipe.fromNodeId = node.id;
    else if (pipePortRef.index === 1) pipe.toNodeId = node.id;
  };
  applyNodeConnection(a, b);
  applyNodeConnection(b, a);
  return { ...document, components, connections: [...connections, connection] };
}

export function buildPipeLongitudinalProfile(pipe: WaterCadComponent): ProfilePoint[] {
  if (pipe.kind !== 'pipe' || pipe.geometry.length < 2) throw new Error('A profile requires a pipe with at least two surveyed vertices.');
  const length = pipe.geometry.slice(1).reduce((sum, p, i) => sum + dist({ ...pipe.geometry[i], z: 0 }, { ...p, z: 0 }), 0);
  if (length <= 0) throw new Error('Pipe profile length must be positive.');
  const groundStart = pipe.properties.groundStartM;
  const groundEnd = pipe.properties.groundEndM;
  const invertStart = pipe.properties.invertInletM;
  const invertEnd = pipe.properties.invertOutletM;
  const od = pipe.properties.externalDiameterMm ?? pipe.properties.nominalDiameterMm;
  let chainage = 0;
  return pipe.geometry.map((point, i) => {
    if (i > 0) chainage += dist({ ...pipe.geometry[i - 1], z: 0 }, { ...point, z: 0 });
    const ratio = chainage / length;
    const interpolatedGround = finite(groundStart) && finite(groundEnd) ? groundStart + (groundEnd - groundStart) * ratio : null;
    const interpolatedInvert = finite(invertStart) && finite(invertEnd) ? invertStart + (invertEnd - invertStart) * ratio : null;
    const ground = finite(point.groundLevelM) ? point.groundLevelM : interpolatedGround;
    const invert = finite(point.invertLevelM) ? point.invertLevelM : interpolatedInvert;
    const crown = invert !== null && finite(od) ? invert + od / 1000 : null;
    return {
      chainageM: chainage, x: point.x, y: point.y, groundLevelM: ground,
      invertLevelM: invert, crownLevelM: crown,
      coverDepthM: ground !== null && crown !== null ? ground - crown : null,
    };
  });
}

export function buildWaterQuantities(document: WaterCadDocument): QuantityLine[] {
  const buckets = new Map<string, QuantityLine>();
  const addLine = (line: QuantityLine) => {
    const key = [line.code, line.material ?? '', line.nominalDiameterMm ?? ''].join('|');
    const existing = buckets.get(key);
    if (existing) existing.quantity += line.quantity;
    else buckets.set(key, { ...line });
  };
  for (const c of document.components) {
    const p = c.properties;
    if (c.kind === 'pipe') {
      const length = c.properties.hydraulicLengthM ?? component3dLength(c);
      if (length > 0) addLine({ code: 'PIPE', description: 'Supply and install ' + (p.material ?? 'unspecified') + ' pipe DN' + (p.nominalDiameterMm ?? '—'), unit: 'm', quantity: length, material: p.material, nominalDiameterMm: p.nominalDiameterMm });
    } else if (['bend', 'tee', 'reducer', 'valve', 'pump', 'tank', 'reservoir', 'chamber', 'hydrant', 'meter', 'air-valve', 'washout', 'junction', 'source'].includes(c.kind)) {
      const dn = p.nominalDiameterMm ? 'DN' + p.nominalDiameterMm : '';
      let code = c.kind.toUpperCase().replace('-', '_');
      let description = c.kind + ' ' + dn;
      if (c.kind === 'bend') { code += '_' + (p.bendAngleDeg ?? 90) + 'DEG_R' + (p.bendRadiusM ?? 0.5); description = 'Bend ' + dn + ' ' + (p.bendAngleDeg ?? 90) + '° radius ' + (p.bendRadiusM ?? 0.5) + ' m'; }
      if (c.kind === 'tee') { code += '_BR' + (p.branchDiameterMm ?? p.nominalDiameterMm ?? ''); description = 'Tee ' + dn + ' × branch DN' + (p.branchDiameterMm ?? '—'); }
      if (c.kind === 'reducer') { code += '_TO_DN' + (p.outletDiameterMm ?? ''); description = 'Reducer DN' + (p.nominalDiameterMm ?? '—') + ' × DN' + (p.outletDiameterMm ?? '—'); }
      if (c.kind === 'valve') { code += '_' + (p.valveType ?? 'unspecified').toUpperCase(); description = (p.valveType ?? 'Valve') + ' valve ' + dn; }
      if (c.kind === 'pump') { code += '_Q' + (p.pumpDutyFlowM3h ?? 'NA') + '_H' + (p.pumpDutyHeadM ?? 'NA'); description = 'Pump duty ' + (p.pumpDutyFlowM3h ?? '—') + ' m³/h @ ' + (p.pumpDutyHeadM ?? '—') + ' m'; }
      if (c.kind === 'tank') { code += '_' + (p.tankType ?? 'unspecified').toUpperCase(); description = 'Tank ' + (p.tankType ?? 'unspecified') + ' ' + (p.tankCapacityM3 ?? '—') + ' m³'; }
      if (c.kind === 'reservoir') description = 'Reservoir ' + (p.tankCapacityM3 ?? '—') + ' m³';
      if (c.kind === 'chamber') { code += '_' + [p.chamberLengthM,p.chamberWidthM,p.chamberDepthM].map(v => v ?? 'NA').join('X'); description = 'Chamber ' + [p.chamberLengthM,p.chamberWidthM,p.chamberDepthM].map(v => v ?? '—').join(' × ') + ' m'; }
      addLine({ code, description, unit: 'nr', quantity: 1, material: p.material, nominalDiameterMm: p.nominalDiameterMm });
    }
  }
  return [...buckets.values()].sort((a, b) => a.code.localeCompare(b.code) || (a.nominalDiameterMm ?? 0) - (b.nominalDiameterMm ?? 0));
}

export function buildPreliminaryBoq(document: WaterCadDocument, trenchWidthM = 0.6, workingDepthM = 1.2): QuantityLine[] {
  if (!(trenchWidthM > 0) || !(workingDepthM > 0)) throw new Error('Trench width and working depth must be positive.');
  const lines = buildWaterQuantities(document);
  const pipeLength = lines.filter(l => l.code === 'PIPE').reduce((s, l) => s + l.quantity, 0);
  if (pipeLength > 0) lines.push({ code: 'EXCAVATION', description: 'Preliminary trench excavation (' + fmt(trenchWidthM) + ' m wide × ' + fmt(workingDepthM) + ' m deep)', unit: 'm3', quantity: pipeLength * trenchWidthM * workingDepthM });
  return lines;
}

export type TopologyIssue = { componentId: string; severity: 'error' | 'warning'; code: string; message: string };

export function validateWaterNetworkTopology(document: NetworkDocument, toleranceM = 0.05): TopologyIssue[] {
  const issues: TopologyIssue[] = [];
  const ports = document.components.flatMap(getWaterPorts);
  const byId = new Map(ports.map(port => [port.id, port]));
  const used = new Map<string, string>();
  for (const connection of document.connections ?? []) {
    const a = byId.get(connection.aPortId), b = byId.get(connection.bPortId);
    if (!a || !b) {
      issues.push({ componentId: a?.componentId ?? b?.componentId ?? 'network', severity: 'error', code: 'UNKNOWN_PORT', message: 'Connection ' + connection.id + ' references a port that no longer exists.' });
      continue;
    }
    for (const port of [a, b]) {
      if (used.has(port.id)) issues.push({ componentId: port.componentId, severity: 'error', code: 'PORT_ALREADY_USED', message: 'Port ' + port.id + ' is assigned to more than one connection.' });
      used.set(port.id, connection.id);
    }
    if (dist(a.point, b.point) > toleranceM) issues.push({ componentId: a.componentId, severity: 'error', code: 'PORT_GAP', message: 'Connected ports ' + a.id + ' and ' + b.id + ' exceed the ' + toleranceM + ' m connection tolerance.' });
    if (finite(a.diameterMm) && finite(b.diameterMm) && Math.abs(a.diameterMm - b.diameterMm) > 1) issues.push({ componentId: a.componentId, severity: 'error', code: 'PORT_DIAMETER_MISMATCH', message: 'Connected ports ' + a.id + ' and ' + b.id + ' have incompatible diameters.' });
  }
  for (const component of document.components) {
    if (component.kind === 'pipe') {
      getWaterPorts(component).forEach((port, index) => {
        const explicitNode = index === 0 ? component.fromNodeId : component.toNodeId;
        if (!used.has(port.id) && !explicitNode) issues.push({ componentId: component.id, severity: 'warning', code: 'OPEN_PIPE_END', message: 'Pipe ' + component.id + ' has an unconnected ' + (index === 0 ? 'start' : 'end') + ' port.' });
      });
    } else if (['bend', 'tee', 'reducer', 'valve', 'pump'].includes(component.kind)) {
      getWaterPorts(component).forEach(port => {
        if (!used.has(port.id)) issues.push({ componentId: component.id, severity: 'warning', code: 'OPEN_FITTING_PORT', message: component.kind + ' ' + component.id + ' has an unconnected ' + port.role + ' port.' });
      });
    }
  }
  if (document.components.some(c => c.kind === 'pipe') && !document.components.some(c => c.kind === 'source' || c.kind === 'reservoir' || c.kind === 'tank')) {
    issues.push({ componentId: 'network', severity: 'warning', code: 'NO_FIXED_HEAD', message: 'Network has no reservoir, source or tank boundary; hydraulic simulation may not converge.' });
  }
  return issues;
}

type HydraulicNode = { id: string; elevationM: number; x: number; y: number; cadComponentId: string };

function resolveHydraulicNodes(document: NetworkDocument): { portNodeIds: Map<string, string>; syntheticNodes: HydraulicNode[] } {
  const ports = document.components.flatMap(getWaterPorts);
  const parent = new Map<string, string>(ports.map(port => [port.id, port.id]));
  const find = (id: string): string => {
    const current = parent.get(id);
    if (!current) throw new Error('Unknown network port ' + id);
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string) => {
    if (parent.has(a) && parent.has(b)) parent.set(find(b), find(a));
  };
  (document.connections ?? []).forEach(connection => union(connection.aPortId, connection.bPortId));
  // Bends, tees and reducers are passive fittings: all their ports share one hydraulic junction.
  document.components.filter(c => ['bend', 'tee', 'reducer'].includes(c.kind)).forEach(component => {
    const ids = getWaterPorts(component).map(port => port.id);
    ids.slice(1).forEach(id => union(ids[0], id));
  });
  // Preserve the legacy explicit node selectors by treating them as endpoint connections.
  document.components.filter(c => ['pipe', 'pump', 'valve'].includes(c.kind)).forEach(component => {
    const ownPorts = getWaterPorts(component);
    if (component.fromNodeId) union(ownPorts[0]?.id ?? '', component.fromNodeId + ':P1');
    if (component.toNodeId) union(ownPorts[1]?.id ?? '', component.toNodeId + ':P1');
  });
  const groups = new Map<string, WaterPort[]>();
  ports.forEach(port => {
    const root = find(port.id);
    groups.set(root, [...(groups.get(root) ?? []), port]);
  });
  const portNodeIds = new Map<string, string>();
  const syntheticNodes: HydraulicNode[] = [];
  let serial = 1;
  for (const [root, group] of groups) {
    const componentIds = new Set(group.map(port => port.componentId));
    const sourceNode = document.components.find(c => componentIds.has(c.id) && ['junction', 'source', 'tank', 'reservoir'].includes(c.kind));
    const containsLink = group.length > 1 && group.some(port => {
      const component = document.components.find(c => c.id === port.componentId);
      return component && ['pipe', 'pump', 'valve'].includes(component.kind);
    });
    if (!sourceNode && !containsLink) continue;
    const nodeId = sourceNode ? safeId(sourceNode.id) : 'N_' + String(serial++).padStart(4, '0');
    group.forEach(port => portNodeIds.set(port.id, nodeId));
    if (!sourceNode) {
      const levels = group.map(port => port.point.z).filter(finite);
      const elevationM = levels.length ? levels.reduce((sum, value) => sum + value, 0) / levels.length : 0;
      const x=group.reduce((sum,port)=>sum+port.point.x,0)/group.length;
      const y=group.reduce((sum,port)=>sum+port.point.y,0)/group.length;
      const cadComponentId=group.find(port=>!['pipe','pump','valve'].includes(document.components.find(component=>component.id===port.componentId)?.kind??''))?.componentId??group[0].componentId;
      syntheticNodes.push({ id: nodeId, elevationM, x, y, cadComponentId });
    }
  }
  return { portNodeIds, syntheticNodes };
}

/** Export a deliberately conservative EPANET INP model. Physical fittings are not silently converted into hydraulic devices. */
export function exportWaterNetworkToEpanet(document: NetworkDocument): EpanetExport {
  const warnings: string[] = [];
  Object.entries(document.epanetTimes??{}).forEach(([key,value])=>{if(typeof value==='number'&&Number.isFinite(value)&&value%60!==0)warnings.push('EPANET time setting '+key+' includes seconds; INP time fields are exported at minute resolution, rounded down.');});
  const nodes = document.components.filter(c => ['junction', 'source', 'tank', 'reservoir'].includes(c.kind));
  const hydraulic = resolveHydraulicNodes(document);
  const nodeIdList=[...nodes.map(n=>safeId(n.id)),...hydraulic.syntheticNodes.map(n=>n.id)];
  const nodeIds = new Set(nodeIdList);
  if(nodeIds.size!==nodeIdList.length)warnings.push('EPANET node ID collision between CAD nodes and generated hydraulic junctions. Rename conflicting IDs before simulation/export.');
  const idMap:EpanetIdMap[]=[
    ...nodes.map(node=>({epanetId:safeId(node.id),cadId:node.id,kind:'node' as const})),
    ...hydraulic.syntheticNodes.map(node=>({epanetId:node.id,cadId:node.cadComponentId,kind:'node' as const})),
    ...document.components.filter(component=>['pipe','pump','valve'].includes(component.kind)).map(link=>({epanetId:safeId(link.id),cadId:link.id,kind:'link' as const}))
  ];
  const hasSafeIdCollision=(['node','link'] as const).some(kind=>{const ids=idMap.filter(item=>item.kind===kind).map(item=>item.epanetId);return new Set(ids).size!==ids.length;});
  if(hasSafeIdCollision)warnings.push('EPANET ID collision: two or more CAD IDs in the same node/link namespace become identical after EPANET-safe normalization. Rename conflicting CAD objects before simulation/export.');
  const linkEnds = (component: WaterCadComponent) => { const ports = getWaterPorts(component); return [hydraulic.portNodeIds.get(ports[0]?.id ?? '') ?? '', hydraulic.portNodeIds.get(ports[1]?.id ?? '') ?? '']; };
  const pipes = document.components.filter(c => c.kind === 'pipe');
  const pumps = document.components.filter(c => c.kind === 'pump');
  const valves = document.components.filter(c => c.kind === 'valve');
  const lines: string[] = ['[TITLE]', 'RayanAqua Water CAD export', '', '[JUNCTIONS]', ';ID Elevation_m BaseDemand_LPS Pattern'];
  nodes.filter(n => n.kind === 'junction').forEach(n => lines.push([safeId(n.id), fmt(n.properties.hydraulicElevationM ?? n.geometry[0]?.z ?? 0), fmt((n.properties.flowM3h ?? 0) * 1000 / 3600), n.properties.demandPatternId ? safeId(n.properties.demandPatternId) : ''].join(' ')));
  hydraulic.syntheticNodes.forEach(n => lines.push([n.id, fmt(n.elevationM), '0', ''].join(' ')));
  lines.push('', '[DEMANDS]', ';JunctionID Demand_LPS Pattern');
  nodes.filter(n=>n.kind==='junction').forEach(n=>(n.properties.additionalDemands??[]).forEach(demand=>lines.push([safeId(n.id),fmt(demand.flowM3h*1000/3600),demand.patternId?safeId(demand.patternId):''].join(' '))));
  lines.push('', '[EMITTERS]', ';JunctionID Coefficient');
  nodes.filter(n=>n.kind==='junction'&&n.properties.emitterCoefficient!==undefined).forEach(n=>lines.push([safeId(n.id),fmt(n.properties.emitterCoefficient??0)].join(' ')));
  lines.push('', '[RESERVOIRS]', ';ID Head_m Pattern');
  nodes.filter(n => n.kind === 'source' || n.kind === 'reservoir').forEach(n => lines.push([safeId(n.id), fmt(n.properties.hydraulicHeadM ?? n.properties.tankOperatingLevelM ?? n.geometry[0]?.z ?? 0), n.properties.hydraulicHeadPatternId ? safeId(n.properties.hydraulicHeadPatternId) : ''].join(' ')));
  lines.push('', '[TANKS]', ';ID Elevation_m InitLevel_m MinLevel_m MaxLevel_m Diameter_m MinVolume_m3');
  nodes.filter(n => n.kind === 'tank').forEach(n => {
    const p = n.properties;
    const level = p.tankOperatingLevelM ?? 1;
    lines.push([safeId(n.id), fmt(n.properties.hydraulicElevationM ?? n.geometry[0]?.z ?? 0), fmt(level), fmt(p.tankMinLevelM ?? 0), fmt(p.tankMaxLevelM ?? Math.max(level + 1, level * 1.5)), fmt(p.tankDiameterM ?? 1), fmt(p.tankMinVolumeM3 ?? 0)].join(' '));
  });
  lines.push('', '[PIPES]', ';ID Node1 Node2 Length_m Diameter_mm Roughness MinorLoss Status');
  for (const p of pipes) {
    const [fromNode, toNode] = linkEnds(p);
    if (!fromNode || !toNode || !nodeIds.has(fromNode) || !nodeIds.has(toNode) || fromNode === toNode) {
      warnings.push('Pipe ' + p.id + ' omitted: connect both ends to valid network ports/nodes.');
      continue;
    }
    const length = p.properties.hydraulicLengthM ?? component3dLength(p);
    if (!(length > 0) || !(p.properties.internalDiameterMm && p.properties.internalDiameterMm > 0)) {
      warnings.push('Pipe ' + p.id + ' omitted: positive length and internal diameter are required.');
      continue;
    }
    lines.push([safeId(p.id), fromNode, toNode, fmt(length), fmt(p.properties.internalDiameterMm), fmt(p.properties.roughness ?? 130), fmt(p.properties.minorLossCoefficient ?? 0), p.properties.initialStatus ?? 'OPEN'].join(' '));
  }
  // EPANET check valves are pipe links with status CV, not GPV valves.
  valves.filter(v => v.properties.valveType === 'check').forEach(v => {
    const [fromNode, toNode] = linkEnds(v);
    if (!fromNode || !toNode || !nodeIds.has(fromNode) || !nodeIds.has(toNode)) warnings.push('Check valve ' + v.id + ' omitted: connect its inlet and outlet ports.');
    else if (!(v.properties.internalDiameterMm ?? v.properties.nominalDiameterMm)) warnings.push('Check valve ' + v.id + ' omitted: set a positive diameter.');
    else lines.push([safeId(v.id), fromNode, toNode, fmt(v.properties.hydraulicLengthM ?? v.properties.fittingLengthM ?? 0.5), fmt(v.properties.internalDiameterMm ?? v.properties.nominalDiameterMm ?? 0), fmt(v.properties.roughness ?? 130), fmt(v.properties.minorLossCoefficient ?? 0), 'CV'].join(' '));
  });
  lines.push('', '[PUMPS]', ';ID Node1 Node2 Parameters');
  pumps.forEach(p => {
    const [fromNode, toNode] = linkEnds(p);
    if (!fromNode || !toNode || !nodeIds.has(fromNode) || !nodeIds.has(toNode)) warnings.push('Pump ' + p.id + ' omitted: connect its inlet and outlet ports.');
    else if (p.properties.pumpPowerKw && p.properties.pumpPowerKw > 0) lines.push([safeId(p.id),fromNode,toNode,'POWER '+fmt(p.properties.pumpPowerKw)].join(' '));
    else if (!(p.properties.pumpCurvePoints?.length || (p.properties.pumpDutyFlowM3h && p.properties.pumpDutyFlowM3h > 0 && p.properties.pumpDutyHeadM && p.properties.pumpDutyHeadM > 0))) warnings.push('Pump ' + p.id + ' omitted: a valid pump curve, constant power, or positive duty flow and head is required.');
    else lines.push([safeId(p.id), fromNode, toNode, 'HEAD ' + safeId('CURVE_' + p.id), ...(p.properties.pumpSpeedMultiplier!==undefined?['SPEED',fmt(p.properties.pumpSpeedMultiplier)]:[]), ...(p.properties.pumpSpeedPattern?['PATTERN',safeId(p.properties.pumpSpeedPattern)]:[])].join(' '));
  });
  lines.push('', '[VALVES]', ';ID Node1 Node2 Diameter_mm Type Setting MinorLoss');
  valves.filter(v => v.properties.valveType !== 'check').forEach(v => {
    const [fromNode, toNode] = linkEnds(v);
    if (!fromNode || !toNode || !nodeIds.has(fromNode) || !nodeIds.has(toNode)) warnings.push('Valve ' + v.id + ' omitted: connect its inlet and outlet ports.');
    else if (['PRV','PSV','PBV','FCV','TCV'].includes(v.properties.valveType ?? '')) lines.push([safeId(v.id), fromNode, toNode, fmt(v.properties.internalDiameterMm ?? v.properties.nominalDiameterMm ?? 0), v.properties.valveType!, fmt(v.properties.valveSetting ?? 0), '0'].join(' '));
    else warnings.push('Valve ' + v.id + ' (' + (v.properties.valveType ?? 'unspecified') + ') omitted from EPANET valve links; its loss/control model needs an explicit supported setting or curve.');
  });
  const unsupported = document.components.filter(c => ['bend', 'tee', 'reducer', 'chamber', 'hydrant', 'meter', 'air-valve', 'washout'].includes(c.kind));
  if (unsupported.length) warnings.push('EPANET does not model physical ' + [...new Set(unsupported.map(c => c.kind))].join(', ') + ' as standalone hydraulic elements; preserve them in CAD/GIS and model hydraulic losses through suitable pipe minor-loss values or supported links.');
  if (document.components.some(c => c.kind === 'junction') && !document.components.some(c => c.kind === 'source' || c.kind === 'reservoir' || c.kind === 'tank')) warnings.push('No fixed-head source, reservoir or tank is defined; the hydraulic model may be unsolvable.');
  lines.push('', '[PATTERNS]', ';ID Multiplier');
  (document.epanetPatterns??[]).forEach(pattern=>{
    if(!pattern.id||!pattern.multipliers.length) return;
    for(let i=0;i<pattern.multipliers.length;i+=6) lines.push([safeId(pattern.id),...pattern.multipliers.slice(i,i+6).map(fmt)].join(' '));
  });
  const definedPatterns=new Set((document.epanetPatterns??[]).map(pattern=>safeId(pattern.id)));
  document.components.forEach(component=>{
    const demandPattern=component.properties.demandPatternId;
    const speedPattern=component.properties.pumpSpeedPattern;
    const headPattern=component.properties.hydraulicHeadPatternId;
    if(demandPattern&&!definedPatterns.has(safeId(demandPattern))) warnings.push('Node '+component.id+' references missing demand pattern '+demandPattern+'.');
    (component.properties.additionalDemands??[]).forEach((demand,index)=>{if(demand.patternId&&!definedPatterns.has(safeId(demand.patternId)))warnings.push('Node '+component.id+' additional demand '+(index+1)+' references missing pattern '+demand.patternId+'.');});
    if(headPattern&&!definedPatterns.has(safeId(headPattern))) warnings.push('Reservoir '+component.id+' references missing head pattern '+headPattern+'.');
    if(speedPattern&&!definedPatterns.has(safeId(speedPattern))) warnings.push('Pump '+component.id+' references missing speed pattern '+speedPattern+'.');
  });
  lines.push('', '[STATUS]', ';LinkID Status');
  [...pumps,...valves].filter(component=>component.properties.initialStatus).forEach(component=>lines.push([safeId(component.id),component.properties.initialStatus!].join(' ')));
  lines.push('', '[CURVES]', ';CurveID Flow_LPS Head_m');
  pumps.filter(p => { const [a, b] = linkEnds(p); return a && b && nodeIds.has(a) && nodeIds.has(b) && (p.properties.pumpCurvePoints?.length || (p.properties.pumpDutyFlowM3h && p.properties.pumpDutyHeadM)); }).forEach(p => {
    const points=p.properties.pumpCurvePoints?.length ? p.properties.pumpCurvePoints : [{flowM3h:p.properties.pumpDutyFlowM3h??0,headM:p.properties.pumpDutyHeadM??0}];
    points.forEach(point=>lines.push([safeId('CURVE_' + p.id),fmt(point.flowM3h*1000/3600),fmt(point.headM)].join(' ')));
  });
  lines.push('', '[OPTIONS]', 'UNITS LPS', 'HEADLOSS '+(document.epanetHeadlossFormula??'H-W'), 'SPECIFIC GRAVITY '+fmt(document.epanetSpecificGravity??1), 'VISCOSITY '+fmt(document.epanetViscosity??1), 'TRIALS '+fmt(document.epanetTrials??40), 'ACCURACY '+fmt(document.epanetAccuracy??0.001), '', '[TIMES]',
    'DURATION '+fmtTime(document.epanetTimes?.durationSeconds??0),
    'HYDRAULIC TIMESTEP '+fmtTime(document.epanetTimes?.hydraulicStepSeconds??3600),
    'QUALITY TIMESTEP 0:05',
    'PATTERN TIMESTEP '+fmtTime(document.epanetTimes?.patternStepSeconds??3600),
    'PATTERN START '+fmtTime(document.epanetTimes?.patternStartSeconds??0),
    'REPORT TIMESTEP '+fmtTime(document.epanetTimes?.reportStepSeconds??3600),
    'REPORT START '+fmtTime(document.epanetTimes?.reportStartSeconds??0),
    '', '[REPORT]', 'STATUS YES', 'SUMMARY YES', 'NODES ALL', 'LINKS ALL', '', '[COORDINATES]');
  nodes.forEach(n => { const point = n.geometry[0]; if (point) lines.push([safeId(n.id), fmt(point.x), fmt(point.y)].join(' ')); });
  hydraulic.syntheticNodes.forEach(n=>lines.push([n.id,fmt(n.x),fmt(n.y)].join(' ')));
  lines.push('', '[VERTICES]', ';LinkID X Y');
  pipes.forEach(pipe=>pipe.geometry.slice(1,-1).forEach(point=>lines.push([safeId(pipe.id),fmt(point.x),fmt(point.y)].join(' '))));
  lines.push('', '[END]');
  return { input: lines.join('\n') + '\n', warnings, idMap };
}
