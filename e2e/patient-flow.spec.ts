import { test, expect } from '@playwright/test';

test.describe('Patient Booking & Payment E2E Journey (Real API + DB + Redis + Signed Webhook)', () => {
  test('Complete flow: Login -> Doctors -> Slot Hold -> Checkout -> Signed Webhook -> Confirmed -> My Appointments', async ({
    page,
  }) => {
    // 1. Login as seeded patient
    await page.goto('/auth/login');
    await expect(page.locator('h1')).toContainText('Sign In to CuraBridge');
    await page.click('button:has-text("Patient (Anita Roy)")');

    // 2. Redirects to Doctor Directory loaded from real API
    await expect(page).toHaveURL(/\/doctors/);
    await expect(page.locator('text=Dr. Subhash Chandra')).toBeVisible();

    // 3. Open first doctor profile
    await page.locator('[data-testid="doctor-card"] a').first().click();
    await expect(page).toHaveURL(/\/doctors\/[0-9a-f-]+/);
    await expect(page.locator('text=Select Consultation Slot')).toBeVisible();

    // 4. Select an available time slot to acquire real Redis hold
    const availableSlot = page.locator('button:not([disabled]):has-text(":")').first();
    await expect(availableSlot).toBeVisible();
    await availableSlot.click();
    await expect(page.locator('text=Slot Held Temporarily')).toBeVisible();

    // 5. Proceed to Payment (creates PENDING_PAYMENT booking)
    await page.click('button:has-text("Proceed to Checkout")');
    await expect(page).toHaveURL(/\/checkout\/[0-9a-f-]+/);
    await expect(page.locator('text=Order Summary')).toBeVisible();
    await expect(page.locator('text=Order ID:')).toBeVisible();

    // 6. Trigger real HMAC-signed webhook via FakeProvider simulate button
    await page.click('button:has-text("Simulate Payment")');

    // 7. Booking confirmation page loaded from real DB
    await expect(page).toHaveURL(/\/appointments\/[0-9a-f-]+\/confirmed/);
    await expect(page.locator('text=Payment Verified & Appointment Confirmed')).toBeVisible();
    await expect(page.locator('text=/MB-\\d{8}-\\d{3}/')).toBeVisible();

    // 8. Navigate to My Appointments and verify confirmed appointment appears
    await page.click('a:has-text("My Appointments")');
    await expect(page).toHaveURL(/\/appointments$/);
    await expect(page.getByText('CONFIRMED', { exact: true }).first()).toBeVisible();
  });
});
