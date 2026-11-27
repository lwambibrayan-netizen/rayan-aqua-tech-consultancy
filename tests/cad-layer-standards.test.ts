import { describe, expect, it } from 'vitest';
import { DEFAULT_DRAFT_LAYERS, createDraftingDocument, sheetDimensionsMm, validateDraftingDocument } from '../cad-drafting';
import { LAYER_STANDARD_TEMPLATES, mergeLayerTemplate, synchronizeLayerTemplate, validateLayerStandard, validatePlotConfiguration } from '../cad-layer-standards';

describe('professional drawing standards', () => {
  it('defaults model-space drafting and annotation layers to white and migrates legacy default ink', () => {
    for (const name of ['0','DIMENSIONS','TEXT','BOUNDARY','ANNOTATION']) {
      expect(DEFAULT_DRAFT_LAYERS.find(layer=>layer.name===name)?.color).toBe('#ffffff');
    }
    const legacy=DEFAULT_DRAFT_LAYERS.map(layer=>['0','DIMENSIONS','TEXT','BOUNDARY','ANNOTATION'].includes(layer.name)?{...layer,color:'#202020'}:layer);
    const migrated=createDraftingDocument({layers:legacy});
    for (const name of ['0','DIMENSIONS','TEXT','BOUNDARY','ANNOTATION']) {
      expect(migrated.layers.find(layer=>layer.name===name)?.color).toBe('#ffffff');
    }
  });

  it('adds water utility layers without replacing user layers', () => {
    const result = mergeLayerTemplate(DEFAULT_DRAFT_LAYERS, 'WATER_UTILITY');
    expect(result.layers.some(layer => layer.name === 'WATER_PIPE')).toBe(true);
    expect(result.layers.some(layer => layer.name === '0')).toBe(true);
    expect(mergeLayerTemplate(result.layers, 'WATER_UTILITY').added).toEqual([]);
  });
  it('synchronizes standard-controlled layer properties without changing user visibility or locks', () => {
    const initial = [{ ...LAYER_STANDARD_TEMPLATES.WATER_UTILITY[0], color: '#ffffff', lineWeightMm: 0.9, visible: false, locked: true, plot: false }];
    const result = synchronizeLayerTemplate(initial, 'WATER_UTILITY');
    const pipe = result.layers.find(layer => layer.name === 'WATER_PIPE')!;
    expect(pipe.color).toBe(LAYER_STANDARD_TEMPLATES.WATER_UTILITY[0].color);
    expect(pipe.lineWeightMm).toBe(0.35);
    expect(pipe.visible).toBe(false);
    expect(pipe.locked).toBe(true);
    expect(pipe.plot).toBe(false);
    expect(result.updated).toContain('WATER_PIPE');
    expect(validateLayerStandard(result.layers, 'WATER_UTILITY')).toEqual([]);
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
    expect(validateDraftingDocument(doc)).toContain('Custom sheet width and height must each be between 180 × 120 mm and 5000 × 5000 mm.');
  });
  it('persists revision history and dimension style configuration', () => {
    const doc = createDraftingDocument({ revisionHistory: [{ revision:'P01', date:'2026-11-27', description:'Initial issue', drawnBy:'A', checkedBy:'B', approvedBy:'', status:'FOR REVIEW' }] });
    expect(doc.revisionHistory[0].revision).toBe('P01');
    const styled = createDraftingDocument({ dimensionStyle: { name:'ISO-25', textHeightMm:2.5, arrowSizeMm:2.5, extensionOffsetMm:1, extensionBeyondMm:1.5, textGapMm:1, precision:2, decimalSeparator:'.', zeroSuppress:'trailing', unit:'m', prefix:'', suffix:'', tolerance:{mode:'none',upper:0,lower:0} } });
    expect(styled.dimensionStyle?.name).toBe('ISO-25');
  });
});
