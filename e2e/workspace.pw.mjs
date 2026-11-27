import { test, expect } from '@playwright/test';

const userId = '00000000-0000-4000-8000-000000000001';
const projectId = '00000000-0000-4000-8000-000000000002';
const user = {
  id: userId,
  aud: 'authenticated',
  role: 'authenticated',
  email: 'cad-e2e@rayanaqua.test',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: { full_name: 'RayanAqua E2E Engineer' },
  created_at: '2026-01-01T00:00:00.000Z',
};

async function prepareWorkspace(page) {
  await page.addInitScript(() => {
    const now = Math.floor(Date.now() / 1000);
    localStorage.setItem('sb-crqvhmcnsktxlpteiryk-auth-token', JSON.stringify({
      access_token: 'e2e-only-mock-access-token',
      refresh_token: 'e2e-only-mock-refresh-token',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: now + 3600,
      user: {
        id: '00000000-0000-4000-8000-000000000001',
        aud: 'authenticated',
        role: 'authenticated',
        email: 'cad-e2e@rayanaqua.test',
        app_metadata: { provider: 'email', providers: ['email'] },
        user_metadata: { full_name: 'RayanAqua E2E Engineer' },
        created_at: '2026-01-01T00:00:00.000Z',
      },
    }));
  });

  await page.route('**/auth/v1/user**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) })
  );

  const project = {
    id: projectId,
    title: 'Voi Water Supply E2E',
    location: 'Voi, Taita Taveta, Kenya',
    projectType: 'Water supply',
    client: 'RayanAqua test client',
    status: 'Planning',
    description: 'Isolated browser-test project',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  await page.route('**/api/projects', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ projects: [project] }) });
      return;
    }
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ project }) });
  });

  await page.route('**/api/projects/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/gis-drafts')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ drafts: [] }) });
      return;
    }
    if (url.pathname.includes('/docs/')) {
      if (request.method() === 'GET') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ document: null }) });
      } else {
        const body = request.postDataJSON();
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ document: { data: body?.data ?? {}, version: 1, updatedAt: new Date().toISOString() } }) });
      }
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
}

test('engineer opens a project, verifies precision drafting, saves and opens 3D', async ({ page }) => {
  await prepareWorkspace(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Projects/ }).first()).toBeVisible();
  await page.getByRole('button', { name: /Projects/ }).first().click();
  await page.getByRole('button', { name: /Voi Water Supply E2E/ }).click();
  await page.getByRole('button', { name: /CAD & 3D workspace/ }).click();

  const ribbon = page.getByRole('tablist', { name: 'AquaCAD ribbon' });
  const cadShell = page.locator('.aquacad-shell');
  const drawingArea = cadShell.locator('.aquacad-canvas-layout');
  await expect(drawingArea).toBeVisible();

  await ribbon.getByRole('tab', { name: 'Modify' }).click();
  await expect(page.locator('.aquacad-shell .aquacad-ribbon-content').getByText('Move', { exact: true })).toBeVisible();
  await expect(drawingArea.getByRole('button', { name: /Move/ })).toHaveCount(0);
  await ribbon.getByRole('tab', { name: 'Home' }).click();
  await expect(page.locator('.aquacad-shell .aquacad-ribbon-content').getByText('Line', { exact: true })).toBeVisible();
  const ribbonContent = page.locator('.aquacad-shell .aquacad-ribbon-content');
  await expect(ribbonContent.getByRole('button', { name: 'Circle' })).toBeVisible();
  await expect(ribbonContent.getByRole('button', { name: 'Ellipse' })).toBeVisible();
  await expect(ribbonContent.getByRole('button', { name: 'Arc' })).toBeVisible();
  const currentLayer = ribbonContent.getByLabel('Current drawing layer');
  await expect(currentLayer).toHaveValue('0');
  await currentLayer.selectOption('WATER_PIPE');
  await expect(currentLayer).toHaveValue('WATER_PIPE');
  await ribbonContent.getByRole('button', { name: 'Circle' }).click();
  const circleMethod = ribbonContent.getByLabel('Circle method');
  await circleMethod.selectOption('three-point');
  await expect(circleMethod).toHaveValue('three-point');
  await ribbonContent.getByRole('button', { name: 'Ellipse' }).click();
  const ellipseMethod = ribbonContent.getByLabel('Ellipse method');
  await ellipseMethod.selectOption('axis-endpoints');
  await expect(ellipseMethod).toHaveValue('axis-endpoints');
  await expect(ribbonContent.getByRole('button', { name: 'Manage Layers' })).toBeVisible();
  await ribbonContent.getByRole('button', { name: 'Arc' }).click();
  const arcMethod = ribbonContent.getByLabel('Arc method');
  await arcMethod.selectOption('center-start-angle');
  await expect(ribbonContent.getByLabel('Sweep °')).toHaveValue('90');
  await ribbon.getByRole('tab', { name: 'Modify' }).click();
  await expect(ribbonContent.getByRole('button', { name: 'Trim' })).toHaveAttribute('title', /cutting edge first, then Shift-select the target/);
  await ribbon.getByRole('tab', { name: 'Home' }).click();
  await expect(drawingArea.getByRole('button', { name: /Line/ })).toHaveCount(0);
  await ribbon.getByRole('tab', { name: 'Drafting' }).click();
  await expect(page.locator('.aquacad-shell [data-cad-ribbon-panel="drafting"]')).toBeVisible();
  await expect(page.locator('.aquacad-shell [data-cad-ribbon-panel="drafting"]')).toContainText('Dimensions, annotations, layers & drawing sheets');
  await ribbon.getByRole('tab', { name: 'Insert' }).click();
  await expect(page.locator('.aquacad-shell [data-cad-ribbon-panel="blocks"]')).toContainText('Engineering object library');
  await ribbon.getByRole('tab', { name: 'Water Network' }).click();
  await expect(page.locator('.aquacad-shell [data-cad-ribbon-panel="water-network"]')).toContainText('Network component library');
  await ribbon.getByRole('tab', { name: '3D Modeling' }).click();
  await expect(page.locator('.aquacad-shell .aquacad-ribbon-content').getByRole('button', { name: /Fetch DEM from GIS/ })).toBeVisible();
  await ribbon.getByRole('tab', { name: 'Home' }).click();

  const cadCanvas = page.getByRole('application', { name: /AquaCAD drawing canvas/ });
  await ribbonContent.getByRole('button', { name: 'Polyline' }).click();
  await cadCanvas.click({ position: { x: 260, y: 200 } });
  await cadCanvas.click({ position: { x: 300, y: 200 } });
  await expect(ribbonContent.getByRole('button', { name: 'Finish Polyline' })).toBeVisible();
  await cadCanvas.click({ position: { x: 300, y: 240 } });
  await ribbonContent.getByRole('button', { name: 'Finish Polyline' }).click();
  await expect(page.getByText(/Polyline finished/).first()).toBeVisible();
  await expect(cadCanvas.locator('[data-shape-id]').first()).toHaveAttribute('stroke', '#087e83');

  await ribbonContent.getByRole('button', { name: 'Circle' }).click();
  await ribbonContent.getByLabel('Circle method').selectOption('center-radius');
  await cadCanvas.click({ position: { x: 120, y: 120 } });
  await cadCanvas.click({ position: { x: 160, y: 120 } });
  await expect(page.getByText(/Circle created using center-radius/).first()).toBeVisible();
  const circleEntity = cadCanvas.locator('circle[data-shape-id]').last();
  const circleBounds = await circleEntity.boundingBox();
  if (!circleBounds) throw new Error('Created circle is not present in the CAD canvas.');
  await circleEntity.click({ position: { x: circleBounds.width - 1, y: circleBounds.height / 2 } });
  await expect(page.getByText(/Entity selected/).first()).toBeVisible();
  await ribbon.getByRole('tab', { name: 'Annotate' }).click();
  await ribbonContent.getByRole('button', { name: 'Radius' }).click();
  await cadCanvas.click({ position: { x: 190, y: 145 } });
  await expect(page.getByText(/Radius dimension placed/).first()).toBeVisible();
  await ribbonContent.getByRole('button', { name: 'Diameter' }).click();
  await cadCanvas.click({ position: { x: 195, y: 160 } });
  await expect(page.getByText(/Diameter dimension placed/).first()).toBeVisible();
  await ribbon.getByRole('tab', { name: 'Home' }).click();

  const pan = page.getByRole('button', { name: 'Pan drawing' });
  await expect(pan).toBeVisible();
  await expect(pan).toHaveAttribute('aria-pressed', 'false');
  await pan.click();
  await expect(pan).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Zoom Extents' }).click();

  await page.getByRole('button', { name: 'Save', exact: true }).first().click();
  await expect(page.getByText(/Saved to Voi Water Supply E2E/)).toBeVisible();

  await page.getByRole('tab', { name: '3D Modeling' }).click();
  await page.getByRole('button', { name: /Open 3D View/ }).click();
  await expect(page.getByText('Interactive 3D model viewport')).toBeVisible();

  await page.getByRole('button', { name: 'Engineering tools', exact: true }).click();
  await expect(page.getByText('CAD / 3D coordination')).toHaveCount(0);
});

