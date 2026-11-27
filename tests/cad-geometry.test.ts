import { describe, expect, it } from 'vitest';
import {
  boundsOfPoints,
  createHistory,
  objectSnapCandidates,
  panViewport,
  pixelsPerMetreAtScale,
  pushHistory,
  redoHistory,
  undoHistory,
  zoomViewportAt,
  directionAngleDegrees,
  distance,
  fromMetres,
  pointFromMetres,
  pointToMetres,
  screenToWorld,
  segmentIntersection,
  snapToGrid,
  toMetres,
  worldToScreen,
  type CadViewport,
} from '../cad-geometry';

const viewport: CadViewport = {
  worldOrigin: { x: 100, y: 200 },
  screenOrigin: { x: 400, y: 300 },
  pixelsPerMetre: 20,
};

describe('CAD metric geometry foundation', () => {
  it('converts metres and millimetres without rounding', () => {
    expect(toMetres(1250, 'mm')).toBe(1.25);
    expect(fromMetres(1.25, 'mm')).toBe(1250);
    expect(toMetres(1.25, 'm')).toBe(1.25);
  });

  it('converts coordinate pairs consistently', () => {
    expect(pointToMetres({ x: 1250, y: -500 }, 'mm')).toEqual({ x: 1.25, y: -0.5 });
    expect(pointFromMetres({ x: 1.25, y: -0.5 }, 'mm')).toEqual({ x: 1250, y: -500 });
  });

  it('maps engineering north-up coordinates to screen coordinates', () => {
    expect(worldToScreen({ x: 102, y: 203 }, viewport)).toEqual({ x: 440, y: 240 });
  });

  it('round-trips world coordinates through the viewport transform', () => {
    const world = { x: -12.345, y: 987.654 };
    const screen = worldToScreen(world, viewport);
    const restored = screenToWorld(screen, viewport);
    expect(restored.x).toBeCloseTo(world.x, 10);
    expect(restored.y).toBeCloseTo(world.y, 10);
  });

  it('snaps positive and negative coordinates to a metric interval', () => {
    expect(snapToGrid({ x: 12.4, y: -7.6 }, 5)).toEqual({ x: 10, y: -10 });
  });

  it('rejects zero, negative and non-finite grid intervals', () => {
    expect(() => snapToGrid({ x: 1, y: 2 }, 0)).toThrow(/greater than zero/);
    expect(() => snapToGrid({ x: 1, y: 2 }, -1)).toThrow(/greater than zero/);
  });

  it('calculates true plan distance in canonical metres', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it('calculates bearings as mathematical angles independent of screen Y direction', () => {
    expect(directionAngleDegrees({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(0);
    expect(directionAngleDegrees({ x: 0, y: 0 }, { x: 0, y: 1 })).toBe(90);
    expect(directionAngleDegrees({ x: 0, y: 0 }, { x: -1, y: 0 })).toBe(180);
    expect(directionAngleDegrees({ x: 0, y: 0 }, { x: 0, y: -1 })).toBe(270);
    expect(() => directionAngleDegrees({ x: 1, y: 1 }, { x: 1, y: 1 })).toThrow(/zero-length/);
  });

  it('calculates bounding extents and handles an empty drawing', () => {
    expect(boundsOfPoints([{ x: 2, y: -1 }, { x: -3, y: 4 }])).toEqual({
      minX: -3, minY: -1, maxX: 2, maxY: 4,
    });
    expect(boundsOfPoints([])).toBeNull();
  });

  it('finds finite segment intersections and ignores infinite-line-only crossings', () => {
    expect(segmentIntersection(
      { x: 0, y: 0 }, { x: 10, y: 10 },
      { x: 0, y: 10 }, { x: 10, y: 0 },
    )).toEqual({ x: 5, y: 5 });
    expect(segmentIntersection(
      { x: 0, y: 0 }, { x: 1, y: 0 },
      { x: 2, y: -1 }, { x: 2, y: 1 },
    )).toBeNull();
    expect(segmentIntersection(
      { x: 0, y: 0 }, { x: 2, y: 0 },
      { x: 1, y: 0 }, { x: 3, y: 0 },
    )).toBeNull();
  });

  it('rejects invalid viewport scales instead of producing misleading coordinates', () => {
    expect(() => worldToScreen({ x: 0, y: 0 }, { ...viewport, pixelsPerMetre: 0 })).toThrow(/greater than zero/);
  });
});


describe('CAD viewport, object snapping and edit history', () => {
  it('derives a physical viewport scale from a drawing ratio', () => {
    expect(pixelsPerMetreAtScale(100)).toBeCloseTo(37.79527559, 6);
    expect(() => pixelsPerMetreAtScale(0)).toThrow(/Scale denominator/);
  });

  it('zooms around the cursor without moving the world point beneath it', () => {
    const anchor = { x: 515, y: 275 };
    const before = screenToWorld(anchor, viewport);
    const zoomed = zoomViewportAt(viewport, anchor, 2);
    const after = screenToWorld(anchor, zoomed);
    expect(after.x).toBeCloseTo(before.x, 10);
    expect(after.y).toBeCloseTo(before.y, 10);
    expect(zoomed.pixelsPerMetre).toBe(40);
  });

  it('pans by screen-space deltas while preserving scale', () => {
    const panned = panViewport(viewport, { x: 40, y: -20 });
    expect(panned.pixelsPerMetre).toBe(viewport.pixelsPerMetre);
    expect(worldToScreen({ x: 100, y: 200 }, panned)).toEqual({ x: 360, y: 280 });
  });

  it('builds endpoint, midpoint, nearest, centre, quadrant and intersection snaps', () => {
    const candidates = objectSnapCandidates(
      { x: 4, y: 2 },
      [
        [{ x: 0, y: 0 }, { x: 10, y: 0 }],
        [{ x: 5, y: -5 }, { x: 5, y: 5 }],
      ],
      [{ center: { x: 20, y: 20 }, radius: 5 }],
    );
    const kinds = new Set(candidates.map(candidate => candidate.kind));
    ['ENDPOINT', 'MIDPOINT', 'NEAREST', 'CENTER', 'QUADRANT', 'INTERSECTION'].forEach(kind => {
      expect(kinds.has(kind as any)).toBe(true);
    });
    expect(candidates.find(candidate => candidate.kind === 'INTERSECTION')?.point).toEqual({ x: 5, y: 0 });
  });

  it('supports undo, redo and discards redo history after a new edit', () => {
    let history = createHistory(['line-1']);
    history = pushHistory(history, ['line-1', 'circle-1']);
    history = pushHistory(history, ['line-1', 'circle-1', 'pipe-1']);
    history = undoHistory(history);
    expect(history.present).toEqual(['line-1', 'circle-1']);
    history = redoHistory(history);
    expect(history.present).toEqual(['line-1', 'circle-1', 'pipe-1']);
    history = undoHistory(history);
    history = pushHistory(history, ['line-1', 'rectangle-1']);
    expect(history.future).toHaveLength(0);
    expect(undoHistory(createHistory('initial')).present).toBe('initial');
  });
});
