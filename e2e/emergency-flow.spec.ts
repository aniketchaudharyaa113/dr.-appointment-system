import { test, expect } from '@playwright/test';

test.describe('Emergency SOS & Real Ambulance Dispatch E2E Flow', () => {
  test('Emergency page loads real hotlines + Leaflet map and dispatches live simulated ambulance', async ({
    page,
  }) => {
    // 1. Public view works immediately (hotlines + hospitals from /api/ambulance/emergency + Leaflet map)
    await page.goto('/emergency');
    await expect(page.locator('h1')).toContainText('Emergency SOS');
    await expect(page.locator('text=Call 112')).toBeVisible();
    await expect(page.locator('text=SSKM Government Hospital')).toBeVisible();
    await expect(page.getByTestId('emergency-leaflet-map')).toBeVisible();

    // 2. Login as seeded patient
    await page.goto('/auth/login');
    await page.click('button:has-text("Patient (Anita Roy)")');
    await expect(page).toHaveURL(/\/doctors/);

    // 3. Dispatch real ambulance request via UI -> API -> Postgres + Redis
    await page.goto('/emergency');
    const requestBtn = page.locator('button:has-text("Request Emergency Ambulance")');
    const statusBadge = page.getByTestId('ambulance-status-badge');

    await Promise.race([
      requestBtn.waitFor({ state: 'visible', timeout: 10000 }),
      statusBadge.waitFor({ state: 'visible', timeout: 10000 }),
    ]);

    if (await requestBtn.isVisible()) {
      await requestBtn.click();
    }
    await expect(statusBadge).toBeVisible();

    // 4. Trigger real driver simulator telemetry and watch live arrival updates over Socket.IO
    await page.click('button:has-text("Simulate Live Driver Telemetry (Dev)")');
    await expect(page.getByTestId('ambulance-status-badge')).toContainText(
      /EN_ROUTE|ARRIVED/,
      { timeout: 10000 },
    );
    await expect(page.getByTestId('ambulance-status-badge')).toContainText(
      'ARRIVED',
      { timeout: 15000 },
    );

    // 5. Cancel / close out clean or verify status persisted
  });
});
