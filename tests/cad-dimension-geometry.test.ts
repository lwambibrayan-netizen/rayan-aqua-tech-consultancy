import { describe, expect, it } from 'vitest';
import {
  calculateAngularDimension, calculateRadiusDimension, calculateDiameterDimension,
  calculateOrdinateDimension, calculateBaselineDimensions, calculateChainDimensions,
} from '../cad-dimension-geometry';

describe('advanced dimension geometry', () => {
  it('builds a minor-angle arc and correctly associates its extension rays', () => {
    const d = calculateAngularDimension({x:0,y:0},{x:1,y:0},{x:0,y:1},2);
    expect(d.angleRad).toBeCloseTo(Math.PI/2);
    expect(d.arc.radius).toBe(2);
    expect(d.firstExtension.a).toEqual({x:1,y:0});
    expect(d.secondExtension.a).toEqual({x:0,y:1});
    expect(d.labelPoint.x).toBeCloseTo(2*1.18/Math.sqrt(2));
  });
  it('chooses the smaller included angle without swapping ray ownership', () => {
    const d = calculateAngularDimension({x:0,y:0},{x:0,y:1},{x:1,y:0},1);
    expect(d.angleRad).toBeCloseTo(Math.PI/2);
    expect(d.firstExtension.a).toEqual({x:0,y:1});
    expect(d.secondExtension.a).toEqual({x:1,y:0});
  });
  it('anchors radial leaders to the circumference and diameter leaders to the opposite circumference', () => {
    const radius = calculateRadiusDimension({x:2,y:3},{x:5,y:3},{x:6,y:4});
    expect(radius.radius).toBe(3);
    expect(radius.centerMark).toHaveLength(2);
    expect(radius.leader.a).toEqual({x:5,y:3});
    const diameter = calculateDiameterDimension({x:2,y:3},{x:5,y:3},{x:6,y:4});
    expect(diameter.diameter).toBe(6);
    expect(diameter.oppositePoint).toEqual({x:-1,y:3});
    expect(diameter.leader.a).toEqual({x:-1,y:3});
  });
  it('calculates signed X and Y ordinate dimensions', () => {
    const x = calculateOrdinateDimension({x:1,y:1},{x:4,y:3},'x',2);
    expect(x.value).toBe(3);
    expect(x.labelPoint).toEqual({x:2.5,y:5});
    const y = calculateOrdinateDimension({x:1,y:1},{x:4,y:-2},'y',-1);
    expect(y.value).toBe(-3);
    expect(y.labelPoint).toEqual({x:3,y:-0.5});
  });
  it('creates baseline and chain dimension geometry', () => {
    const origin={x:0,y:0};
    const features=[{x:2,y:1},{x:5,y:2}];
    const baseline=calculateBaselineDimensions(origin,features,1,'x');
    expect(baseline.map(d=>d.value)).toEqual([2,5]);
    const chain=calculateChainDimensions([{x:0,y:0},{x:3,y:0},{x:3,y:4}],1);
    expect(chain).toHaveLength(2);
    expect(chain[0].a).toEqual({x:0,y:1});
    expect(chain[1].a).toEqual({x:2,y:0});
  });
  it('rejects invalid or degenerate geometry', () => {
    expect(()=>calculateAngularDimension({x:0,y:0},{x:0,y:0},{x:1,y:0},1)).toThrow();
    expect(()=>calculateRadiusDimension({x:0,y:0},{x:0,y:0},{x:1,y:0})).toThrow();
    expect(()=>calculateOrdinateDimension({x:0,y:0},{x:1,y:1},'x',0)).toThrow();
    expect(()=>calculateChainDimensions([{x:0,y:0},{x:0,y:0}],1)).toThrow();
  });
});


describe('associative dimension anchors', () => {
  it('remeasures an aligned dimension when a referenced polyline vertex moves', async () => {
    const { findAssociativeAnchor, makeAlignedDimension, resolveAssociativeDimension, measureDimension } = await import('../cad-drafting');
    const entities = [{ id: 'pipe-1', type: 'polyline', points: [{x:0,y:0},{x:3,y:0}] }];
    const a = findAssociativeAnchor({x:0,y:0}, entities, 0.002, 1);
    const b = findAssociativeAnchor({x:3,y:0}, entities, 0.002, 1);
    const dimension = makeAlignedDimension('dim-1', {x:0,y:0}, {x:3,y:0}, 1);
    dimension.association = { a, b };
    expect(measureDimension(dimension)).toBe(3);
    const moved = [{ ...entities[0], points: [{x:0,y:0},{x:4,y:0}] }];
    const resolved = resolveAssociativeDimension(dimension, moved, 1);
    expect(resolved.b).toEqual({x:4,y:0});
    expect(measureDimension(resolved)).toBe(4);
  });
  it('keeps an orphaned reference at its last saved measurement', async () => {
    const { resolveAssociativeDimension, makeAlignedDimension } = await import('../cad-drafting');
    const dimension = makeAlignedDimension('dim-2', {x:0,y:0}, {x:2,y:0}, 1);
    dimension.association = { b: { entityId: 'missing', pointIndex: 1 } };
    expect(resolveAssociativeDimension(dimension, [], 1).b).toEqual({x:2,y:0});
  });
});

describe('associative radial and angular dimensions', () => {
  it('tracks a circle centre and radius after the source circle is edited', async () => {
    const { findAssociativeCircle, resolveAssociativeRadialDimension } = await import('../cad-drafting');
    const initial = [{ id: 'circle-1', type: 'circle', points: [{x:2,y:3}], radius: 4 }];
    const circleId = findAssociativeCircle({x:2,y:3}, initial, 0.002, 1);
    const annotation = { id: 'rad-1', kind: 'radial' as const, layer: 'DIMENSIONS', circleId, center: {x:2,y:3}, radiusM: 4, dimensionType: 'diameter' as const, leaderAngleRad: 0, precision: 3 };
    const edited = [{ id: 'circle-1', type: 'circle', points: [{x:5,y:6}], radius: 7 }];
    const resolved = resolveAssociativeRadialDimension(annotation, edited, 1);
    expect(resolved.center).toEqual({x:5,y:6});
    expect(resolved.radiusM).toBe(7);
  });
  it('tracks both rays of an angular dimension when their source vertices move', async () => {
    const { resolveAssociativeAngularDimension, measureAngularDimension } = await import('../cad-drafting');
    const annotation = {
      id: 'ang-1', kind: 'angular' as const, layer: 'DIMENSIONS',
      vertex: {x:0,y:0}, rayA: {x:1,y:0}, rayB: {x:0,y:1}, offsetM: 1, precision: 2,
      association: {
        vertex: {entityId:'a',pointIndex:0},
        rayA: {entityId:'a',pointIndex:1},
        rayB: {entityId:'b',pointIndex:1},
      },
    };
    const entities = [
      {id:'a',type:'line',points:[{x:0,y:0},{x:2,y:0}]},
      {id:'b',type:'line',points:[{x:0,y:0},{x:2,y:2}]},
    ];
    const resolved = resolveAssociativeAngularDimension(annotation, entities, 1);
    expect(measureAngularDimension(resolved) * 180 / Math.PI).toBeCloseTo(45);
    const moved = [
      {id:'a',type:'line',points:[{x:0,y:0},{x:2,y:0}]},
      {id:'b',type:'line',points:[{x:0,y:0},{x:0,y:2}]},
    ];
    expect(measureAngularDimension(resolveAssociativeAngularDimension(annotation, moved, 1)) * 180 / Math.PI).toBeCloseTo(90);
  });
});
