import { describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { InitHydOption, LinkProperty, NodeProperty, Project, Workspace } from 'epanet-js';
import { fromInp, toInp } from '../EpanetEnginePanel';

describe('EPA Net3 seven-day EPANET solver benchmark', () => {
  it('solves the imported-and-exported Net3 model hydraulically and traces source water for 168 hours', async () => {
    const source = readFileSync(resolve(process.cwd(), 'tests/fixtures/Net3.inp'), 'utf8');
    const imported = fromInp(source);
    expect(imported.settings.demandPattern.split(/[\\s,]+/).filter(Boolean).map(Number)).toEqual(expect.arrayContaining([1.34, 1.94, 1.46, 1.44]));
    const appInp = toInp(imported);
    expect(appInp).toContain('RA_DEMAND 1.34 1.94 1.46 1.44');
    expect(appInp).toMatch(/QUALITY TIMESTEP\s+0:05/);
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

      const sourceIndex = project.getNodeIndex('Lake');
      const junctions = imported.nodes.filter(n => n.kind === 'J').map(n => ({id:n.id,index:project.getNodeIndex(n.id)}));
      const tanks = imported.nodes.filter(n => n.kind === 'T').map(n => ({id:n.id,index:project.getNodeIndex(n.id),elevation:n.elevation}));
      const links = imported.links.map(l => ({id:l.id,kind:l.kind,index:project.getLinkIndex(l.id)}));
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
      const hourlySamples: Array<{timeHours:number;nodes:Array<{id:string;pressureM:number}>;tanks:Array<{id:string;levelM:number}>;links:Array<{id:string;kind:string;flowLps:number;velocityMps?:number}>}> = [];

      do {
        project.runH();
        hydraulicPeriods += 1;
        const nodeSamples = junctions.map(n => ({id:n.id,pressureM:project.getNodeValue(n.index,NodeProperty.Pressure)}));
        const tankSamples = tanks.map(t => ({id:t.id,levelM:project.getNodeValue(t.index,NodeProperty.Head)-t.elevation}));
        const linkSamples = links.map(l => ({id:l.id,kind:l.kind,flowLps:project.getLinkValue(l.index,LinkProperty.Flow),...(l.kind==='pipe'?{velocityMps:project.getLinkValue(l.index,LinkProperty.Velocity)}:{})}));
        const pressure = nodeSamples.find(n=>n.id==='101')?.pressureM ?? NaN;
        const representativePipe = linkSamples.find(l=>l.id==='60');
        const flow = representativePipe?.flowLps ?? NaN;
        const velocity = representativePipe?.velocityMps ?? NaN;
        const tankLevel = tankSamples.find(t=>t.id==='1')?.levelM ?? NaN;

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
        const currentHours = elapsedSeconds / 3600;
        if (Math.abs(currentHours - Math.round(currentHours)) < 1e-7) {
          hourlySamples.push({timeHours:currentHours,nodes:nodeSamples,tanks:tankSamples,links:linkSamples});
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
      expect(Math.abs(sampleFlow)).toBeGreaterThan(0.1);
      expect(Math.abs(sampleVelocity)).toBeGreaterThan(0.0001);
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

      // EN_nextQ advances to hydraulic events; EPANET performs quality routing internally at the configured 5-minute quality step.
      expect(qualityPeriods).toBe(hydraulicPeriods);
      expect(qualityPeriods).toBeGreaterThanOrEqual(168);
      expect(Number.isFinite(lakeTrace)).toBe(true);
      expect(lakeTrace).toBeCloseTo(100, 3);

      const report = String(workspace.readFile('Net3-roundtrip.rpt', 'utf8') ?? '');
      const artifactDir = resolve(process.cwd(), 'tests/.benchmark-output');
      mkdirSync(artifactDir, {recursive:true});
      writeFileSync(resolve(artifactDir,'Net3-roundtrip.inp'), appInp);
      writeFileSync(resolve(artifactDir,'epanet-js-results.json'), JSON.stringify({hourlySamples},null,2));
      expect(report.length).toBeGreaterThan(100);
      console.info(JSON.stringify({
        benchmark: 'EPA Net3 / 168 hours',
        hydraulicPeriods,
        elapsedHours: elapsedSeconds / 3600,
        junctionsCompared: junctions.length,
        tanksCompared: tanks.length,
        linksCompared: links.length,
        pressureAt101FinalM: samplePressure,
        pressureRangeAt101M: [minimumPressure, maximumPressure],
        riverIntakePipe60FinalFlowLps: sampleFlow,
        riverIntakePipe60FinalVelocityMps: sampleVelocity,
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
