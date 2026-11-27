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
/** Constrain a cursor ray to the nearest angular increment while preserving its length. */
export function constrainPointToAngle(anchor: Point2D, cursor: Point2D, incrementDegrees = 15): Point2D {
  [anchor,cursor].forEach(point=>{assertFinite(point.x,'Point X');assertFinite(point.y,'Point Y');});
  if(!Number.isFinite(incrementDegrees)||incrementDegrees<=0||incrementDegrees>360)throw new Error('Polar angle increment must be greater than 0 and no more than 360 degrees.');
  const dx=cursor.x-anchor.x,dy=cursor.y-anchor.y,length=Math.hypot(dx,dy);
  if(length<=Number.EPSILON)return {...anchor};
  const increment=incrementDegrees*Math.PI/180;
  const angle=Math.round(Math.atan2(dy,dx)/increment)*increment;
  return {x:anchor.x+length*Math.cos(angle),y:anchor.y+length*Math.sin(angle)};
}

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
  return within(a, b) && within(c, d) ? { x: x === 0 ? 0 : x, y: y === 0 ? 0 : y } : null;
}


/** Standard CSS reference density; callers may supply the actual display density. */
export const CSS_PIXELS_PER_INCH = 96;

/** Derive CSS pixels per model metre for a paper scale such as 1:100. */
export function pixelsPerMetreAtScale(
  scaleDenominator: number,
  pixelsPerInch = CSS_PIXELS_PER_INCH,
): number {
  if (!Number.isFinite(scaleDenominator) || scaleDenominator <= 0) {
    throw new Error('Scale denominator must be a finite number greater than zero.');
  }
  if (!Number.isFinite(pixelsPerInch) || pixelsPerInch <= 0) {
    throw new Error('Pixels per inch must be a finite number greater than zero.');
  }
  // One model metre is 1000 mm; at 1:N it occupies 1000/N paper mm.
  return (1000 / scaleDenominator) * (pixelsPerInch / 25.4);
}

/** Zoom around a screen-space anchor while keeping the world point under it fixed. */
export function zoomViewportAt(
  viewport: CadViewport,
  screenAnchor: Point2D,
  zoomFactor: number,
  minPixelsPerMetre = 0.001,
  maxPixelsPerMetre = 1e7,
): CadViewport {
  assertViewport(viewport);
  assertFinite(screenAnchor.x, 'Zoom anchor X');
  assertFinite(screenAnchor.y, 'Zoom anchor Y');
  if (!Number.isFinite(zoomFactor) || zoomFactor <= 0) throw new Error('Zoom factor must be greater than zero.');
  if (!Number.isFinite(minPixelsPerMetre) || !Number.isFinite(maxPixelsPerMetre) ||
      minPixelsPerMetre <= 0 || maxPixelsPerMetre < minPixelsPerMetre) {
    throw new Error('Invalid zoom limits.');
  }
  const anchorWorld = screenToWorld(screenAnchor, viewport);
  const pixelsPerMetre = Math.min(maxPixelsPerMetre, Math.max(minPixelsPerMetre, viewport.pixelsPerMetre * zoomFactor));
  return {
    ...viewport,
    pixelsPerMetre,
    worldOrigin: {
      x: anchorWorld.x - (screenAnchor.x - viewport.screenOrigin.x) / pixelsPerMetre,
      y: anchorWorld.y + (screenAnchor.y - viewport.screenOrigin.y) / pixelsPerMetre,
    },
  };
}

/** Pan by a screen-pixel delta. Positive screen Y moves the drawing down. */
export function panViewport(viewport: CadViewport, deltaScreen: Point2D): CadViewport {
  assertViewport(viewport);
  assertFinite(deltaScreen.x, 'Pan delta X');
  assertFinite(deltaScreen.y, 'Pan delta Y');
  return {
    ...viewport,
    worldOrigin: {
      x: viewport.worldOrigin.x - deltaScreen.x / viewport.pixelsPerMetre,
      y: viewport.worldOrigin.y + deltaScreen.y / viewport.pixelsPerMetre,
    },
  };
}

export type SnapKind = 'ENDPOINT' | 'MIDPOINT' | 'CENTER' | 'QUADRANT' | 'NEAREST' | 'INTERSECTION' | 'PERPENDICULAR' | 'TANGENT';
export type SnapCandidate = { point: Point2D; kind: SnapKind };

