import { expect, test } from '@playwright/test';

test('production example initializes and renders through the production viewer', async ({
  page,
}) => {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await page.route('https://cloud-stg-api.near.ai/**', (route) =>
    route.fulfill({
      status: 401,
      json: { error: { message: 'Unauthorized' } },
    }),
  );
  await page.goto('http://127.0.0.1:4175/');
  await page.getByLabel('Viewer URL').fill('http://127.0.0.1:4175/embed.html');
  await page.getByLabel('API key', { exact: true }).fill('production-test-key');
  await page.getByRole('button', { name: 'Verify model', exact: true }).click();
  const viewer = page.frameLocator('dialog iframe');
  await expect(viewer.locator('[data-field="status"]')).toHaveText(
    'Unable to verify',
  );
  await expect
    .poll(() =>
      viewer
        .locator('.nearai-report-brand')
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBeGreaterThan(0);
  await expect(viewer.locator('meta[name="referrer"]')).toHaveAttribute(
    'content',
    'no-referrer',
  );
  await viewer
    .getByRole('button', { name: 'Verify Again', exact: true })
    .click();
  await expect(viewer.locator('[data-field="status"]')).toHaveText(
    'Unable to verify',
  );
  await viewer
    .getByRole('button', { name: 'Verify Again', exact: true })
    .press('Escape');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await page.getByLabel('Message', { exact: true }).fill('hello');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('#status')).toContainText('HTTP 401');
  expect(failures).toEqual([]);
});
test('production build includes a working viewer entry', async ({ page }) => {
  await page.goto('http://127.0.0.1:4175/embed.html');
  await expect(page).toHaveTitle('SDK verification report');
  await expect(page.locator('#viewer')).toContainText(
    'Open this viewer through the widget on an allowed parent origin.',
  );
});
