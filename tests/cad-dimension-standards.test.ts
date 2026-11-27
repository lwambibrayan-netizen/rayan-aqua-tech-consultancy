import { describe, expect, it } from 'vitest';
import { appendDrawingRevision, DIMENSION_STYLES, formatStyledDimension, measureDimensionRecord, validateDimensionRecords, validateDimensionStyle, type DimensionRecord } from '../cad-dimension-standards';

describe('engineering dimension standards', () => {
  it('provides ISO, BS and ANSI dimension presets with valid paper sizes', () => {
    for (const style of Object.values(DIMENSION_STYLES)) expect(validateDimensionStyle(style)).toEqual([]);
    expect(DIMENSION_STYLES.ISO.textHeightMm).toBe(2.5);
  });
  it('formats metric values with unit and tolerance conventions', () => {
    const style = { ...DIMENSION_STYLES.ISO, precision: 2, tolerance: { mode: 'symmetric' as const, upper: 0.05, lower: 0.05 } };
    expect(formatStyledDimension(12.5, style)).toBe('12.5 m ±0.05');
    expect(formatStyledDimension(0.125, { ...style, unit: 'mm', tolerance: { mode: 'none', upper: 0, lower: 0 } })).toBe('125 mm');
  });
  it('measures angular, radial, diameter and ordinate dimensions', () => {
    const base = { id: 'D', styleName: 'ISO-25', offsetM: 0 };
    expect(measureDimensionRecord({ ...base, kind: 'angular', points: [{x:0,y:0},{x:1,y:0},{x:0,y:1}] })).toBe(90);
    expect(measureDimensionRecord({ ...base, kind: 'radius', points: [{x:0,y:0},{x:3,y:4}] })).toBe(5);
    expect(measureDimensionRecord({ ...base, kind: 'diameter', points: [{x:0,y:0},{x:3,y:4}] })).toBe(10);
    expect(measureDimensionRecord({ ...base, kind: 'ordinate', ordinateAxis: 'y', points: [{x:3,y:4}] })).toBe(4);
  });
  it('validates references for baseline and chain dimensions', () => {
    const records: DimensionRecord[] = [{ id:'D1', kind:'aligned', points:[{x:0,y:0},{x:3,y:4}], styleName:'ISO-25' }, { id:'D2', kind:'baseline', baseDimensionId:'D1', points:[{x:0,y:0},{x:2,y:0}], styleName:'ISO-25' }];
    expect(validateDimensionRecords(records, [DIMENSION_STYLES.ISO])).toEqual([]);
    expect(validateDimensionRecords([{...records[1], baseDimensionId:undefined}], [DIMENSION_STYLES.ISO])).toContain('baseline dimensions must reference a base dimension.');
  });
  it('keeps revision history append-only and rejects duplicate or backdated revisions', () => {
    const first = { revision:'P01', date:'2026-11-27', description:'Initial issue', drawnBy:'A', checkedBy:'B', approvedBy:'', status:'FOR REVIEW' as const };
    const history = appendDrawingRevision([], first);
    expect(history).toHaveLength(1);
    expect(() => appendDrawingRevision(history, first)).toThrow(/unique/);
    expect(() => appendDrawingRevision(history, {...first, revision:'P02', date:'2026-11-26'})).toThrow(/before/);
  });
});
