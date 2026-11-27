/**
 * RayanAqua CAD geometry kernel.
 *
 * Engineering coordinates are stored in metres in a right-handed 2D world
 * (X east/right, Y north/up). Screen coordinates are a separate presentation
 * space and must never be persisted as engineering coordinates.
 */
export type CadUnit = 'm' | 'mm';

export type Point2D = { x: number; y: number };

export type CadViewport = {
  /** World coordinate at the screen origin, in metres. */
  worldOrigin: Point2D;
  /** Screen coordinate of the viewport origin, in CSS pixels. */
  screenOrigin: Point2D;
  /** Display scale in CSS pixels per metre. Must be finite and > 0. */
  pixelsPerMetre: number;
};

export type CadBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export const CAD_DOCUMENT_SCHEMA_VERSION = 1;
export const CAD_INTERNAL_LENGTH_UNIT = 'm' as const;

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`${label} must be a finite number.`);
}

function assertViewport(viewport: CadViewport): void {
  assertFinite(viewport.worldOrigin.x, 'World origin X');
  assertFinite(viewport.worldOrigin.y, 'World origin Y');
  assertFinite(viewport.screenOrigin.x, 'Screen origin X');
  assertFinite(viewport.screenOrigin.y, 'Screen origin Y');
  if (!Number.isFinite(viewport.pixelsPerMetre) || viewport.pixelsPerMetre <= 0) {
    throw new Error('Viewport pixelsPerMetre must be a finite number greater than zero.');
  }
}

/** Convert a length to the CAD kernel's canonical metre unit. */
export function toMetres(value: number, unit: CadUnit): number {
  assertFinite(value, 'Length');
  if (unit === 'm') return value;
  if (unit === 'mm') return value / 1000;
  throw new Error(`Unsupported CAD length unit: ${String(unit)}`);
}

/** Convert a canonical metre length into the requested display unit. */
export function fromMetres(valueInMetres: number, unit: CadUnit): number {
  assertFinite(valueInMetres, 'Length');
  if (unit === 'm') return valueInMetres;
  if (unit === 'mm') return valueInMetres * 1000;
  throw new Error(`Unsupported CAD length unit: ${String(unit)}`);
}

/** Convert a point expressed in a selected unit into canonical metres. */
export function pointToMetres(point: Point2D, unit: CadUnit): Point2D {
  return { x: toMetres(point.x, unit), y: toMetres(point.y, unit) };
}

/** Convert canonical metre coordinates into a selected display unit. */
export function pointFromMetres(point: Point2D, unit: CadUnit): Point2D {
  return { x: fromMetres(point.x, unit), y: fromMetres(point.y, unit) };
}

/** Convert an engineering-world point (metres) into screen pixels. */
export function worldToScreen(point: Point2D, viewport: CadViewport): Point2D {
  assertViewport(viewport);
  assertFinite(point.x, 'Point X');
  assertFinite(point.y, 'Point Y');
  return {
    x: viewport.screenOrigin.x + (point.x - viewport.worldOrigin.x) * viewport.pixelsPerMetre,
    y: viewport.screenOrigin.y - (point.y - viewport.worldOrigin.y) * viewport.pixelsPerMetre,
  };
}

/** Convert screen pixels back into engineering-world coordinates (metres). */
export function screenToWorld(point: Point2D, viewport: CadViewport): Point2D {
  assertViewport(viewport);
  assertFinite(point.x, 'Screen X');
  assertFinite(point.y, 'Screen Y');
  return {
    x: viewport.worldOrigin.x + (point.x - viewport.screenOrigin.x) / viewport.pixelsPerMetre,
    y: viewport.worldOrigin.y - (point.y - viewport.screenOrigin.y) / viewport.pixelsPerMetre,
  };
}

/** Round a world point to the nearest metric grid interval, in metres. */
export function snapToGrid(point: Point2D, gridIntervalMetres: number): Point2D {
  assertFinite(point.x, 'Point X');
  assertFinite(point.y, 'Point Y');
  if (!Number.isFinite(gridIntervalMetres) || gridIntervalMetres <= 0) {
    throw new Error('Grid interval must be a finite number greater than zero.');
  }
  const round = (value: number) => Math.round(value / gridIntervalMetres) * gridIntervalMetres;
  return { x: round(point.x), y: round(point.y) };
}

export function distance(a: Point2D, b: Point2D): number {
  assertFinite(a.x, 'Point A X');
  assertFinite(a.y, 'Point A Y');
  assertFinite(b.x, 'Point B X');
  assertFinite(b.y, 'Point B Y');
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Return the included direction angle from A to B in degrees, clockwise-positive screen-independent math (CCW from +X). */
export function directionAngleDegrees(a: Point2D, b: Point2D): number {
  assertFinite(a.x, 'Point A X');
  assertFinite(a.y, 'Point A Y');
  assertFinite(b.x, 'Point B X');
  assertFinite(b.y, 'Point B Y');
  if (a.x === b.x && a.y === b.y) throw new Error('A direction angle is undefined for a zero-length segment.');
  const angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  return (angle + 360) % 360;
}

export function boundsOfPoints(points: Point2D[]): CadBounds | null {
  if (!points.length) return null;
  points.forEach(point => {
    assertFinite(point.x, 'Point X');
    assertFinite(point.y, 'Point Y');
  });
  return points.reduce<CadBounds>((bounds, point) => ({
    minX: Math.min(bounds.minX, point.x),
    minY: Math.min(bounds.minY, point.y),
    maxX: Math.max(bounds.maxX, point.x),
    maxY: Math.max(bounds.maxY, point.y),
  }), {
    minX: points[0].x,
    minY: points[0].y,
    maxX: points[0].x,
    maxY: points[0].y,
  });
}

/** Segment intersection, including endpoints. Parallel/collinear overlap returns null. */
export function segmentIntersection(
  a: Point2D, b: Point2D, c: Point2D, d: Point2D,
  tolerance = 1e-9,
): Point2D | null {
  [a, b, c, d].forEach(point => {
    assertFinite(point.x, 'Point X');
    assertFinite(point.y, 'Point Y');
  });
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new Error('Tolerance must be non-negative.');
  const denominator = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
  if (Math.abs(denominator) <= tolerance) return null;
  const determinantAB = a.x * b.y - a.y * b.x;
  const determinantCD = c.x * d.y - c.y * d.x;
  const x = (determinantAB * (c.x - d.x) - (a.x - b.x) * determinantCD) / denominator;
  const y = (determinantAB * (c.y - d.y) - (a.y - b.y) * determinantCD) / denominator;
  const within = (p: Point2D, q: Point2D) =>
    x >= Math.min(p.x, q.x) - tolerance && x <= Math.max(p.x, q.x) + tolerance &&
    y >= Math.min(p.y, q.y) - tolerance && y <= Math.max(p.y, q.y) + tolerance;
  return within(a, b) && within(c, d) ? { x, y } : null;
}
