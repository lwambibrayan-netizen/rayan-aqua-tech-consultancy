import { describe, expect, it } from 'vitest';
import { createWaterComponent, type WaterCadDocument } from '../water-cad';
import {
  buildBendCentreline, buildPipeLongitudinalProfile, buildPreliminaryBoq, buildWaterQuantities,
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

  it('uses exact persisted symbol ports for topology and snap connections', () => {
    const doc = document();
    const valve = createWaterComponent('valve', 'V-LIB', 10, 0);
    valve.customPorts = [
      { id: 'inlet', point: { x: 10, y: 0 }, role: 'inlet', diameterMm: 110 },
      { id: 'outlet', point: { x: 10.2, y: 0 }, role: 'outlet', diameterMm: 110 },
    ];
    doc.components.push(valve);
    const ports = getWaterPorts(valve);
    expect(ports.map(port => port.id)).toEqual(['V-LIB:inlet', 'V-LIB:outlet']);
    expect(ports[0].point).toEqual({ x: 10, y: 0 });
    const connected = connectWaterPorts(doc, 'P-1:P2', 'V-LIB:inlet', 0.001);
    expect(connected.connections).toHaveLength(1);
    expect(connected.connections?.[0].aPortId).toBe('P-1:P2');
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

  it('prefers surveyed intermediate ground and invert RL over endpoint interpolation', () => {
    const pipe = createWaterComponent('pipe', 'P-SURVEY', 0, 0);
    pipe.geometry = [
      { x: 0, y: 0, groundLevelM: 100, invertLevelM: 98 },
      { x: 5, y: 0, groundLevelM: 102, invertLevelM: 99 },
      { x: 10, y: 0, groundLevelM: 99, invertLevelM: 97 },
    ];
    pipe.properties.externalDiameterMm = 110;
    const profile = buildPipeLongitudinalProfile(pipe);
    expect(profile[1].groundLevelM).toBe(102);
    expect(profile[1].invertLevelM).toBe(99);
    expect(profile[1].coverDepthM).toBeCloseTo(2.89);
  });

  it('builds grouped material quantities and preliminary excavation volumes', () => {
    const doc = document();
    const pipe2 = createWaterComponent('pipe', 'P-2', 10, 0);
    pipe2.geometry = [{ x: 10, y: 0 }, { x: 20, y: 0 }];
    doc.components.push(pipe2, createWaterComponent('valve', 'V-1', 10, 0));
    const boq = buildPreliminaryBoq(doc, 0.6, 1.2);
    expect(boq.find(q => q.code === 'PIPE')?.quantity).toBeCloseTo(20.198,3);
    expect(boq.find(q => q.code === 'VALVE_GATE')?.quantity).toBe(1);
    expect(boq.find(q => q.code === 'EXCAVATION')?.quantity).toBeCloseTo(14.5426,3);
  });

  it('keeps fitting schedule quantities separated by engineering type and size', () => {
    const bend = createWaterComponent('bend', 'B-1', 0, 0);
    bend.properties.bendAngleDeg = 45;
    const tee = createWaterComponent('tee', 'T-1', 0, 0);
    tee.properties.branchDiameterMm = 63;
    const gate = createWaterComponent('valve', 'V-1', 0, 0);
    const prv = createWaterComponent('valve', 'V-2', 0, 0);
    prv.properties.valveType = 'PRV';
    const document: WaterCadDocument = { schemaVersion: 1, units: 'm', verticalDatum: 'test', components: [bend, tee, gate, prv] };
    const schedule = buildWaterQuantities(document);
    expect(schedule.some(line => line.code.includes('45DEG'))).toBe(true);
    expect(schedule.some(line => line.code.includes('BR63'))).toBe(true);
    expect(schedule.some(line => line.code.includes('VALVE_GATE'))).toBe(true);
    expect(schedule.some(line => line.code.includes('VALVE_PRV'))).toBe(true);
  });

  it('exports valid network primitives and reports missing or unsupported items', () => {
    const doc = document();
    const badPipe = createWaterComponent('pipe', 'P-BAD', 0, 2);
    doc.components.push(badPipe, createWaterComponent('bend', 'B-1', 5, 0));
    doc.components.find(item => item.id === 'P-1')!.properties.minorLossCoefficient = 2.5;
    const exported = exportWaterNetworkToEpanet(doc);
    expect(exported.input).toContain('P-1 SRC-1 J-1 10.198 96 140 2.5 OPEN');
    expect(exported.input).toContain('[JUNCTIONS]');
    expect(exported.input).toContain('[RESERVOIRS]');
    expect(exported.input).toContain('[PIPES]');
    expect(exported.input).toContain('P-1 SRC-1 J-1');
    expect(exported.input).toContain('[END]');
    expect(exported.warnings.some(w => w.includes('P-BAD'))).toBe(true);
    expect(exported.warnings.some(w => w.includes('physical bend'))).toBe(true);
  });
});
