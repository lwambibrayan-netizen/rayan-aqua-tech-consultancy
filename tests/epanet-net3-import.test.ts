import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fromInp, validate } from '../EpanetEnginePanel';

describe('EPA Net3 EPANET benchmark import', () => {
  const source = readFileSync(resolve(process.cwd(), 'tests/fixtures/Net3.inp'), 'utf8');
  const model = fromInp(source);

  it('imports the complete network without node/link ID namespace collisions', () => {
    expect(model.nodes).toHaveLength(97);
    expect(model.nodes.filter(n => n.kind === 'J')).toHaveLength(92);
    expect(model.nodes.filter(n => n.kind === 'R')).toHaveLength(2);
    expect(model.nodes.filter(n => n.kind === 'T')).toHaveLength(3);
    expect(model.links).toHaveLength(119);
    expect(model.links.filter(l => l.kind === 'pipe')).toHaveLength(117);
    expect(model.links.filter(l => l.kind === 'pump')).toHaveLength(2);
    expect(model.links.some(l => l.id === '101')).toBe(true);
    expect(model.nodes.some(n => n.id === '101')).toBe(true);
  });

  it('converts GPM, feet, inches and tank geometry to metric internal values', () => {
    const junction = model.nodes.find(n => n.id === '101');
    const reservoir = model.nodes.find(n => n.id === 'River');
    const tank = model.nodes.find(n => n.id === '1');
    const pipe = model.links.find(l => l.id === '60');
    expect(junction?.elevation).toBeCloseTo(12.8016, 4);
    expect(junction?.demand).toBeCloseTo(11.98398, 4);
    expect(reservoir?.head).toBeCloseTo(67.056, 3);
    expect(tank?.elevation).toBeCloseTo(40.20312, 4);
    expect(tank?.initialLevel).toBeCloseTo(3.99288, 4);
    expect(tank?.diameter).toBeCloseTo(25.908, 3);
    expect(tank?.volumeCurve).toBeUndefined();
    expect(pipe?.length).toBeCloseTo(375.2088, 3);
    expect(pipe?.diameter).toBeCloseTo(609.6, 2);
  });

  it('preserves seven-day controls, pump curves, demand patterns and source tracing', () => {
    const pump = model.links.find(l => l.id === '10');
    const patternedJunction = model.nodes.find(n => n.id === '15');
    expect(model.settings.duration).toBe(168);
    expect(model.settings.timeControls?.length ?? 0).toBeGreaterThan(0);
    expect(model.settings.tankControls?.length ?? 0).toBeGreaterThan(0);
    expect(pump?.pumpCurve).toContain('126.1804:28.0416');
    expect(patternedJunction?.demandPattern).not.toBe('');
    expect(model.settings.qualityMode).toBe('trace');
    expect(model.settings.qualityTraceNode).toBe('Lake');
    expect((model.inpExtras?.STATUS ?? []).map(row => row.trim().replace(/\s+/g, ' '))).toContain('10 Closed');
  });

  it('passes the importer validation checks', () => {
    expect(validate(model)).toEqual([]);
  });
});
