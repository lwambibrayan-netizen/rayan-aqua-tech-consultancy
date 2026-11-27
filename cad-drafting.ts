import type { DimensionStyle } from './cad-dimension-standards';
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
  generalNotes?: string; keyPlanText?: string; showNorthArrow?: boolean; showScaleBar?: boolean;
};
export type DrawingRevisionEntry = { revision: string; date: string; description: string; drawnBy: string; checkedBy: string; approvedBy: string; status: 'PRELIMINARY' | 'FOR REVIEW' | 'FOR APPROVAL' | 'FOR CONSTRUCTION' | 'AS BUILT' };
export type DraftingDocument = {
  revisionHistory: DrawingRevisionEntry[];
  dimensionStyle?: DimensionStyle;
  standard: 'ISO' | 'BS' | 'ANSI';
  layers: DraftLayer[];
  annotations: DraftAnnotation[];
  sheet: DrawingSheet;
  sheets: DrawingSheet[];
  activeSheetIndex: number;
};
export const DEFAULT_DRAFT_LAYERS: DraftLayer[] = [
  { name: '0', color: '#202020', lineType: 'CONTINUOUS', lineWeightMm: 0.18, visible: true, locked: false, plot: true },
  { name: 'WATER_NETWORK', color: '#167b78', lineType: 'CONTINUOUS', lineWeightMm: 0.35, visible: true, locked: false, plot: true },
  { name: 'WATER_PIPE', color: '#087e83', lineType: 'CONTINUOUS', lineWeightMm: 0.35, visible: true, locked: false, plot: true },
  { name: 'WATER_FITTING', color: '#087e83', lineType: 'CONTINUOUS', lineWeightMm: 0.35, visible: true, locked: false, plot: true },
  { name: 'WATER_VALVE', color: '#a45c20', lineType: 'CONTINUOUS', lineWeightMm: 0.35, visible: true, locked: false, plot: true },
  { name: 'WATER_STRUCTURE', color: '#536b9b', lineType: 'CONTINUOUS', lineWeightMm: 0.35, visible: true, locked: false, plot: true },
  { name: 'WATER_CHAMBER', color: '#70558f', lineType: 'CONTINUOUS', lineWeightMm: 0.35, visible: true, locked: false, plot: true },
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
  if (sheet.size === 'CUSTOM') return { widthMm: sheet.widthMm ?? 297, heightMm: sheet.heightMm ?? 420 };
  const [short, long] = A_SIZES[sheet.size];
  return sheet.orientation === 'landscape' ? { widthMm: long, heightMm: short } : { widthMm: short, heightMm: long };
}
export function createDraftingDocument(partial?: Partial<DraftingDocument>): DraftingDocument {
  const fallbackSheet = { ...DEFAULT_DRAWING_SHEET, ...(partial?.sheet ?? {}) };
  const sheets = partial?.sheets?.length ? partial.sheets.map(sheet => ({ ...sheet })) : [fallbackSheet];
  const activeSheetIndex = Math.max(0, Math.min(partial?.activeSheetIndex ?? 0, sheets.length - 1));
  const sheet = { ...(sheets[activeSheetIndex] ?? fallbackSheet) };
  sheets[activeSheetIndex] = sheet;
  return {
    standard: partial?.standard ?? 'ISO',
    revisionHistory: partial?.revisionHistory?.map(item => ({...item})) ?? [],
    layers: partial?.layers?.length ? partial.layers : DEFAULT_DRAFT_LAYERS.map(layer => ({ ...layer })),
    annotations: partial?.annotations ?? [],
    sheet, sheets, activeSheetIndex,
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
    const points = item.kind === 'text' ? [item.at] : item.kind === 'leader' ? item.points : [item.a, item.b];
    if (points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) issues.push('Annotation ' + item.id + ' contains invalid coordinates.');
    if (item.kind === 'text' && (!item.text.trim() || item.heightMm <= 0)) issues.push('Text annotations require content and a positive paper text height.');
    if (item.kind === 'leader' && (item.points.length < 2 || !item.text.trim() || item.textHeightMm <= 0)) issues.push('Leaders require at least two points, text and a positive text height.');
    if ((item.kind === 'linear' || item.kind === 'aligned') && (item.a.x === item.b.x && item.a.y === item.b.y)) issues.push('A dimension cannot measure a zero-length segment.');
  }
  const sheet = sheetDimensionsMm(doc.sheet);
  if (!(sheet.widthMm > 0 && sheet.heightMm > 0) || !Number.isFinite(sheet.widthMm) || !Number.isFinite(sheet.heightMm)) issues.push('Drawing sheet dimensions must be positive finite values.');
  if (doc.sheet.size === 'CUSTOM' && (!(doc.sheet.widthMm && doc.sheet.heightMm) || doc.sheet.widthMm < 180 || doc.sheet.heightMm < 120 || doc.sheet.widthMm > 5000 || doc.sheet.heightMm > 5000)) issues.push('Custom sheet width and height must each be between 180 × 120 mm and 5000 × 5000 mm.');
  const revisionIds = new Set<string>();
  for (const revision of doc.revisionHistory) { const key = revision.revision.trim().toUpperCase(); if (!key || revisionIds.has(key)) issues.push('Revision identifiers must be unique and non-empty.'); revisionIds.add(key); if (!revision.date || !revision.description.trim()) issues.push('Each revision requires a date and change description.'); }
  if (!/^1:\\d+(?:\\.\\d+)?$/.test(doc.sheet.scale)) issues.push('Sheet scale must use a ratio such as 1:100.');
  if (!doc.sheet.drawingNumber.trim() || !doc.sheet.title.trim()) issues.push('Drawing title and drawing number are required.');
  return issues;
}
export function makeLinearDimension(id: string, a: DraftPoint, b: DraftPoint, offsetM: number, layer = 'DIMENSIONS', precision = 3): Extract<DraftAnnotation, { kind: 'linear' | 'aligned' }> {
  if (!id || !Number.isFinite(offsetM) || !Number.isInteger(precision) || precision < 0 || precision > 6) throw new Error('Invalid dimension settings.');
  if (Math.hypot(b.x - a.x, b.y - a.y) <= 1e-9) throw new Error('Cannot dimension a zero-length segment.');
  return { id, kind: 'linear', layer, a: { ...a }, b: { ...b }, offsetM, precision };
}

export function makeAlignedDimension(id: string, a: DraftPoint, b: DraftPoint, offsetM: number, layer = 'DIMENSIONS', precision = 3): Extract<DraftAnnotation, { kind: 'linear' | 'aligned' }> {
  const base = makeLinearDimension(id, a, b, offsetM, layer, precision);
  return { ...base, kind: 'aligned' };
}