/** Closest point on a finite segment, including endpoints. */
export function nearestPointOnSegment(point: Point2D, a: Point2D, b: Point2D): Point2D {
  [point, a, b].forEach(p => {
    assertFinite(p.x, 'Point X');
    assertFinite(p.y, 'Point Y');
  });
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return { ...a };
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/**
 * Build deterministic object-snap candidates for linear and circular geometry.
 * referencePoint is the previous construction point used for perpendicular and tangent snaps.
 * Segment and circle intersections are exact within the supplied geometric tolerance.
 */
export function objectSnapCandidates(
  cursor: Point2D,
  segments: Array<[Point2D, Point2D]>,
  circles: Array<{ center: Point2D; radius: number }> = [],
  referencePoint?: Point2D,
  tolerance = 1e-9,
): SnapCandidate[] {
  assertFinite(cursor.x, 'Cursor X');
  assertFinite(cursor.y, 'Cursor Y');
  if (referencePoint) {
    assertFinite(referencePoint.x, 'Reference point X');
    assertFinite(referencePoint.y, 'Reference point Y');
  }
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new Error('Snap tolerance must be non-negative.');
  const candidates: SnapCandidate[] = [];
  segments.forEach(([a, b]) => {
    [a, b].forEach(p => { assertFinite(p.x, 'Segment X'); assertFinite(p.y, 'Segment Y'); });
    candidates.push({ point: { ...a }, kind: 'ENDPOINT' }, { point: { ...b }, kind: 'ENDPOINT' });
    candidates.push({ point: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, kind: 'MIDPOINT' });
    const nearest = nearestPointOnSegment(cursor, a, b);
    candidates.push({ point: nearest, kind: 'NEAREST' });
    if (referencePoint) {
      const perpendicular = nearestPointOnSegment(referencePoint, a, b);
      const dx=b.x-a.x, dy=b.y-a.y, length=Math.hypot(dx,dy);
      if (length > tolerance && distance(perpendicular, referencePoint) > tolerance) {
        candidates.push({ point: perpendicular, kind: 'PERPENDICULAR' });
      }
    }
  });
  circles.forEach(({ center, radius }) => {
    assertFinite(center.x, 'Circle centre X');
    assertFinite(center.y, 'Circle centre Y');
    if (!Number.isFinite(radius) || radius <= 0) throw new Error('Circle radius must be greater than zero.');
    candidates.push({ point: { ...center }, kind: 'CENTER' });
    const dx = cursor.x - center.x, dy = cursor.y - center.y, length = Math.hypot(dx, dy);
    if (length > tolerance) candidates.push({
      point: { x: center.x + dx / length * radius, y: center.y + dy / length * radius },
      kind: 'NEAREST',
    });
    [0, Math.PI / 2, Math.PI, Math.PI * 1.5].forEach(angle => candidates.push({
      point: { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius },
      kind: 'QUADRANT',
    }));
    if (referencePoint) {
      const vx=referencePoint.x-center.x, vy=referencePoint.y-center.y, d2=vx*vx+vy*vy;
      if (d2 > radius*radius + tolerance) {
        const base=Math.atan2(vy,vx), offset=Math.acos(Math.min(1,radius/Math.sqrt(d2)));
        [base+offset,base-offset].forEach(angle=>candidates.push({
          point:{x:center.x+radius*Math.cos(angle),y:center.y+radius*Math.sin(angle)},kind:'TANGENT',
        }));
      }
    }
  });
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const point = segmentIntersection(segments[i][0], segments[i][1], segments[j][0], segments[j][1], tolerance);
      if (point) candidates.push({ point, kind: 'INTERSECTION' });
    }
    for (const circle of circles) {
      const [a,b]=segments[i], dx=b.x-a.x, dy=b.y-a.y, fx=a.x-circle.center.x, fy=a.y-circle.center.y;
      const A=dx*dx+dy*dy, B=2*(fx*dx+fy*dy), C=fx*fx+fy*fy-circle.radius*circle.radius;
      if (A <= tolerance*tolerance) continue;
      const discriminant=B*B-4*A*C;
      if (discriminant < -tolerance) continue;
      const root=Math.sqrt(Math.max(0,discriminant));
      for (const t of [(-B-root)/(2*A),(-B+root)/(2*A)]) {
        if (t >= -tolerance && t <= 1+tolerance) candidates.push({
          point:{x:a.x+t*dx,y:a.y+t*dy},kind:'INTERSECTION',
        });
      }
    }
  }
  for(let i=0;i<circles.length;i++) for(let j=i+1;j<circles.length;j++) {
    const a=circles[i],b=circles[j],dx=b.center.x-a.center.x,dy=b.center.y-a.center.y,d=Math.hypot(dx,dy);
    if(d<=tolerance||d>a.radius+b.radius+tolerance||d<Math.abs(a.radius-b.radius)-tolerance) continue;
    const along=(a.radius*a.radius-b.radius*b.radius+d*d)/(2*d);
    const height=Math.sqrt(Math.max(0,a.radius*a.radius-along*along));
    const base={x:a.center.x+along*dx/d,y:a.center.y+along*dy/d};
    const offset={x:-dy*height/d,y:dx*height/d};
    candidates.push({point:{x:base.x+offset.x,y:base.y+offset.y},kind:'INTERSECTION'});
    if(height>tolerance)candidates.push({point:{x:base.x-offset.x,y:base.y-offset.y},kind:'INTERSECTION'});
  }
  const unique: SnapCandidate[] = [];
  candidates.forEach(candidate => {
    if (!unique.some(existing => existing.kind === candidate.kind &&
      Math.hypot(existing.point.x-candidate.point.x, existing.point.y-candidate.point.y) <= tolerance)) {
      unique.push(candidate);
    }
  });
  return unique;
}

export type HistoryState<T> = {
  past: T[];
  present: T;
  future: T[];
};

/** Immutable undo/redo history suitable for CAD document snapshots. */
export function createHistory<T>(initial: T): HistoryState<T> {
  return { past: [], present: initial, future: [] };
}

export function pushHistory<T>(history: HistoryState<T>, next: T, limit = 100): HistoryState<T> {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('History limit must be a positive integer.');
  if (Object.is(history.present, next)) return history;
  return {
    past: [...history.past, history.present].slice(-limit),
    present: next,
    future: [],
  };
}

export function undoHistory<T>(history: HistoryState<T>): HistoryState<T> {
  if (!history.past.length) return history;
  return {
    past: history.past.slice(0, -1),
    present: history.past[history.past.length - 1],
    future: [history.present, ...history.future],
  };
}

export function redoHistory<T>(history: HistoryState<T>): HistoryState<T> {
  if (!history.future.length) return history;
  return {
    past: [...history.past, history.present],
    present: history.future[0],
    future: history.future.slice(1),
  };
}
