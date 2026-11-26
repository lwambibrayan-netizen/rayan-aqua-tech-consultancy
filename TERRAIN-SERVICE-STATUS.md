# QGIS / PyQGIS terrain integration status

## Implemented in the feature branch
- `app.py` is the dedicated Flask + PyQGIS terrain API.
- The Docker image builds the QGIS 3.40 service and provisions `TERRAIN_OUTPUT_DIR=/data/terrain-outputs`.
- The backend forwards authenticated, project-owned requests to PyQGIS using server-only `PYQGIS_API_URL` and `PYQGIS_API_KEY`.
- The service requires its own `PYQGIS_API_KEY` and a mounted, georeferenced DEM configured through `TERRAIN_DEM_PATH`. It returns an error when the DEM is absent; it does not invent terrain.
- Ground profiles, route comparisons, contours, least-cost route results and slope rasters are now written to a user- and project-scoped output directory. Authenticated list and retrieval endpoints prevent cross-project output access.
- Profile and route outputs are persisted as JSON; contours are persisted as GeoJSON inside the output record; slope analysis is persisted as GeoTIFF.
- Hydraulic result overlays now include pressure, flow, velocity and headloss selectors. EPANET simulations capture a bounded set of hydraulic time-step snapshots for time selection in GIS.
- EPANET INP import preserves unrecognised sections and unsupported control/rule blocks for export instead of silently discarding them.
- Terrain profile chainage and raster pixel resolution are measured in metres using QGIS distance/ellipsoid calculations. Profile results include maximum uphill grade.

## Deployment requirements — not yet verified live
- The PyQGIS container must be deployed separately, with a **persistent volume mounted at** `/data/terrain-outputs`. Docker `VOLUME` declares the mount point; the hosting platform must attach durable storage to retain files across redeployments.
- Configure `PYQGIS_API_KEY` in the PyQGIS service and `PYQGIS_API_URL` plus `PYQGIS_API_KEY` in the authenticated Vercel API.
- Mount a verified, georeferenced DEM and set `TERRAIN_DEM_PATH`. Confirm its datum, CRS, resolution and survey suitability.
- Live health, DEM, profile, contours, least-cost, raster persistence and authenticated retrieval requests must be tested against the deployed service before relying on outputs.
- The least-cost route uses a DEM-derived corridor and slope-weighted Dijkstra. Review obstacles and route constructability; it is not a detailed pipeline alignment approval.
- The current QGIS Server WMS/WFS integration remains separate and requires `QGIS_SERVER_URL` plus a published QGIS project/layers.

## Engineering acceptance checks still required
1. Deploy the PyQGIS service with durable storage and a verified project DEM.
2. Test a known surveyed pipeline route against expected chainage/elevation values.
3. Verify saved contour GeoJSON and slope GeoTIFF survive service restarts and can only be retrieved by the owning project.
4. Validate pressure/flow/velocity/headloss map overlays against the same EPANET result period and the hydraulic report.
5. Run representative EPANET INP round-trip files in OWA-EPANET and compare node/link counts, settings, controls, rules and report results.
