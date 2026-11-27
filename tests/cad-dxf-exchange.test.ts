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
    expect(imported.annotations[0].heightMm).toBeCloseTo(2.5);
    expect(imported.annotations[1].kind).toBe('aligned');
    expect(imported.annotations[1].offsetM).toBeCloseTo(2);
    expect(imported.layerNames).toEqual(['PIPE','FITTING','BOUNDARY','TEXT','DIMENSIONS']);
  });
});