test('PyQGIS service exposes a healthy processor and passing self-test', async ({ request }) => {
  const base = 'https://rayanaqua-pyqgis-processing-api-production.up.railway.app';
  const health = await request.get(base + '/health');
  expect(health.ok()).toBeTruthy();
  const healthBody = await health.json();
  expect(JSON.stringify(healthBody).toLowerCase()).toContain('ok');

  const selftest = await request.get(base + '/selftest');
  expect(selftest.ok()).toBeTruthy();
  const result = await selftest.json();
  expect(result.status).toBe('passed');
  expect(result.profile_valid_samples).toBeGreaterThanOrEqual(2);
  expect(result.cad_grid_width).toBeGreaterThan(1);
  expect(result.cad_grid_height).toBeGreaterThan(1);
  expect(result.cad_grid_valid_samples).toBeGreaterThanOrEqual(4);
  expect(result.cad_grid_crs).toMatch(/^EPSG:\d+$/);
  expect(result.cad_grid_vertical_datum).toContain('Copernicus DEM');
  expect(result.contour_features).toBeGreaterThan(0);
});

test('engineer opens the GIS workspace and sees terrain-to-CAD tools', async ({ page }) => {
  await prepareWorkspace(page);
  await page.goto('/');
  await page.getByRole('button', { name: /Projects/ }).first().click();
  await page.getByRole('button', { name: /Voi Water Supply E2E/ }).click();
  await page.getByRole('button', { name: 'GIS workspace', exact: true }).click();

  await expect(page.getByRole('button', { name: /Pipeline ground profile/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Check PyQGIS \/ DEM coverage/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Send DEM surface to CAD \/ 3D/ })).toHaveCount(0);
});

test('PyQGIS DEM-to-CAD endpoint is registered and requires authentication', async ({ request }) => {
  const base = 'https://rayanaqua-pyqgis-processing-api-production.up.railway.app';
  const response = await request.post(base + '/terrain/grid', {
    data: { userId: 'e2e-user', projectId: 'e2e-project', bbox: { west: 38.5, south: -3.4, east: 38.51, north: -3.39 }, maxDimension: 32 },
  });
  expect(response.status()).toBe(401);
});
