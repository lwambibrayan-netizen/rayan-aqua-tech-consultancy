import { describe, expect, it } from 'vitest';
import { runEpanetHydraulicSimulation } from '../water-epanet-runner';

describe('OWA-EPANET simulation adapter',()=>{
  it('runs a simple reservoir-junction network and returns node and link hydraulics',async()=>{
    const input=`[TITLE]
RayanAqua EPANET engine integration test
[JUNCTIONS]
J1 0 1
[RESERVOIRS]
R1 100
[PIPES]
P1 R1 J1 100 100 130 0 OPEN
[OPTIONS]
UNITS LPS
HEADLOSS H-W
[TIMES]
DURATION 0
HYDRAULIC TIMESTEP 1:00
[REPORT]
NODES ALL
LINKS ALL
[COORDINATES]
R1 0 0
J1 100 0
[END]`;
    const output=await runEpanetHydraulicSimulation(input);
    expect(output.engine).toContain('OWA-EPANET');
    expect(output.results.length).toBeGreaterThan(0);
    expect(output.results[0].nodes.find(node=>node.id==='J1')?.pressureM).toBeGreaterThan(0);
    expect(output.results[0].links.find(link=>link.id==='P1')?.velocityMs).toBeGreaterThan(0);
  },30000);
});
