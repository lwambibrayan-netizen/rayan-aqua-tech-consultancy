# QGIS / PyQGIS terrain source update (25 Nov 2026)

## Included in this archive
- Backend PyQGIS API authentication now reads `PYQGIS_API_KEY` from AppDeploy secrets; the previously embedded/obfuscated key was removed.
- Authenticated project-owner checks remain on terrain routes.
- Added `pyqgis-service/` with a dedicated QGIS runtime container, authenticated service endpoints, local GeoTIFF DEM diagnostics, DEM-derived profile sampling, route comparison, QGIS contour generation and slope processing.
- Existing GIS client supports terrain profiles, route comparisons, contour GeoJSON export, profile CSV export, and appending returned contours to the active GIS draft.

## Required before claiming production terrain connectivity
Deploy the service separately and set `PYQGIS_API_URL` and `PYQGIS_API_KEY` in the backend secret store. Mount a verified DEM and set `TERRAIN_DEM_PATH`. The service refuses to invent elevations when a DEM is absent. The service currently does not download Copernicus tiles, persist generated raster layers into a GIS project store, style classified slope overlays, or compute least-cost routes; these require further implementation and live integration. The archive is source only and does not alter the live AppDeploy deployment.
