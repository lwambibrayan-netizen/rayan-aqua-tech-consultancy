import { describe, expect, it } from 'vitest';
import {
  chamferPolylineCorner, copyEntities, extendLine, filletPolylineCorner,
  mirrorEntities, moveEntities, offsetLine, rectangularArray, rotateEntities,
  stretchEntities, trimLine, type CadEditableEntity,
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
  it('chamfers and fillets an internal polyline corner', () => {
    const poly: CadEditableEntity = { id: 'p', type: 'polyline', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], layer: 'WATER' };
    const chamfered = chamferPolylineCorner(poly, 1, 2);
    expect(chamfered.points).toEqual([{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 10, y: 2 }, { x: 10, y: 10 }]);
    const filleted = filletPolylineCorner(poly, 1, 2, 8);
    expect(filleted.points).toHaveLength(11);
    expect(filleted.points[1].x).toBeCloseTo(8);
    expect(filleted.points[filleted.points.length - 2].y).toBeCloseTo(2);
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
    const start = result.points[1], end = result.points[result.points.length - 2];
    expect(start.x).toBeCloseTo(8);
    expect(start.y).toBeCloseTo(0);
    expect(end.x).toBeCloseTo(10);
    expect(end.y).toBeCloseTo(2);
    expect(result.points).toHaveLength(19);
    expect(() => filletPolylineCorner(poly, 1, 11)).toThrow(/too large/);
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
