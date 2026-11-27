import { describe, expect, it } from 'vitest';
import { createWaterComponent, type WaterCadDocument } from '../water-cad';
import { sampleTerrainElevation, sampleGroundProfile, applyTerrainToPipe, buildTerrainIssues, type TerrainGrid } from '../water-terrain-engineering';
import { importEpanetInp } from '../water-epanet-bridge';
import { buildHydraulicOverlay } from '../water-hydraulic-overlays';

const terrain:TerrainGrid={width:3,height:3,originX:0,originY:0,cellSizeX:10,cellSizeY:10,elevationsM:[100,101,102,99,100,101,98,99,100],crs:'LOCAL',verticalDatum:'Project datum'};
describe('terrain-aware water engineering',()=>{
 it('bilinearly samples terrain and rejects outside/no-data samples',()=>{
  expect(sampleTerrainElevation(terrain,5,5)).toBeCloseTo(100);
  expect(sampleTerrainElevation(terrain,-1,0)).toBeNull();
  expect(()=>sampleTerrainElevation({...terrain,elevationsM:[null,...terrain.elevationsM.slice(1)]},1,1)).not.toThrow();
 });
 it('samples a route ground profile at regular chainages',()=>{
  const profile=sampleGroundProfile(terrain,[{x:0,y:0},{x:20,y:0}],5);
  expect(profile.map(p=>p.chainageM)).toEqual([0,5,10,15,20]);
  expect(profile[2].groundLevelM).toBe(101);
 });
 it('routes a pipe below sampled terrain using crown cover and pipe OD',()=>{
  const pipe=createWaterComponent('pipe','P-1',0,0);
  pipe.geometry=[{x:0,y:0},{x:20,y:0}];
  const routed=applyTerrainToPipe(pipe,terrain,1.2);
  expect(routed.geometry[0].groundLevelM).toBe(100);
  expect(routed.geometry[0].invertLevelM).toBeCloseTo(98.69);
  expect(routed.geometry[0].z).toBeCloseTo(98.745);
  expect(routed.properties.coverDepthM).toBe(1.2);
  expect(buildTerrainIssues({schemaVersion:1,units:'m',verticalDatum:'test',components:[routed]})).toHaveLength(0);
 });
 it('reports insufficient cover and above-ground conflicts',()=>{
  const pipe=createWaterComponent('pipe','P-2',0,0);
  pipe.geometry=[{x:0,y:0,groundLevelM:100,invertLevelM:99.95},{x:10,y:0,groundLevelM:100,invertLevelM:98}];
  const issues=buildTerrainIssues({schemaVersion:1,units:'m',verticalDatum:'test',components:[pipe]});
  expect(issues.some(i=>i.code==='PIPE_ABOVE_GROUND')).toBe(true);
 });
});
describe('EPANET bridge and drawing result overlay',()=>{
 const inp=`[JUNCTIONS]
J1 100 2
J2 98 0
[RESERVOIRS]
R1 110
[PIPES]
P1 R1 J1 125 150 140 0.2 OPEN
P2 J1 J2 80 100 130 0 OPEN
[OPTIONS]
UNITS LPS
[COORDINATES]
R1 0 0
J1 100 0
J2 180 0
[END]`;
 it('imports nodes and links while preserving elevations, geometry and hydraulic lengths',()=>{
  const result=importEpanetInp(inp,'AHD');
  const p=result.document.components.find(c=>c.id==='P1')!;
  expect(result.document.components.find(c=>c.id==='J1')?.geometry[0].z).toBe(100);
  expect(p.properties.hydraulicLengthM).toBe(125);
  expect(p.properties.internalDiameterMm).toBe(150);
  expect(p.geometry[1].x).toBe(100);
  expect(result.warnings).toHaveLength(0);
 });
 it('warns when EPANET coordinates are absent rather than pretending the layout is surveyed',()=>{
  const result=importEpanetInp('[JUNCTIONS]\nJ1 10 1\n[RESERVOIRS]\nR1 20\n[PIPES]\nP1 R1 J1 50 100 130 0 OPEN\n[END]');
  expect(result.warnings.some(w=>w.includes('Synthetic layout positions'))).toBe(true);
 });
 it('maps simulation results to CAD IDs and highlights threshold violations',()=>{
  const document:WaterCadDocument={schemaVersion:1,units:'m',verticalDatum:'test',components:[createWaterComponent('junction','J1',0,0),createWaterComponent('pipe','P1',0,0)]};
  const overlay=buildHydraulicOverlay(document,{timeSeconds:3600,nodes:[{id:'J1',pressureM:4}],links:[{id:'P1',flowLps:12,velocityMs:2.8,headlossM:5}]},'velocityMs',{maximum:2});
  expect(overlay.items[0].componentId).toBe('P1');
  expect(overlay.items[0].severity).toBe('critical');
  expect(overlay.timeSeconds).toBe(3600);
 });
});
