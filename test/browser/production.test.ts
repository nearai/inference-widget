import { expect, test } from '@playwright/test';

test('production examples initialize model, reply and iframe integrations', async ({
  page,
}) => {
  const failures: string[] = [];
  let requests = 0;
  page.on('pageerror', (error) => failures.push(error.message));
  await page.route('**/cloud/**', (route) => {
    requests += 1;
    return route.fulfill({
      status: 401,
      json: { error: { message: 'Unauthorized' } },
    });
  });
  await page.goto('http://127.0.0.1:4175/');
  await expect(page.getByLabel('API base URL')).toHaveValue(
    'http://127.0.0.1:4175/cloud/v1/',
  );
  await page.getByLabel('API key', { exact: true }).fill('production-test-key');
  await page.getByLabel('Model', { exact: true }).fill('example-model');
  await page.getByRole('button', { name: 'Verify environment' }).click();
  await expect(page.locator('#model-reports [data-field="status"]')).toHaveText(
    'Unable to verify',
  );
  await page.locator('#model-verification button').click();
  await expect(
    page
      .frameLocator('.nearai-verification-frame')
      .locator('[data-field="status"]'),
  ).toHaveText('Unable to verify');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Send request', exact: true }).click();
  await expect(page.locator('#reply-status')).toContainText('HTTP 401');
  await page.getByRole('button', { name: 'Verify in iframe' }).click();
  const viewer = page.frameLocator('#example-iframe');
  await expect(viewer.locator('[data-field="status"]')).toHaveText(
    'Unable to verify',
  );
  await viewer.getByRole('button', { name: 'Verify again' }).click();
  await expect.poll(() => requests).toBe(7);
  await expect(viewer.locator('[data-field="status"]')).toHaveText(
    'Unable to verify',
  );
  expect(failures).toEqual([]);
});

test('production build includes a working viewer entry', async ({ page }) => {
  await page.goto('http://127.0.0.1:4175/embed.html');
  await expect(page).toHaveTitle('SDK verification report');
  await expect(page.locator('#viewer')).toContainText(
    'Open this viewer through the widget on an allowed parent origin.',
  );
});
