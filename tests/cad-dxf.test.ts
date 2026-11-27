import { describe, expect, it } from 'vitest';
import { exportDxf, importDxf } from '../Cad3DEnginePanel';
import { filletPolylineCorner, type CadEditableEntity } from '../cad-editing';

describe('DXF circular polyline arc exchange', () => {
  it('round-trips exact circular fillet bulges through LWPOLYLINE group code 42', () => {
    const source:CadEditableEntity={id:'p',type:'polyline',points:[{x:0,y:0},{x:10,y:0},{x:10,y:10}],layer:'WATER'};
    const fillet=filletPolylineCorner(source,1,2);
    const dxf=exportDxf([fillet as any]);
    expect(dxf).toContain('\n42\n');
    const imported=importDxf(dxf)[0];
    expect(imported.type).toBe('polyline');
    expect(imported.points).toEqual(fillet.points);
    expect(imported.bulges?.[1]).toBeCloseTo(fillet.bulges?.[1]||0,10);
  });
});
