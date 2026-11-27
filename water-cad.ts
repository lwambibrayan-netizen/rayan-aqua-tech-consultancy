/**
 * Water-engineering CAD domain model.
 * Geometry is stored in metres in a project-local engineering coordinate system.
 * Elevations are metres on the project's declared vertical datum.
 */
export type WaterComponentKind =
  | 'pipe' | 'bend' | 'tee' | 'reducer' | 'valve' | 'pump'
  | 'tank' | 'chamber' | 'hydrant' | 'meter' | 'air-valve'
  | 'washout' | 'reservoir' | 'source' | 'junction';
export type WaterPoint = { x: number; y: number; z?: number };
export type PipeMaterial = 'DI' | 'HDPE' | 'uPVC' | 'steel' | 'concrete' | 'GRP' | 'other';
export type WaterEngineeringProperties = {
  tag: string;
  description: string;
  material?: PipeMaterial;
  nominalDiameterMm?: number;
  internalDiameterMm?: number;
  pressureClass?: string;
  designPressureBar?: number;
  roughness?: number;
  invertInletM?: number;
  invertOutletM?: number;
  coverDepthM?: number;
  groundStartM?: number;
  groundEndM?: number;
  externalDiameterMm?: number;
  rotationDeg?: number;
  fittingLengthM?: number;
  fittingRunLengthM?: number;
  fittingBranchLengthM?: number;
  bendAngleDeg?: number;
  bendRadiusM?: number;
  branchDiameterMm?: number;
  outletDiameterMm?: number;
  valveType?: 'gate' | 'butterfly' | 'check' | 'PRV' | 'PSV' | 'air-release' | 'washout' | 'control';
  valveSetting?: number;
  pumpDutyFlowM3h?: number;
  pumpDutyHeadM?: number;
  pumpEfficiencyPct?: number;
  tankType?: 'ground' | 'elevated' | 'underground';
  tankCapacityM3?: number;
  tankOperatingLevelM?: number;
  tankDiameterM?: number;
  chamberLengthM?: number;
  chamberWidthM?: number;
  chamberDepthM?: number;
  flowM3h?: number;
  velocityMinMs?: number;
  velocityMaxMs?: number;
  notes?: string;
};
export type WaterCadComponent = {
  id: string;
  kind: WaterComponentKind;
  geometry: WaterPoint[];
  properties: WaterEngineeringProperties;
  fromNodeId?: string;
  toNodeId?: string;
  connectedNodeIds?: string[];
};
export type WaterCadDocument = {
  schemaVersion: 1;
  units: 'm';
  verticalDatum: string;
  components: WaterCadComponent[];
  connections?: { id: string; aPortId: string; bPortId: string }[];
};
export type WaterCadIssue = { componentId: string; severity: 'error' | 'warning'; code: string; message: string };

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const positive = (n: unknown): n is number => finite(n) && n > 0;
const distance2d = (a: WaterPoint, b: WaterPoint) => Math.hypot(b.x - a.x, b.y - a.y);

export function createWaterComponent(kind: WaterComponentKind, id: string, x: number, y: number): WaterCadComponent {
  if (!id.trim() || !finite(x) || !finite(y)) throw new Error('A component needs an ID and finite plan coordinates.');
  const properties: WaterEngineeringProperties = { tag: id, description: '' };
  const geometry: WaterPoint[] = [{ x, y }];
  if (kind === 'pipe') {
    geometry.push({ x: x + 10, y });
    Object.assign(properties, { material: 'HDPE', nominalDiameterMm: 110, internalDiameterMm: 96, externalDiameterMm: 110, pressureClass: 'PN16', roughness: 140, velocityMinMs: 0.3, velocityMaxMs: 2.0 });
  } else if (kind === 'bend') Object.assign(properties, { nominalDiameterMm: 110, bendAngleDeg: 90, bendRadiusM: 0.5, rotationDeg: 0 });
  else if (kind === 'tee') Object.assign(properties, { nominalDiameterMm: 110, branchDiameterMm: 110, rotationDeg: 0, fittingRunLengthM: 1, fittingBranchLengthM: 0.5 });
  else if (kind === 'reducer') Object.assign(properties, { nominalDiameterMm: 160, outletDiameterMm: 110, rotationDeg: 0, fittingLengthM: 0.5 });
  else if (kind === 'valve') Object.assign(properties, { nominalDiameterMm: 110, valveType: 'gate', valveSetting: 100 });
  else if (kind === 'pump') Object.assign(properties, { nominalDiameterMm: 110, pumpDutyFlowM3h: 15, pumpDutyHeadM: 40, pumpEfficiencyPct: 75 });
  else if (kind === 'tank' || kind === 'reservoir') Object.assign(properties, { tankType: 'ground', tankCapacityM3: 100, tankOperatingLevelM: 3, tankDiameterM: 7 });
  else if (kind === 'chamber') Object.assign(properties, { chamberLengthM: 1.2, chamberWidthM: 1.0, chamberDepthM: 1.5 });
  else if (kind === 'hydrant' || kind === 'meter' || kind === 'air-valve' || kind === 'washout') Object.assign(properties, { nominalDiameterMm: 80 });
  return { id, kind, geometry, properties };
}

