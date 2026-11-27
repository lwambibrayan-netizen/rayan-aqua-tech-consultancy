import type { DraftAnnotation, DraftingDocument } from './cad-drafting';
export type DxfShape = { id: string; type: 'line'|'polyline'|'rect'|'circle'; points: {x:number;y:number}[]; radius?: number; bulges?: number[]; layer: string };
export type DxfImportResult = { shapes: DxfShape[]; annotations: DraftAnnotation[]; layerNames: string[]; warnings: string[] };
type Pair = [string,string];
const fmt = (n:number) => Number.isFinite(n) ? String(Number(n.toPrecision(12))) : '0';
const entity = (kind:string, values:(string|number)[]) => ['0',kind,...values.map(String)];
function pairsOf(source:string): Pair[] {
  const rows=source.replace(/\r/g,'').split('\n');
  const pairs:Pair[]=[];
  for(let i=0;i+1<rows.length;i+=2) pairs.push([rows[i].trim(),rows[i+1].trim()]);
  return pairs;
}
export function exportDraftingDxf(shapes:DxfShape[], drafting:DraftingDocument, metresPerDrawingUnit=1):string {
  if(!Number.isFinite(metresPerDrawingUnit)||metresPerDrawingUnit<=0) throw new Error('A valid drawing calibration is required for DXF export.');
  const insunits=Math.abs(metresPerDrawingUnit-1)<1e-9?6:Math.abs(metresPerDrawingUnit-0.001)<1e-9?4:0;
  const layerMap = new Map(drafting.layers.map(layer => [layer.name.toUpperCase(), layer]));
  shapes.forEach(shape => { const name = shape.layer || '0'; if (!layerMap.has(name.toUpperCase())) layerMap.set(name.toUpperCase(), { name, color: '#666666', lineType: 'CONTINUOUS', lineWeightMm: 0.18, visible: true, locked: false, plot: true }); });
  drafting.annotations.forEach(item => { if (!layerMap.has(item.layer.toUpperCase())) layerMap.set(item.layer.toUpperCase(), { name: item.layer, color: '#666666', lineType: 'CONTINUOUS', lineWeightMm: 0.18, visible: true, locked: false, plot: true }); });
  const exportLayers = [...layerMap.values()];
  const out:string[]=['0','SECTION','2','HEADER','9','$ACADVER','1','AC1015','9','$INSUNITS','70',String(insunits),'9','$MEASUREMENT','70','1','0','ENDSEC','0','SECTION','2','TABLES','0','TABLE','2','LAYER','70',String(exportLayers.length)];
  for(const layer of exportLayers) out.push('0','LAYER','2',layer.name,'70',layer.locked?'4':'0','62',layer.visible? '7':'-7','420',String(parseInt(layer.color.slice(1),16)),'6',layer.lineType,'370',String(Math.round(layer.lineWeightMm*100)));
  out.push('0','ENDTAB','0','ENDSEC','0','SECTION','2','ENTITIES');
  for(const shape of shapes){
    const layer=shape.layer||'0';
    if(shape.type==='line') out.push(...entity('LINE',['8',layer,'10',fmt(shape.points[0].x),'20',fmt(shape.points[0].y),'11',fmt(shape.points[1].x),'21',fmt(shape.points[1].y)]));
    else if(shape.type==='circle') out.push(...entity('CIRCLE',['8',layer,'10',fmt(shape.points[0].x),'20',fmt(shape.points[0].y),'40',fmt(shape.radius||1)]));
    else {
      const pts=shape.type==='rect'?[shape.points[0],{x:shape.points[1].x,y:shape.points[0].y},shape.points[1],{x:shape.points[0].x,y:shape.points[1].y}]:shape.points;
      out.push(...entity('LWPOLYLINE',['8',layer,'90',pts.length,'70',shape.type==='rect'?'1':'0']));
      pts.forEach((p,i)=>out.push('10',fmt(p.x),'20',fmt(p.y),...(shape.bulges?.[i]?[ '42',fmt(shape.bulges[i]) ]:[])));
    }
  }
  const model = (p:{x:number;y:number})=>({x:p.x/metresPerDrawingUnit,y:p.y/metresPerDrawingUnit});
  const textEntity=(at:{x:number;y:number},text:string,height:number,layer:string,rotation=0)=>out.push(...entity('TEXT',['8',layer,'10',fmt(at.x),'20',fmt(at.y),'40',fmt(height),'1',text.replace(/\n/g,' '),'50',fmt(rotation)]));
  for(const item of drafting.annotations){
    if(item.kind==='text') textEntity(model(item.at),item.text,item.heightMm*(Number(drafting.sheet.scale.split(':')[1])||100)/1000/metresPerDrawingUnit,item.layer,item.rotationDeg);
    else if(item.kind==='leader'){
      const pts=item.points.map(model); out.push(...entity('LWPOLYLINE',['8',item.layer,'90',pts.length,'70','0']));
      pts.forEach(p=>out.push('10',fmt(p.x),'20',fmt(p.y)));
      const last=pts[pts.length-1]; textEntity({x:last.x+0.5,y:last.y+0.5},item.text,item.textHeightMm*(Number(drafting.sheet.scale.split(':')[1])||100)/1000/metresPerDrawingUnit,item.layer);
    } else {
      const a=model(item.a),b=model(item.b),dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1,nx=-dy/len,ny=dx/len,off=item.offsetM/metresPerDrawingUnit;
      const p1={x:a.x+nx*off,y:a.y+ny*off},p2={x:b.x+nx*off,y:b.y+ny*off};
      for(const [s,e] of [[a,p1],[b,p2],[p1,p2]]) out.push(...entity('LINE',['8',item.layer,'10',fmt(s.x),'20',fmt(s.y),'11',fmt(e.x),'21',fmt(e.y)]));
      const label=item.textOverride||((item.kind==='aligned'?Math.hypot(item.b.x-item.a.x,item.b.y-item.a.y):Math.abs(item.b.x-item.a.x)).toFixed(item.precision));
      textEntity({x:(p1.x+p2.x)/2,y:(p1.y+p2.y)/2},label,2.5*(Number(drafting.sheet.scale.split(':')[1])||100)/1000/metresPerDrawingUnit,item.layer);
    }
  }
  out.push('0','ENDSEC','0','EOF');
  return out.join('\n');
}
export function importDraftingDxf(source:string, metresPerDrawingUnit=1, scaleDenominator=100):DxfImportResult {
  if(!Number.isFinite(metresPerDrawingUnit)||metresPerDrawingUnit<=0) throw new Error('Drawing calibration must be positive.');
  if(!Number.isFinite(scaleDenominator)||scaleDenominator<=0) throw new Error('Drawing scale denominator must be positive.');
  const pairs=pairsOf(source);
  const start=pairs.findIndex(p=>p[0]==='2'&&p[1]==='ENTITIES');
  if(start<0) throw new Error('DXF ENTITIES section not found.');
  const shapes:DxfShape[]=[],annotations:DraftAnnotation[]=[],layers=new Set<string>(),warnings:string[]=[];
  let current:{type:string;values:Pair[]}|null=null,seq=0;
  const flush=()=>{
    if(!current)return;
    const v=current.values;
    const get=(code:string)=>v.find(p=>p[0]===code)?.[1];
    const num=(code:string)=>Number(get(code)||0);
    const layer=get('8')||'0'; layers.add(layer);
    const id='DXF-'+(++seq);
    if(current.type==='LINE') shapes.push({id,type:'line',points:[{x:num('10'),y:num('20')},{x:num('11'),y:num('21')}],layer});
    else if(current.type==='CIRCLE') shapes.push({id,type:'circle',points:[{x:num('10'),y:num('20')}],radius:num('40'),layer});
    else if(current.type==='LWPOLYLINE'){
      const points:{x:number;y:number}[]=[],bulges:number[]=[];let x:number|null=null;
      v.forEach(([code,value])=>{if(code==='10')x=Number(value);else if(code==='20'&&x!==null){points.push({x,y:Number(value)});bulges.push(0);x=null;}else if(code==='42'&&bulges.length)bulges[bulges.length-1]=Number(value);});
      if(points.length>1){if((num('70')&1)===1)points.push({...points[0]});shapes.push({id,type:'polyline',points,bulges,layer});}
    } else if(current.type==='TEXT'||current.type==='MTEXT'){
      const raw=v.filter(p=>p[0]==='3'||p[0]==='1').map(p=>p[1]).join('');
      annotations.push({id,kind:'text',layer,at:{x:num('10')*metresPerDrawingUnit,y:num('20')*metresPerDrawingUnit},text:raw.replace(/\\P/g,'\n'),heightMm:Math.max(0.5,num('40')*1000*metresPerDrawingUnit/scaleDenominator),rotationDeg:num('50')});
    } else if(current.type==='ARC'){
      const cx=num('10'),cy=num('20'),r=num('40'),a=num('50')*Math.PI/180,b=num('51')*Math.PI/180;
      let sweep=b-a;if(sweep<=0)sweep+=Math.PI*2;
      const p1={x:cx+r*Math.cos(a),y:cy+r*Math.sin(a)},p2={x:cx+r*Math.cos(b),y:cy+r*Math.sin(b)};
      shapes.push({id,type:'polyline',points:[p1,p2],bulges:[Math.tan(sweep/4),0],layer});
    } else if(current.type==='DIMENSION') {
      const a={x:num('13')*metresPerDrawingUnit,y:num('23')*metresPerDrawingUnit};
      const b={x:num('14')*metresPerDrawingUnit,y:num('24')*metresPerDrawingUnit};
      if(Math.hypot(b.x-a.x,b.y-a.y)>1e-9) { const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy),nx=-dy/len,ny=dx/len,locX=num('10')*metresPerDrawingUnit,locY=num('20')*metresPerDrawingUnit; const offsetM=(locX-a.x)*nx+(locY-a.y)*ny; annotations.push({id,kind:(num('70')&1)?'aligned':'linear',layer,a,b,offsetM,precision:3,textOverride:get('1')&&get('1')!=='<>'?get('1'):undefined}); }
      else warnings.push('Skipped DIMENSION with missing definition points.');
    } else if(current.type==='POINT') {
      shapes.push({id,type:'circle',points:[{x:num('10'),y:num('20')}],radius:0.03,layer});
    } else warnings.push('Skipped unsupported DXF entity '+current.type+'.');
    current=null;
  };
  for(let i=start+1;i<pairs.length;i++){
    const [code,value]=pairs[i];
    if(code==='0'){flush();if(value==='ENDSEC')break;current={type:value,values:[]};}
    else if(current)current.values.push([code,value]);
  }
  flush();
  if(!shapes.length&&!annotations.length)throw new Error('No supported LINE, CIRCLE, ARC, LWPOLYLINE, TEXT or MTEXT entities found.');
  return {shapes,annotations,layerNames:[...layers],warnings};
}
