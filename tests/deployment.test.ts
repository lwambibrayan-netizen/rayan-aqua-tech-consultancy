import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('deployment and data-boundary configuration', () => {
  it('pins Vercel functions to the supported Node 22 runtime', () => {
    const config = JSON.parse(readFileSync(resolve(process.cwd(), 'vercel.json'), 'utf8'));
    expect(config.functions['api/**/*.ts'].runtime).toBe('nodejs22.x');
  });
  it('enables RLS and owner predicates for every project data table', () => {
    const schema = readFileSync(resolve(process.cwd(), 'supabase/schema.sql'), 'utf8');
    for (const table of ['projects', 'project_documents', 'gis_drafts']) {
      expect(schema).toContain(`alter table public.${table} enable row level security`);
    }
    expect(schema.match(/auth\.uid\(\)/g)?.length).toBeGreaterThanOrEqual(6);
  });
  it('does not ship privileged database or AppDeploy credentials in the browser client', () => {
    const client = readFileSync(resolve(process.cwd(), 'client.ts'), 'utf8');
    expect(client).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(client.toLowerCase()).not.toContain('appdeploy');
  });
  it('routes PyQGIS status checks separately from terrain operations', () => {
    const api = readFileSync(resolve(process.cwd(), 'api/[...path].ts'), 'utf8');
    expect(api).toContain("path[3] !== 'status'");
    expect(api).toContain("path[3] === 'status' && method === 'POST'");
    expect(api).toContain('PYQGIS_API_URL');
    expect(api).toContain('PYQGIS_API_KEY');
  });
  it('keeps hydraulic simulation on the EPANET solver rather than a display-only estimate', () => {
    const epanet = readFileSync(resolve(process.cwd(), 'EpanetEnginePanel.tsx'), 'utf8');
    expect(epanet).toContain("from 'epanet-js'");
    expect(epanet).toContain('new Workspace()');
    expect(epanet).toContain('new EpanetProject(ws)');
    expect(epanet).toContain('m.runH()');
    expect(epanet).toContain('getLinkValue');
  });
  it('distinguishes the DEM-grid routing helper from server-side PyQGIS analysis', () => {
    const gis = readFileSync(resolve(process.cwd(), 'GisEnginePanel.tsx'), 'utf8');
    expect(gis).toContain('findLeastCostRoute');
    expect(gis).toContain('fetchTerrainElevations');
    expect(gis).toContain("'/gis-terrain/' + operation");
    expect(gis).toContain('local 17'); // explanatory UI copy identifies the local DEM grid
  });

  it('calculates terrain profile chainage in metres and reports uphill grade', () => {
    const service = readFileSync(resolve(process.cwd(), 'app.py'), 'utf8');
    expect(service).toContain('QgsDistanceArea');
    expect(service).toContain('measure.measureLine(a,b)');
    expect(service).toContain('pixel_resolution_m(layer)');
    expect(service).toContain('maximum_uphill_grade_percent');
    expect(service).not.toContain('"maximum_uphill_grade_percent":None');
  });

});
