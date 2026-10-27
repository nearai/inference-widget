import { expect, type Page, test } from '@playwright/test';
async function configure(page: Page) {
  await page.goto('/');
  await page.getByLabel('Viewer URL').fill('http://127.0.0.1:4174/embed.html');
  await page.getByLabel('API key', { exact: true }).fill('example-test-key');
  await page.getByLabel('Model', { exact: true }).fill('example-model');
}
test('does not contact services before submission and does not persist configuration', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('cloud-stg-api')) requests.push(request.url());
  });
  await configure(page);
  await expect(page.getByLabel('Dark mode')).not.toBeChecked();
  await expect(page.getByLabel('Show header')).not.toBeChecked();
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(requests).toEqual([]);
  expect(
    await page.evaluate(() => [localStorage.length, sessionStorage.length]),
  ).toEqual([0, 0]);
  await page.reload();
  await expect(page.getByLabel('API key', { exact: true })).toHaveValue('');
});
test('uses the real SDK authentication and safe errors without inference after authentication failure', async ({
  page,
}) => {
  const requests: string[] = [];
  await page.route('https://cloud-stg-api.near.ai/**', (route) => {
    requests.push(route.request().url());
    expect(route.request().headers().authorization).toBe(
      'Bearer example-test-key',
    );
    return route.fulfill({
      status: 401,
      json: { error: { message: 'private-error-do-not-display' } },
    });
  });
  await configure(page);
  await page.getByRole('button', { name: 'Verify model', exact: true }).click();
  const viewer = page.frameLocator('dialog iframe');
  await expect(viewer.locator('[data-field="status"]')).toHaveText(
    'Unable to verify',
  );
  await expect(viewer.locator('body')).not.toContainText('example-test-key');
  await expect(viewer.locator('body')).not.toContainText('private-error');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByLabel('Message', { exact: true }).fill('private-message');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.locator('#status')).toContainText('HTTP 401');
  expect(requests.some((url) => url.includes('chat/completions'))).toBe(false);
  await page
    .getByRole('button', { name: 'Clear key and conversation' })
    .click();
  await expect(page.getByLabel('API key', { exact: true })).toHaveValue('');
  await expect(page.locator('#sent-message')).toBeHidden();
  await expect(page.locator('dialog')).toHaveCount(0);
});
test('real SDK rejects invalid quotes for every advertised replica', async ({
  page,
}) => {
  await page.route('https://cloud-stg-api.near.ai/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/model/'))
      return route.fulfill({
        json: {
          metadata: { providerType: 'vllm', attestationSupported: true },
        },
      });
    const evidence = {
      request_nonce: url.searchParams.get('nonce'),
      signing_algo: 'ed25519',
      signing_address: '11'.repeat(32),
      intel_quote: '00',
      event_log: [],
      report_data: '00'.repeat(64),
      info: { tcb_info: { app_compose: '{}' } },
    };
    return route.fulfill({
      json: url.searchParams.has('model')
        ? { model_attestations: [evidence, evidence] }
        : { gateway_attestation: evidence },
    });
  });
  await configure(page);
  await page.getByRole('button', { name: 'Verify model', exact: true }).click();
  const viewer = page.frameLocator('dialog iframe');
  await expect(viewer.locator('[data-field="status"]')).toHaveText(
    'Verification needs attention',
  );
  await viewer
    .getByRole('tab', { name: 'Model Verification', exact: true })
    .click();
  await expect(viewer.locator('body')).toContainText('Model replica 2');
  await expect(viewer.locator('body')).toContainText(
    'quote.verification_failed',
  );
});
