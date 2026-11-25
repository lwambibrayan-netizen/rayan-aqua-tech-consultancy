# Dedicated PyQGIS terrain service

This is the service source that the backend's `PYQGIS_API_URL` points to. Deploy it separately in a QGIS-enabled runtime; the web app's build manifest alone does not contain a running QGIS engine.

Required runtime secrets/config:
- `PYQGIS_API_KEY`: same bearer token configured as the backend secret.
- `TERRAIN_DEM_PATH`: path to a verified, georeferenced DEM GeoTIFF mounted into the service.
- `QGIS_PREFIX_PATH` if the image's QGIS install differs from `/usr`.

The service currently implements authenticated health/DEM diagnostics, DEM-derived pipeline profile sampling, route comparison, contour generation and slope processing. It explicitly reports missing DEM data rather than fabricating elevations. Copernicus GLO-30/GLO-90 discovery/download, persistent raster/vector publishing, classified slope styling and least-cost path solving still require provider credentials/data-source integration and are not claimed as complete by this source. The `/terrain/least-cost` endpoint deliberately returns 422 until cost/obstacle rasters are configured.

Use a managed secret store for the bearer token. Do not commit secrets into source control.
