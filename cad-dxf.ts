import type { DraftAnnotation, DraftingDocument, DraftLayer } from './cad-drafting';
export type DxfShape = { id: string; type: 'line'|'polyline'|'rect'|'circle'; points: {x:number;y:number}[]; radius?: number; bulges?: number[]; layer: string };
export type DxfImportResult = { shapes: DxfShape[]; annotations: DraftAnnotation[]; layerNames: string[]; layers: DraftLayer[]; warnings: string[]; metresPerDrawingUnit: number | null };
type Pair = [string,string];
const fmt = (n:number) => Number.isFinite(n) ? String(Number(n.toPrecision(12))) : '0';
const entity = (kind:string, values:(string|number)[], handle:string) => {
  const subclasses:Record<string,string>={LINE:'AcDbLine',CIRCLE:'AcDbCircle',LWPOLYLINE:'AcDbPolyline',TEXT:'AcDbText'};
  const layerIndex=values.findIndex(value=>String(value)==='8');
  const output=['0',kind,'5',handle,'100','AcDbEntity'];
  if(layerIndex>=0){output.push(String(values[layerIndex]),String(values[layerIndex+1]));}
  output.push('100',subclasses[kind]||'AcDbEntity');
  const remaining=layerIndex>=0?[...values.slice(0,layerIndex),...values.slice(layerIndex+2)]:values;
  output.push(...remaining.map(String));
  return output;
};
function pairsOf(source:string): Pair[] {
  const rows=source.replace(/\r/g,'').split('\n');
  const pairs:Pair[]=[];
  for(let i=0;i+1<rows.length;i+=2) pairs.push([rows[i].trim(),rows[i+1].trim()]);
  return pairs;
}

function normalizeLegacyPolylines(input: Pair[], warnings: string[]): Pair[] {
  const output: Pair[] = [];
  for (let i = 0; i < input.length; i++) {
    const pair = input[i];
    if (pair[0] !== '0' || pair[1] !== 'POLYLINE') { output.push(pair); continue; }
    const header: Pair[] = [];
    const vertices: Pair[][] = [];
    let vertex: Pair[] | null = null;
    let closed = false;
    let layer = '0';
    let ended = false;
    for (i++; i < input.length; i++) {
      const [code, value] = input[i];
      if (code === '0' && value === 'VERTEX') { if (vertex) vertices.push(vertex); vertex = []; continue; }
      if (code === '0' && value === 'SEQEND') { if (vertex) vertices.push(vertex); vertex = null; ended = true; break; }
      if (code === '0') { if (vertex) vertices.push(vertex); vertex = null; i--; break; }
      if (vertex) vertex.push(input[i]);
      else header.push(input[i]);
    }
    layer = header.find(([code]) => code === '8')?.[1] || '0';
    closed = ((Number(header.find(([code]) => code === '70')?.[1] || 0)) & 1) === 1;
    const points: Pair[] = [];
    for (const values of vertices) {
      const x = values.find(([code]) => code === '10')?.[1];
      const y = values.find(([code]) => code === '20')?.[1];
      const bulge = values.find(([code]) => code === '42')?.[1];
      if (x !== undefined && y !== undefined) points.push(['10', x], ['20', y], ...(bulge && Number(bulge) !== 0 ? [['42', bulge] as Pair] : []));
    }
    if (points.length >= 4) output.push(['0','LWPOLYLINE'], ['8',layer], ['90',String(vertices.length)], ['70',closed?'1':'0'], ...points);
    else warnings.push('Skipped legacy POLYLINE with fewer than two valid vertices.');
    if (!ended) warnings.push('Legacy POLYLINE ended without SEQEND; imported available vertices where possible.');
  }
  return output;
}


