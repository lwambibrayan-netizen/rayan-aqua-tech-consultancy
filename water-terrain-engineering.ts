import { component3dLength, type WaterCadComponent, type WaterCadDocument, type WaterPoint } from './water-cad';
import type { ProfilePoint } from './water-network-engineering';

export type TerrainGrid = {
  width: number;
  height: number;
  originX: number;
  originY: number;
  cellSizeX: number;
  cellSizeY: number;
  /** Row-major elevations in metres; first sample is at originX/originY and rows advance in +Y; null represents NoData. */
  elevationsM: Array<number | null>;
  crs: string;
  verticalDatum: string;
};
export type GroundProfileSample = { chainageM: number; x: number; y: number; groundLevelM: number | null };
export type TerrainIssue = { componentId: string; severity: 'error' | 'warning'; code: string; message: string };

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
function validateTerrain(grid: TerrainGrid): void {
  if (!Number.isInteger(grid.width) || !Number.isInteger(grid.height) || grid.width < 2 || grid.height < 2 ||
      !finite(grid.originX) || !finite(grid.originY) || !finite(grid.cellSizeX) || !finite(grid.cellSizeY) ||
      grid.cellSizeX <= 0 || grid.cellSizeY <= 0 || grid.elevationsM.length !== grid.width * grid.height) {
    throw new Error('Terrain grid needs at least 2 × 2 cells, positive cell sizes and exactly width × height elevations.');
  }
  if (grid.elevationsM.some(value => value !== null && !finite(value))) throw new Error('Terrain elevations must be finite metres or null NoData.');
}
export function sampleTerrainElevation(grid: TerrainGrid, x: number, y: number): number | null {
  validateTerrain(grid);
  if (!finite(x) || !finite(y)) throw new Error('Terrain sample coordinates must be finite.');
  const gx = (x - grid.originX) / grid.cellSizeX;
  const gy = (y - grid.originY) / grid.cellSizeY;
  if (gx < 0 || gy < 0 || gx > grid.width - 1 || gy > grid.height - 1) return null;
  const x0 = Math.min(Math.floor(gx), grid.width - 2), y0 = Math.min(Math.floor(gy), grid.height - 2);
  const tx = gx - x0, ty = gy - y0;
  const at = (col: number, row: number) => grid.elevationsM[row * grid.width + col];
  const values = [at(x0,y0), at(x0+1,y0), at(x0,y0+1), at(x0+1,y0+1)];
  const weights=[(1-tx)*(1-ty),tx*(1-ty),(1-tx)*ty,tx*ty];
  if(values.some((value,index)=>value===null&&weights[index]>1e-12))return null;
  return values.reduce((sum,value,index)=>sum+(value===null?0:value*weights[index]),0);
}
function segmentLength(a: WaterPoint, b: WaterPoint): number { return Math.hypot(b.x-a.x,b.y-a.y); }
export function sampleGroundProfile(grid: TerrainGrid, route: WaterPoint[], spacingM = 5): GroundProfileSample[] {
  validateTerrain(grid);
  if (route.length < 2 || !finite(spacingM) || spacingM <= 0) throw new Error('Ground profile needs at least two route points and positive sample spacing.');
  const result: GroundProfileSample[] = [];
  let chainage = 0;
  for (let i=1;i<route.length;i++) {
    const a=route[i-1], b=route[i], length=segmentLength(a,b);
    if (!finite(a.x)||!finite(a.y)||!finite(b.x)||!finite(b.y)||length<=0) throw new Error('Route vertices must be finite and consecutive vertices must be distinct.');
    const count=Math.max(1,Math.ceil(length/spacingM));
    for(let j=0;j<=count;j++) {
      if(i>1 && j===0) continue;
      const t=j/count, x=a.x+(b.x-a.x)*t, y=a.y+(b.y-a.y)*t;
      result.push({chainageM:chainage+length*t,x,y,groundLevelM:sampleTerrainElevation(grid,x,y)});
    }
    chainage+=length;
  }
  return result;
}
/** Applies sampled ground and a specified crown cover to every pipe vertex.
 * The pipe invert and centreline are derived independently from ground level. */
