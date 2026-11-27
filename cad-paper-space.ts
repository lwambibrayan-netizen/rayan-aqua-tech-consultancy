/** Paper-space layout and viewport mathematics. Model coordinates are metres; paper dimensions are millimetres. */
export type PaperPoint={x:number;y:number};
export type PaperViewport={
 id:string;name:string;xMm:number;yMm:number;widthMm:number;heightMm:number;
 modelCenter:PaperPoint;scaleDenominator:number;rotationDeg:number;locked:boolean;visible:boolean;
};
export type PaperLayout={
 id:string;name:string;sheetSize:'A0'|'A1'|'A2'|'A3'|'A4'|'CUSTOM';
 widthMm:number;heightMm:number;orientation:'landscape'|'portrait';
 viewports:PaperViewport[];plotScale:'1:1';printableMarginMm:number;
};
export type ViewportTransform={scaleModelToPaper:number;rotationRad:number;modelToPaper:(point:PaperPoint)=>PaperPoint;paperToModel:(point:PaperPoint)=>PaperPoint};
const finite=(n:number)=>Number.isFinite(n);
export function validatePaperLayout(layout:PaperLayout):string[]{
 const issues:string[]=[];
 if(!layout.id.trim()||!layout.name.trim())issues.push('Layout ID and name are required.');
 if(!finite(layout.widthMm)||!finite(layout.heightMm)||layout.widthMm<=0||layout.heightMm<=0)issues.push('Paper dimensions must be positive finite millimetres.');
 if(!finite(layout.printableMarginMm)||layout.printableMarginMm<0||layout.printableMarginMm*2>=Math.min(layout.widthMm,layout.heightMm))issues.push('Printable margin is invalid for this sheet size.');
 const ids=new Set<string>();
 for(const v of layout.viewports){
  if(!v.id.trim()||ids.has(v.id))issues.push('Viewport IDs must be unique and non-empty.');ids.add(v.id);
  if(![v.xMm,v.yMm,v.widthMm,v.heightMm,v.modelCenter.x,v.modelCenter.y,v.scaleDenominator,v.rotationDeg].every(finite))issues.push(v.name+' has non-finite viewport properties.');
  if(v.widthMm<=0||v.heightMm<=0||v.scaleDenominator<=0)issues.push(v.name+' needs positive viewport dimensions and scale.');
  if(v.xMm<layout.printableMarginMm||v.yMm<layout.printableMarginMm||v.xMm+v.widthMm>layout.widthMm-layout.printableMarginMm||v.yMm+v.heightMm>layout.heightMm-layout.printableMarginMm)issues.push(v.name+' extends outside the printable sheet area.');
 }
 return issues;
}
export function createViewportTransform(viewport:PaperViewport):ViewportTransform{
 if(![viewport.modelCenter.x,viewport.modelCenter.y,viewport.scaleDenominator,viewport.rotationDeg].every(finite)||viewport.scaleDenominator<=0)throw new Error('Viewport transform parameters are invalid.');
 const rotationRad=viewport.rotationDeg*Math.PI/180,c=Math.cos(rotationRad),s=Math.sin(rotationRad);
 // 1 model metre at 1:N equals 1000/N paper millimetres.
 const scaleModelToPaper=1000/viewport.scaleDenominator;
 const modelToPaper=(point:PaperPoint):PaperPoint=>{
  const dx=point.x-viewport.modelCenter.x,dy=point.y-viewport.modelCenter.y;
  return{x:viewport.xMm+viewport.widthMm/2+scaleModelToPaper*(dx*c-dy*s),y:viewport.yMm+viewport.heightMm/2-scaleModelToPaper*(dx*s+dy*c)};
 };
 const paperToModel=(point:PaperPoint):PaperPoint=>{
  const x=(point.x-viewport.xMm-viewport.widthMm/2)/scaleModelToPaper;
  const y=-(point.y-viewport.yMm-viewport.heightMm/2)/scaleModelToPaper;
  return{x:viewport.modelCenter.x+x*c+y*s,y:viewport.modelCenter.y-x*s+y*c};
 };
 return{scaleModelToPaper,rotationRad,modelToPaper,paperToModel};
}
export function fitViewportScale(modelWidthM:number,modelHeightM:number,viewportWidthMm:number,viewportHeightMm:number,preferredDenominators:number[]=[20,25,50,75,100,150,200,250,500,1000,2000,5000]):number{
 if(![modelWidthM,modelHeightM,viewportWidthMm,viewportHeightMm].every(finite)||modelWidthM<=0||modelHeightM<=0||viewportWidthMm<=0||viewportHeightMm<=0)throw new Error('Model and viewport extents must be positive and finite.');
 const maxDenominator=Math.min(viewportWidthMm*1000/modelWidthM,viewportHeightMm*1000/modelHeightM);
 const candidates=preferredDenominators.filter(n=>finite(n)&&n>0&&n<=maxDenominator).sort((a,b)=>b-a);
 return candidates.length?candidates[0]:Math.max(1,Math.ceil(1/maxDenominator));
}
export function pointInsideViewport(point:PaperPoint,viewport:PaperViewport):boolean{
 return point.x>=viewport.xMm&&point.x<=viewport.xMm+viewport.widthMm&&point.y>=viewport.yMm&&point.y<=viewport.yMm+viewport.heightMm;
}
