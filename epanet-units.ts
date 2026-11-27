export type EpanetFlowUnit = 'LPS'|'LPM'|'MLD'|'CMH'|'CMD'|'CMS'|'GPM'|'CFS'|'MGD'|'IMGD'|'AFD';

export type EpanetUnitFactors = {
  flowToLps: number;
  lengthToM: number;
  pipeDiameterToMm: number;
  tankVolumeToM3: number;
  pressureToM: number;
};

const FLOW_TO_LPS: Record<EpanetFlowUnit, number> = {
  LPS: 1,
  LPM: 1 / 60,
  MLD: 11.5740740741,
  CMH: 1000 / 3600,
  CMD: 1000 / 86400,
  CMS: 1000,
  GPM: 0.0630901964,
  CFS: 28.316846592,
  MGD: 43.8126363889,
  IMGD: 52.6167824074,
  AFD: 14.2764101852,
};

const US_UNITS = new Set<EpanetFlowUnit>(['GPM', 'CFS', 'MGD', 'IMGD', 'AFD']);

export function getEpanetUnitFactors(rawUnit: string): EpanetUnitFactors {
  const unit = rawUnit.trim().toUpperCase() as EpanetFlowUnit;
  const flowToLps = FLOW_TO_LPS[unit];
  if (!flowToLps) {
    throw new Error(`Unsupported EPANET flow unit "${rawUnit}". Supported units: LPS, LPM, MLD, CMH, CMD, CMS, GPM, CFS, MGD, IMGD and AFD.`);
  }
  const lengthToM = US_UNITS.has(unit) ? 0.3048 : 1;
  return {
    flowToLps,
    lengthToM,
    pipeDiameterToMm: US_UNITS.has(unit) ? 25.4 : 1,
    tankVolumeToM3: US_UNITS.has(unit) ? 0.028316846592 : 1,
    // EPANET US customary pressure settings are psi, not feet of head.
    pressureToM: US_UNITS.has(unit) ? 0.7032496149 : 1,
  };
}

export function convertEmitterCoefficient(value: number, flowToLps: number, headToM: number, exponent = 0.5): number {
  return value * flowToLps / Math.pow(headToM, exponent);
}
