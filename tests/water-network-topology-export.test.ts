import { describe, expect, it } from 'vitest';
import { createWaterComponent } from '../water-cad';
import {
  buildBendCentreline, buildPipeLongitudinalProfile, buildPreliminaryBoq,
  buildReducerCentreline, buildTeeCentreline, connectWaterPorts,
  exportWaterNetworkToEpanet, getWaterPorts, type NetworkDocument,
} from '../water-network-engineering';

const document = (): NetworkDocument => {
  const source = createWaterComponent('source', 'SRC-1', 0, 0);
  source.geometry[0].z = 100;
  const junction = createWaterComponent('junction', 'J-1', 10, 0);
  junction.geometry[0].z = 98;
  const pipe = createWaterComponent('pipe', 'P-1', 0, 0);
  pipe.geometry = [{ x: 0, y: 0, z: 100 }, { x: 10, y: 0, z: 98 }];
  pipe.fromNodeId = source.id;
  pipe.toNodeId = junction.id;
  return { schemaVersion: 1, units: 'm', verticalDatum: 'Project datum', components: [source, junction, pipe], connections: [] };
};

describe('water network engineering', () => {
  it('creates two-port inline fittings and a three-port tee with orientation', () => {
    const tee = createWaterComponent('tee', 'T-1', 5, 5);
    tee.properties.rotationDeg = 90;
    expect(getWaterPorts(tee)).toHaveLength(3);
    expect(getWaterPorts(tee)[0].point.x).toBeCloseTo(5);
    expect(getWaterPorts(tee)[0].point.y).toBeCloseTo(4.5);
    const reducer = createWaterComponent('reducer', 'R-1', 0, 0);
    expect(getWaterPorts(reducer)).toHaveLength(2);
    expect(getWaterPorts(reducer)[1].diameterMm).toBe(110);
  });

  it('builds circular bend, tee and reducer centreline geometry', () => {
    const bend = createWaterComponent('bend', 'B-1', 0, 0);
    const arc = buildBendCentreline(bend, 24);
    expect(arc).toHaveLength(25);
    expect(Math.hypot(arc[12].x - (arc[0].x + arc[24].x) / 2, arc[12].y - (arc[0].y + arc[24].y) / 2)).toBeGreaterThan(0);
    expect(buildTeeCentreline(createWaterComponent('tee', 'T-1', 0, 0))).toHaveLength(2);
    expect(buildReducerCentreline(createWaterComponent('reducer', 'R-1', 0, 0))).toHaveLength(2);
  });

  it('connects fitting ports only within the declared tolerance and prevents double connections', () => {
    const tee = createWaterComponent('tee', 'T-1', 0, 0);
    const pipeA = createWaterComponent('pipe', 'P-A', -5, 0);
    pipeA.geometry = [{ x: -1, y: 0 }, { x: -0.5, y: 0 }];
    const pipeB = createWaterComponent('pipe', 'P-B', 0, 0);
    pipeB.geometry = [{ x: -0.5, y: 0 }, { x: 0, y: 0 }];
    const doc: NetworkDocument = { schemaVersion: 1, units: 'm', verticalDatum: 'test', components: [tee, pipeA, pipeB] };
    const joined = connectWaterPorts(doc, 'P-A:P2', 'T-1:P1', 0);
    expect(joined.connections).toHaveLength(1);
    expect(() => connectWaterPorts(joined, 'P-B:P1', 'T-1:P1', 0)).toThrow(/already connected/);
    expect(() => connectWaterPorts(doc, 'P-A:P2', 'T-1:P2', 0)).toThrow(/apart/);
  });

  it('exports connected tee branches as one shared hydraulic junction', () => {
    const source = createWaterComponent('source', 'SRC', -1, 0);
    source.geometry[0].z = 100;
    const j1 = createWaterComponent('junction', 'J1', 1, 0);
    const j2 = createWaterComponent('junction', 'J2', 0, 1);
    const tee = createWaterComponent('tee', 'TEE', 0, 0);
    const a = createWaterComponent('pipe', 'PA', -1, 0);
    a.geometry = [{ x: -1, y: 0 }, { x: -0.5, y: 0 }];
    const b = createWaterComponent('pipe', 'PB', 0.5, 0);
    b.geometry = [{ x: 0.5, y: 0 }, { x: 1, y: 0 }];
    const c = createWaterComponent('pipe', 'PC', 0, 0.5);
    c.geometry = [{ x: 0, y: 0.5 }, { x: 0, y: 1 }];
    let doc: NetworkDocument = { schemaVersion: 1, units: 'm', verticalDatum: 'test', components: [source, j1, j2, tee, a, b, c] };
    doc = connectWaterPorts(doc, 'PA:P1', 'SRC:P1', 0);
    doc = connectWaterPorts(doc, 'PA:P2', 'TEE:P1', 0);
    doc = connectWaterPorts(doc, 'PB:P1', 'TEE:P2', 0);
    doc = connectWaterPorts(doc, 'PB:P2', 'J1:P1', 0);
    doc = connectWaterPorts(doc, 'PC:P1', 'TEE:P3', 0);
    doc = connectWaterPorts(doc, 'PC:P2', 'J2:P1', 0);
    const exported = exportWaterNetworkToEpanet(doc);
    expect(exported.input).toContain('PA SRC N_0001');
    expect(exported.input).toContain('PB N_0001 J1');
    expect(exported.input).toContain('PC N_0001 J2');
    expect(exported.warnings).toHaveLength(1);
    expect(exported.warnings[0]).toContain('physical tee');
  });

  it('exports a pump curve and represents a check valve as a CV pipe link', () => {
    const src = createWaterComponent('source', 'SRC', 0, 0);
    const junction = createWaterComponent('junction', 'J', 1, 0);
    const pump = createWaterComponent('pump', 'PU', 0, 0);
    pump.fromNodeId = 'SRC';
    pump.toNodeId = 'J';
    const check = createWaterComponent('valve', 'CV1', 0.5, 0);
    check.properties.valveType = 'check';
    check.fromNodeId = 'SRC';
    check.toNodeId = 'J';
    const doc: NetworkDocument = { schemaVersion: 1, units: 'm', verticalDatum: 'test', components: [src, junction, pump, check] };
    const exported = exportWaterNetworkToEpanet(doc);
    expect(exported.input).toContain('PU SRC J HEAD CURVE_PU');
    expect(exported.input).toContain('CURVE_PU 4.1667 40');
    expect(exported.input).toContain('CV1 SRC J 0.5 110 130 0 CV');
  });

  it('calculates longitudinal ground, invert, crown and cover at each route vertex', () => {
    const pipe = createWaterComponent('pipe', 'P-1', 0, 0);
    pipe.geometry = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }];
    pipe.properties.groundStartM = 100;
    pipe.properties.groundEndM = 99;
    pipe.properties.invertInletM = 98;
    pipe.properties.invertOutletM = 97;
    pipe.properties.externalDiameterMm = 110;
    const profile = buildPipeLongitudinalProfile(pipe);
    expect(profile.map(p => p.chainageM)).toEqual([0, 5, 10]);
    expect(profile[1].groundLevelM).toBeCloseTo(99.5);
    expect(profile[1].invertLevelM).toBeCloseTo(97.5);
    expect(profile[1].crownLevelM).toBeCloseTo(97.61);
    expect(profile[1].coverDepthM).toBeCloseTo(1.89);
  });

  it('builds grouped material quantities and preliminary excavation volumes', () => {
    const doc = document();
    const pipe2 = createWaterComponent('pipe', 'P-2', 10, 0);
    pipe2.geometry = [{ x: 10, y: 0 }, { x: 20, y: 0 }];
    doc.components.push(pipe2, createWaterComponent('valve', 'V-1', 10, 0));
    const boq = buildPreliminaryBoq(doc, 0.6, 1.2);
    expect(boq.find(q => q.code === 'PIPE')?.quantity).toBe(20);
    expect(boq.find(q => q.code === 'VALVE')?.quantity).toBe(1);
    expect(boq.find(q => q.code === 'EXCAVATION')?.quantity).toBeCloseTo(14.4);
  });

  it('exports valid network primitives and reports missing or unsupported items', () => {
    const doc = document();
    const badPipe = createWaterComponent('pipe', 'P-BAD', 0, 2);
    doc.components.push(badPipe, createWaterComponent('bend', 'B-1', 5, 0));
    const exported = exportWaterNetworkToEpanet(doc);
    expect(exported.input).toContain('[JUNCTIONS]');
    expect(exported.input).toContain('[RESERVOIRS]');
    expect(exported.input).toContain('[PIPES]');
    expect(exported.input).toContain('P-1 SRC-1 J-1');
    expect(exported.input).toContain('[END]');
    expect(exported.warnings.some(w => w.includes('P-BAD'))).toBe(true);
    expect(exported.warnings.some(w => w.includes('physical bend'))).toBe(true);
  });
});
