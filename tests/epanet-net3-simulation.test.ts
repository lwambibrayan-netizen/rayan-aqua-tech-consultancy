import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { InitHydOption, LinkProperty, NodeProperty, Project, Workspace } from 'epanet-js';
import { fromInp, toInp } from '../EpanetEnginePanel';

describe('EPA Net3 seven-day EPANET solver benchmark', () => {
  it('solves the imported-and-exported Net3 model hydraulically and traces source water for 168 hours', async () => {
    const source = readFileSync(resolve(process.cwd(), 'tests/fixtures/Net3.inp'), 'utf8');
    const imported = fromInp(source);
    const appInp = toInp(imported);
    const workspace = new Workspace();
    await workspace.loadModule();
    const project = new Project(workspace);
    workspace.writeFile('Net3-roundtrip.inp', appInp);

    let opened = false;
    let hydraulicsOpen = false;
    let qualityOpen = false;
    try {
      project.open('Net3-roundtrip.inp', 'Net3-roundtrip.rpt', 'Net3-roundtrip.bin');
      opened = true;
      project.openH();
      hydraulicsOpen = true;
      project.initH(InitHydOption.SaveAndInit);

      const junctionIndex = project.getNodeIndex('101');
      const sourceIndex = project.getNodeIndex('Lake');
      const tankIndex = project.getNodeIndex('1');
      const representativePipeIndex = project.getLinkIndex('101');
      let hydraulicPeriods = 0;
      let elapsedSeconds = 0;
      let finitePressureSamples = 0;
      let positivePressureSamples = 0;
      let nonZeroFlowSamples = 0;
      let finiteVelocitySamples = 0;
      let minimumPressure = Infinity;
      let maximumPressure = -Infinity;
      let minimumTankLevel = Infinity;
      let maximumTankLevel = -Infinity;
      let samplePressure = NaN;
      let sampleFlow = NaN;
      let sampleVelocity = NaN;
      let dt = Infinity;

      do {
        project.runH();
        hydraulicPeriods += 1;
        const pressure = project.getNodeValue(junctionIndex, NodeProperty.Pressure);
        const flow = project.getLinkValue(representativePipeIndex, LinkProperty.Flow);
        const velocity = project.getLinkValue(representativePipeIndex, LinkProperty.Velocity);
        const tankHead = project.getNodeValue(tankIndex, NodeProperty.Head);
        const tankLevel = tankHead - 40.20312;

        if (Number.isFinite(pressure)) {
          finitePressureSamples += 1;
          minimumPressure = Math.min(minimumPressure, pressure);
          maximumPressure = Math.max(maximumPressure, pressure);
          if (pressure > 0) positivePressureSamples += 1;
          samplePressure = pressure;
        }
        if (Number.isFinite(flow)) {
          if (Math.abs(flow) > 1e-6) nonZeroFlowSamples += 1;
          sampleFlow = flow;
        }
        if (Number.isFinite(velocity)) {
          finiteVelocitySamples += 1;
          sampleVelocity = velocity;
        }
        if (Number.isFinite(tankLevel)) {
          minimumTankLevel = Math.min(minimumTankLevel, tankLevel);
          maximumTankLevel = Math.max(maximumTankLevel, tankLevel);
        }

        dt = project.nextH();
        if (dt > 0) elapsedSeconds += dt;
        if (hydraulicPeriods > 10000) throw new Error('Net3 hydraulic benchmark exceeded 10,000 periods');
      } while (dt > 0);

      project.saveH();
      project.closeH();
      hydraulicsOpen = false;

      expect(hydraulicPeriods).toBeGreaterThanOrEqual(168);
      expect(elapsedSeconds).toBe(168 * 60 * 60);
      expect(finitePressureSamples).toBe(hydraulicPeriods);
      expect(positivePressureSamples).toBeGreaterThan(0);
      expect(minimumPressure).toBeGreaterThan(-100);
      expect(maximumPressure).toBeGreaterThan(minimumPressure);
      expect(nonZeroFlowSamples).toBeGreaterThan(0);
      expect(finiteVelocitySamples).toBe(hydraulicPeriods);
      expect(Number.isFinite(samplePressure)).toBe(true);
      expect(Number.isFinite(sampleFlow)).toBe(true);
      expect(Number.isFinite(sampleVelocity)).toBe(true);
      expect(Number.isFinite(minimumTankLevel)).toBe(true);
      expect(Number.isFinite(maximumTankLevel)).toBe(true);

      project.openQ();
      qualityOpen = true;
      project.initQ(InitHydOption.Save);
      let qualityPeriods = 0;
      let lakeTrace = NaN;
      let qualityStep = Infinity;
      do {
        project.runQ();
        qualityPeriods += 1;
        lakeTrace = project.getNodeValue(sourceIndex, NodeProperty.Quality);
        qualityStep = project.nextQ();
        if (qualityPeriods > 200000) throw new Error('Net3 source-tracing benchmark exceeded 200,000 periods');
      } while (qualityStep > 0);
      project.closeQ();
      qualityOpen = false;

      expect(qualityPeriods).toBeGreaterThan(2000);
      expect(Number.isFinite(lakeTrace)).toBe(true);
      expect(lakeTrace).toBeCloseTo(100, 3);

      const report = String(workspace.readFile('Net3-roundtrip.rpt', 'utf8') ?? '');
      expect(report.length).toBeGreaterThan(100);
      console.info(JSON.stringify({
        benchmark: 'EPA Net3 / 168 hours',
        hydraulicPeriods,
        elapsedHours: elapsedSeconds / 3600,
        pressureAt101FinalM: samplePressure,
        pressureRangeAt101M: [minimumPressure, maximumPressure],
        pipe101FinalFlowLps: sampleFlow,
        pipe101FinalVelocityMps: sampleVelocity,
        tank1LevelRangeM: [minimumTankLevel, maximumTankLevel],
        qualityPeriods,
        lakeTracePercent: lakeTrace
      }));
    } finally {
      if (qualityOpen) {
        try { project.closeQ(); } catch { /* cleanup */ }
      }
      if (hydraulicsOpen) {
        try { project.closeH(); } catch { /* cleanup */ }
      }
      if (opened) {
        try { project.close(); } catch { /* cleanup */ }
      }
    }
  }, 120000);
});
