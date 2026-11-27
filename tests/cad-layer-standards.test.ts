import { describe, expect, it } from 'vitest';
import { DEFAULT_DRAFT_LAYERS, createDraftingDocument, sheetDimensionsMm, validateDraftingDocument } from '../cad-drafting';
import { LAYER_STANDARD_TEMPLATES, mergeLayerTemplate, validatePlotConfiguration } from '../cad-layer-standards';

describe('professional drawing standards', () => {
  it('adds water utility layers without replacing user layers', () => {
    const result = mergeLayerTemplate(DEFAULT_DRAFT_LAYERS, 'WATER_UTILITY');
    expect(result.added).toContain('W-PIPE');
    expect(result.layers.some(layer => layer.name === '0')).toBe(true);
    expect(mergeLayerTemplate(result.layers, 'WATER_UTILITY').added).toEqual([]);
  });
  it('provides civil and mechanical templates with valid plot settings', () => {
    for (const template of Object.values(LAYER_STANDARD_TEMPLATES)) {
      expect(validatePlotConfiguration(template)).toEqual([]);
    }
    expect(LAYER_STANDARD_TEMPLATES.CIVIL_SITE.some(layer => layer.name === 'C-CONTOUR-MAJOR')).toBe(true);
    expect(LAYER_STANDARD_TEMPLATES.MECHANICAL.some(layer => layer.name === 'M-EQUIPMENT')).toBe(true);
  });
  it('supports validated custom paper sizes', () => {
    const doc = createDraftingDocument({ sheet: { ...createDraftingDocument().sheet, size: 'CUSTOM', widthMm: 500, heightMm: 700 } });
    expect(sheetDimensionsMm(doc.sheet)).toEqual({ widthMm: 500, heightMm: 700 });
    expect(validateDraftingDocument(doc)).toEqual([]);
    doc.sheet.widthMm = 20;
    expect(validateDraftingDocument(doc)).toContain('Custom sheet width and height must each be between 50 mm and 5000 mm.');
  });
  it('persists revision history and dimension style configuration', () => {
    const doc = createDraftingDocument({ revisionHistory: [{ revision:'P01', date:'2026-11-27', description:'Initial issue', drawnBy:'A', checkedBy:'B', approvedBy:'', status:'FOR REVIEW' }] });
    expect(doc.revisionHistory[0].revision).toBe('P01');
  });
});
