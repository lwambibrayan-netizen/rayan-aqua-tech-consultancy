import { describe, expect, it } from 'vitest';
import { createDraftingDocument } from '../cad-drafting';
import { exportDraftingDxf, importDraftingDxf } from '../cad-dxf';

describe('structured DXF exchange', () => {
  it('writes drawing units, layer table, linework and annotations', () => {
    const doc = createDraftingDocument();
    doc.annotations.push({ id: 'T1', kind: 'text', layer: 'TEXT', at: { x: 10, y: 20 }, text: 'PIPE DN110', heightMm: 2.5, rotationDeg: 0 });
    const dxf = exportDraftingDxf([{ id: 'L1', type: 'line', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], layer: 'WATER_NETWORK' }, { id: 'PL1', type: 'polyline', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 0 }], layer: 'WATER_PIPE' }], doc, 1);
    expect(dxf).toContain('$INSUNITS');
    expect(dxf).toContain('WATER_NETWORK');
    expect(dxf).toContain('PIPE DN110');
    expect(dxf).toContain('LWPOLYLINE');
  });
  it('imports line, arc, polyline and text entities with layer names', () => {
    const source = ['0','SECTION','2','ENTITIES',
      '0','LINE','8','PIPE','10','0','20','0','11','10','21','0',
      '0','ARC','8','FITTING','10','5','20','5','40','2','50','0','51','90',
      '0','LWPOLYLINE','8','BOUNDARY','90','2','70','1','10','0','20','0','10','5','20','0',
      '0','TEXT','8','TEXT','10','2','20','3','40','0.25','1','NOTE',
      '0','DIMENSION','8','DIMENSIONS','10','0','20','2','13','0','23','0','14','10','24','0','70','1','1','<>',
      '0','ENDSEC','0','EOF'].join('\n');
    const imported = importDraftingDxf(source, 1, 100);
    expect(imported.shapes.map(s => s.type)).toEqual(['line','polyline','polyline']);
    expect(imported.shapes[1].bulges?.[0]).toBeCloseTo(Math.tan(Math.PI/8));
    expect(imported.annotations[0].kind).toBe('text');
    if (imported.annotations[0].kind === 'text') expect(imported.annotations[0].heightMm).toBeCloseTo(2.5);
    expect(imported.annotations[1].kind).toBe('aligned');
    if (imported.annotations[1].kind === 'aligned' || imported.annotations[1].kind === 'linear') expect(imported.annotations[1].offsetM).toBeCloseTo(2);
    expect(imported.layerNames).toEqual(['PIPE','FITTING','BOUNDARY','TEXT','DIMENSIONS']);
  });

  it('imports legacy POLYLINE/VERTEX sequences including bulge and closure', () => {
    const legacy = ['0','SECTION','2','ENTITIES','0','POLYLINE','8','WATER_PIPE','70','1',
      '0','VERTEX','10','0','20','0','42','0.25',
      '0','VERTEX','10','10','20','0',
      '0','VERTEX','10','10','20','10',
      '0','SEQEND','0','ENDSEC','0','EOF'].join('\n');
    const result = importDraftingDxf(legacy);
    expect(result.shapes).toHaveLength(1);
    expect(result.shapes[0].type).toBe('polyline');
    expect(result.shapes[0].layer).toBe('WATER_PIPE');
    expect(result.shapes[0].points).toHaveLength(4);
    expect(result.shapes[0].bulges?.[0]).toBe(0.25);
  });

  it('expands a scaled and rotated BLOCK INSERT into model geometry', () => {
    const source = ['0','SECTION','2','BLOCKS','0','BLOCK','8','0','2','VALVE','10','0','20','0',
      '0','CIRCLE','8','0','10','0','20','0','40','1','0','ENDBLK','0','ENDSEC',
      '0','SECTION','2','ENTITIES','0','INSERT','8','SYMBOLS','2','VALVE','10','10','20','20','41','2','42','2','50','90',
      '0','ENDSEC','0','EOF'].join('\n');
    const imported = importDraftingDxf(source);
    expect(imported.shapes).toHaveLength(1);
    expect(imported.shapes[0].type).toBe('circle');
    expect(imported.shapes[0].points[0]).toEqual({x:10,y:20});
    expect(imported.shapes[0].radius).toBe(2);
    expect(imported.shapes[0].layer).toBe('SYMBOLS');
  });
  it('converts SPLINE, ELLIPSE and polyline-boundary HATCH to editable polylines', () => {
    const source = ['0','SECTION','2','ENTITIES',
      '0','SPLINE','8','CURVES','11','0','21','0','11','5','21','8','11','10','21','0',
      '0','ELLIPSE','8','ELLIPSES','10','20','20','20','11','5','21','0','40','0.5','41','0','42','6.283185307',
      '0','HATCH','8','HATCHED','92','0','72','0','73','1','93','3','10','0','20','0','10','4','20','0','10','2','20','3',
      '0','ENDSEC','0','EOF'].join('\n');
    const imported = importDraftingDxf(source);
    expect(imported.shapes).toHaveLength(3);
    expect(imported.shapes.every(shape => shape.type === 'polyline')).toBe(true);
    expect(imported.shapes[0].points.length).toBeGreaterThan(3);
    expect(imported.shapes[1].points.length).toBeGreaterThan(16);
    expect(imported.shapes[2].points[0]).toEqual(imported.shapes[2].points[3]);
  });
});
