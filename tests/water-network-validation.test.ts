import { describe, expect, it } from 'vitest';
import { createWaterComponent } from '../water-cad';
import { connectWaterPorts, validateWaterNetworkTopology, type NetworkDocument } from '../water-network-engineering';

describe('water network topology validation', () => {
  it('reports open pipe ends and missing fixed-head boundaries', () => {
    const pipe = createWaterComponent('pipe', 'P1', 0, 0);
    const doc: NetworkDocument = { schemaVersion: 1, units: 'm', verticalDatum: 'test', components: [pipe] };
    const issues = validateWaterNetworkTopology(doc);
    expect(issues.filter(issue => issue.code === 'OPEN_PIPE_END')).toHaveLength(2);
    expect(issues.some(issue => issue.code === 'NO_FIXED_HEAD')).toBe(true);
  });

  it('accepts connected fitting ports and reports any unconnected branch', () => {
    const tee = createWaterComponent('tee', 'T1', 0, 0);
    const pipe = createWaterComponent('pipe', 'P1', -1, 0);
    pipe.geometry = [{ x: -1, y: 0 }, { x: -0.5, y: 0 }];
    let doc: NetworkDocument = { schemaVersion: 1, units: 'm', verticalDatum: 'test', components: [tee, pipe] };
    doc = connectWaterPorts(doc, 'P1:P2', 'T1:P1', 0);
    const issues = validateWaterNetworkTopology(doc);
    expect(issues.some(issue => issue.code === 'OPEN_FITTING_PORT')).toBe(true);
    expect(issues.some(issue => issue.code === 'PORT_GAP')).toBe(false);
  });
});
