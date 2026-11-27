import {describe,it,expect} from 'vitest';
import {ENGINEERING_BLOCK_LIBRARY,getEngineeringBlock,validateEngineeringBlock,instantiateEngineeringBlock,instantiateEngineeringPorts} from '../cad-object-library';
describe('parametric water engineering object library',()=>{
 it('provides validated engineering blocks with unique named connection ports',()=>{
  expect(ENGINEERING_BLOCK_LIBRARY.length).toBeGreaterThanOrEqual(10);
  for(const block of ENGINEERING_BLOCK_LIBRARY) expect(validateEngineeringBlock(block)).toEqual([]);
  expect(getEngineeringBlock('PRV').defaultProperties.valveType).toBe('PRV');
  expect(getEngineeringBlock('PUMP_CENTRIFUGAL').ports.map(p=>p.id)).toEqual(['suction','discharge']);
 });
 it('returns independent copies of library definitions',()=>{
  const block=getEngineeringBlock('GATE_VALVE');block.ports[0].point.x=999;
  expect(getEngineeringBlock('GATE_VALVE').ports[0].point.x).toBe(-100);
 });
 it('transforms inserted symbols and ports by scale, rotation and translation',()=>{
  const insert={blockName:'GATE_VALVE',at:{x:1000,y:2000},rotationDeg:90,scaleX:2,scaleY:2,layer:'WATER_VALVE',properties:{}};
  const primitives=instantiateEngineeringBlock(insert);
  const first=primitives.find(p=>p.kind==='line'&&p.a.x===1000&&p.a.y===1800);
  expect(first).toBeDefined();
  const ports=instantiateEngineeringPorts(insert,getEngineeringBlock('GATE_VALVE'));
  expect(ports[0].point.x).toBeCloseTo(1000);
  expect(ports[0].point.y).toBeCloseTo(1800);
  expect(ports[0].directionDeg).toBe(270);
 });
 it('rejects invalid insert transforms and unknown symbols',()=>{
  expect(()=>instantiateEngineeringBlock({blockName:'NOPE',at:{x:0,y:0},rotationDeg:0,scaleX:1,scaleY:1,layer:'0',properties:{}})).toThrow();
  expect(()=>instantiateEngineeringBlock({blockName:'GATE_VALVE',at:{x:0,y:0},rotationDeg:0,scaleX:0,scaleY:1,layer:'0',properties:{}})).toThrow();
 });
});
