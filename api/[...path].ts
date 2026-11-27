import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type VercelRequest = Request;
type VercelNodeRequest = {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined> & { host?: string; 'x-forwarded-proto'?: string };
  body?: unknown;
};
type VercelNodeResponse = {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
};
type Json = Record<string, any>;
const allowedKinds = new Set(['hydraulic', 'boq', 'report', 'drawing', 'gis', 'calculations']);
const allowedStatuses = new Set(['Planning', 'In progress', 'On hold', 'Completed']);
const allowedLayers = new Set(['junctions', 'water_sources', 'reservoirs', 'tanks', 'pipelines', 'pumps', 'valves', 'project_boundary']);
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (message: string, status = 400) => json({ error: message }, status);
const record = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
const projectView = (p: any) => ({ id: p.id, title: p.title, location: p.location, projectType: p.project_type, client: p.client, status: p.status, description: p.description, createdAt: p.created_at, updatedAt: p.updated_at });
const draftView = (d: any) => ({ ...d.data, id: d.id, draftId: d.id, ownerUserId: d.user_id, projectId: d.project_id, kind: 'gis-draft', name: d.name, version: d.version, createdAt: d.created_at, updatedAt: d.updated_at, data: d.data });

function supabaseFor(token: string): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Server configuration is incomplete: SUPABASE_URL and SUPABASE_ANON_KEY are required.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
}
async function bodyOf(request: Request): Promise<Json> {
  try { return record(await request.json()); } catch { return {}; }
}
async function upstreamJson(url: URL, init?: RequestInit): Promise<any> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(120000) });
  const text = await response.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = { error: text.slice(0, 500) }; }
  if (!response.ok) throw new Error(String(body.error || `External engineering service returned HTTP ${response.status}.`));
  return body;
}

async function upstreamFile(url: URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20000) });
  if (!response.ok) {
    const text = await response.text(); let body: any;
    try { body = JSON.parse(text); } catch { body = { error: text.slice(0, 500) }; }
    throw new Error(String(body.error || `External engineering service returned HTTP ${response.status}.`));
  }
  return response;
}

