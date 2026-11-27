import { CountType, InitHydOption, LinkProperty, NodeProperty, Project, Workspace } from 'epanet-js';
import type { HydraulicResults } from './water-epanet-bridge';

export type EpanetSimulationOutput = { results: HydraulicResults[]; engine: string; report: string };
/** Runs the real OWA-EPANET WASM engine against an INP model and returns each hydraulic timestep. */
export async function runEpanetHydraulicSimulation(input: string): Promise<EpanetSimulationOutput> {
  if (!input.trim() || !input.includes('[END]')) throw new Error('A complete EPANET INP model ending with [END] is required.');
  const workspace = new Workspace();
  await workspace.loadModule();
  const project = new Project(workspace);
  let opened = false;
  let hydraulicsOpen = false;
  try {
    workspace.writeFile('rayan-aqua-network.inp', input);
    project.open('rayan-aqua-network.inp', 'rayan-aqua-report.rpt', 'rayan-aqua-output.bin');
    opened = true;
    const nodeCount = project.getCount(CountType.NodeCount);
    const linkCount = project.getCount(CountType.LinkCount);
    if (nodeCount < 1 || linkCount < 1) throw new Error('EPANET model must contain at least one node and one hydraulic link.');
    const results: HydraulicResults[] = [];
    project.openH();
    hydraulicsOpen = true;
    project.initH(InitHydOption.NoSave);
    let nextStep = 1;
    let iterations = 0;
    while (nextStep > 0) {
      if (++iterations > 10000) throw new Error('EPANET simulation exceeded 10,000 hydraulic steps; check the duration and timestep settings.');
      const timeSeconds = project.runH();
      const nodes = Array.from({ length: nodeCount }, (_, index) => {
        const i = index + 1;
        return {
          id: project.getNodeId(i),
          pressureM: project.getNodeValue(i, NodeProperty.Pressure),
          headM: project.getNodeValue(i, NodeProperty.Head),
          demandLps: project.getNodeValue(i, NodeProperty.Demand),
        };
      });
      const links = Array.from({ length: linkCount }, (_, index) => {
        const i = index + 1;
        return {
          id: project.getLinkId(i),
          flowLps: project.getLinkValue(i, LinkProperty.Flow),
          velocityMs: project.getLinkValue(i, LinkProperty.Velocity),
          headlossM: project.getLinkValue(i, LinkProperty.HeadLoss),
          status: String(project.getLinkValue(i, LinkProperty.Status)),
        };
      });
      results.push({ timeSeconds, nodes, links });
      nextStep = project.nextH();
    }
    project.closeH();
    hydraulicsOpen = false;
    project.close();
    opened = false;
    let report = '';
    try { report = workspace.readFile('rayan-aqua-report.rpt') as string; } catch { /* report text is optional; numerical results are returned above */ }
    return { results, engine: 'OWA-EPANET via epanet-js', report };
  } finally {
    if (hydraulicsOpen) { try { project.closeH(); } catch { /* retain original engine error */ } }
    if (opened) { try { project.close(); } catch { /* retain original engine error */ } }
  }
}
