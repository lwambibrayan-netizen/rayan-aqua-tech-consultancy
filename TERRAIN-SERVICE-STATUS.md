# QGIS / PyQGIS terrain integration status

## Source included in this branch
- `app.py` is the dedicated Flask + PyQGIS terrain API.
- `Dockerfile` builds the QGIS 3.40 service image; `requirements.txt` installs Flask.
- The API backend forwards authenticated project requests to the service using server-only `PYQGIS_API_URL` and `PYQGIS_API_KEY`.
- The service requires its own `PYQGIS_API_KEY` and a mounted, georeferenced DEM configured through `TERRAIN_DEM_PATH`. It deliberately returns an error if the DEM is absent; it does not invent terrain.
- Terrain profile chainage and raster pixel resolution are measured in metres using QGIS distance/ellipsoid calculations. Profile results now include maximum uphill grade.
- GIS client labels distinguish the browser-side DEM-grid least-cost route from server-side PyQGIS profiles, route comparisons, contours and slope analysis.

## Important limitations — not yet production-complete
- Passing CI verifies Python syntax, TypeScript, tests and the Vite build. It does **not** prove that a live QGIS/PyQGIS service is deployed or reachable.
- Deploy the service separately, set the backend and service secrets, mount a verified DEM, and run live health/DEM/profile/contour/slope requests before relying on outputs.
- The current PyQGIS least-cost endpoint intentionally returns HTTP 422 until a project-specific cost raster and obstacle layer are supplied. The UI's current 17 × 17 least-cost route is a separate browser-side DEM-sampled grid, not the PyQGIS least-cost engine.
- Contours are returned as GeoJSON and can be saved in a GIS draft. The slope operation currently produces a temporary raster; persistent slope-raster storage, styled/classified slope overlays and durable raster-layer retrieval are still outstanding.
- The service does not yet download/manage Copernicus DEM tiles automatically. Provide a verified local GeoTIFF and confirm its datum, CRS, resolution and survey suitability.
- QGIS Server WMS/WFS is a separate integration and requires `QGIS_SERVER_URL` plus a published QGIS project/layers.

## Next engineering steps
1. Deploy the QGIS service and configure secrets and DEM storage.
2. Exercise authenticated live endpoints and test a known surveyed route against expected chainage/elevation values.
3. Implement project-scoped persistent raster outputs and classified slope overlays.
4. Implement PyQGIS least-cost routing using explicit terrain-cost and obstacle layers, then connect its output to saved GIS drafts.
5. Add live integration tests; current automated tests are source/configuration checks, not hydraulic or GIS acceptance tests.
