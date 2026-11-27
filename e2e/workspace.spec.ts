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

async function prepareWorkspace(page: import('@playwright/test').Page) {
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

test('engineer opens a project, uses visible CAD navigation, saves and opens 3D', async ({ page }) => {
  await prepareWorkspace(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Projects/ }).first()).toBeVisible();
  await page.getByRole('button', { name: /Projects/ }).first().click();
  await page.getByRole('button', { name: /Voi Water Supply E2E/ }).click();
  await page.getByRole('button', { name: /CAD & 3D workspace/ }).click();

  const pan = page.getByRole('button', { name: 'Pan drawing' });
  await expect(pan).toBeVisible();
  await expect(pan).toHaveAttribute('aria-pressed', 'false');
  await pan.click();
  await expect(pan).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Zoom Extents' }).click();

  await page.getByRole('button', { name: 'Save drawing' }).click();
  await expect(page.getByText(/Saved to Voi Water Supply E2E/)).toBeVisible();

  await page.getByRole('tab', { name: '3D Modeling' }).click();
  await page.getByRole('button', { name: /Open 3D View/ }).click();
  await expect(page.getByText('Interactive 3D model viewport')).toBeVisible();
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
  expect(result.contour_features).toBeGreaterThan(0);
});
