import { router, json, error, requireAuth, db, secrets } from '@appdeploy/sdk';

type Project = {
  ownerUserId: string;
  title: string;
  location: string;
  projectType: string;
  client: string;
  status: string;
  description: string;
  createdAt: string;
  updatedAt: string;
};

type ProjectDocument = {
  ownerUserId: string;
  projectId: string;
  kind: string;
  data: unknown;
  version: number;
  updatedAt: string;
};

const safeKey = (userId: string) => userId.replace(/[^A-Za-z0-9]/g, '');
const projectTable = (userId: string) => 'ra_projects_' + safeKey(userId);
const documentTable = (userId: string) => 'ra_docs_' + safeKey(userId);
const allowedStatuses = ['Planning', 'In progress', 'On hold', 'Completed'];
const allowedDocumentKinds = ['hydraulic', 'boq', 'report', 'drawing', 'gis', 'calculations'];

function bodyRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

async function ownedProject(
  userId: string,
  projectId: string
): Promise<Project | null> {
  const [project] = await db.get<Project>(projectTable(userId), [projectId]);
  if (!project || project.ownerUserId !== userId) return null;
  return project;
}

const PYQGIS_API_URL = 'https://rayanaqua-pyqgis-processing-api-production.up.railway.app';
const PYQGIS_API_KEY = atob('MjM5MzVjOGRkN2E3ZjI4OWU2NGE1ODNkODMzNDI2MjUzNDgwYjk2MDRlNjNhZTk2ZDczODU3NDY5ZmNlMjhjZg==');

async function runPyqgis(userId: string, projectId: string, operation: string, payload: Record<string, unknown>) {
  const response = await fetch(PYQGIS_API_URL + '/terrain/' + operation, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + PYQGIS_API_KEY },
    body: JSON.stringify({ ...payload, userId, projectId }),
  });
  const raw = await response.text();
  let result: any;
  try { result = JSON.parse(raw); } catch { result = { error: raw.slice(0, 400) }; }
  if (!response.ok) throw new Error(String(result.error || 'PyQGIS service returned HTTP ' + response.status + '.'));
  return result;
}

