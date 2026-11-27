import { describe, expect, it } from 'vitest';
import { createDraftingDocument, formatDimension, makeLinearDimension, measureDimension, sheetDimensionsMm, validateDraftingDocument } from '../cad-drafting';

describe('professional drafting model', () => {
  it('creates ISO layers and A3 landscape sheet defaults', () => {
    const doc = createDraftingDocument();
    expect(doc.standard).toBe('ISO');
    expect(doc.layers.some(layer => layer.name === 'DIMENSIONS')).toBe(true);
    expect(sheetDimensionsMm(doc.sheet)).toEqual({ widthMm: 420, heightMm: 297 });
  });
  it('measures aligned and linear dimensions in model metres and formats paper units', () => {
    const dim = makeLinearDimension('D1', { x: 0, y: 0 }, { x: 3, y: 4 }, 1);
    expect(measureDimension(dim)).toBe(3);
    expect(formatDimension(3.1254, 2, 'm')).toBe('3.13 m');
    expect(formatDimension(3.1254, 0, 'mm')).toBe('3125 mm');
  });
  it('rejects zero-length dimensions and invalid layer/sheet settings', () => {
    expect(() => makeLinearDimension('D0', { x: 1, y: 1 }, { x: 1, y: 1 }, 0)).toThrow();
    const doc = createDraftingDocument();
    doc.layers.push({ ...doc.layers[0] });
    doc.sheet.scale = 'not-a-scale';
    expect(validateDraftingDocument(doc).some(issue => issue.includes('Duplicate layer'))).toBe(true);
    expect(validateDraftingDocument(doc).some(issue => issue.includes('scale'))).toBe(true);
  });
});
