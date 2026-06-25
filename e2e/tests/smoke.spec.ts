import { test, expect } from '@playwright/test';

test.describe('TrustOS platform smoke', () => {
  test('command centre loads with live modules', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Command Centre/i })).toBeVisible();
    await expect(page.getByText('Patient Administration').first()).toBeVisible();
  });

  test('patient administration worklist and chart', async ({ page }) => {
    await page.goto('/patients');
    await expect(page.getByRole('heading', { name: 'Patient Administration' })).toBeVisible();
    // Open the first patient in the inpatient worklist.
    const firstPatientLink = page.locator('table a').first();
    await expect(firstPatientLink).toBeVisible();
    await firstPatientLink.click();
    await expect(page.getByText(/Problems/i)).toBeVisible();
    await expect(page.getByText(/NHS/i).first()).toBeVisible();
  });

  test('api health is proxied', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).status).toBe('ok');
  });
});
