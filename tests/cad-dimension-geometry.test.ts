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
  it('calculates radius and diameter leaders from a circle centre', () => {
    const radius = calculateRadiusDimension({x:2,y:3},{x:5,y:3},{x:6,y:4});
    expect(radius.radius).toBe(3);
    expect(radius.centerMark).toHaveLength(2);
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