export function applyTerrainToPipe(pipe: WaterCadComponent, grid: TerrainGrid, coverDepthM: number, invertOffsetM = 0, spacingM = 5): WaterCadComponent {
  if(pipe.kind!=='pipe'||pipe.geometry.length<2) throw new Error('Terrain routing requires a pipe with at least two vertices.');
  if(!finite(coverDepthM)||coverDepthM<0||!finite(invertOffsetM)||!finite(spacingM)||spacingM<=0) throw new Error('Cover depth must be non-negative; invert offset and route spacing must be finite, with positive spacing.');
  const od=(pipe.properties.externalDiameterMm??0)/1000;
  if(!(od>0)) throw new Error('Set a verified positive external pipe diameter (OD) before calculating cover depth.');
  const samples=sampleGroundProfile(grid,pipe.geometry,spacingM);
  const geometry=samples.map(point=>{
    const ground=point.groundLevelM;
    if(ground===null) throw new Error('Terrain contains NoData or route is outside the terrain extent at '+point.x+', '+point.y+'.');
    const invert=ground-coverDepthM-od+invertOffsetM;
    return {x:point.x,y:point.y,groundLevelM:ground,invertLevelM:invert,z:invert+od/2};
  });
  const start=geometry[0], end=geometry[geometry.length-1];
  return {...pipe,geometry,properties:{...pipe.properties,groundStartM:start.groundLevelM,groundEndM:end.groundLevelM,invertInletM:start.invertLevelM,invertOutletM:end.invertLevelM,coverDepthM,hydraulicLengthM:component3dLength({...pipe,geometry})}};
}
/** Builds a sampled ground/invert/crown/cover profile from the actual terrain surface. */
export function buildTerrainAwarePipeProfile(pipe:WaterCadComponent,grid:TerrainGrid,spacingM=5):ProfilePoint[] {
  if(pipe.kind!=='pipe') throw new Error('A terrain profile requires a pipe component.');
  const ground=sampleGroundProfile(grid,pipe.geometry,spacingM);
  const od=(pipe.properties.externalDiameterMm??0)/1000;
  const start=pipe.properties.invertInletM,end=pipe.properties.invertOutletM;
  const anchors:Array<{chainageM:number;invert:number|null}>=[];
  let anchorChainage=0;
  pipe.geometry.forEach((point,index)=>{
    if(index>0)anchorChainage+=segmentLength(pipe.geometry[index-1],point);
    anchors.push({chainageM:anchorChainage,invert:finite(point.invertLevelM)?point.invertLevelM:null});
  });
  const total=ground[ground.length-1]?.chainageM??0;
  return ground.map(sample=>{
    const ratio=total>0?sample.chainageM/total:0;
    let invert:number|null=null;
    const nextIndex=anchors.findIndex(anchor=>anchor.chainageM>=sample.chainageM);
    if(nextIndex>0){
      const a=anchors[nextIndex-1],b=anchors[nextIndex];
      if(a.invert!==null&&b.invert!==null){const t=(sample.chainageM-a.chainageM)/(b.chainageM-a.chainageM||1);invert=a.invert+(b.invert-a.invert)*t;}
    } else if(nextIndex===0) invert=anchors[0]?.invert??null;
    if(invert===null&&finite(start)&&finite(end))invert=start+(end-start)*ratio;
    const crown=invert!==null&&od>0?invert+od:null;
    return {chainageM:sample.chainageM,x:sample.x,y:sample.y,groundLevelM:sample.groundLevelM,invertLevelM:invert,crownLevelM:crown,coverDepthM:sample.groundLevelM!==null&&crown!==null?sample.groundLevelM-crown:null};
  });
}
export function buildTerrainIssues(document: WaterCadDocument, minimumCoverM = 0.9, maximumCoverM = 3): TerrainIssue[] {
  if(!finite(minimumCoverM)||!finite(maximumCoverM)||minimumCoverM<0||maximumCoverM<=minimumCoverM) throw new Error('Terrain cover limits are invalid.');
  const issues:TerrainIssue[]=[];
  for(const pipe of document.components.filter(c=>c.kind==='pipe')) {
    const od=(pipe.properties.externalDiameterMm??0)/1000;
    pipe.geometry.forEach((point,index)=>{
      if(!finite(point.groundLevelM)||!finite(point.invertLevelM)||!(od>0)) {
        issues.push({componentId:pipe.id,severity:'warning',code:'TERRAIN_LEVELS_MISSING',message:'Pipe vertex '+(index+1)+' needs surveyed ground, invert and a valid outside diameter.'});
        return;
      }
      const cover=point.groundLevelM-(point.invertLevelM+od);
      if(cover<0) issues.push({componentId:pipe.id,severity:'error',code:'PIPE_ABOVE_GROUND',message:'Pipe crown is '+Math.abs(cover).toFixed(2)+' m above ground at vertex '+(index+1)+'.'});
      else if(cover<minimumCoverM) issues.push({componentId:pipe.id,severity:'warning',code:'INSUFFICIENT_COVER',message:'Pipe cover '+cover.toFixed(2)+' m is below '+minimumCoverM.toFixed(2)+' m at vertex '+(index+1)+'.'});
      else if(cover>maximumCoverM) issues.push({componentId:pipe.id,severity:'warning',code:'EXCESSIVE_COVER',message:'Pipe cover '+cover.toFixed(2)+' m exceeds '+maximumCoverM.toFixed(2)+' m at vertex '+(index+1)+'.'});
    });
  }
  return issues;
}
