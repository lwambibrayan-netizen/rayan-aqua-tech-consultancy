import {validateDraftingDocument,type DraftingDocument,sheetDimensionsMm} from './cad-drafting';
import {validateWaterCad,type WaterCadDocument} from './water-cad';
import type {DxfShape} from './cad-dxf';
import {validatePaperLayout,type PaperLayout} from './cad-paper-space';
export type EngineeringDrawingIssue={severity:'error'|'warning';code:string;message:string;source:'drafting'|'water-cad'|'geometry'|'paper-space'};
export type EngineeringDrawingAuditInput={
 drafting:DraftingDocument;waterCad:WaterCadDocument;shapes:DxfShape[];
 metresPerDrawingUnit:number|null;paperLayouts?:PaperLayout[];
};
export type EngineeringDrawingAudit={
 status:'PASS'|'PASS_WITH_WARNINGS'|'FAIL';errors:number;warnings:number;issues:EngineeringDrawingIssue[];
 summary:{shapeCount:number;annotationCount:number;waterComponentCount:number;layerCount:number;sheetCount:number;viewportCount:number};
};
export function auditEngineeringDrawing(input:EngineeringDrawingAuditInput):EngineeringDrawingAudit{
 const issues:EngineeringDrawingIssue[]=[];
 const add=(severity:EngineeringDrawingIssue['severity'],code:string,message:string,source:EngineeringDrawingIssue['source'])=>issues.push({severity,code,message,source});
 for(const message of validateDraftingDocument(input.drafting))add('error','DRAFTING_INVALID',message,'drafting');
 for(const item of validateWaterCad(input.waterCad))add(item.severity,item.code,item.message,'water-cad');
 if(input.metresPerDrawingUnit===null||!Number.isFinite(input.metresPerDrawingUnit)||input.metresPerDrawingUnit<=0)add('error','DRAWING_SCALE_UNCALIBRATED','Drawing scale is not calibrated to a verified real-world length.','geometry');
 const layerNames=new Set(input.drafting.layers.map(layer=>layer.name.toUpperCase()));
 const shapeIds=new Set<string>();
 for(const shape of input.shapes){
  if(!shape.id||shapeIds.has(shape.id))add('error','DUPLICATE_SHAPE_ID','CAD shape IDs must be unique and non-empty.','geometry');
  shapeIds.add(shape.id);
  if(!layerNames.has((shape.layer||'0').toUpperCase()))add('warning','UNDEFINED_SHAPE_LAYER','Shape '+shape.id+' uses undefined layer '+(shape.layer||'0')+'.','geometry');
  if(shape.points.length<1||shape.points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))add('error','INVALID_SHAPE_GEOMETRY','Shape '+shape.id+' has missing or non-finite coordinates.','geometry');
  if(shape.type==='line'&&shape.points.length!==2)add('error','INVALID_LINE_GEOMETRY','Line '+shape.id+' must have exactly two endpoints.','geometry');
  if(shape.type==='circle'&&(!Number.isFinite(shape.radius)||Number(shape.radius)<=0))add('error','INVALID_CIRCLE_RADIUS','Circle '+shape.id+' must have a positive finite radius.','geometry');
 }
 for(const annotation of input.drafting.annotations)if(!layerNames.has(annotation.layer.toUpperCase()))add('warning','UNDEFINED_ANNOTATION_LAYER','Annotation '+annotation.id+' uses undefined layer '+annotation.layer+'.','drafting');
 const sheets=input.drafting.sheets?.length?input.drafting.sheets:[input.drafting.sheet];
 sheets.forEach((sheet,index)=>{
  const dimensions=sheetDimensionsMm(sheet);
  if(!Number.isFinite(dimensions.widthMm)||!Number.isFinite(dimensions.heightMm)||dimensions.widthMm<=0||dimensions.heightMm<=0)add('error','INVALID_SHEET_SIZE','Drawing sheet '+(index+1)+' has invalid dimensions.','drafting');
  if(!/^1:\d+(?:\.\d+)?$/.test(sheet.scale))add('error','INVALID_SHEET_SCALE','Drawing sheet '+(index+1)+' has an invalid scale notation.','drafting');
 });
 let viewportCount=0;
 for(const layout of input.paperLayouts||[]){viewportCount+=layout.viewports.length;for(const message of validatePaperLayout(layout))add('error','PAPER_LAYOUT_INVALID',message,'paper-space');}
 const errors=issues.filter(item=>item.severity==='error').length,warnings=issues.filter(item=>item.severity==='warning').length;
 return {status:errors?'FAIL':warnings?'PASS_WITH_WARNINGS':'PASS',errors,warnings,issues,summary:{shapeCount:input.shapes.length,annotationCount:input.drafting.annotations.length,waterComponentCount:input.waterCad.components.length,layerCount:input.drafting.layers.length,sheetCount:sheets.length,viewportCount}};
}
