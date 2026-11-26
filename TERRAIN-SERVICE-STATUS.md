# QGIS / PyQGIS terrain integration status

## Existing Railway infrastructure
- Railway project: **RayanAqua GIS Infrastructure**.
- Existing services observed online: **RayanAqua PyQGIS Processing API**, **QGIS Server**, and **PostGIS**.
- The PyQGIS service has a 500 MB persistent volume mounted at `/io/data`; its existing processor stores DEM and derived terrain files under a project-specific hashed folder at `/io/data/processing`.
- The current live processor downloads Copernicus DEM GLO-30 tiles with GLO-90 fallback, reprojects/clips them for analysis, and exposes a passing `/selftest` health check.
- Existing live processing operations: ground profile, route comparison, contours, slope statistics, and DEM-grid least-cost route analysis.

## Feature-branch implementation
- The feature branch now contains the same Copernicus-backed PyQGIS service implementation as the live processor, with project-scoped output manifests and authenticated output retrieval added.
- Profile, route-comparison, contour, slope-analysis and least-cost results are saved under the authenticated user's project folder.
- Slope calculations retain their derived GeoTIFF raster. The output archive exposes metadata listing and authenticated JSON/GeoJSON or GeoTIFF downloads.
- The Vercel API adds project-ownership-checked routes for listing and downloading those outputs. The browser download uses the user's existing Supabase access token.
- The GIS workspace shows saved PyQGIS outputs and supports downloading them.
- The Dockerfile now uses the same QGIS Server LTR runtime as the existing Railway service and mounts `/io/data` as persistent storage.
- Hydraulic map overlays support pressure, flow, velocity and headloss, with a time-step selector using bounded EPANET simulation snapshots.
- EPANET import/export now preserves unrecognised INP sections and unsupported control/rule blocks rather than silently dropping them.

## Deployment protection
- A **staged Railway configuration change** has been prepared for the existing PyQGIS Processing API. It updates only that service's start command to the feature-branch processor.
- The staged change is not live. The current Railway PyQGIS API, QGIS Server, PostGIS, and the production RayanAqua application have not been replaced or redeployed by this feature-branch work.
- Accepting the staged change will redeploy the dedicated PyQGIS service. Its existing `/io/data` volume and `/selftest` health check are retained.
- Until that staged service update is accepted and passes its health check, the saved-output listing/download endpoints are not available from the currently live PyQGIS service.

## Engineering acceptance checks
1. Accept the staged PyQGIS service update only after reviewing the feature preview.
2. Confirm Railway deployment succeeds and `/selftest` passes.
3. Run profile, compare, contours, slope and least-cost against a known route; verify the saved outputs survive a service restart.
4. Verify one user's project cannot list or download another project's output.
5. Compare hydraulic map values at selected time steps with the EPANET report and confirm GIS–EPANET coordinate and attribute synchronization.
6. Round-trip representative EPANET INP files and compare node/link counts, pump and valve data, controls, rules and simulation results.

## Engineering limitations
- Copernicus GLO-30/GLO-90 is a digital surface model; it is not a substitute for project survey, pipe cover verification, geotechnical investigation or construction set-out.
- Least-cost routing is a slope-weighted DEM corridor analysis. Obstacles and engineering constraints require review; the result is not a certified pipeline alignment.
- Hydraulic pressure/velocity criteria are editable screening limits. Confirm applicable design standards and project requirements before approval.
