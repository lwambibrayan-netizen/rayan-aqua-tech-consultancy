import{describe,it,expect}from'vitest';
import{auditEngineeringDrawing}from'../cad-engineering-verification';
import{createDraftingDocument}from'../cad-drafting';
import{DIMENSION_STYLES}from'../cad-dimension-standards';
import{synchronizeLayerTemplate}from'../cad-layer-standards';
import{createWaterComponent}from'../water-cad';
import type{WaterCadDocument}from'../water-cad';
const water:WaterCadDocument={schemaVersion:1,units:'m',verticalDatum:'Project datum',components:[createWaterComponent('pipe','P-1',0,0)]};
describe('integrated engineering drawing audit',()=>{
 it('passes a calibrated drawing with valid water CAD and geometry',()=>{
  const result=auditEngineeringDrawing({drafting:createDraftingDocument(),waterCad:water,shapes:[{id:'L1',type:'line',points:[{x:0,y:0},{x:10,y:0}],layer:'WATER_NETWORK'}],metresPerDrawingUnit:1});
  expect(result.status).toBe('PASS');
  expect(result.errors).toBe(0);
  expect(result.summary.waterComponentCount).toBe(1);
 });
 it('fails drawings that are uncalibrated or contain invalid geometry',()=>{
  const result=auditEngineeringDrawing({drafting:createDraftingDocument(),waterCad:water,shapes:[{id:'C1',type:'circle',points:[{x:0,y:0}],radius:-1,layer:'0'}],metresPerDrawingUnit:null});
  expect(result.status).toBe('FAIL');
  expect(result.issues.some(x=>x.code==='DRAWING_SCALE_UNCALIBRATED')).toBe(true);
  expect(result.issues.some(x=>x.code==='INVALID_CIRCLE_RADIUS')).toBe(true);
 });
 it('detects invalid hydraulic components and duplicate geometry IDs',()=>{
  const invalid={...water,components:[...water.components,{...water.components[0],properties:{...water.components[0].properties,internalDiameterMm:0}}]};
  const result=auditEngineeringDrawing({drafting:createDraftingDocument(),waterCad:invalid,shapes:[{id:'L',type:'line',points:[{x:0,y:0},{x:1,y:0}],layer:'0'},{id:'L',type:'line',points:[{x:0,y:0},{x:2,y:0}],layer:'0'}],metresPerDrawingUnit:1});
  expect(result.status).toBe('FAIL');
  expect(result.issues.some(x=>x.code==='PIPE_BORE_REQUIRED')).toBe(true);
  expect(result.issues.some(x=>x.code==='DUPLICATE_SHAPE_ID')).toBe(true);
 });

 it('passes when the selected layer profile and dimension style conform',()=>{
  const layers=synchronizeLayerTemplate(createDraftingDocument().layers,'WATER_UTILITY').layers;
  const style=DIMENSION_STYLES.ISO;
  const result=auditEngineeringDrawing({drafting:createDraftingDocument({layers,dimensionStyle:style}),waterCad:water,shapes:[],metresPerDrawingUnit:1,layerStandard:'WATER_UTILITY',dimensionStyle:style});
  expect(result.status).toBe('PASS');
  expect(result.errors).toBe(0);
 });
 it('fails when the selected layer profile is incomplete',()=>{
  const layers=synchronizeLayerTemplate(createDraftingDocument().layers,'WATER_UTILITY').layers.filter(layer=>layer.name!=='WATER_PIPE');
  const result=auditEngineeringDrawing({drafting:createDraftingDocument({layers}),waterCad:water,shapes:[],metresPerDrawingUnit:1,layerStandard:'WATER_UTILITY'});
  expect(result.status).toBe('FAIL');
  expect(result.issues.some(x=>x.code==='LAYER_STANDARD_NONCONFORMING'&&x.message.includes('WATER_PIPE'))).toBe(true);
 });
});
