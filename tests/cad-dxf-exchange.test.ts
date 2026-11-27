import { describe, expect, it } from 'vitest';
import { createDraftingDocument } from '../cad-drafting';
import { exportDraftingDxf, importDraftingDxf } from '../cad-dxf';
import { getEngineeringBlock, instantiateEngineeringBlock } from '../cad-object-library';

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
  it('round-trips parametric water library symbols as editable DXF primitives and layers', () => {
    const block = getEngineeringBlock('GATE_VALVE');
    const primitives = instantiateEngineeringBlock({ blockName: block.name, at: { x: 5000, y: 7000 }, rotationDeg: 30, scaleX: 1, scaleY: 1, layer: 'WATER_VALVE', properties: { ...block.defaultProperties } });
    const shapes = primitives.map((primitive, index) => {
      if (primitive.kind === 'line') return { id: 'B' + index, type: 'line' as const, points: [primitive.a, primitive.b], layer: primitive.layer };
      if (primitive.kind === 'circle') return { id: 'B' + index, type: 'circle' as const, points: [primitive.center], radius: primitive.radius, layer: primitive.layer };
      return { id: 'B' + index, type: 'polyline' as const, points: primitive.points, layer: primitive.layer };
    });
    const dxf = exportDraftingDxf(shapes, createDraftingDocument(), 1);
    const imported = importDraftingDxf(dxf, 1, 100);
    expect(imported.shapes).toHaveLength(shapes.length);
    expect(imported.layerNames).toContain('WATER_VALVE');
    expect(imported.shapes.some(shape => shape.type === 'circle')).toBe(true);
    expect(imported.shapes.some(shape => shape.type === 'line')).toBe(true);
    expect(imported.shapes.some(shape => shape.type === 'polyline')).toBe(true);
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
      '0','CIRCLE','8','0','10','0','20','0','40','1',
      '0','LINE','8','0','10','0','20','0','11','2','21','0','0','ENDBLK','0','ENDSEC',
      '0','SECTION','2','ENTITIES','0','INSERT','8','SYMBOLS','2','VALVE','10','10','20','20','41','2','42','2','50','90',
      '0','ENDSEC','0','EOF'].join('\n');
    const imported = importDraftingDxf(source);
    expect(imported.shapes).toHaveLength(2);
    const circle = imported.shapes.find(shape => shape.type === 'circle')!;
    const line = imported.shapes.find(shape => shape.type === 'line')!;
    expect(circle.points[0]).toEqual({x:10,y:20});
    expect(circle.radius).toBe(2);
    expect(line.points).toEqual([{x:10,y:20},{x:10,y:24}]);
    expect(circle.layer).toBe('SYMBOLS');
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

  it('imports SOLID and 3DFACE boundaries as editable closed polylines', () => {
    const source = ['0','SECTION','2','ENTITIES',
      '0','SOLID','8','SYMBOL','10','0','20','0','11','4','21','0','12','0','22','3','13','4','23','3',
      '0','3DFACE','8','SURFACE','10','10','20','10','11','14','21','10','12','14','22','14','13','10','23','14',
      '0','ENDSEC','0','EOF'].join('\n');
    const imported = importDraftingDxf(source);
    expect(imported.shapes).toHaveLength(2);
    expect(imported.shapes[0].points[0]).toEqual(imported.shapes[0].points[4]);
    expect(imported.shapes[1].points[0]).toEqual(imported.shapes[1].points[4]);
  });

  it('exports referenced DXF linetype table records for every supported layer style', () => {
    const doc = createDraftingDocument();
    doc.layers = doc.layers.map((layer,index) => ({ ...layer, lineType: (['CONTINUOUS','DASHED','CENTER','HIDDEN','PHANTOM'] as const)[index % 5] }));
    const dxf = exportDraftingDxf([], doc, 1);
    expect(dxf).toContain('2\nLTYPE');
    for (const name of ['CONTINUOUS','DASHED','CENTER','HIDDEN','PHANTOM']) {
      expect(dxf).toContain('2\n' + name);
    }
    expect(dxf).toContain('2\nLAYER');
    expect(dxf).toContain('6\nDASHED');
    expect(dxf).toContain('6\nCENTER');
    expect(dxf).toContain('6\nHIDDEN');
    expect(dxf).toContain('6\nPHANTOM');
  });

  it('round-trips DXF layer colour, linetype, lineweight, visibility, lock and plot state', () => {
    const doc = createDraftingDocument({ layers: [{ name:'WATER_PIPE', color:'#087e83', lineType:'DASHED', lineWeightMm:0.35, visible:false, locked:true, plot:false }] });
    const shape = { id:'P1', type:'line' as const, points:[{x:0,y:0},{x:10,y:0}], layer:'WATER_PIPE' };
    const imported = importDraftingDxf(exportDraftingDxf([shape],doc,1));
    expect(imported.layers).toContainEqual({ name:'WATER_PIPE', color:'#087e83', lineType:'DASHED', lineWeightMm:0.35, visible:false, locked:true, plot:false });
  });


  it('round-trips metric model geometry through millimetre DXF units without scale drift', () => {
    const doc = createDraftingDocument();
    const shapes = [
      { id:'MM-LINE', type:'line' as const, points:[{x:0,y:0},{x:2500,y:1250}], layer:'WATER_PIPE' },
      { id:'MM-CIRCLE', type:'circle' as const, points:[{x:1000,y:2000}], radius:125, layer:'VALVES' },
      { id:'MM-PLINE', type:'polyline' as const, points:[{x:0,y:0},{x:1000, y:0},{x:1000,y:1000}], layer:'NETWORK' },
    ];
    const dxf = exportDraftingDxf(shapes, doc, 0.001);
    expect(dxf).toContain('$INSUNITS\n70\n4');
    expect(dxf).toContain('11\n2500');
    expect(dxf).toContain('40\n125');
    const imported = importDraftingDxf(dxf);
    expect(imported.shapes.find(shape=>shape.id==='DXF-1')?.points[1].x).toBeCloseTo(2500);
    expect(imported.shapes.find(shape=>shape.type==='circle')?.radius).toBeCloseTo(125);
    expect(imported.shapes.find(shape=>shape.type==='polyline')?.points[2].y).toBeCloseTo(1000);
  });


  it('preserves closed polyline topology in an export/import round trip', () => {
    const closed = { id:'CLOSED', type:'polyline' as const, points:[{x:0,y:0},{x:4,y:0},{x:2,y:3},{x:0,y:0}], layer:'CHAMBERS' };
    const dxf = exportDraftingDxf([closed], createDraftingDocument(), 1);
    expect(dxf).toContain('70\n1');
    const imported = importDraftingDxf(dxf);
    expect(imported.shapes[0].points[0]).toEqual(imported.shapes[0].points.at(-1));
  });

  it('reads standard external DXF INSUNITS metadata when no project calibration override is supplied', () => {
    const externalDrawing = ['0','SECTION','2','HEADER','9','$ACADVER','1','AC1018','9','$INSUNITS','70','4','0','ENDSEC',
      '0','SECTION','2','ENTITIES','0','LINE','8','WATER_PIPE','10','0','20','0','11','1500','21','2500',
      '0','CIRCLE','8','VALVES','10','1500','20','2500','40','100',
      '0','TEXT','8','LABELS','10','1500','20','2500','40','100','1','Valve chamber label','0','ENDSEC','0','EOF'].join('\n');
    const imported = importDraftingDxf(externalDrawing);
    expect(imported.shapes[0].points[1]).toEqual({x:1500,y:2500});
    expect(imported.shapes[1].points[0]).toEqual({x:1500,y:2500});
    expect(imported.shapes[1].radius).toBeCloseTo(100);
    expect(imported.metresPerDrawingUnit).toBeCloseTo(0.001);
    const importedLabel = imported.annotations[0];
    expect(importedLabel.kind).toBe('text');
    if(importedLabel.kind==='text'){
      expect(importedLabel.at).toEqual({x:1.5,y:2.5});
      expect(importedLabel.text).toBe('Valve chamber label');
    }
  });


  it('emits R2000 handles and subclass markers required by independent DXF readers', () => {
    const dxf = exportDraftingDxf([
      {id:'L1',type:'line',points:[{x:0,y:0},{x:10,y:5}],layer:'WATER_PIPE'},
      {id:'P1',type:'polyline',points:[{x:0,y:0},{x:5,y:0},{x:0,y:0}],layer:'WATER_PIPE'},
    ], createDraftingDocument(), 0.001);
    expect(dxf).toContain('$ACADVER\n1\nAC1015');
    expect(dxf).toContain('$HANDSEED\n5\n10000');
    expect(dxf).toContain('0\nLAYER\n5\n15');
    expect(dxf).toContain('100\nAcDbSymbolTableRecord\n100\nAcDbLayerTableRecord');
    expect(dxf).toContain('100\nAcDbEntity\n8\nWATER_PIPE\n100\nAcDbLine');
    expect(dxf).toContain('100\nAcDbEntity\n8\nWATER_PIPE\n100\nAcDbPolyline');
  });

  it('warns when explicit project calibration conflicts with external DXF INSUNITS', () => {
    const source = ['0','SECTION','2','HEADER','9','$INSUNITS','70','4','0','ENDSEC',
      '0','SECTION','2','ENTITIES','0','LINE','8','0','10','0','20','0','11','1000','21','0','0','ENDSEC','0','EOF'].join('\n');
    const imported = importDraftingDxf(source, 1);
    expect(imported.shapes[0].points[1].x).toBe(1000);
    expect(imported.warnings.some(warning=>warning.includes('conflicts with the active project calibration'))).toBe(true);
  });

  it('exports paper-scaled dimension text and arrow linework from the selected dimension style', () => {
    const doc = createDraftingDocument();
    doc.dimensionStyle = { name:'TEST', textHeightMm:3, arrowSizeMm:2, extensionOffsetMm:1, extensionBeyondMm:1.5, textGapMm:1, precision:2, decimalSeparator:'.', zeroSuppress:'trailing', unit:'m', prefix:'', suffix:'', tolerance:{mode:'none',upper:0,lower:0} };
    doc.annotations.push({ id:'D1', kind:'aligned', layer:'DIMENSIONS', a:{x:0,y:0}, b:{x:3,y:4}, offsetM:1, precision:2, textOverride:'5.00 m' });
    const dxf = exportDraftingDxf([], doc, 1);
    expect(dxf).toContain('5.00 m');
    expect(dxf).toContain('40\n0.3');
    expect((dxf.match(/\nLINE\n/g) || []).length).toBeGreaterThanOrEqual(7);
  });
});
