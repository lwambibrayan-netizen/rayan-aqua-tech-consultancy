import { describe, expect, it } from 'vitest';
import { componentPlanLength, createWaterComponent, hazenWilliamsHeadlossM, pipeSlopePercent, pipeVelocityMs, validateWaterCad, type WaterCadDocument } from '../water-cad';

describe('water engineering CAD domain model', () => {
  it('creates editable engineering defaults for pipes and fittings', () => {
    const pipe = createWaterComponent('pipe', 'P-001', 0, 0);
    expect(pipe.geometry).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
    expect(pipe.properties).toMatchObject({ material: 'HDPE', nominalDiameterMm: 110, internalDiameterMm: 96, pressureClass: 'PN16' });
    expect(createWaterComponent('tee', 'T-1', 0, 0).properties.branchDiameterMm).toBe(110);
    expect(createWaterComponent('reducer', 'R-1', 0, 0).properties.outletDiameterMm).toBe(110);
    expect(createWaterComponent('valve', 'V-1', 0, 0).properties.valveType).toBe('gate');
    expect(createWaterComponent('pump', 'PU-1', 0, 0).properties.pumpDutyFlowM3h).toBe(15);
    expect(createWaterComponent('tank', 'TK-1', 0, 0).properties.tankCapacityM3).toBe(100);
    expect(createWaterComponent('chamber', 'CH-1', 0, 0).properties.chamberDepthM).toBe(1.5);
  });
  it('calculates true polyline plan length, velocity, gradient and Hazen-Williams loss', () => {
    const pipe = createWaterComponent('pipe', 'P-1', 0, 0);
    pipe.geometry = [{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 6, y: 4 }];
    pipe.properties.invertInletM = 12;
    pipe.properties.invertOutletM = 11.5;
    pipe.properties.flowM3h = 15;
    expect(componentPlanLength(pipe)).toBe(8);
    expect(pipeSlopePercent(pipe)).toBeCloseTo(-6.25);
    expect(pipeVelocityMs(15, 96)).toBeGreaterThan(0.5);
    expect(hazenWilliamsHeadlossM(100, 15, 96, 140)).toBeGreaterThan(0);
    expect(hazenWilliamsHeadlossM(100, 0, 96, 140)).toBe(0);
  });
  it('flags invalid engineering properties and design velocity warnings', () => {
    const pipe = createWaterComponent('pipe', 'P-1', 0, 0);
    pipe.properties.internalDiameterMm = 0;
    pipe.properties.flowM3h = 100;
    const tank = createWaterComponent('tank', 'TK-1', 0, 0);
    tank.properties.tankCapacityM3 = 0;
    const doc: WaterCadDocument = { schemaVersion: 1, units: 'm', verticalDatum: 'project datum - confirm', components: [pipe, tank] };
    const issues = validateWaterCad(doc);
    expect(issues.some(x => x.code === 'PIPE_BORE_REQUIRED' && x.severity === 'error')).toBe(true);
    expect(issues.some(x => x.code === 'TANK_CAPACITY')).toBe(true);
  });
  it('rejects invalid calculation inputs instead of silently returning misleading results', () => {
    expect(() => pipeVelocityMs(-1, 100)).toThrow();
    expect(() => hazenWilliamsHeadlossM(0, 10, 100, 140)).toThrow();
    expect(() => createWaterComponent('pipe', '', 0, 0)).toThrow();
  });
});
