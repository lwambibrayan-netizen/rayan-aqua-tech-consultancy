import { describe, expect, it } from 'vitest';
import { convertEmitterCoefficient, getEpanetUnitFactors } from '../epanet-units';

describe('EPANET unit conversion', () => {
  it('converts US customary GPM models to metric internal units', () => {
    const f = getEpanetUnitFactors('GPM');
    expect(f.flowToLps).toBeCloseTo(0.0630901964, 9);
    expect(f.lengthToM).toBe(0.3048);
    expect(f.pipeDiameterToMm).toBe(25.4);
    expect(f.tankVolumeToM3).toBeCloseTo(0.028316846592, 12);
  });

  it('converts US customary alternatives', () => {
    expect(getEpanetUnitFactors('CFS').flowToLps).toBeCloseTo(28.316846592, 8);
    expect(getEpanetUnitFactors('MGD').flowToLps).toBeCloseTo(43.8126363889, 8);
    expect(getEpanetUnitFactors('IMGD').flowToLps).toBeCloseTo(52.6167824074, 8);
    expect(getEpanetUnitFactors('AFD').flowToLps).toBeCloseTo(14.2764101852, 8);
  });

  it('leaves metric units dimensionally metric', () => {
    for (const unit of ['LPS', 'LPM', 'MLD', 'CMH', 'CMD', 'CMS']) {
      expect(getEpanetUnitFactors(unit).lengthToM).toBe(1);
      expect(getEpanetUnitFactors(unit).pipeDiameterToMm).toBe(1);
    }
  });

  it('converts US pressure settings in psi to metres of water head', () => {
    expect(getEpanetUnitFactors('GPM').pressureToM).toBeCloseTo(0.7032496149, 8);
    expect(getEpanetUnitFactors('LPS').pressureToM).toBe(1);
  });

  it('converts emitter coefficients for both flow and head units', () => {
    const f = getEpanetUnitFactors('GPM');
    expect(convertEmitterCoefficient(1, f.flowToLps, f.lengthToM)).toBeCloseTo(0.1143, 4);
  });

  it('respects non-default EPANET emitter exponents', () => {
    const f = getEpanetUnitFactors('GPM');
    expect(convertEmitterCoefficient(1, f.flowToLps, f.lengthToM, 1)).toBeCloseTo(0.2070, 4);
  });

  it('rejects unsupported unit labels instead of silently mis-scaling', () => {
    expect(() => getEpanetUnitFactors('UNKNOWN')).toThrow(/Unsupported EPANET flow unit/);
  });
});