export const handler = router({
  'GET /api/health': [
    async () => json({ status: 'ok', service: 'RayanAqua cloud workspace' }),
  ],

  'GET /api/gis/status': [
    requireAuth(),
    async () => {
      const secretNames = await secrets.listSecretNames();
      if (!secretNames.includes('QGIS_SERVER_URL')) {
        return json({
          configured: false,
          connected: false,
          projectReady: false,
          service: 'QGIS Server',
          message: 'QGIS Server endpoint has not been configured.',
        });
      }
      try {
        const endpoint = await secrets.readSecret('QGIS_SERVER_URL');
        const base = endpoint.endsWith('/') ? endpoint : endpoint + '/';
        const root = await fetch(base);
        if (root.status >= 500) {
          return json({
            configured: true,
            connected: false,
            projectReady: false,
            service: 'QGIS Server',
            httpStatus: root.status,
            message: 'QGIS Server returned HTTP ' + root.status + '.',
          });
        }
        const projectPath = '/ogc/rayanaqua/rayanaqua.qgz';
        const projectUrl = new URL(projectPath, base);
        const readCapabilities = async (service: string, version: string) => {
          const url = new URL(projectUrl.toString());
          url.searchParams.set('SERVICE', service);
          url.searchParams.set('VERSION', version);
          url.searchParams.set('REQUEST', 'GetCapabilities');
          const response = await fetch(url.toString());
          const xml = await response.text();
          if (!response.ok || /<(?:ServiceException|ExceptionText)\b|Project file error/i.test(xml)) {
            throw new Error(service + ' GetCapabilities failed (HTTP ' + response.status + '). ' + xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220));
          }
          return xml;
        };
        const [wmsXml, wfsXml] = await Promise.all([
          readCapabilities('WMS', '1.3.0'),
          readCapabilities('WFS', '2.0.0'),
        ]);
        const allowedLayers = ['junctions', 'water_sources', 'reservoirs', 'tanks', 'pipelines', 'pumps', 'valves', 'project_boundary'];
        const wmsLayers = [...new Set(Array.from(wmsXml.matchAll(/<Name>([^<]+)<\/Name>/g), match => match[1].trim()).filter(name => allowedLayers.includes(name.split(':').pop() || name)))];
        const wfsLayers = [...new Set(Array.from(wfsXml.matchAll(/<FeatureType>\s*<Name>([^<]+)<\/Name>/g), match => match[1].trim()).filter(name => allowedLayers.includes(name.split(':').pop() || name)))];
        return json({
          configured: true,
          connected: true,
          projectReady: wmsLayers.length > 0 && wfsLayers.length > 0,
          projectTitle: 'RayanAqua Engineering Base Layers',
          projectPath,
          wmsUrl: projectUrl.toString(),
          wmsLayers,
          wfsLayers,
          service: 'QGIS Server',
          httpStatus: 200,
          message: wmsLayers.length && wfsLayers.length
            ? 'QGIS Server project loaded. WMS map rendering and WFS feature services are responding with ' + wmsLayers.length + ' map layer(s) and ' + wfsLayers.length + ' feature layer(s).'
            : 'QGIS Server answered OGC requests, but no supported vector layers were advertised in the project.',
        });
      } catch (caught) {
        return json({
          configured: true,
          connected: true,
          projectReady: false,
          service: 'QGIS Server',
          message: caught instanceof Error
            ? 'QGIS Server is reachable, but its engineering project or OGC services are not ready: ' + caught.message
            : 'QGIS Server is reachable, but its OGC project could not be loaded.',
        });
      }
    },
  ],

  'POST /api/projects/:id/gis-terrain/status': [
    requireAuth(),
    async ctx => {
      const userId = ctx.user!.userId;
      const projectId = ctx.params.id;
      if (!(await ownedProject(userId, projectId))) return error('Project not found.', 404);
      try {
        const input = bodyRecord(ctx.body);
        const lat = Number(input.lat ?? -3.4);
        const lon = Number(input.lon ?? 38.5);
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) return error('Valid project-centre coordinates are required.', 400);
        const [healthResponse, demResponse] = await Promise.all([
          fetch(PYQGIS_API_URL + '/health'),
          fetch(PYQGIS_API_URL + '/dem/check?lat=' + encodeURIComponent(String(lat)) + '&lon=' + encodeURIComponent(String(lon))),
        ]);
        if (!healthResponse.ok || !demResponse.ok) return error('PyQGIS or Copernicus DEM diagnostics failed.', 502);
        const [service, demAvailability] = await Promise.all([healthResponse.json(), demResponse.json()]);
        return json({ service, demAvailability });
      } catch (caught) {
        return error(caught instanceof Error ? caught.message : 'PyQGIS status check failed.', 502);
      }
    },
  ],

  'POST /api/projects/:id/gis-terrain/:operation': [
    requireAuth(),
    async ctx => {
      const userId = ctx.user!.userId;
      const projectId = ctx.params.id;
      if (!(await ownedProject(userId, projectId))) return error('Project not found.', 404);
      const operation = String(ctx.params.operation || '');
      if (!['profile', 'compare', 'contours', 'slope', 'analyze'].includes(operation)) return error('Unknown terrain operation.', 404);
      try {
        return json(await runPyqgis(userId, projectId, operation, bodyRecord(ctx.body)));
      } catch (caught) {
        return error(caught instanceof Error ? caught.message : 'PyQGIS terrain processing failed.', 502);
      }
    },
  ],

  'POST /api/gis/ogc/features': [
    requireAuth(),
    async ctx => {
      const input = bodyRecord(ctx.body);
      const typeName = String(input.typeName ?? '').trim();
      const allowed = /^(?:[A-Za-z0-9_-]+:)?(?:junctions|water_sources|reservoirs|tanks|pipelines|pumps|valves|project_boundary)$/;
      if (!allowed.test(typeName)) return error('Select a published RayanAqua WFS layer.', 400);
      const requestedLimit = Number(input.limit ?? 1000);
      const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(5000, Math.floor(requestedLimit))) : 1000;
      try {
        const secretNames = await secrets.listSecretNames();
        if (!secretNames.includes('QGIS_SERVER_URL')) return error('QGIS Server endpoint is not configured.', 503);
        const endpoint = await secrets.readSecret('QGIS_SERVER_URL');
        const url = new URL('/ogc/rayanaqua/rayanaqua.qgz', endpoint.endsWith('/') ? endpoint : endpoint + '/');
        url.searchParams.set('SERVICE', 'WFS');
        url.searchParams.set('VERSION', '2.0.0');
        url.searchParams.set('REQUEST', 'GetFeature');
        url.searchParams.set('TYPENAMES', typeName);
        url.searchParams.set('COUNT', String(limit));
        url.searchParams.set('OUTPUTFORMAT', 'application/json');
        const response = await fetch(url.toString());
        const body = await response.text();
        if (!response.ok) return error('QGIS WFS returned HTTP ' + response.status + '.', 502);
        let collection: any;
        try { collection = JSON.parse(body); }
        catch { return error('QGIS WFS did not return GeoJSON. Check that the published layer is a valid vector layer.', 502); }
        if (collection?.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
          return error('QGIS WFS response is not a GeoJSON FeatureCollection.', 502);
        }
        return json({ featureCollection: collection, count: collection.features.length, limit });
      } catch (caught) {
        return error(caught instanceof Error ? 'QGIS WFS request failed: ' + caught.message : 'QGIS WFS request failed.', 502);
      }
    },
  ],

  'GET /api/projects': [
    requireAuth(),
    async ctx => {
      const userId = ctx.user!.userId;
      const result = await db.list<Project>(projectTable(userId), {
        limit: 100,
      });
      const projects = result.items
        .filter(item => item.ownerUserId === userId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return json({ projects });
    },
  ],

  'POST /api/projects': [
    requireAuth(),
    async ctx => {
      const userId = ctx.user!.userId;
      const input = bodyRecord(ctx.body);
      const title = String(input.title ?? '').trim();
      if (!title) return error('Project name is required.', 400);
      if (title.length > 120)
        return error('Project name must be 120 characters or fewer.', 400);

      const now = new Date().toISOString();
      const project: Project = {
        ownerUserId: userId,
        title,
        location: String(input.location ?? '')
          .trim()
          .slice(0, 160),
        projectType: String(input.projectType ?? 'Water supply')
          .trim()
          .slice(0, 80),
        client: String(input.client ?? '')
          .trim()
          .slice(0, 120),
        status: allowedStatuses.includes(String(input.status))
          ? String(input.status)
          : 'Planning',
        description: String(input.description ?? '')
          .trim()
          .slice(0, 2000),
        createdAt: now,
        updatedAt: now,
      };
      const [id] = await db.add(projectTable(userId), [project]);
      if (!id)
        return error('The project could not be created. Please retry.', 503);
      return json({ project: { ...project, id } }, 201);
    },
  ],

  'PUT /api/projects/:id': [
    requireAuth(),
    async ctx => {
      const userId = ctx.user!.userId;
      const projectId = ctx.params.id;
      const existing = await ownedProject(userId, projectId);
      if (!existing) return error('Project not found.', 404);

      const input = bodyRecord(ctx.body);
      const patch: Record<string, unknown> = {
        updatedAt: new Date().toISOString(),
      };
      if (typeof input.title === 'string') {
        const title = input.title.trim();
        if (!title) return error('Project name is required.', 400);
        if (title.length > 120)
          return error('Project name must be 120 characters or fewer.', 400);
        patch.title = title;
      }
      if (typeof input.location === 'string')
        patch.location = input.location.trim().slice(0, 160);
      if (typeof input.projectType === 'string')
        patch.projectType = input.projectType.trim().slice(0, 80);
      if (typeof input.client === 'string')
        patch.client = input.client.trim().slice(0, 120);
      if (typeof input.description === 'string')
        patch.description = input.description.trim().slice(0, 2000);
      if (typeof input.status === 'string') {
        if (!allowedStatuses.includes(input.status))
          return error('Invalid project status.', 400);
        patch.status = input.status;
      }
      const [updated] = await db.tx.update(
        projectTable(userId),
        [
          {
            id: projectId,
            record: patch,
            if: { ownerUserId: userId },
          },
        ],
        { patch: true }
      );
      if (!updated)
        return error(
          'Project changed or is no longer available. Refresh and retry.',
          409
        );
      const project = await ownedProject(userId, projectId);
      return json({ project: project ? { ...project, id: projectId } : null });
    },
  ],

  'DELETE /api/projects/:id': [
    requireAuth(),
    async ctx => {
      const userId = ctx.user!.userId;
      const projectId = ctx.params.id;
      const existing = await ownedProject(userId, projectId);
      if (!existing) return error('Project not found.', 404);
      const [deleted] = await db.delete(projectTable(userId), [projectId]);
      if (!deleted)
        return error('Project could not be deleted. Refresh and retry.', 409);
      const docs = documentTable(userId);
      for (const kind of allowedDocumentKinds) {
        await db.delete(docs, [projectId + '_' + kind]);
      }
      return json({ deleted: true, id: projectId });
    },
  ],

  'GET /api/projects/:id/gis-drafts': [
    requireAuth(),
    async ctx => {
      const userId = ctx.user!.userId;
      const projectId = ctx.params.id;
      if (!(await ownedProject(userId, projectId))) return error('Project not found.', 404);
      const result = await db.list<any>(documentTable(userId), { limit: 100 });
      const drafts = result.items
        .filter(item => item.ownerUserId === userId && item.projectId === projectId && item.kind === 'gis-draft')
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      return json({ drafts });
    },
  ],

  'POST /api/projects/:id/gis-drafts': [
    requireAuth(),
    async ctx => {
      const userId = ctx.user!.userId;
      const projectId = ctx.params.id;
      if (!(await ownedProject(userId, projectId))) return error('Project not found.', 404);
      const input = bodyRecord(ctx.body);
      const name = String(input.name ?? '').trim().slice(0, 100);
      if (!name) return error('Give this GIS draft a name.', 400);
      if (input.data === undefined) return error('GIS draft data is required.', 400);
      if (JSON.stringify(input.data).length > 900000) return error('This GIS draft exceeds the 900 KB project storage limit. Export GeoJSON or split the design into separate drafts.', 413);
      const now = new Date().toISOString();
      const draftId = crypto.randomUUID();
      const draft = {
        ownerUserId: userId, projectId, kind: 'gis-draft', draftId, name,
        data: input.data, version: 1, createdAt: now, updatedAt: now,
      };
      const [created] = await db.add(documentTable(userId), [{ ...draft, id: projectId + '_gisdraft_' + draftId }]);
      if (!created) return error('GIS draft was not saved. Please retry.', 503);
      return json({ draft: { ...draft, id: draftId } }, 201);
    },
  ],

  'PUT /api/projects/:id/gis-drafts/:draftId': [
    requireAuth(),
    async ctx => {
      const userId = ctx.user!.userId;
      const projectId = ctx.params.id;
      const draftId = ctx.params.draftId;
      if (!(await ownedProject(userId, projectId))) return error('Project not found.', 404);
      const recordId = projectId + '_gisdraft_' + draftId;
      const table = documentTable(userId);
      const [existing] = await db.get<any>(table, [recordId]);
      if (!existing || existing.ownerUserId !== userId || existing.projectId !== projectId || existing.kind !== 'gis-draft') return error('GIS draft not found.', 404);
      const input = bodyRecord(ctx.body);
      const name = typeof input.name === 'string' ? input.name.trim().slice(0, 100) : existing.name;
      if (!name) return error('GIS draft name is required.', 400);
      if (input.data === undefined) return error('GIS draft data is required.', 400);
      if (JSON.stringify(input.data).length > 900000) return error('This GIS draft exceeds the 900 KB project storage limit. Export GeoJSON or split the design into separate drafts.', 413);
      const now = new Date().toISOString();
      const [updated] = await db.tx.update(table, [{
        id: recordId,
        record: { name, data: input.data, version: existing.version + 1, updatedAt: now },
        if: { ownerUserId: userId, projectId, version: existing.version },
      }], { patch: true });
      if (!updated) return error('This GIS draft changed elsewhere. Reload and retry.', 409);
      return json({ draft: { ...existing, name, data: input.data, version: existing.version + 1, updatedAt: now, id: draftId } });
    },
  ],

  'DELETE /api/projects/:id/gis-drafts/:draftId': [
    requireAuth(),
    async ctx => {
      const userId = ctx.user!.userId;
      const projectId = ctx.params.id;
      const draftId = ctx.params.draftId;
      if (!(await ownedProject(userId, projectId))) return error('Project not found.', 404);
      const recordId = projectId + '_gisdraft_' + draftId;
      const table = documentTable(userId);
      const [existing] = await db.get<any>(table, [recordId]);
      if (!existing || existing.ownerUserId !== userId || existing.projectId !== projectId || existing.kind !== 'gis-draft') return error('GIS draft not found.', 404);
      const [deleted] = await db.delete(table, [recordId]);
      if (!deleted) return error('GIS draft could not be deleted. Refresh and retry.', 409);
      return json({ deleted: true, draftId });
    },
  ],

  'GET /api/projects/:id/docs/:kind': [
    requireAuth(),
    async ctx => {
      const userId = ctx.user!.userId;
      const projectId = ctx.params.id;
      const kind = ctx.params.kind;
      if (!allowedDocumentKinds.includes(kind))
        return error('Unknown project document.', 404);
      if (!(await ownedProject(userId, projectId)))
        return error('Project not found.', 404);
      const docId = projectId + '_' + kind;
      const [doc] = await db.get<ProjectDocument>(documentTable(userId), [
        docId,
      ]);
      if (!doc || doc.ownerUserId !== userId || doc.projectId !== projectId) {
        return json({ document: null });
      }
      return json({ document: doc });
    },
  ],

  'PUT /api/projects/:id/docs/:kind': [
    requireAuth(),
    async ctx => {
      const userId = ctx.user!.userId;
      const projectId = ctx.params.id;
      const kind = ctx.params.kind;
      if (!allowedDocumentKinds.includes(kind))
        return error('Unknown project document.', 404);
      if (!(await ownedProject(userId, projectId)))
        return error('Project not found.', 404);

      const input = bodyRecord(ctx.body);
      const data = input.data;
      if (data === undefined) return error('Document data is required.', 400);
      const serialized = JSON.stringify(data);
      if (serialized.length > 220000)
        return error(
          'This document is too large to save. Split it into smaller project records.',
          413
        );

      const docId = projectId + '_' + kind;
      const table = documentTable(userId);
      const [existing] = await db.get<ProjectDocument>(table, [docId]);
      const now = new Date().toISOString();
      const nextVersion = (existing?.version ?? 0) + 1;
      const document: ProjectDocument = {
        ownerUserId: userId,
        projectId,
        kind,
        data,
        version: nextVersion,
        updatedAt: now,
      };

      if (!existing) {
        const [created] = await db.add(table, [{ ...document, id: docId }]);
        if (!created)
          return error('Document was not saved. Refresh and retry.', 409);
      } else {
        if (
          existing.ownerUserId !== userId ||
          existing.projectId !== projectId
        ) {
          return error('Project not found.', 404);
        }
        const [updated] = await db.tx.update(
          table,
          [
            {
              id: docId,
              record: { data, version: nextVersion, updatedAt: now },
              if: { ownerUserId: userId, version: existing.version },
            },
          ],
          { patch: true }
        );
        if (!updated)
          return error(
            'This document was changed elsewhere. Reload before saving again.',
            409
          );
      }
      return json({ document: { ...document } });
    },
  ],
});
