import { test, expect } from '@playwright/test';

test.describe('Emergency Ambulance Dispatch E2E Journey', () => {
  test('Emergency Screen -> 112 Hotline -> Request Ambulance -> Live GPS Tracking', async ({
    page,
  }) => {
    // 1. Visit emergency screen
    await page.goto('/emergency');
    await expect(page.locator('h1')).toContainText('Emergency Medical Service (EMS)');

    // 2. Verify emergency call hotlines are present
    const call112 = page.locator('a[href="tel:112"]');
    await expect(call112).toBeVisible();

    // 3. Verify Kolkata designated trauma centers list
    await expect(page.locator('text=SSKM Hospital (IPGMER)')).toBeVisible();

    // 4. Request emergency ambulance
    await page.click('button:has-text("Request Ambulance Now")');

    // 5. Verify status progresses to REQUESTED / OFFERED / ACCEPTED
    await expect(page.locator('text=Status: REQUESTED')).toBeVisible();

    // Wait for driver accept
    await expect(page.locator('text=Driver accepted!')).toBeVisible({ timeout: 6000 });
    await expect(page.locator('text=Rajesh Karmakar')).toBeVisible();
    await expect(page.locator('text=WB-02-AX-8910')).toBeVisible();
  });
});
