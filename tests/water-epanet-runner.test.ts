import { describe, expect, it } from 'vitest';
import { runEpanetHydraulicSimulation } from '../water-epanet-runner';
import { createWaterComponent } from '../water-cad';
import { exportWaterNetworkToEpanet } from '../water-network-engineering';

describe('OWA-EPANET simulation adapter',()=>{
  it('runs a complete CAD-authored network through the real EPANET engine',async()=>{
    const source=createWaterComponent('source','SRC-1',0,0);
    source.properties.hydraulicHeadM=100;
    const junction=createWaterComponent('junction','J-1',100,0);
    junction.properties.hydraulicElevationM=0;
    junction.properties.flowM3h=3.6;
    const pipe=createWaterComponent('pipe','P-1',0,0);
    pipe.geometry=[{x:0,y:0,z:100},{x:100,y:0,z:0}];
    pipe.fromNodeId=source.id;pipe.toNodeId=junction.id;
    pipe.properties.hydraulicLengthM=100;pipe.properties.internalDiameterMm=100;pipe.properties.roughness=130;
    const exported=exportWaterNetworkToEpanet({schemaVersion:1,units:'m',verticalDatum:'test',components:[source,junction,pipe]});
    expect(exported.warnings.filter(warning=>warning.includes('omitted'))).toHaveLength(0);
    const output=await runEpanetHydraulicSimulation(exported.input);
    expect(output.results[0].nodes.find(node=>node.id==='J-1')?.pressureM).toBeGreaterThan(0);
    expect(output.results[0].links.find(link=>link.id==='P-1')?.velocityMs).toBeGreaterThan(0);
  },30000);
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
