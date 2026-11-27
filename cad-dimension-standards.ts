/** Dimension-style and drawing-revision primitives for engineering CAD.
 * Geometry is in metres; style sizes are paper millimetres.
 */
export type Vec2 = { x: number; y: number };
export type DimensionKind = 'linear' | 'aligned' | 'angular' | 'radius' | 'diameter' | 'ordinate' | 'baseline' | 'chain';
export type DimensionStyle = {
  name: string;
  textHeightMm: number;
  arrowSizeMm: number;
  extensionOffsetMm: number;
  extensionBeyondMm: number;
  textGapMm: number;
  precision: number;
  decimalSeparator: '.' | ',';
  zeroSuppress: 'none' | 'leading' | 'trailing' | 'both';
  unit: 'm' | 'mm';
  prefix: string;
  suffix: string;
  tolerance: { mode: 'none' | 'symmetric' | 'deviation'; upper: number; lower: number };
};
export type DimensionRecord = {
  id: string;
  kind: DimensionKind;
  points: Vec2[];
  offsetM?: number;
  baseDimensionId?: string;
  ordinateAxis?: 'x' | 'y';
  textOverride?: string;
  styleName: string;
};
export type DrawingRevision = {
  revision: string;
  date: string;
  description: string;
  drawnBy: string;
  checkedBy: string;
  approvedBy: string;
  status: 'PRELIMINARY' | 'FOR REVIEW' | 'FOR APPROVAL' | 'FOR CONSTRUCTION' | 'AS BUILT';
};
export const DIMENSION_STYLES: Record<'ISO' | 'BS' | 'ANSI', DimensionStyle> = {
  ISO: { name: 'ISO-25', textHeightMm: 2.5, arrowSizeMm: 2.5, extensionOffsetMm: 1, extensionBeyondMm: 1.5, textGapMm: 1, precision: 2, decimalSeparator: '.', zeroSuppress: 'trailing', unit: 'm', prefix: '', suffix: '', tolerance: { mode: 'none', upper: 0, lower: 0 } },
  BS: { name: 'BS-ENG', textHeightMm: 2.5, arrowSizeMm: 2.5, extensionOffsetMm: 1, extensionBeyondMm: 1.5, textGapMm: 1, precision: 2, decimalSeparator: '.', zeroSuppress: 'trailing', unit: 'm', prefix: '', suffix: '', tolerance: { mode: 'none', upper: 0, lower: 0 } },
  ANSI: { name: 'ANSI-25', textHeightMm: 2.5, arrowSizeMm: 2.5, extensionOffsetMm: 0.8, extensionBeyondMm: 1.6, textGapMm: 1, precision: 2, decimalSeparator: '.', zeroSuppress: 'none', unit: 'mm', prefix: '', suffix: '', tolerance: { mode: 'none', upper: 0, lower: 0 } },
};
const finitePoint = (p: Vec2) => Number.isFinite(p.x) && Number.isFinite(p.y);
export function validateDimensionStyle(style: DimensionStyle): string[] {
  const issues: string[] = [];
  for (const key of ['textHeightMm','arrowSizeMm','extensionBeyondMm'] as const) if (!Number.isFinite(style[key]) || style[key] <= 0) issues.push(key + ' must be positive.');
  for (const key of ['extensionOffsetMm','textGapMm'] as const) if (!Number.isFinite(style[key]) || style[key] < 0) issues.push(key + ' cannot be negative.');
  if (!Number.isInteger(style.precision) || style.precision < 0 || style.precision > 6) issues.push('Precision must be an integer from 0 to 6.');
  if (![style.tolerance.upper, style.tolerance.lower].every(Number.isFinite) || style.tolerance.upper < 0 || style.tolerance.lower < 0) issues.push('Tolerance values must be finite and non-negative.');
  if (style.tolerance.mode === 'symmetric' && style.tolerance.upper !== style.tolerance.lower) issues.push('Symmetric tolerance requires equal upper and lower values.');
  return issues;
}
export function formatStyledDimension(valueM: number, style: DimensionStyle): string {
  if (!Number.isFinite(valueM)) throw new Error('Dimension value must be finite.');
  const factor = style.unit === 'mm' ? 1000 : 1;
  let raw = Math.abs(valueM * factor).toFixed(style.precision);
  if (style.zeroSuppress === 'trailing' || style.zeroSuppress === 'both') raw = raw.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  if (style.zeroSuppress === 'leading' || style.zeroSuppress === 'both') raw = raw.replace(/^0(?=\.)/, '');
  if (style.decimalSeparator === ',') raw = raw.replace('.', ',');
  const sign = valueM < 0 ? '-' : '';
  const base = style.prefix + sign + raw + (style.unit === 'mm' ? ' mm' : ' m') + style.suffix;
  if (style.tolerance.mode === 'none') return base;
  const upper = style.tolerance.upper.toFixed(style.precision);
  const lower = style.tolerance.lower.toFixed(style.precision);
  return style.tolerance.mode === 'symmetric' ? base + ' ±' + upper : base + ' +' + upper + '/-' + lower;
}
export function measureDimensionRecord(dimension: DimensionRecord): number {
  const p = dimension.points;
  if (p.some(point => !finitePoint(point))) throw new Error('Dimension coordinates must be finite.');
  if (dimension.kind === 'radius' || dimension.kind === 'diameter') {
    if (p.length < 2) throw new Error('Radius and diameter dimensions require a centre and a point on the circle.');
    const radius = Math.hypot(p[1].x-p[0].x,p[1].y-p[0].y);
    return dimension.kind === 'diameter' ? radius*2 : radius;
  }
  if (dimension.kind === 'ordinate') {
    if (!p.length) throw new Error('Ordinate dimensions require a measured point.');
    return dimension.ordinateAxis === 'y' ? p[0].y : p[0].x;
  }
  if (dimension.kind === 'angular') {
    if (p.length < 3) throw new Error('Angular dimensions require vertex and two arm points.');
    const a=Math.atan2(p[1].y-p[0].y,p[1].x-p[0].x), b=Math.atan2(p[2].y-p[0].y,p[2].x-p[0].x);
    let angle=Math.abs((b-a)*180/Math.PI)%360;
    if(angle>180) angle=360-angle;
    return angle;
  }
  if (p.length < 2) throw new Error('Linear dimensions require two points.');
  if (dimension.kind === 'linear') return Math.abs(p[1].x-p[0].x);
  return Math.hypot(p[1].x-p[0].x,p[1].y-p[0].y);
}
export function validateDimensionRecords(records: DimensionRecord[], styles: DimensionStyle[]): string[] {
  const issues: string[] = [], ids = new Set<string>(), styleNames = new Set(styles.map(s=>s.name));
  for (const d of records) {
    if (!d.id || ids.has(d.id)) issues.push('Dimension IDs must be unique and non-empty.');
    ids.add(d.id);
    if (!styleNames.has(d.styleName)) issues.push('Dimension ' + d.id + ' references a missing style.');
    try { measureDimensionRecord(d); } catch (error) { issues.push(d.id + ': ' + (error instanceof Error ? error.message : 'Invalid geometry.')); }
    if ((d.kind === 'baseline' || d.kind === 'chain') && !d.baseDimensionId) issues.push(d.kind + ' dimensions must reference a base dimension.');
  }
  return issues;
}
export function appendDrawingRevision(history: DrawingRevision[], revision: DrawingRevision): DrawingRevision[] {
  if (!revision.revision.trim() || !revision.date.trim() || !revision.description.trim()) throw new Error('Revision, date and change description are required.');
  if (history.some(item => item.revision.toUpperCase() === revision.revision.toUpperCase())) throw new Error('Revision identifiers must be unique.');
  if (history.length && revision.date < history[history.length-1].date) throw new Error('A new revision cannot be dated before the latest recorded revision.');
  return [...history.map(item => ({...item})), {...revision}];
}
