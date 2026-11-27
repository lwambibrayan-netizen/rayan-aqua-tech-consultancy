import{describe,it,expect}from'vitest';
import{createViewportTransform,fitViewportScale,pointInsideViewport,validatePaperLayout,type PaperLayout,type PaperViewport}from'../cad-paper-space';
const viewport:PaperViewport={id:'vp1',name:'Plan viewport',xMm:20,yMm:20,widthMm:250,heightMm:160,modelCenter:{x:500,y:300},scaleDenominator:100,rotationDeg:0,locked:true,visible:true};
describe('paper space layouts and model viewports',()=>{
 it('round-trips model coordinates through a scaled viewport',()=>{
  const t=createViewportTransform(viewport),p={x:512.5,y:287.25},paper=t.modelToPaper(p),back=t.paperToModel(paper);
  expect(back.x).toBeCloseTo(p.x);expect(back.y).toBeCloseTo(p.y);
  expect(t.scaleModelToPaper).toBe(10);
 });
 it('supports rotated viewports',()=>{
  const t=createViewportTransform({...viewport,rotationDeg:90}),p={x:510,y:300},back=t.paperToModel(t.modelToPaper(p));
  expect(back.x).toBeCloseTo(p.x);expect(back.y).toBeCloseTo(p.y);
 });
 it('selects the largest standard scale that fits the model extent',()=>{
  expect(fitViewportScale(100,50,200,100,[50,100,200,500])).toBe(500);
  expect(()=>fitViewportScale(0,10,100,100)).toThrow();
 });
 it('validates printable layout and viewport bounds',()=>{
  const layout:PaperLayout={id:'layout1',name:'Model plan',sheetSize:'A3',widthMm:420,heightMm:297,orientation:'landscape',viewports:[viewport],plotScale:'1:1',printableMarginMm:10};
  expect(validatePaperLayout(layout)).toEqual([]);
  expect(pointInsideViewport({x:20,y:20},viewport)).toBe(true);
  expect(validatePaperLayout({...layout,viewports:[{...viewport,xMm:400}]}).some(x=>x.includes('outside'))).toBe(true);
 });
});
