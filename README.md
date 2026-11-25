# RayanAqua Tech Consultancy

A React/Vite water-engineering workspace deployed as a static Vercel site with Node.js 22 serverless API functions. The existing EPANET network editor and solver, GIS/GeoJSON, PyQGIS service client, CAD/3D drawing, calculators, project management and reporting code are retained.

## Local development and checks

Use Node.js 22. Install dependencies with `npm install`, then start with `npm run dev`. Run `npm run typecheck`, `npm test` and `npm run build` before deployment. `package-lock.json` should be generated and committed using `npm install` under Node 22; do not use `npm ci` until the lockfile exists.

## Supabase setup (required)

1. Create a Supabase project and configure Google OAuth under Authentication → Providers. Add the deployed Vercel domain and local development URL to the provider redirect allow-list.
2. Run `supabase/schema.sql` in the Supabase SQL editor. It creates the project, document and GIS-draft tables and enables row-level security (RLS).
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for the Vite build. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` as Vercel server environment variables as well. These are the public project URL and anon/publishable key—not a service-role key.
4. Review the RLS policies before adding any tables. Project documents and GIS drafts have both an owner predicate and a project-owner existence check. API calls forward the authenticated user's JWT to Supabase; the server does not bypass RLS.

## Vercel setup

Import the repository into Vercel, select the Vite framework preset, and use the repository root. `vercel.json` specifies `npm run build`, `dist`, and the `nodejs22.x` API runtime. Add environment variables for Preview and Production separately. Configure the matching OAuth redirect URL in Supabase. No AppDeploy runtime or credentials are used.

The API entry point is `api/[...path].ts`; the SPA entry point is `main.tsx` referenced from the root `index.html`. The Vite output is `dist/`.

## Optional engineering integrations

- **QGIS Server:** `QGIS_SERVER_URL` points to a deployment serving the configured `/ogc/rayanaqua/rayanaqua.qgz` OGC project. WMS/WFS status is discovered from GetCapabilities; WFS import is proxied through the authenticated API.
- **PyQGIS terrain processing:** deploy the included QGIS-enabled Python service separately. Configure server-only `PYQGIS_API_URL` and `PYQIS_API_KEY` (use the actual variable name `PYQGIS_API_KEY`) in Vercel, and `PYQGIS_API_KEY` plus `TERRAIN_DEM_PATH` in the service. Mount a verified georeferenced DEM; no terrain results are generated when service/data is unavailable. The backend currently calls the profile, compare, contours, slope, analyze and status operations. The Python service's least-cost route endpoint explicitly reports its requirement for project-specific cost/obstacle data.
- **Basemaps/elevation:** GIS uses public tile/elevation providers configured in the existing client. Their availability, terms, rate limits and data quality are external. Public DEM-derived values are indicative, not surveyed levels.

The API responds with an explicit unconfigured/unavailable error rather than simulating a QGIS, PyQGIS, database, or terrain result. EPANET remains a client-side OWA-EPANET engine; validate model assumptions, units, boundary conditions and outputs independently before engineering use.

## Security and operations

Never commit `.env` files, OAuth secrets, database service-role keys, or the terrain API token. Configure secrets in Vercel and the relevant external service. Supabase RLS is the authorization boundary for every project row. Rotate any credentials that may have appeared in earlier repository revisions and inspect Git history; deleting a value from the latest tree does not remove it from old commits. Set up Supabase backups, monitoring and retention appropriate to your project data.

## Verification status

A lockfile and execution results must be produced in a Node 22 environment. This source update is not a claim that `npm install`, typecheck, unit tests, Vercel deployment, external GIS services, or EPANET simulations have succeeded; run the commands above in CI or locally and resolve any reported errors before production release.
