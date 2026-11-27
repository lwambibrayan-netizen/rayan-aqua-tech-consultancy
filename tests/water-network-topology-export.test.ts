import { describe, expect, it } from 'vitest';
import { createWaterComponent } from '../water-cad';
import { connectWaterPorts, exportWaterNetworkToEpanet, type NetworkDocument } from '../water-network-engineering';

describe('water network topology export', () => {
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
    const branch = createWaterComponent('pipe', 'PC', 0, 0.5);
    branch.geometry = [{ x: 0, y: 0.5 }, { x: 0, y: 1 }];
    let doc: NetworkDocument = { schemaVersion: 1, units: 'm', verticalDatum: 'test', components: [source, j1, j2, tee, a, b, branch] };
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

  it('rejects mismatched connection diameters and binds pipe endpoints to real node IDs', () => {
    const pipe = createWaterComponent('pipe', 'P1', 0, 0);
    pipe.geometry = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
    const source = createWaterComponent('source', 'SRC', 0, 0);
    const junction = createWaterComponent('junction', 'J', 1, 0);
    const doc: NetworkDocument = { schemaVersion: 1, units: 'm', verticalDatum: 'test', components: [pipe, source, junction] };
    const connected = connectWaterPorts(doc, 'P1:P1', 'SRC:P1', 0);
    const fullyConnected = connectWaterPorts(connected, 'P1:P2', 'J:P1', 0);
    expect(fullyConnected.components.find(c => c.id === 'P1')).toMatchObject({ fromNodeId: 'SRC', toNodeId: 'J' });
    const reducer = createWaterComponent('reducer', 'RED', 0, 0);
    reducer.properties.nominalDiameterMm = 160;
    reducer.properties.outletDiameterMm = 90;
    const large = createWaterComponent('pipe', 'LARGE', -1, 0);
    large.geometry = [{ x: -1, y: 0 }, { x: 0, y: 0 }];
    const mismatched: NetworkDocument = { schemaVersion: 1, units: 'm', verticalDatum: 'test', components: [reducer, large] };
    expect(() => connectWaterPorts(mismatched, 'LARGE:P2', 'RED:P2', 0)).toThrow(/diameters do not match/);
  });
});
