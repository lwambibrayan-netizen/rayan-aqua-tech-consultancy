import { describe, expect, it } from 'vitest';
import {
  chamferPolylineCorner, copyEntities, extendLine, filletPolylineCorner,
  mirrorEntities, moveEntities, offsetLine, offsetPolyline, rectangularArray, rotateEntities,
  stretchEntities, trimLine, selectEntitiesInWindow, type CadEditableEntity,
} from '../cad-editing';

const line: CadEditableEntity = { id: 'l1', type: 'line', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], layer: 'WATER' };

describe('CAD editing geometry operations', () => {
  it('moves and copies entities without mutating originals', () => {
    expect(moveEntities([line], { x: 2, y: 3 })[0].points).toEqual([{ x: 2, y: 3 }, { x: 12, y: 3 }]);
    const copied = copyEntities([line], { x: 0, y: 5 }, () => 'copy-1');
    expect(copied[0].id).toBe('copy-1');
    expect(copied[0].points).toEqual([{ x: 0, y: 5 }, { x: 10, y: 5 }]);
    expect(line.points[0]).toEqual({ x: 0, y: 0 });
  });
  it('rotates around a pivot and mirrors about an arbitrary axis', () => {
    const rotated = rotateEntities([line], { x: 0, y: 0 }, 90);
    expect(rotated[0].points[1].x).toBeCloseTo(0);
    expect(rotated[0].points[1].y).toBeCloseTo(10);
    const mirrored = mirrorEntities([line], { x: 0, y: 0 }, { x: 0, y: 1 });
    expect(mirrored[0].points).toEqual([{ x: 0, y: 0 }, { x: -10, y: 0 }]);
  });
  it('rotates and mirrors rectangles as closed true four-corner polylines', () => {
    const rect: CadEditableEntity = { id: 'r', type: 'rect', points: [{ x: 0, y: 0 }, { x: 4, y: 2 }], layer: 'CIVIL' };
    const rotated = rotateEntities([rect], { x: 0, y: 0 }, 90)[0];
    expect(rotated.type).toBe('polyline');
    expect(rotated.points).toHaveLength(5);
    expect(rotated.points[0]).toEqual({ x: 0, y: 0 });
    expect(rotated.points[1].x).toBeCloseTo(0);
    expect(rotated.points[1].y).toBeCloseTo(4);
    expect(rotated.points[4]).toEqual(rotated.points[0]);
    const mirrored = mirrorEntities([rect], { x: 0, y: 0 }, { x: 0, y: 1 })[0];
    expect(mirrored.type).toBe('polyline');
    expect(mirrored.points[0].x).toBe(0);
    expect(mirrored.points[1].x).toBe(-4);
    expect(mirrored.points[4]).toEqual(mirrored.points[0]);
  });
  it('stretches only vertices inside the crossing window', () => {
    const poly: CadEditableEntity = { id: 'p', type: 'polyline', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 10 }], layer: 'WATER' };
    const result = stretchEntities([poly], { minX: 4, minY: 4, maxX: 6, maxY: 6 }, { x: 2, y: 0 });
    expect(result[0].points).toEqual([{ x: 0, y: 0 }, { x: 7, y: 5 }, { x: 10, y: 10 }]);
  });
  it('creates a rectangular array with predictable row and column spacing', () => {
    const result = rectangularArray([line], 2, 3, 20, 15, (() => { let n = 0; return () => 'array-' + ++n; })());
    expect(result).toHaveLength(5);
    expect(result[0].points[0]).toEqual({ x: 15, y: 0 });
    expect(result[2].points[0]).toEqual({ x: 0, y: 20 });
  });
  it('trims and extends line endpoints to cutting/boundary edges', () => {
    const cutter: CadEditableEntity = { id: 'c', type: 'line', points: [{ x: 5, y: -5 }, { x: 5, y: 5 }], layer: '0' };
    expect(trimLine(line, cutter, { x: 1, y: 0 }).points[0]).toEqual({ x: 5, y: 0 });
    const shortLine: CadEditableEntity = { ...line, points: [{ x: 0, y: 0 }, { x: 3, y: 0 }] };
    expect(extendLine(shortLine, cutter, 1).points[1]).toEqual({ x: 5, y: 0 });
    expect(() => extendLine(line, cutter, 1)).toThrow(/not beyond/);
    const finiteCutter: CadEditableEntity = { ...cutter, points: [{ x: 5, y: 4 }, { x: 5, y: 5 }] };
    expect(() => trimLine(line, finiteCutter, { x: 1, y: 0 })).toThrow(/finite cutting edge/);
  });
  it('offsets a line by a true perpendicular distance', () => {
    expect(offsetLine(line, 2).points).toEqual([{ x: 0, y: 2 }, { x: 10, y: 2 }]);
  });

  it('offsets open polylines with perpendicular segments and safe joins', () => {
    const poly:CadEditableEntity={id:'offset-me',type:'polyline',points:[{x:0,y:0},{x:10,y:0},{x:10,y:10}],layer:'WATER'};
    const result=offsetPolyline(poly,2);
    expect(result.points[0]).toEqual({x:0,y:2});
    expect(result.points[1].x).toBeCloseTo(8);
    expect(result.points[1].y).toBeCloseTo(2);
    expect(result.points[2]).toEqual({x:8,y:10});
    expect(result.id).not.toBe(poly.id);
    expect(()=>offsetPolyline({...poly,points:[{x:0,y:0},{x:0,y:0},{x:2,y:2}]},2)).toThrow(/zero-length/);
  });
  it('chamfers and fillets an internal polyline corner', () => {
    const poly: CadEditableEntity = { id: 'p', type: 'polyline', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], layer: 'WATER' };
    const chamfered = chamferPolylineCorner(poly, 1, 2);
    expect(chamfered.points).toEqual([{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 10, y: 2 }, { x: 10, y: 10 }]);
    const filleted = filletPolylineCorner(poly, 1, 2, 8);
    expect(filleted.points).toHaveLength(4);
    expect(filleted.points[1]).toEqual({x:8,y:0});
    expect(filleted.points[2]).toEqual({x:10,y:2});
    expect(filleted.bulges?.[1]).toBeCloseTo(Math.tan(Math.PI/8));
  });
  it('supports both trim endpoints and extension directions', () => {
    const cutter: CadEditableEntity = { id: 'c', type: 'line', points: [{ x: 5, y: -5 }, { x: 5, y: 5 }], layer: '0' };
    const trimmedEnd = trimLine(line, cutter, { x: 9, y: 0 });
    expect(trimmedEnd.points[1]).toEqual({ x: 5, y: 0 });
    const reversed: CadEditableEntity = { ...line, points: [{ x: 7, y: 0 }, { x: 10, y: 0 }] };
    const extendedStart = extendLine(reversed, cutter, 0);
    expect(extendedStart.points[0]).toEqual({ x: 5, y: 0 });
  });
  it('keeps fillet tangent points at the requested radius and rejects oversized corners', () => {
    const poly: CadEditableEntity = { id: 'p', type: 'polyline', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], layer: 'WATER' };
    const result = filletPolylineCorner(poly, 1, 2, 16);
    const start = result.points[1], end = result.points[2];
    expect(start).toEqual({x:8,y:0});
    expect(end).toEqual({x:10,y:2});
    expect(result.points).toHaveLength(4);
    expect(result.bulges?.[1]).toBeCloseTo(Math.tan(Math.PI/8));
    expect(() => filletPolylineCorner(poly, 1, 11)).toThrow(/too large/);
  });

  it('selects crossing geometry by exact segment/window intersection, not bounding boxes', () => {
    const cross:CadEditableEntity={id:'cross',type:'line',points:[{x:-5,y:5},{x:15,y:5}],layer:'0'};
    const falseHit:CadEditableEntity={id:'false',type:'line',points:[{x:-5,y:-5},{x:-1,y:-1}],layer:'0'};
    const inside:CadEditableEntity={id:'inside',type:'line',points:[{x:2,y:2},{x:8,y:8}],layer:'0'};
    const circle:CadEditableEntity={id:'circle',type:'circle',points:[{x:11,y:5}],radius:2,layer:'0'};
    const w={minX:0,minY:0,maxX:10,maxY:10};
    expect(selectEntitiesInWindow([cross,falseHit,inside,circle],w,true).map(x=>x.id)).toEqual(['cross','inside','circle']);
    expect(selectEntitiesInWindow([cross,falseHit,inside,circle],w,false).map(x=>x.id)).toEqual(['inside']);
  });

  it('mirrors arc bulges and retains exact circular fillet geometry', () => {
    const poly:CadEditableEntity={id:'p',type:'polyline',points:[{x:0,y:0},{x:10,y:0},{x:10,y:10}],layer:'WATER'};
    const fillet=filletPolylineCorner(poly,1,2);
    const bulge=fillet.bulges?.[1]||0;
    expect(bulge).not.toBe(0);
    expect(mirrorEntities([fillet],{x:0,y:0},{x:0,y:1})[0].bulges?.[1]).toBeCloseTo(-bulge);
    expect(()=>offsetPolyline(fillet,2)).toThrow(/curved polylines/);
  });
  it('creates unique IDs for every generated array entity', () => {
    let n = 0;
    const result = rectangularArray([line], 2, 2, 5, 5, () => 'generated-' + ++n);
    expect(new Set(result.map(item => item.id)).size).toBe(result.length);
  });
  it('rejects degenerate geometry and invalid array dimensions', () => {
    expect(() => mirrorEntities([line], { x: 1, y: 1 }, { x: 1, y: 1 })).toThrow(/non-zero/);
    expect(() => rectangularArray([line], 0, 2, 1, 1)).toThrow(/positive integers/);
    expect(() => offsetLine({ ...line, points: [{ x: 0, y: 0 }, { x: 0, y: 0 }] }, 2)).toThrow(/zero-length/);
    expect(() => stretchEntities([line], { minX: -Infinity, minY: -Infinity, maxX: Infinity, maxY: Infinity }, { x: 1, y: 0 })).toThrow(/finite/);
  });
});