export function componentPlanLength(component: WaterCadComponent): number {
  if (component.kind !== 'pipe' || component.geometry.length < 2) return 0;
  let length = 0;
  for (let i = 1; i < component.geometry.length; i++) length += distance2d(component.geometry[i - 1], component.geometry[i]);
  return length;
}
export function component3dLength(component: WaterCadComponent): number {
  if (component.kind !== 'pipe' || component.geometry.length < 2) return 0;
  let length = 0;
  for (let i = 1; i < component.geometry.length; i++) {
    const a = component.geometry[i - 1], b = component.geometry[i];
    const dz = finite(a.z) && finite(b.z) ? b.z - a.z : 0;
    length += Math.hypot(b.x - a.x, b.y - a.y, dz);
  }
  return length;
}
export function connectPipeEndpoints(document: WaterCadDocument, pipeId: string, fromNodeId: string, toNodeId: string, toleranceM = 0.05): WaterCadDocument {
  const pipe = document.components.find(item => item.id === pipeId && item.kind === 'pipe');
  const from = document.components.find(item => item.id === fromNodeId);
  const to = document.components.find(item => item.id === toNodeId);
  const allowed = new Set<WaterComponentKind>(['junction','source','tank','reservoir']);
  if (!pipe || !from || !to) throw new Error('Select an existing pipe and two existing network nodes.');
  if (!allowed.has(from.kind) || !allowed.has(to.kind)) throw new Error('Pipe endpoints must connect to junctions, sources, tanks or reservoirs.');
  if (from.id === to.id) throw new Error('A pipe must connect two different nodes.');
  if (!finite(toleranceM) || toleranceM < 0) throw new Error('Connection tolerance must be a non-negative metre value.');
  if (pipe.geometry.length < 2 || !from.geometry[0] || !to.geometry[0]) throw new Error('Pipe and network nodes need valid endpoint geometry.');
  const startDistance = distance2d(pipe.geometry[0], from.geometry[0]);
  const endDistance = distance2d(pipe.geometry[pipe.geometry.length - 1], to.geometry[0]);
  if (startDistance > toleranceM || endDistance > toleranceM) {
    throw new Error('Pipe endpoints must coincide with the selected node locations within ' + toleranceM + ' m (start: ' + startDistance.toFixed(3) + ' m, end: ' + endDistance.toFixed(3) + ' m).');
  }
  return { ...document, components: document.components.map(item => item.id === pipeId ? { ...item, fromNodeId, toNodeId } : item) };
}

