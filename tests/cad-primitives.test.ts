import { describe, expect, it } from 'vitest';
import { arcFromCenterStartAngle, arcFromThreePoints, circleFromCenterDiameter, circleFromCenterRadius, circleFromDiameter, circleFromThreePoints, ellipseFromBounds } from '../cad-primitives';

describe('CAD precision drawing primitives', () => {
  it('constructs circles by centre-radius and diameter endpoints', () => {
    expect(circleFromCenterRadius({x:2,y:3},{x:5,y:7},'r','0').radius).toBe(5);
    expect(circleFromCenterDiameter({x:2,y:3},{x:6,y:3},'cd','0').radius).toBe(2);
    const circle=circleFromDiameter({x:0,y:0},{x:4,y:0},'d','0');
    expect(circle.points[0]).toEqual({x:2,y:0});
    expect(circle.radius).toBe(2);
  });
  it('constructs a circle through three non-collinear points', () => {
    const circle=circleFromThreePoints({x:1,y:0},{x:0,y:1},{x:-1,y:0},'3p','0');
    expect(circle.points[0].x).toBeCloseTo(0);
    expect(circle.points[0].y).toBeCloseTo(0);
    expect(circle.radius).toBeCloseTo(1);
  });
  it('rejects zero-radius and collinear circle definitions', () => {
    expect(()=>circleFromCenterRadius({x:1,y:1},{x:1,y:1},'x','0')).toThrow(/greater than zero/);
    expect(()=>circleFromThreePoints({x:0,y:0},{x:1,y:1},{x:2,y:2},'x','0')).toThrow(/collinear/);
  });
  it('creates a closed ellipse polyline from opposite bounding corners', () => {
    const ellipse=ellipseFromBounds({x:0,y:0},{x:10,y:4},'e','0');
    expect(ellipse.points).toHaveLength(65);
    expect(ellipse.points[0]).toEqual(ellipse.points[64]);
    expect(Math.max(...ellipse.points.map(p=>p.x))).toBeCloseTo(10);
    expect(Math.max(...ellipse.points.map(p=>p.y))).toBeCloseTo(4);
  });
  it('creates a true circular arc using a signed bulge and honours the through point', () => {
    const arc=arcFromThreePoints({x:1,y:0},{x:Math.SQRT1_2,y:Math.SQRT1_2},{x:0,y:1},'a','0');
    expect(arc.points).toHaveLength(2);
    expect(arc.bulges?.[0]).toBeCloseTo(Math.tan(Math.PI/8));
    const clockwise=arcFromThreePoints({x:1,y:0},{x:Math.SQRT1_2,y:-Math.SQRT1_2},{x:0,y:1},'b','0');
    expect(clockwise.bulges?.[0]).toBeLessThan(0);
  });
});

describe('CAD angle arc construction', () => {
  it('constructs a centre-start-angle arc with the requested signed sweep', () => {
    const arc=arcFromCenterStartAngle({x:0,y:0},{x:2,y:0},90,'angle','0');
    expect(arc.points[1].x).toBeCloseTo(0);
    expect(arc.points[1].y).toBeCloseTo(2);
    expect(arc.bulges?.[0]).toBeCloseTo(Math.tan(Math.PI/8));
    expect(arcFromCenterStartAngle({x:0,y:0},{x:2,y:0},-90,'reverse','0').bulges?.[0]).toBeLessThan(0);
    expect(()=>arcFromCenterStartAngle({x:0,y:0},{x:0,y:0},90,'bad','0')).toThrow(/radius/);
  });
});