function splitEntities(pairs: Pair[]): Array<{type:string;values:Pair[]}> {
  const result:Array<{type:string;values:Pair[]}>=[];
  let current:{type:string;values:Pair[]}|null=null;
  for(const pair of pairs){
    if(pair[0]==='0'){if(current)result.push(current);current={type:pair[1],values:[]};}
    else if(current)current.values.push(pair);
  }
  if(current)result.push(current);
  return result;
}
function expandBlockInserts(pairs: Pair[], warnings: string[]): Pair[] {
  const blocks=new Map<string,{base:{x:number;y:number};xref:boolean;entities:Array<{type:string;values:Pair[]}>}>();
  const blockSection=pairs.findIndex((p,i)=>p[0]==='2'&&p[1]==='BLOCKS');
  if(blockSection>=0){
    let i=blockSection+1;
    while(i<pairs.length && !(pairs[i][0]==='0'&&pairs[i][1]==='ENDSEC')){
      if(pairs[i][0]!=='0'||pairs[i][1]!=='BLOCK'){i++;continue;}
      const header:Pair[]=[];i++;
      while(i<pairs.length&&pairs[i][0]!=='0')header.push(pairs[i++]);
      const name=header.find(p=>p[0]==='2')?.[1]||header.find(p=>p[0]==='3')?.[1]||'';
      const base={x:Number(header.find(p=>p[0]==='10')?.[1]||0),y:Number(header.find(p=>p[0]==='20')?.[1]||0)};
      const body:Pair[]=[];
      while(i<pairs.length&&!(pairs[i][0]==='0'&&pairs[i][1]==='ENDBLK'))body.push(pairs[i++]);
      if(i<pairs.length)i++;
      if(name){const flags=Number(header.find(p=>p[0]==='70')?.[1]||0),path=header.find(p=>p[0]==='1')?.[1]||'';blocks.set(name.toUpperCase(),{base,xref:(flags&4)===4||!!path,entities:splitEntities(body).filter(e=>e.type!=='ENDBLK'&&e.type!=='ENDSEC')});}
    }
  }
  const section=pairs.findIndex(p=>p[0]==='2'&&p[1]==='ENTITIES');
  if(section<0)return pairs;
  const end=pairs.findIndex((p,i)=>i>section&&p[0]==='0'&&p[1]==='ENDSEC');
  if(end<0)return pairs;
  const prefix=pairs.slice(0,section+1), entities=splitEntities(pairs.slice(section+1,end)), suffix=pairs.slice(end);
  const expanded:Pair[]=[];
  for(const item of entities){
    if(item.type!=='INSERT'){expanded.push(['0',item.type],...item.values);continue;}
    const get=(code:string)=>item.values.find(p=>p[0]===code)?.[1];
    const name=(get('2')||'').toUpperCase(), block=blocks.get(name);
    if(!block){warnings.push('Skipped INSERT referencing missing BLOCK '+(get('2')||'(unnamed)')+'.');continue;}
    if(block.xref){warnings.push('Skipped external XREF '+name+'; external drawing files are not fetched or merged automatically.');continue;}
    const at={x:Number(get('10')||0),y:Number(get('20')||0)},sx=Number(get('41')||1),sy=Number(get('42')||1),angle=Number(get('50')||0)*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle),insertLayer=get('8')||'0';
    if(![at.x,at.y,sx,sy,angle].every(Number.isFinite)||sx===0||sy===0){warnings.push('Skipped INSERT with invalid transform.');continue;}
    for(const child of block.entities){
      if(child.type==='INSERT'){warnings.push('Nested BLOCK INSERT was skipped; nested block references are not yet expanded.');continue;}
      const values:Pair[]=[];let pending:{code:string;yCode:string;x:number;index:number}|null=null;
      for(const [code,value] of child.values){
        if(['10','11','12','13','14','15','16','17','18','19'].includes(code)){
          pending={code,yCode:String(Number(code)+10),x:Number(value),index:values.length};
          values.push([code,value]);continue;
        }
        if(pending&&code===pending.yCode){
          const px=(pending.x-block.base.x)*sx,py=(Number(value)-block.base.y)*sy;
          values[pending.index]=[pending.code,fmt(at.x+px*cos-py*sin)];
          values.push([code,fmt(at.y+px*sin+py*cos)]);pending=null;continue;
        }
        if(code==='8'&&value==='0')values.push(['8',insertLayer]);
        else if(code==='40'&&Number.isFinite(Number(value)))values.push([code,fmt(Number(value)*Math.sqrt(Math.abs(sx*sy)))]);
        else values.push([code,value]);
      }
      if(Math.abs(Math.abs(sx)-Math.abs(sy))>1e-9&&child.type==='CIRCLE')warnings.push('INSERT '+name+' applies non-uniform scaling to a CIRCLE; the circle radius was approximated using the geometric-mean scale.');
      expanded.push(['0',child.type],...values);
    }
  }
  return [...prefix,...expanded,...suffix];
}
function sampleCatmullRom(points:{x:number;y:number}[],steps=8):{x:number;y:number}[]{
  if(points.length<3)return points;
  const out:{x:number;y:number}[]=[];
  for(let i=0;i<points.length-1;i++){
    const p0=points[Math.max(0,i-1)],p1=points[i],p2=points[i+1],p3=points[Math.min(points.length-1,i+2)];
    for(let j=0;j<steps;j++){const t=j/steps,t2=t*t,t3=t2*t;out.push({x:0.5*((2*p1.x)+(-p0.x+p2.x)*t+(2*p0.x-5*p1.x+4*p2.x-p3.x)*t2+(-p0.x+3*p1.x-3*p2.x+p3.x)*t3),y:0.5*((2*p1.y)+(-p0.y+p2.y)*t+(2*p0.y-5*p1.y+4*p2.y-p3.y)*t2+(-p0.y+3*p1.y-3*p2.y+p3.y)*t3)});}
  }
  out.push({...points[points.length-1]});return out;
}