export function pipeSlopePercent(component: WaterCadComponent): number | null {
  const length = componentPlanLength(component);
  const a = component.properties.invertInletM, b = component.properties.invertOutletM;
  if (component.kind !== 'pipe' || length <= 0 || !finite(a) || !finite(b)) return null;
  return (b - a) / length * 100;
}
export function pipeVelocityMs(flowM3h: number, internalDiameterMm: number): number {
  if (!finite(flowM3h) || flowM3h < 0 || !positive(internalDiameterMm)) throw new Error('Flow must be non-negative and internal diameter must be positive.');
  const area = Math.PI * Math.pow(internalDiameterMm / 1000, 2) / 4;
  return (flowM3h / 3600) / area;
}
export function hazenWilliamsHeadlossM(lengthM: number, flowM3h: number, diameterMm: number, coefficient: number): number {
  if (!positive(lengthM) || !finite(flowM3h) || flowM3h < 0 || !positive(diameterMm) || !positive(coefficient)) throw new Error('Hazen-Williams inputs are outside their valid ranges.');
  if (flowM3h === 0) return 0;
  const q = flowM3h / 3600, d = diameterMm / 1000;
  return 10.67 * lengthM * Math.pow(q, 1.852) / (Math.pow(coefficient, 1.852) * Math.pow(d, 4.8704));
}
export function validateWaterCad(document: WaterCadDocument): WaterCadIssue[] {
  const issues: WaterCadIssue[] = [];
  const ids = new Set<string>();
  for (const c of document.components) {
    const p = c.properties;
    const add = (severity: WaterCadIssue['severity'], code: string, message: string) => issues.push({ componentId: c.id, severity, code, message });
    if (!c.id || ids.has(c.id)) add('error', 'DUPLICATE_ID', 'Component IDs must be unique and non-empty.');
    ids.add(c.id);
    if (!c.geometry.length || c.geometry.some(point => !finite(point.x) || !finite(point.y) || (point.z !== undefined && !finite(point.z)))) add('error', 'INVALID_GEOMETRY', 'Component coordinates must be finite.');
    if (c.kind === 'pipe') {
      const length = componentPlanLength(c);
      if (length <= 0) add('error', 'ZERO_LENGTH_PIPE', 'Pipe must have a positive plan length.');
      if (!positive(p.internalDiameterMm)) add('error', 'PIPE_BORE_REQUIRED', 'Set a positive internal pipe diameter.');
      if (!positive(p.nominalDiameterMm)) add('error', 'PIPE_ND_REQUIRED', 'Set a positive nominal pipe diameter.');
      if (finite(p.invertInletM) && finite(p.invertOutletM) && length > 0 && Math.abs((p.invertOutletM - p.invertInletM) / length) > 1) add('warning', 'EXTREME_SLOPE', 'Pipe invert gradient exceeds 100%; verify levels and units.');
      if (finite(p.flowM3h) && positive(p.internalDiameterMm)) {
        const velocity = pipeVelocityMs(p.flowM3h, p.internalDiameterMm);
        if (finite(p.velocityMinMs) && velocity < p.velocityMinMs) add('warning', 'LOW_VELOCITY', 'Calculated velocity is below the specified design minimum.');
        if (finite(p.velocityMaxMs) && velocity > p.velocityMaxMs) add('warning', 'HIGH_VELOCITY', 'Calculated velocity exceeds the specified design maximum.');
      }
      const outsideDiameter = p.externalDiameterMm ?? p.nominalDiameterMm;
      if (finite(p.groundStartM) && finite(p.invertInletM) && positive(outsideDiameter) && p.groundStartM - p.invertInletM - outsideDiameter / 1000 < 0) add('warning', 'NEGATIVE_COVER', 'Pipe crown is above ground at the inlet; verify survey levels and vertical datum.');
      if (finite(p.groundEndM) && finite(p.invertOutletM) && positive(outsideDiameter) && p.groundEndM - p.invertOutletM - outsideDiameter / 1000 < 0) add('warning', 'NEGATIVE_COVER', 'Pipe crown is above ground at the outlet; verify survey levels and vertical datum.');
      if (p.material === 'HDPE' && p.pressureClass && !/^PN\\d+(?:\\.\\d+)?$/i.test(p.pressureClass)) add('warning', 'PRESSURE_CLASS_FORMAT', 'HDPE pressure class should use a PN designation such as PN16.');
    }
    if (c.kind === 'bend' && (!positive(p.nominalDiameterMm) || !finite(p.bendAngleDeg) || p.bendAngleDeg <= 0 || p.bendAngleDeg >= 180)) add('error', 'BEND_PROPERTIES', 'Bend needs a positive diameter and an angle between 0° and 180°.');
    if (c.kind === 'tee' && (!positive(p.nominalDiameterMm) || !positive(p.branchDiameterMm))) add('error', 'TEE_DIAMETERS', 'Tee needs run and branch diameters.');
    if (c.kind === 'reducer' && (!positive(p.nominalDiameterMm) || !positive(p.outletDiameterMm) || p.outletDiameterMm === p.nominalDiameterMm)) add('error', 'REDUCER_DIAMETERS', 'Reducer needs two different positive end diameters.');
    if (c.kind === 'valve' && !p.valveType) add('error', 'VALVE_TYPE', 'Select a valve type.');
    if (c.kind === 'pump' && (!positive(p.pumpDutyFlowM3h) || !positive(p.pumpDutyHeadM))) add('error', 'PUMP_DUTY', 'Pump duty flow and head must be positive.');
    if ((c.kind === 'tank' || c.kind === 'reservoir') && !positive(p.tankCapacityM3)) add('error', 'TANK_CAPACITY', 'Tank/reservoir capacity must be positive.');
    if (c.kind === 'chamber' && (![p.chamberLengthM, p.chamberWidthM, p.chamberDepthM].every(positive))) add('error', 'CHAMBER_DIMENSIONS', 'Chamber length, width and depth must be positive.');
  }
  for (const c of document.components) {
    for (const nodeId of [c.fromNodeId, c.toNodeId, ...(c.connectedNodeIds || [])].filter(Boolean) as string[]) {
      if (!ids.has(nodeId)) issues.push({ componentId: c.id, severity: 'error', code: 'BROKEN_CONNECTION', message: 'Connection references missing component ' + nodeId + '.' });
    }
  }
  return issues;
}
