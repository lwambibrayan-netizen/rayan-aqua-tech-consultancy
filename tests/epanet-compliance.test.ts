import { describe, expect, it } from 'vitest';
import { diagnose } from '../EpanetEnginePanel';

describe('EPANET velocity compliance diagnosis', () => {
  it('flags a pipe above the configured maximum as HIGH and gives a corrective recommendation', () => {
    const network = {
      settings: { minPressure: 15, maxPressure: 60, minVelocity: 0.3, maxVelocity: 2.0 },
      nodes: [],
    };
    const links = [{
      id: 'PIPE-60',
      kind: 'pipe',
      flow: 12,
      velocity: 2.83,
      minVelocity: 1.1,
      maxVelocity: 2.83,
      headloss: 4.2,
      status: 'Open',
    }];

    const suggestions = diagnose(network as any, [], links as any);

    expect(suggestions).toContain(
      'PIPE-60: maximum simulated velocity 2.83 m/s exceeds the 2.00 m/s limit. Recheck peak flow and internal diameter; compare larger diameter or parallel pipeline options and rerun headloss and cost calculations.',
    );
  });

  it('does not report a high-velocity failure when the pipe remains within the limit', () => {
    const network = {
      settings: { minPressure: 15, maxPressure: 60, minVelocity: 0.3, maxVelocity: 2.0 },
      nodes: [],
    };
    const links = [{
      id: 'PIPE-OK',
      kind: 'pipe',
      flow: 8,
      velocity: 1.4,
      minVelocity: 0.8,
      maxVelocity: 1.4,
      headloss: 1.2,
      status: 'Open',
    }];

    const suggestions = diagnose(network as any, [], links as any);

    expect(suggestions.some((message) => message.includes('PIPE-OK') && message.includes('exceeds'))).toBe(false);
  });
});