export function exportDraftingDxf(shapes:DxfShape[], drafting:DraftingDocument, metresPerDrawingUnit=1):string {
  if(!Number.isFinite(metresPerDrawingUnit)||metresPerDrawingUnit<=0) throw new Error('A valid drawing calibration is required for DXF export.');
  const insunitFactors: Array<[number,number]> = [[0.0254,1],[0.3048,2],[1609.344,3],[0.001,4],[0.01,5],[1,6],[1000,7],[2.54e-8,8],[0.0000254,9],[0.9144,10],[1e-10,11],[1e-9,12],[1e-6,13],[0.1,14],[10,15],[100,16],[1e9,17],[149597870700,18],[9.460730472e15,19],[3.085677581e16,20]];
  const insunits=insunitFactors.find(([factor])=>Math.abs(factor-metresPerDrawingUnit)<1e-12)?.[1]??0;
  const layerMap = new Map(drafting.layers.map(layer => [layer.name.toUpperCase(), layer]));
  shapes.forEach(shape => { const name = shape.layer || '0'; if (!layerMap.has(name.toUpperCase())) layerMap.set(name.toUpperCase(), { name, color: '#666666', lineType: 'CONTINUOUS', lineWeightMm: 0.18, visible: true, locked: false, plot: true }); });
  drafting.annotations.forEach(item => { if (!layerMap.has(item.layer.toUpperCase())) layerMap.set(item.layer.toUpperCase(), { name: item.layer, color: '#666666', lineType: 'CONTINUOUS', lineWeightMm: 0.18, visible: true, locked: false, plot: true }); });
  const exportLayers = [...layerMap.values()];
  const lineTypes: Array<{name:string;description:string;pattern:number[]}> = [
    {name:'CONTINUOUS',description:'Solid line',pattern:[]},
    {name:'DASHED',description:'Dashed __ __ __',pattern:[4,-2]},
    {name:'CENTER',description:'Center ____ _ ____ _',pattern:[6,-2,1,-2]},
    {name:'HIDDEN',description:'Hidden __ __ __',pattern:[1.5,-1.5]},
    {name:'PHANTOM',description:'Phantom ____ _ _ ____',pattern:[6,-2,1,-2,1,-2]},
  ];
  const out:string[]=['0','SECTION','2','HEADER','9','$ACADVER','1','AC1015','9','$INSUNITS','70',String(insunits),'9','$MEASUREMENT','70','1','9','$HANDSEED','5','10000','0','ENDSEC','0','SECTION','2','TABLES','0','TABLE','2','LTYPE','5','10','100','AcDbSymbolTable','70',String(lineTypes.length)];
  for(const [index,item] of lineTypes.entries()) out.push('0','LTYPE','5',(11+index).toString(16).toUpperCase(),'100','AcDbSymbolTableRecord','100','AcDbLinetypeTableRecord','2',item.name,'70','0','3',item.description,'72','65','73',String(item.pattern.length),'40',fmt(item.pattern.reduce((sum,value)=>sum+Math.abs(value),0)),...item.pattern.flatMap(value=>['49',fmt(value),'74','0']));
  out.push('0','ENDTAB','0','TABLE','2','LAYER','5','20','100','AcDbSymbolTable','70',String(exportLayers.length));
  for(const [index,layer] of exportLayers.entries()) out.push('0','LAYER','5',(256+index).toString(16).toUpperCase(),'100','AcDbSymbolTableRecord','100','AcDbLayerTableRecord','2',layer.name,'70',layer.locked?'4':'0','62',layer.visible? '7':'-7','420',String(parseInt(layer.color.slice(1),16)),'6',layer.lineType,'370',String(Math.round(layer.lineWeightMm*100)),'290',layer.plot?'1':'0');
  out.push('0','ENDTAB','0','ENDSEC','0','SECTION','2','ENTITIES');
  let nextEntityHandle=4096;
  const emitEntity=(kind:string,values:(string|number)[])=>entity(kind,values,(nextEntityHandle++).toString(16).toUpperCase());
  for(const shape of shapes){
    const layer=shape.layer||'0';
    if(shape.type==='line') out.push(...emitEntity('LINE',['8',layer,'10',fmt(shape.points[0].x),'20',fmt(shape.points[0].y),'11',fmt(shape.points[1].x),'21',fmt(shape.points[1].y)]));
    else if(shape.type==='circle') out.push(...emitEntity('CIRCLE',['8',layer,'10',fmt(shape.points[0].x),'20',fmt(shape.points[0].y),'40',fmt(shape.radius||1)]));
    else {
      const pts=shape.type==='rect'?[shape.points[0],{x:shape.points[1].x,y:shape.points[0].y},shape.points[1],{x:shape.points[0].x,y:shape.points[1].y}]:shape.points;
      const isClosed=shape.type==='rect'||(pts.length>2&&Math.hypot(pts[0].x-pts[pts.length-1].x,pts[0].y-pts[pts.length-1].y)<=1e-9);
      out.push(...emitEntity('LWPOLYLINE',['8',layer,'90',pts.length,'70',isClosed?'1':'0']));
      pts.forEach((p,i)=>out.push('10',fmt(p.x),'20',fmt(p.y),...(shape.bulges?.[i]?[ '42',fmt(shape.bulges[i]) ]:[])));
    }
  }
  const model = (p:{x:number;y:number})=>({x:p.x/metresPerDrawingUnit,y:p.y/metresPerDrawingUnit});
  const textEntity=(at:{x:number;y:number},text:string,height:number,layer:string,rotation=0)=>out.push(...emitEntity('TEXT',['8',layer,'10',fmt(at.x),'20',fmt(at.y),'40',fmt(height),'1',text.replace(/\n/g,' '),'50',fmt(rotation)]));
  for(const item of drafting.annotations){
    if(item.kind==='text') textEntity(model(item.at),item.text,item.heightMm*(Number(drafting.sheet.scale.split(':')[1])||100)/1000/metresPerDrawingUnit,item.layer,item.rotationDeg);
    else if(item.kind==='leader'){
      const pts=item.points.map(model); out.push(...emitEntity('LWPOLYLINE',['8',item.layer,'90',pts.length,'70','0']));
      pts.forEach(p=>out.push('10',fmt(p.x),'20',fmt(p.y)));
      const last=pts[pts.length-1]; textEntity({x:last.x+0.5,y:last.y+0.5},item.text,item.textHeightMm*(Number(drafting.sheet.scale.split(':')[1])||100)/1000/metresPerDrawingUnit,item.layer);
    } else {
      const a=model(item.a),b=model(item.b),dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1,nx=-dy/len,ny=dx/len,off=item.offsetM/metresPerDrawingUnit;
      const p1={x:a.x+nx*off,y:a.y+ny*off},p2={x:b.x+nx*off,y:b.y+ny*off};
      const denominator=Number(drafting.sheet.scale.split(':')[1])||100,style=drafting.dimensionStyle;
      const extOffset=(style?.extensionOffsetMm||1)*denominator/1000/metresPerDrawingUnit,extBeyond=(style?.extensionBeyondMm||1.5)*denominator/1000/metresPerDrawingUnit;
      const e1={x:a.x+nx*extOffset,y:a.y+ny*extOffset},e2={x:b.x+nx*extOffset,y:b.y+ny*extOffset},e1End={x:p1.x+nx*extBeyond,y:p1.y+ny*extBeyond},e2End={x:p2.x+nx*extBeyond,y:p2.y+ny*extBeyond};
      for(const [s,e] of [[e1,e1End],[e2,e2End],[p1,p2]]) out.push(...emitEntity('LINE',['8',item.layer,'10',fmt(s.x),'20',fmt(s.y),'11',fmt(e.x),'21',fmt(e.y)]));
      const arrow=(style?.arrowSizeMm||2.5)*denominator/1000/metresPerDrawingUnit,ux=dx/len,uy=dy/len;
      for(const [p,sign] of [[p1,1],[p2,-1]] as Array<[{x:number;y:number},number]>){
        for(const side of [-1,1]){const end={x:p.x+ux*arrow*sign+nx*arrow*0.5*side,y:p.y+uy*arrow*sign+ny*arrow*0.5*side};out.push(...emitEntity('LINE',['8',item.layer,'10',fmt(p.x),'20',fmt(p.y),'11',fmt(end.x),'21',fmt(end.y)]));}
      }
      const label=item.textOverride||((item.kind==='aligned'?Math.hypot(item.b.x-item.a.x,item.b.y-item.a.y):Math.abs(item.b.x-item.a.x)).toFixed(item.precision));
      textEntity({x:(p1.x+p2.x)/2,y:(p1.y+p2.y)/2},label,(style?.textHeightMm||2.5)*denominator/1000/metresPerDrawingUnit,item.layer);
    }
  }
  out.push('0','ENDSEC','0','EOF');
  return out.join('\n');
}
export function importDraftingDxf(source:string, metresPerDrawingUnit?:number, scaleDenominator=100):DxfImportResult {
  if(metresPerDrawingUnit!==undefined&&(!Number.isFinite(metresPerDrawingUnit)||metresPerDrawingUnit<=0)) throw new Error('Drawing calibration must be positive.');
  if(!Number.isFinite(scaleDenominator)||scaleDenominator<=0) throw new Error('Drawing scale denominator must be positive.');
  const warnings:string[]=[];
  const rawPairs=pairsOf(source);
  const unitHeader=rawPairs.findIndex(pair=>pair[0]==='9'&&pair[1]==='$INSUNITS');
  const declaredUnits=unitHeader>=0?Number(rawPairs.slice(unitHeader+1).find(pair=>pair[0]==='70')?.[1]):0;
  const metresByInsunits:Record<number,number>={1:0.0254,2:0.3048,3:1609.344,4:0.001,5:0.01,6:1,7:1000,8:1e-6,9:0.0000254,10:0.9144,11:1e-10,12:1e-9,13:1e-6,14:0.1,15:10,16:100,17:1e9};
  const detectedMetresPerDrawingUnit=metresPerDrawingUnit??metresByInsunits[declaredUnits]??null;
  const effectiveMetresPerDrawingUnit=detectedMetresPerDrawingUnit??1;
  const fileMetresPerUnit=metresByInsunits[declaredUnits];
  if(metresPerDrawingUnit!==undefined&&fileMetresPerUnit&&Math.abs(metresPerDrawingUnit-fileMetresPerUnit)>Math.max(1e-12,fileMetresPerUnit*1e-6))warnings.push('DXF $INSUNITS metadata conflicts with the active project calibration; the project calibration was used for imported annotations.');
  if(detectedMetresPerDrawingUnit===null)warnings.push('DXF does not declare a recognized $INSUNITS value; annotations are interpreted using a temporary 1 metre per drawing unit assumption. Calibrate the drawing before engineering measurements.');
  const pairs=expandBlockInserts(normalizeLegacyPolylines(rawPairs, warnings), warnings);
  const importedLayers:DraftLayer[]=[];
  const indexedColors:Record<number,string>={1:'#ff0000',2:'#ffff00',3:'#00ff00',4:'#00ffff',5:'#0000ff',6:'#ff00ff',7:'#222222'};
  const supportedLineTypes=new Set(['CONTINUOUS','DASHED','CENTER','HIDDEN','PHANTOM']);
  for(let i=0;i<pairs.length;i++){
    if(pairs[i][0]!=='0'||pairs[i][1]!=='LAYER')continue;
    const values:Pair[]=[];
    for(let j=i+1;j<pairs.length&&pairs[j][0]!=='0';j++)values.push(pairs[j]);
    const get=(code:string)=>values.find(pair=>pair[0]===code)?.[1];
    const name=get('2')||'0';
    const trueColor=Number(get('420'));
    const colorIndex=Math.abs(Number(get('62')||7));
    const color=Number.isFinite(trueColor)&&get('420')!==undefined?'#'+Math.max(0,trueColor).toString(16).padStart(6,'0').slice(-6):(indexedColors[colorIndex]||'#666666');
    const requestedLineType=(get('6')||'CONTINUOUS').toUpperCase();
    const lineType=supportedLineTypes.has(requestedLineType)?requestedLineType as DraftLayer['lineType']:'CONTINUOUS';
    if(lineType!==requestedLineType)warnings.push('Layer '+name+' uses unsupported DXF linetype '+requestedLineType+'; imported as CONTINUOUS.');
    const rawWeight=Number(get('370')||18);
    const lineWeightMm=rawWeight>=0?Math.min(2.11,Math.max(0,rawWeight/100)):0.18;
    const flags=Number(get('70')||0);
    importedLayers.push({name,color,lineType,lineWeightMm,visible:Number(get('62')||7)>=0,locked:(flags&4)!==0,plot:get('290')===undefined?true:get('290')!=='0'});
  }
  const start=pairs.findIndex(p=>p[0]==='2'&&p[1]==='ENTITIES');
  if(start<0) throw new Error('DXF ENTITIES section not found.');
  const shapes:DxfShape[]=[],annotations:DraftAnnotation[]=[],layers=new Set<string>();
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
      annotations.push({id,kind:'text',layer,at:{x:num('10')*effectiveMetresPerDrawingUnit,y:num('20')*effectiveMetresPerDrawingUnit},text:raw.replace(/\\P/g,'\n'),heightMm:Math.max(0.5,num('40')*1000*effectiveMetresPerDrawingUnit/scaleDenominator),rotationDeg:num('50')});
    } else if(current.type==='ARC'){
      const cx=num('10'),cy=num('20'),r=num('40'),a=num('50')*Math.PI/180,b=num('51')*Math.PI/180;
      let sweep=b-a;if(sweep<=0)sweep+=Math.PI*2;
      const p1={x:cx+r*Math.cos(a),y:cy+r*Math.sin(a)},p2={x:cx+r*Math.cos(b),y:cy+r*Math.sin(b)};
      shapes.push({id,type:'polyline',points:[p1,p2],bulges:[Math.tan(sweep/4),0],layer});
    } else if(current.type==='SPLINE') {
      const readPoints=(xCode:string,yCode:string)=>{const points:{x:number;y:number}[]=[];let x:number|null=null;for(const [code,value] of v){if(code===xCode)x=Number(value);else if(code===yCode&&x!==null){points.push({x,y:Number(value)});x=null;}}return points;};
      const points=readPoints('11','21').length>=2?readPoints('11','21'):readPoints('10','20');
      if(points.length>=2){shapes.push({id,type:'polyline',points:sampleCatmullRom(points),layer});warnings.push('Converted SPLINE '+id+' to an editable sampled polyline; exact NURBS control data is not preserved.');}
      else warnings.push('Skipped SPLINE without at least two usable fit/control points.');
    } else if(current.type==='ELLIPSE') {
      const cx=num('10'),cy=num('20'),mx=num('11'),my=num('21'),ratio=num('40'),start=num('41'),end=num('42')||Math.PI*2;
      const major=Math.hypot(mx,my),minor=major*ratio;
      if(major>0&&ratio>0){let sweep=end-start;if(sweep<=0)sweep+=Math.PI*2;const rotation=Math.atan2(my,mx),count=Math.max(16,Math.ceil(Math.abs(sweep)/(Math.PI*2)*64));const points=Array.from({length:count+1},(_,i)=>{const t=start+sweep*i/count;return {x:cx+major*Math.cos(t)*Math.cos(rotation)-minor*Math.sin(t)*Math.sin(rotation),y:cy+major*Math.cos(t)*Math.sin(rotation)+minor*Math.sin(t)*Math.cos(rotation)};});shapes.push({id,type:'polyline',points,layer});warnings.push('Converted ELLIPSE '+id+' to a sampled polyline; exact analytic ellipse parameters are not preserved.');}
      else warnings.push('Skipped ELLIPSE with invalid major axis or ratio.');
    } else if(current.type==='HATCH') {
      const pathIndex=v.findIndex(p=>p[0]==='92');
      if(pathIndex>=0){
        const polylinePath = v.findIndex((p,i)=>i>pathIndex&&p[0]==='72') >= 0 && Number(v[v.findIndex((p,i)=>i>pathIndex&&p[0]==='72')][1]) === 0;
        if(!polylinePath){warnings.push('Skipped HATCH edge-based boundary; only polyline hatch boundaries are supported.');current=null;return;}
        const vertexStart=v.findIndex((p,i)=>i>pathIndex&&p[0]==='93');
        const count=vertexStart>=0?Number(v[vertexStart][1]):0;
        const points:{x:number;y:number}[]=[];let x:number|null=null;
        if(count>1)for(let i=vertexStart+1;i<v.length&&points.length<count;i++){const [code,value]=v[i];if(code==='10')x=Number(value);else if(code==='20'&&x!==null){points.push({x,y:Number(value)});x=null;}}
        if(points.length>=2){if(Number(v.find((p,i)=>i>pathIndex&&p[0]==='73')?.[1]||0)===1)points.push({...points[0]});shapes.push({id,type:'polyline',points,layer});warnings.push('Converted HATCH '+id+' to its boundary polyline only; hatch pattern and fill are not preserved.');}
        else warnings.push('Skipped HATCH without a readable closed polyline boundary.');
      } else warnings.push('Skipped HATCH without a supported polyline boundary path.');
    } else if(current.type==='SOLID'||current.type==='TRACE'||current.type==='3DFACE') {
      const coordinate=(xCode:string,yCode:string)=>{const x=Number(get(xCode)),y=Number(get(yCode));return Number.isFinite(x)&&Number.isFinite(y)?{x,y}:null;};
      const codes=current.type==='SOLID'||current.type==='TRACE'?['10','11','13','12']:['10','11','12','13'];
      const points=codes.map(code=>coordinate(code,String(Number(code)+10))).filter((point):point is {x:number;y:number}=>!!point);
      const unique=points.filter((point,index)=>!points.slice(0,index).some(previous=>Math.hypot(previous.x-point.x,previous.y-point.y)<1e-9));
      if(unique.length>=3){unique.push({...unique[0]});shapes.push({id,type:'polyline',points:unique,layer});if(v.some(([code,value])=>['30','31','32','33'].includes(code)&&Math.abs(Number(value))>1e-9))warnings.push('Converted '+current.type+' '+id+' to a 2D boundary; elevation/Z values were not retained.');}
      else warnings.push('Skipped '+current.type+' without three distinct valid vertices.');
    } else if(current.type==='DIMENSION') {
      const a={x:num('13')*effectiveMetresPerDrawingUnit,y:num('23')*effectiveMetresPerDrawingUnit};
      const b={x:num('14')*effectiveMetresPerDrawingUnit,y:num('24')*effectiveMetresPerDrawingUnit};
      if(Math.hypot(b.x-a.x,b.y-a.y)>1e-9) { const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy),nx=-dy/len,ny=dx/len,locX=num('10')*effectiveMetresPerDrawingUnit,locY=num('20')*effectiveMetresPerDrawingUnit; const offsetM=(locX-a.x)*nx+(locY-a.y)*ny; annotations.push({id,kind:(num('70')&1)?'aligned':'linear',layer,a,b,offsetM,precision:3,textOverride:get('1')&&get('1')!=='<>'?get('1'):undefined}); }
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
  const importedByName=new Set(importedLayers.map(layer=>layer.name.toUpperCase()));
  for(const name of layers)if(!importedByName.has(name.toUpperCase()))importedLayers.push({name,color:'#666666',lineType:'CONTINUOUS',lineWeightMm:0.18,visible:true,locked:false,plot:true});
  return {shapes,annotations,layerNames:[...layers],layers:importedLayers,warnings,metresPerDrawingUnit:detectedMetresPerDrawingUnit};
}
