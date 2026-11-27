import type { DraftLayer } from './cad-drafting';

export type LayerStandard = 'WATER_UTILITY' | 'CIVIL_SITE' | 'MECHANICAL';
export const LAYER_STANDARD_TEMPLATES: Record<LayerStandard, DraftLayer[]> = {
  WATER_UTILITY: [
    { name:'WATER_PIPE', color:'#087e83', lineType:'CONTINUOUS', lineWeightMm:0.35, visible:true, locked:false, plot:true },
    { name:'WATER_FITTING', color:'#167b78', lineType:'CONTINUOUS', lineWeightMm:0.35, visible:true, locked:false, plot:true },
    { name:'WATER_VALVE', color:'#a45c20', lineType:'CONTINUOUS', lineWeightMm:0.35, visible:true, locked:false, plot:true },
    { name:'WATER_STRUCTURE', color:'#536b9b', lineType:'CONTINUOUS', lineWeightMm:0.35, visible:true, locked:false, plot:true },
    { name:'WATER_EXISTING', color:'#777777', lineType:'DASHED', lineWeightMm:0.18, visible:true, locked:false, plot:true },
    { name:'WATER_PROPOSED', color:'#087e83', lineType:'CONTINUOUS', lineWeightMm:0.50, visible:true, locked:false, plot:true },
    { name:'WATER_ABANDONED', color:'#9b7777', lineType:'DASHED', lineWeightMm:0.18, visible:true, locked:false, plot:true },
    { name:'WATER_CHAMBER', color:'#70558f', lineType:'CONTINUOUS', lineWeightMm:0.35, visible:true, locked:false, plot:true },
    { name:'ANNOTATION', color:'#202020', lineType:'CONTINUOUS', lineWeightMm:0.18, visible:true, locked:false, plot:true },
    { name:'DIMENSIONS', color:'#202020', lineType:'CONTINUOUS', lineWeightMm:0.18, visible:true, locked:false, plot:true },
    { name:'CENTERLINES', color:'#777777', lineType:'CENTER', lineWeightMm:0.18, visible:true, locked:false, plot:true },
    { name:'HIDDEN', color:'#777777', lineType:'HIDDEN', lineWeightMm:0.18, visible:true, locked:false, plot:true },
  ],
  CIVIL_SITE: [
    { name:'C-BOUNDARY', color:'#202020', lineType:'CONTINUOUS', lineWeightMm:0.50, visible:true, locked:false, plot:true },
    { name:'C-ROAD', color:'#555555', lineType:'CONTINUOUS', lineWeightMm:0.35, visible:true, locked:false, plot:true },
    { name:'C-CONTOUR-MAJOR', color:'#9b7745', lineType:'CONTINUOUS', lineWeightMm:0.25, visible:true, locked:false, plot:true },
    { name:'C-CONTOUR-MINOR', color:'#b49a73', lineType:'CONTINUOUS', lineWeightMm:0.13, visible:true, locked:false, plot:true },
    { name:'C-DRAINAGE', color:'#287caa', lineType:'CONTINUOUS', lineWeightMm:0.25, visible:true, locked:false, plot:true },
    { name:'C-EXISTING', color:'#777777', lineType:'DASHED', lineWeightMm:0.18, visible:true, locked:false, plot:true },
    { name:'C-PROPOSED', color:'#b35b36', lineType:'CONTINUOUS', lineWeightMm:0.35, visible:true, locked:false, plot:true },
    { name:'C-ANNO', color:'#202020', lineType:'CONTINUOUS', lineWeightMm:0.18, visible:true, locked:false, plot:true },
  ],
  MECHANICAL: [
    { name:'M-EQUIPMENT', color:'#167b78', lineType:'CONTINUOUS', lineWeightMm:0.35, visible:true, locked:false, plot:true },
    { name:'M-PIPE', color:'#087e83', lineType:'CONTINUOUS', lineWeightMm:0.35, visible:true, locked:false, plot:true },
    { name:'M-VALVE', color:'#a45c20', lineType:'CONTINUOUS', lineWeightMm:0.25, visible:true, locked:false, plot:true },
    { name:'M-CENTRE', color:'#777777', lineType:'CENTER', lineWeightMm:0.18, visible:true, locked:false, plot:true },
    { name:'M-HIDDEN', color:'#777777', lineType:'HIDDEN', lineWeightMm:0.18, visible:true, locked:false, plot:true },
    { name:'M-DIMS', color:'#202020', lineType:'CONTINUOUS', lineWeightMm:0.18, visible:true, locked:false, plot:true },
    { name:'M-ANNO', color:'#202020', lineType:'CONTINUOUS', lineWeightMm:0.18, visible:true, locked:false, plot:true },
  ],
};
export function mergeLayerTemplate(existing: DraftLayer[], standard: LayerStandard): { layers: DraftLayer[]; added: string[] } {
  const known = new Set(existing.map(layer => layer.name.trim().toUpperCase()));
  const added = LAYER_STANDARD_TEMPLATES[standard].filter(layer => !known.has(layer.name.toUpperCase())).map(layer => ({...layer}));
  return { layers: [...existing.map(layer=>({...layer})), ...added], added: added.map(layer=>layer.name) };
}
export function validatePlotConfiguration(layers: DraftLayer[]): string[] {
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const layer of layers) {
    const key = layer.name.trim().toUpperCase();
    if (!key || seen.has(key)) issues.push('Plot layer names must be unique and non-empty.');
    seen.add(key);
    if (layer.plot && !layer.visible) issues.push(layer.name + ' is set to plot while hidden; confirm this is intentional.');
    if (!Number.isFinite(layer.lineWeightMm) || layer.lineWeightMm < 0 || layer.lineWeightMm > 2.11) issues.push(layer.name + ' has an invalid plot lineweight.');
  }
  return issues;
}
