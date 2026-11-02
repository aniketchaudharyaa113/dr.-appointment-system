import { test, expect } from '@playwright/test';

test.describe('Patient Booking & Consultation E2E Journey', () => {
  test('Complete flow: Landing -> Search -> Hold -> Checkout -> Confirmed -> Consultation', async ({
    page,
  }) => {
    // 1. Visit landing page
    await page.goto('/');
    await expect(page).toHaveTitle(/MediBook/);
    await expect(page.locator('h1')).toContainText('Instant Healthcare');

    // 2. Navigate to Doctor Directory
    await page.click('text=Find Specialists');
    await expect(page).toHaveURL(/\/doctors/);
    await expect(page.locator('text=Dr. Arindam Mukherjee')).toBeVisible();

    // 3. Open doctor profile
    await page.click('text=Book Appointment >> nth=0');
    await expect(page).toHaveURL(/\/doctors\/doc-1/);
    await expect(page.locator('text=Apollo Gleneagles Hospitals')).toBeVisible();

    // 4. Select an available time slot to trigger Redis 10-minute hold
    await page.click('button:has-text("05:30 PM")');
    await expect(page.locator('text=Slot Held Temporarily')).toBeVisible();

    // 5. Proceed to checkout
    await page.click('text=Proceed to Checkout');
    await expect(page).toHaveURL(/\/checkout/);
    await expect(page.locator('text=Order Summary')).toBeVisible();
    await expect(page.locator('text=Total Payable')).toBeVisible();

    // 6. Pay with Fake Provider (simulates instant webhook capture and ledger balancing)
    await page.click('button:has-text("Pay")');

    // 7. Booking confirmation
    await expect(page).toHaveURL(/\/appointments\/.*\/confirmed/);
    await expect(page.locator('text=Payment Verified & Appointment Confirmed')).toBeVisible();
    await expect(page.locator('text=Booking Reference')).toBeVisible();

    // 8. Join consultation room
    await page.click('text=Join Consultation Room');
    await expect(page).toHaveURL(/\/consultation/);

    // 9. Verify Telemedicine Informed Consent modal
    await expect(page.locator('text=Telemedicine Informed Consent')).toBeVisible();
    await page.click('button:has-text("I Consent & Join Consultation Room")');

    // 10. Verify LiveKit Encrypted badge and Chat panel
    await expect(page.locator('text=LiveKit Encrypted')).toBeVisible();
    await expect(page.locator('text=Encrypted Consultation Chat')).toBeVisible();
  });
});