async function handleRequest(request: VercelRequest): Promise<Response> {
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    const method = request.method || 'GET';
    if (path.length === 1 && path[0] === 'health' && method === 'GET') return json({ status: 'ok', service: 'RayanAqua API' });

    const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (!token) return fail('Authentication required.', 401);
    const supabase = supabaseFor(token);
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData.user) return fail('Authentication required.', 401);
    const userId = authData.user.id;
    const projectOwned = async (id: string) => {
      const { data, error } = await supabase.from('projects').select('id').eq('id', id).maybeSingle();
      if (error) throw error;
      return Boolean(data);
    };

    if (path[0] === 'projects' && path.length === 1 && method === 'GET') {
      const { data, error } = await supabase.from('projects').select('*').order('updated_at', { ascending: false }).limit(100);
      if (error) throw error;
      return json({ projects: (data ?? []).map(projectView) });
    }
    if (path[0] === 'projects' && path.length === 1 && method === 'POST') {
      const input = await bodyOf(request); const title = String(input.title ?? '').trim();
      if (!title || title.length > 120) return fail('Project name is required and must be 120 characters or fewer.');
      const { data, error } = await supabase.from('projects').insert({ user_id: userId, title, location: String(input.location ?? '').trim().slice(0, 160), project_type: String(input.projectType ?? 'Water supply').slice(0, 80), client: String(input.client ?? '').trim().slice(0, 120), status: allowedStatuses.has(input.status) ? input.status : 'Planning', description: String(input.description ?? '').trim().slice(0, 2000) }).select('*').single();
      if (error) throw error;
      return json({ project: projectView(data) }, 201);
    }

    if (path[0] === 'projects' && path[1]) {
      const projectId = path[1];
      if (!(await projectOwned(projectId))) return fail('Project not found.', 404);
      if (path.length === 2 && method === 'PUT') {
        const input = await bodyOf(request); const patch: Json = { updated_at: new Date().toISOString() };
        for (const [source, target, max] of [['title', 'title', 120], ['location', 'location', 160], ['projectType', 'project_type', 80], ['client', 'client', 120], ['description', 'description', 2000]] as const) {
          if (typeof input[source] === 'string') { const value = input[source].trim(); if (source === 'title' && !value) return fail('Project name is required.'); patch[target] = value.slice(0, max); }
        }
        if (input.status !== undefined) { if (!allowedStatuses.has(input.status)) return fail('Invalid project status.'); patch.status = input.status; }
        const { data, error } = await supabase.from('projects').update(patch).eq('id', projectId).select('*').single();
        if (error) throw error;
        return json({ project: projectView(data) });
      }
      if (path.length === 2 && method === 'DELETE') {
        const { error } = await supabase.from('projects').delete().eq('id', projectId);
        if (error) throw error;
        return json({ deleted: true, id: projectId });
      }
      if (path[2] === 'docs' && path.length === 4) {
        const kind = path[3]; if (!allowedKinds.has(kind)) return fail('Unknown project document.', 404);
        if (method === 'GET') {
          const { data, error } = await supabase.from('project_documents').select('data, version, updated_at').eq('project_id', projectId).eq('kind', kind).maybeSingle();
          if (error) throw error;
          return json({ document: data ? { data: data.data, version: data.version, updatedAt: data.updated_at } : null });
        }
        if (method === 'PUT' || method === 'POST') {
          const input = await bodyOf(request); if (input.data === undefined) return fail('Document data is required.');
          const serialized = JSON.stringify(input.data); if (serialized.length > 220000) return fail('This document exceeds the 220 KB storage limit.', 413);
          const { data: current, error: readError } = await supabase.from('project_documents').select('version').eq('project_id', projectId).eq('kind', kind).maybeSingle();
          if (readError) throw readError;
          const nextVersion = (current?.version ?? 0) + 1;
          const { data, error } = await supabase.from('project_documents').upsert({ user_id: userId, project_id: projectId, kind, data: input.data, version: nextVersion, updated_at: new Date().toISOString() }, { onConflict: 'project_id,kind' }).select('data, version, updated_at').single();
          if (error) throw error;
          return json({ document: { data: data.data, version: data.version, updatedAt: data.updated_at } });
        }
      }
      if (path[2] === 'gis-drafts' && path.length === 3) {
        if (method === 'GET') {
          const { data, error } = await supabase.from('gis_drafts').select('*').eq('project_id', projectId).order('updated_at', { ascending: false }).limit(100);
          if (error) throw error;
          return json({ drafts: (data ?? []).map(draftView) });
        }
        if (method === 'POST') {
          const input = await bodyOf(request); const name = String(input.name ?? '').trim().slice(0, 100);
          if (!name || input.data === undefined) return fail('GIS draft name and data are required.');
          if (JSON.stringify(input.data).length > 900000) return fail('GIS draft exceeds the 900 KB storage limit.', 413);
          const { data, error } = await supabase.from('gis_drafts').insert({ user_id: userId, project_id: projectId, name, data: input.data }).select('*').single();
          if (error) throw error;
          return json({ draft: draftView(data) }, 201);
        }
      }
      if (path[2] === 'gis-drafts' && path[3] && path.length === 4) {
        const draftId = path[3];
        if (method === 'PUT') {
          const input = await bodyOf(request); if (input.data === undefined) return fail('GIS draft data is required.');
          if (JSON.stringify(input.data).length > 900000) return fail('GIS draft exceeds the 900 KB storage limit.', 413);
          const patch: Json = { data: input.data, updated_at: new Date().toISOString() };
          if (typeof input.name === 'string') patch.name = input.name.trim().slice(0, 100);
          const { data: current, error: readError } = await supabase.from('gis_drafts').select('version').eq('id', draftId).eq('project_id', projectId).maybeSingle();
          if (readError) throw readError;
          if (!current) return fail('GIS draft not found.', 404);
          const { data, error } = await supabase.from('gis_drafts').update({ ...patch, version: current.version + 1 }).eq('id', draftId).eq('project_id', projectId).select('*').single();
          if (error) throw error;
          return json({ draft: draftView(data) });
        }
        if (method === 'DELETE') {
          const { data, error } = await supabase.from('gis_drafts').delete().eq('id', draftId).eq('project_id', projectId).select('id').maybeSingle();
          if (error) throw error;
          if (!data) return fail('GIS draft not found.', 404);
          return json({ deleted: true, draftId });
        }
      }
      if (path[2] === 'gis-terrain' && path[3] === 'outputs' && (path.length === 4 || path.length === 5) && method === 'GET') {
        const service = process.env.PYQGIS_API_URL; const key = process.env.PYQGIS_API_KEY;
        if (!service || !key) return fail('PyQGIS terrain service is not configured.', 503);
        if (path.length === 5 && !/^[a-f0-9]{16}$/.test(path[4])) return fail('Invalid terrain output ID.');
        const upstream = new URL(path.length === 4 ? '/terrain/outputs' : '/terrain/outputs/' + path[4], service);
        upstream.searchParams.set('userId', userId); upstream.searchParams.set('projectId', projectId);
        try {
          const response = await upstreamFile(upstream, { headers: { Authorization: `Bearer ${key}` } });
          if (path.length === 4) return json(await response.json());
          const headers = new Headers();
          headers.set('Content-Type', response.headers.get('content-type') || 'application/octet-stream');
          const disposition = response.headers.get('content-disposition');
          if (disposition) headers.set('Content-Disposition', disposition);
          headers.set('Cache-Control', 'private, no-store');
          return new Response(await response.arrayBuffer(), { status: 200, headers });
        } catch (error) { return fail(error instanceof Error ? error.message : 'Terrain output retrieval failed.', 502); }
      }
      if (path[2] === 'gis-terrain' && path.length === 4 && path[3] !== 'status' && method === 'POST') {
        const service = process.env.PYQGIS_API_URL; const key = process.env.PYQGIS_API_KEY;
        if (!service || !key) return fail('PyQGIS terrain service is not configured. Configure PYQGIS_API_URL and PYQGIS_API_KEY.', 503);
        const operation = path[3]; if (!['profile', 'compare', 'least-cost', 'contours', 'slope', 'analyze', 'grid'].includes(operation)) return fail('Unknown terrain operation.', 404);
        const upstream = new URL(`/terrain/${operation}`, service);
        try { const result = await upstreamJson(upstream, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ ...(await bodyOf(request)), userId, projectId }) }); return json(result); }
        catch (error) { return fail(error instanceof Error ? error.message : 'PyQGIS service request failed.', 502); }
      }
      if (path[2] === 'gis-terrain' && path[3] === 'status' && method === 'POST') {
        const service = process.env.PYQGIS_API_URL; const key = process.env.PYQGIS_API_KEY;
        if (!service || !key) return fail('PyQGIS terrain service is not configured.', 503);
        const input = await bodyOf(request); const lat = Number(input.lat), lon = Number(input.lon);
        if (!Number.isFinite(lat) || Math.abs(lat) > 85 || !Number.isFinite(lon) || Math.abs(lon) > 180) return fail('Valid project coordinates are required.');
        try { const root = new URL(service); const [health, dem] = await Promise.all([upstreamJson(new URL('/health', root), { headers: { Authorization: `Bearer ${key}` } }), upstreamJson(new URL(`/dem/check?lat=${lat}&lon=${lon}`, root), { headers: { Authorization: `Bearer ${key}` } })]); return json({ service: health, demAvailability: dem }); }
        catch (error) { return fail(error instanceof Error ? error.message : 'PyQGIS service check failed.', 502); }
      }
    }
    if (path[0] === 'gis' && path[1] === 'status' && method === 'GET') {
      const endpoint = process.env.QGIS_SERVER_URL;
      if (!endpoint) return json({ configured: false, connected: false, projectReady: false, service: 'QGIS Server', message: 'QGIS Server endpoint is not configured.' });
      try {
        const projectUrl = new URL('/ogc/rayanaqua/rayanaqua.qgz', endpoint);
        const caps = async (service: string, version: string) => { const target = new URL(projectUrl); target.searchParams.set('SERVICE', service); target.searchParams.set('VERSION', version); target.searchParams.set('REQUEST', 'GetCapabilities'); const response = await fetch(target, { signal: AbortSignal.timeout(10000) }); if (!response.ok) throw new Error(`QGIS ${service} returned HTTP ${response.status}.`); return response.text(); };
        const [wms, wfs] = await Promise.all([caps('WMS', '1.3.0'), caps('WFS', '2.0.0')]);
        const extract = (xml: string, pattern: RegExp) => [...xml.matchAll(pattern)].map(m => m[1].trim()).filter(n => allowedLayers.has(n.split(':').pop() || n));
        const wmsLayers = extract(wms, /<Name>([^<]+)<\/Name>/g); const wfsLayers = extract(wfs, /<FeatureType>\s*<Name>([^<]+)<\/Name>/g);
        return json({ configured: true, connected: true, projectReady: Boolean(wmsLayers.length && wfsLayers.length), projectTitle: 'RayanAqua Engineering Base Layers', projectPath: projectUrl.pathname, wmsUrl: projectUrl.toString(), wmsLayers, wfsLayers, service: 'QGIS Server', message: `QGIS capabilities checked: ${wmsLayers.length} WMS and ${wfsLayers.length} WFS layers.` });
      } catch (error) { return json({ configured: true, connected: false, projectReady: false, service: 'QGIS Server', message: error instanceof Error ? error.message : 'QGIS Server could not be reached.' }); }
    }
    if (path[0] === 'gis' && path[1] === 'ogc' && path[2] === 'features' && method === 'POST') {
      const endpoint = process.env.QGIS_SERVER_URL; if (!endpoint) return fail('QGIS Server endpoint is not configured.', 503);
      const input = await bodyOf(request); const typeName = String(input.typeName ?? '').trim(); const layer = typeName.split(':').pop() || '';
      if (!allowedLayers.has(layer) || !/^(?:[A-Za-z0-9_-]+:)?[A-Za-z0-9_-]+$/.test(typeName)) return fail('Select a published RayanAqua WFS layer.');
      const count = Math.max(1, Math.min(5000, Math.floor(Number(input.limit) || 1000))); const target = new URL('/ogc/rayanaqua/rayanaqua.qgz', endpoint);
      Object.entries({ SERVICE: 'WFS', VERSION: '2.0.0', REQUEST: 'GetFeature', TYPENAMES: typeName, COUNT: String(count), OUTPUTFORMAT: 'application/json' }).forEach(([k, v]) => target.searchParams.set(k, v));
      try { const result = await upstreamJson(target); if (result.type !== 'FeatureCollection' || !Array.isArray(result.features)) return fail('QGIS WFS did not return a GeoJSON FeatureCollection.', 502); return json({ featureCollection: result, count: result.features.length, limit: count }); }
      catch (error) { return fail(error instanceof Error ? error.message : 'QGIS WFS request failed.', 502); }
    }
    return fail('Not found.', 404);
  } catch (error) {
    console.error('API request failed:', error);
    const message = error instanceof Error && !('code' in error) ? error.message : 'The API request could not be completed.';
    return fail(message, 500);
  }
}

export default async function vercelHandler(req: VercelNodeRequest, res: VercelNodeResponse): Promise<void> {
  try {
    const host = req.headers.host || 'localhost';
    const protocol = req.headers['x-forwarded-proto']?.toString().split(',')[0] || 'https';
    const url = new URL(req.url || '/', `${protocol}://${host}`);
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }
    const method = req.method || 'GET';
    const hasBody = method !== 'GET' && method !== 'HEAD';
    const body = hasBody && req.body !== undefined
      ? typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
      : undefined;
    const webRequest = new Request(url, { method, headers, ...(body !== undefined ? { body } : {}) });
    const response = await handleRequest(webRequest);
    res.statusCode = response.status;
    response.headers.forEach((value, name) => res.setHeader(name, value));
    res.end(await response.text());
  } catch (error) {
    console.error('Vercel API adapter failed:', error);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'The API request could not be completed.' }));
  }
}
