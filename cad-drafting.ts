/** Professional drafting primitives. Model geometry is stored in metres; plotted annotation sizes are paper millimetres. */
export type DraftLayer = {
  name: string;
  color: string;
  lineType: 'CONTINUOUS' | 'DASHED' | 'CENTER' | 'HIDDEN' | 'PHANTOM';
  lineWeightMm: number;
  visible: boolean;
  locked: boolean;
  plot: boolean;
};
export type DraftPoint = { x: number; y: number };
export type DraftAnnotation =
  | { id: string; kind: 'linear' | 'aligned'; layer: string; a: DraftPoint; b: DraftPoint; offsetM: number; textOverride?: string; precision: number }
  | { id: string; kind: 'text'; layer: string; at: DraftPoint; text: string; heightMm: number; rotationDeg: number }
  | { id: string; kind: 'leader'; layer: string; points: DraftPoint[]; text: string; textHeightMm: number };
export type SheetSize = 'A0' | 'A1' | 'A2' | 'A3' | 'A4' | 'CUSTOM';
export type DrawingSheet = {
  size: SheetSize; orientation: 'landscape' | 'portrait'; widthMm?: number; heightMm?: number;
  scale: string; title: string; drawingNumber: string; revision: string; status: 'PRELIMINARY' | 'FOR REVIEW' | 'FOR APPROVAL' | 'FOR CONSTRUCTION' | 'AS BUILT';
  company: string; designer: string; checker: string; approver: string; date: string; units: 'm' | 'mm';
};
export type DraftingDocument = {
  standard: 'ISO' | 'BS' | 'ANSI';
  layers: DraftLayer[];
  annotations: DraftAnnotation[];
  sheet: DrawingSheet;
};
export const DEFAULT_DRAFT_LAYERS: DraftLayer[] = [
  { name: '0', color: '#202020', lineType: 'CONTINUOUS', lineWeightMm: 0.18, visible: true, locked: false, plot: true },
  { name: 'WATER_PIPE', color: '#087e83', lineType: 'CONTINUOUS', lineWeightMm: 0.35, visible: true, locked: false, plot: true },
  { name: 'WATER_FITTING', color: '#087e83', lineType: 'CONTINUOUS', lineWeightMm: 0.35, visible: true, locked: false, plot: true },
  { name: 'DIMENSIONS', color: '#202020', lineType: 'CONTINUOUS', lineWeightMm: 0.18, visible: true, locked: false, plot: true },
  { name: 'TEXT', color: '#202020', lineType: 'CONTINUOUS', lineWeightMm: 0.18, visible: true, locked: false, plot: true },
  { name: 'CENTERLINES', color: '#777777', lineType: 'CENTER', lineWeightMm: 0.18, visible: true, locked: false, plot: true },
  { name: 'HIDDEN', color: '#777777', lineType: 'HIDDEN', lineWeightMm: 0.18, visible: true, locked: false, plot: true },
  { name: 'BOUNDARY', color: '#202020', lineType: 'CONTINUOUS', lineWeightMm: 0.5, visible: true, locked: false, plot: true },
  { name: 'ANNOTATION', color: '#202020', lineType: 'CONTINUOUS', lineWeightMm: 0.18, visible: true, locked: false, plot: true },
  { name: 'CONSTRUCTION', color: '#aaaaaa', lineType: 'DASHED', lineWeightMm: 0.13, visible: true, locked: false, plot: false },
];
export const DEFAULT_DRAWING_SHEET: DrawingSheet = {
  size: 'A3', orientation: 'landscape', scale: '1:100', title: 'Water Engineering General Arrangement',
  drawingNumber: 'RA-WTR-001', revision: 'P01', status: 'PRELIMINARY', company: 'RayanAqua Tech Consultancy',
  designer: '', checker: '', approver: '', date: new Date().toISOString().slice(0, 10), units: 'm',
};
const A_SIZES: Record<Exclude<SheetSize, 'CUSTOM'>, [number, number]> = {
  A0: [841, 1189], A1: [594, 841], A2: [420, 594], A3: [297, 420], A4: [210, 297],
};
export function sheetDimensionsMm(sheet: DrawingSheet): { widthMm: number; heightMm: number } {
  const [short, long] = sheet.size === 'CUSTOM'
    ? [sheet.widthMm ?? 297, sheet.heightMm ?? 420]
    : A_SIZES[sheet.size];
  return sheet.orientation === 'landscape' ? { widthMm: long, heightMm: short } : { widthMm: short, heightMm: long };
}
export function createDraftingDocument(partial?: Partial<DraftingDocument>): DraftingDocument {
  return {
    standard: partial?.standard ?? 'ISO',
    layers: partial?.layers?.length ? partial.layers : DEFAULT_DRAFT_LAYERS.map(layer => ({ ...layer })),
    annotations: partial?.annotations ?? [],
    sheet: { ...DEFAULT_DRAWING_SHEET, ...(partial?.sheet ?? {}) },
  };
}
export function measureDimension(annotation: Extract<DraftAnnotation, { kind: 'linear' | 'aligned' }>): number {
  const dx = annotation.b.x - annotation.a.x, dy = annotation.b.y - annotation.a.y;
  return annotation.kind === 'aligned' ? Math.hypot(dx, dy) : Math.abs(dx);
}
export function formatDimension(valueM: number, precision = 3, units: 'm' | 'mm' = 'm'): string {
  if (!Number.isFinite(valueM) || !Number.isInteger(precision) || precision < 0 || precision > 6) throw new Error('Dimension value and precision are invalid.');
  const value = units === 'mm' ? valueM * 1000 : valueM;
  return value.toFixed(precision) + (units === 'mm' ? ' mm' : ' m');
}
export function validateDraftingDocument(doc: DraftingDocument): string[] {
  const issues: string[] = [];
  const names = new Set<string>();
  for (const layer of doc.layers) {
    const key = layer.name.trim().toUpperCase();
    if (!key) issues.push('Layer names cannot be blank.');
    if (names.has(key)) issues.push('Duplicate layer name: ' + layer.name);
    names.add(key);
    if (!/^#[0-9a-f]{6}$/i.test(layer.color)) issues.push('Layer ' + layer.name + ' has an invalid RGB color.');
    if (!Number.isFinite(layer.lineWeightMm) || layer.lineWeightMm < 0 || layer.lineWeightMm > 2.11) issues.push('Layer ' + layer.name + ' has an invalid lineweight.');
  }
  const annotationIds = new Set<string>();
  for (const item of doc.annotations) {
    if (!item.id || annotationIds.has(item.id)) issues.push('Annotation IDs must be unique and non-empty.');
    annotationIds.add(item.id);
    if (!names.has(item.layer.toUpperCase())) issues.push('Annotation ' + item.id + ' uses an undefined layer.');
    const points = item.kind === 'text' ? [item.at] : item.points ?? [item.a, item.b];
    if (points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) issues.push('Annotation ' + item.id + ' contains invalid coordinates.');
    if (item.kind === 'text' && (!item.text.trim() || item.heightMm <= 0)) issues.push('Text annotations require content and a positive paper text height.');
    if (item.kind === 'leader' && (item.points.length < 2 || !item.text.trim() || item.textHeightMm <= 0)) issues.push('Leaders require at least two points, text and a positive text height.');
    if ((item.kind === 'linear' || item.kind === 'aligned') && (item.a.x === item.b.x && item.a.y === item.b.y)) issues.push('A dimension cannot measure a zero-length segment.');
  }
  const sheet = sheetDimensionsMm(doc.sheet);
  if (!(sheet.widthMm > 0 && sheet.heightMm > 0)) issues.push('Drawing sheet dimensions must be positive.');
  if (!/^1:\\d+(?:\\.\\d+)?$/.test(doc.sheet.scale)) issues.push('Sheet scale must use a ratio such as 1:100.');
  if (!doc.sheet.drawingNumber.trim() || !doc.sheet.title.trim()) issues.push('Drawing title and drawing number are required.');
  return issues;
}
export function makeLinearDimension(id: string, a: DraftPoint, b: DraftPoint, offsetM: number, layer = 'DIMENSIONS', precision = 3): DraftAnnotation {
  if (!id || !Number.isFinite(offsetM) || !Number.isInteger(precision) || precision < 0 || precision > 6) throw new Error('Invalid dimension settings.');
  if (Math.hypot(b.x - a.x, b.y - a.y) <= 1e-9) throw new Error('Cannot dimension a zero-length segment.');
  return { id, kind: 'linear', layer, a: { ...a }, b: { ...b }, offsetM, precision };
}
