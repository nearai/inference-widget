import { expect, type Page, test } from '@playwright/test';

async function configure(page: Page) {
  await page.goto('/');
  await expect(page.getByLabel('API base URL')).toHaveValue(
    'http://127.0.0.1:4173/cloud/v1/',
  );
  await page.getByLabel('API key', { exact: true }).fill('example-test-key');
  await page.getByLabel('Model', { exact: true }).fill('example-model');
}

test('loads the real SDK without making API requests before user submission', async ({
  page,
}) => {
  const failures: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('request', (request) => {
    if (request.url().includes('/cloud/')) requests.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByLabel('API base URL')).toHaveValue(/\/cloud\/v1\/$/);
  await page.getByRole('button', { name: 'Verify environment' }).click();
  await expect(page.locator('#model-reports')).toBeHidden();
  await expect(page.locator('.nearai-verification-frame')).toHaveCount(0);
  await expect(page.locator('#example-iframe')).toBeHidden();
  expect(requests).toEqual([]);
  expect(failures).toEqual([]);
});

test('uses SDK authentication, renders safe errors and clears previous configuration results', async ({
  page,
}) => {
  const requests: { url: string; authorization?: string }[] = [];
  await page.route('**/cloud/**', async (route) => {
    const request = route.request();
    requests.push({
      url: request.url(),
      authorization: request.headers().authorization,
    });
    await route.fulfill({
      status: 401,
      json: { error: { message: 'Rejected example-test-key' } },
    });
  });
  await configure(page);
  await page.getByRole('button', { name: 'Verify environment' }).click();
  await expect(page.locator('#verify-page-status')).toContainText('incomplete');
  await expect(
    page.locator('#model-reports .nearai-verification-report'),
  ).toHaveAttribute('data-status', 'unverifiable');
  await expect(page.locator('#model-reports')).toContainText('api.http_status');
  expect(requests).toHaveLength(2);
  expect(
    requests.every(
      (request) => request.authorization === 'Bearer example-test-key',
    ),
  ).toBe(true);
  expect(
    requests.every((request) => !request.url.includes('example-test-key')),
  ).toBe(true);
  await expect(page.locator('#model-reports')).not.toContainText(
    'example-test-key',
  );
  await page
    .locator('#model-reports')
    .getByRole('tab', { name: 'Model Verification', exact: true })
    .click();
  await page.getByLabel('Model', { exact: true }).fill('another-model');
  await expect(page.locator('#model-reports')).toBeHidden();
  await expect(page.locator('.nearai-verification-dialog')).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel('API key', { exact: true })).toHaveValue(
    'example-test-key',
  );
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue(
    'another-model',
  );
  await page.getByRole('button', { name: 'Verify environment' }).click();
  await expect(
    page.locator('#model-reports .nearai-verification-report'),
  ).toHaveAttribute('data-status', 'unverifiable');
  await page
    .getByRole('button', { name: 'Clear configuration', exact: true })
    .click();
  await expect(page.locator('#model-reports')).toBeHidden();
  await expect(page.locator('.nearai-verification-dialog')).toHaveCount(0);
  await expect(page.locator('#verify-page-status')).toBeEmpty();
  await expect(page.getByLabel('API key', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('');
  await page.reload();
  await expect(page.getByLabel('API key', { exact: true })).toHaveValue('');
});

test('verifies every replica with the real SDK and never turns invalid quotes into success', async ({
  page,
}) => {
  await page.route('**/cloud/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/model/')) {
      await route.fulfill({
        json: {
          metadata: { providerType: 'vllm', attestationSupported: true },
        },
      });
      return;
    }
    const evidence = {
      request_nonce: url.searchParams.get('nonce'),
      signing_algo: 'ed25519',
      signing_address: '11'.repeat(32),
      intel_quote: '00',
      event_log: [],
      report_data: '00'.repeat(64),
      info: { tcb_info: { app_compose: '{}' } },
    };
    await route.fulfill({
      json: url.searchParams.has('model')
        ? { model_attestations: [evidence, evidence] }
        : { gateway_attestation: evidence },
    });
  });
  await configure(page);
  await page.getByRole('button', { name: 'Verify environment' }).click();
  await expect(page.locator('#verify-page-status')).toContainText(
    'Verification failed',
  );
  await expect(
    page.locator('#model-reports .nearai-verification-report'),
  ).toHaveAttribute('data-status', 'failed');
  await expect(page.locator('#model-reports [data-field="status"]')).toHaveText(
    ['Verification failed'],
  );
  await expect(page.locator('#model-reports')).toContainText(
    'quote.verification_failed',
  );
  await expect(
    page.locator('#model-reports [data-field="error"]'),
  ).toContainText('quote.verification_failed');
  await page
    .getByRole('tab', { name: 'Model Verification', exact: true })
    .click();
  await expect(page.locator('#model-reports')).toContainText('Model replica 2');
});

test('reply example uses SDK preflight and does not send inference after an authentication failure', async ({
  page,
}) => {
  const requests: string[] = [];
  const authorizations: (string | undefined)[] = [];
  await page.route('**/cloud/**', async (route) => {
    requests.push(route.request().url());
    authorizations.push(route.request().headers().authorization);
    await route.fulfill({
      status: 401,
      json: { error: { message: 'Unauthorized' } },
    });
  });
  await configure(page);
  await page.getByRole('button', { name: 'Send request', exact: true }).click();
  await expect(page.locator('#reply-status')).toContainText(
    'Gateway attestation returned HTTP 401',
  );
  await expect(
    page.getByRole('button', { name: 'Send request', exact: true }),
  ).toBeEnabled();
  expect(requests).toHaveLength(1);
  expect(
    authorizations.every((value) => value === 'Bearer example-test-key'),
  ).toBe(true);
  expect(requests.some((url) => url.includes('/chat/completions'))).toBe(false);
  await expect(page.locator('#reply-text')).toBeHidden();
  await expect(page.locator('#reply-verification')).toBeEmpty();
});

test('reply example explains empty mocked SDK responses and preserves the verification button', async ({
  page,
}) => {
  await page.route('**/@nearai_inference-sdk.js*', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `
      export class InferenceClient {
        async verify() {}
        chat = { completions: { create: async ({ messages, max_tokens }) => ({
          id: 'empty-reply',
          choices: [{
            message: {
              content: messages[0].content === 'normal' ? 'Hello!' : null,
              refusal: messages[0].content === 'refusal' ? 'The model declined this request.' : null,
            },
            finish_reason: messages[0].content === 'length' ? 'length' : 'stop',
          }],
          usage: { completion_tokens: max_tokens },
        }) } };
      }
      export class AttestationClient {}
      export const createTdxQuoteVerifier = () => () => {};
      export const createGpuEvidenceVerifier = () => () => {};
      export const verifyGatewayAttestation = () => {};
      export const verifyModelAttestation = () => {};
    `,
    }),
  );
  await configure(page);
  for (const [prompt, expected] of [
    [
      'length',
      'The model reached the output token limit without returning reply text.',
    ],
    ['empty', 'The model returned no reply text.'],
    ['refusal', 'The model declined this request.'],
    ['normal', 'Hello!'],
  ]) {
    await page
      .getByRole('textbox', { name: 'Prompt', exact: true })
      .fill(prompt);
    await page
      .getByRole('button', { name: 'Send request', exact: true })
      .click();
    await expect(page.locator('#reply-text')).toContainText(expected);
    await expect(page.locator('#reply-verification button')).toHaveText(
      'Verify reply',
    );
    await expect(
      page.getByRole('button', { name: 'Send request', exact: true }),
    ).toBeEnabled();
    if (prompt === 'length') {
      await page
        .locator('.example-section')
        .first()
        .screenshot({ path: 'test-results/empty-reply.png' });
    }
  }
});

test('native postMessage example exchanges reports and rejects messages from other senders or requests', async ({
  page,
}) => {
  const authorizations: (string | undefined)[] = [];
  await page.route('**/cloud/**', async (route) => {
    authorizations.push(route.request().headers().authorization);
    await route.fulfill({
      status: 401,
      json: { error: { message: 'Unauthorized' } },
    });
  });
  await configure(page);
  await page.getByRole('button', { name: 'Verify in iframe' }).click();
  const viewer = page.frameLocator('#example-iframe');
  await expect(viewer.locator('[data-field="status"]')).toHaveText(
    'Unable to verify',
  );
  await expect(viewer.locator('[data-field="error"]')).toContainText(
    'HTTP 401',
  );
  expect(authorizations).toEqual([
    'Bearer example-test-key',
    'Bearer example-test-key',
  ]);
  await page.evaluate(() => {
    const iframe = document.querySelector<HTMLIFrameElement>('#example-iframe');
    if (!iframe) throw new Error('Missing iframe');
    const url = new URL(iframe.src);
    const data = {
      type: 'nearai:request-reports',
      protocolVersion: 1,
      instanceId: url.searchParams.get('instanceId'),
      requestId: url.searchParams.get('requestId'),
    };
    for (const invalid of [
      { origin: url.origin, source: window, data },
      {
        origin: 'https://untrusted.invalid',
        source: iframe.contentWindow,
        data,
      },
      {
        origin: url.origin,
        source: iframe.contentWindow,
        data: { ...data, requestId: 'old' },
      },
      {
        origin: url.origin,
        source: iframe.contentWindow,
        data: { ...data, instanceId: 'other' },
      },
      {
        origin: url.origin,
        source: iframe.contentWindow,
        data: { ...data, protocolVersion: 2 },
      },
    ]) {
      window.dispatchEvent(new MessageEvent('message', invalid));
    }
  });
  await expect(page.locator('#iframe-status')).toHaveText(
    'Reports sent to viewer.',
  );
  await viewer
    .getByRole('button', { name: 'Verify again', exact: true })
    .click();
  await expect.poll(() => authorizations.length).toBe(4);
  await expect(viewer.locator('[data-field="status"]')).toHaveText(
    'Unable to verify',
  );
  await expect(viewer.locator('body')).not.toContainText('example-test-key');
  await expect(page.locator('#example-iframe')).not.toHaveAttribute(
    'src',
    /example-test-key/,
  );
  await page.getByLabel('Model', { exact: true }).fill('another-model');
  await expect(page.locator('#example-iframe')).toBeHidden();
  await expect(page.locator('#example-iframe')).toHaveAttribute(
    'src',
    'about:blank',
  );
  await expect(page.locator('#iframe-status')).toBeEmpty();
});

test('native postMessage example discards reports after configuration changes during verification', async ({
  page,
}) => {
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route('**/cloud/**', async (route) => {
    requests += 1;
    await pending;
    await route.fulfill({
      status: 401,
      json: { error: { message: 'Unauthorized' } },
    });
  });
  await configure(page);
  await page.getByRole('button', { name: 'Verify in iframe' }).click();
  await expect.poll(() => requests).toBe(2);
  await page.getByLabel('Model', { exact: true }).fill('another-model');
  release();
  await page.waitForResponse((response) => response.url().includes('/cloud/'));
  await expect(page.locator('#example-iframe')).toBeHidden();
  await expect(page.locator('#iframe-status')).toBeEmpty();
  await expect(
    page.getByRole('button', { name: 'Verify in iframe' }),
  ).toBeEnabled();
});

test('iframe example recovers from a viewer that never becomes ready', async ({
  page,
}) => {
  await page.clock.install();
  await page.route('**/embed.html?**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Unavailable viewer</title>',
    }),
  );
  await configure(page);
  await page.getByRole('button', { name: 'Verify in iframe' }).click();
  await expect(page.locator('#iframe-status')).toContainText('Loading');
  await page.clock.fastForward(15_001);
  await expect(page.locator('#iframe-status')).toHaveText(
    'The viewer did not become ready. Try again.',
  );
  await expect(page.locator('#example-iframe')).toBeHidden();
  await expect(
    page.getByRole('button', { name: 'Verify in iframe' }),
  ).toBeEnabled();
  await page.unroute('**/embed.html?**');
  await page.route('**/cloud/**', (route) =>
    route.fulfill({
      status: 401,
      json: { error: { message: 'Unauthorized' } },
    }),
  );
  await page.getByRole('button', { name: 'Verify in iframe' }).click();
  await expect(
    page.frameLocator('#example-iframe').locator('[data-field="status"]'),
  ).toHaveText('Unable to verify');
});

test('restores all configuration fields and clears only this example’s stored entry', async ({
  page,
}) => {
  await configure(page);
  const fields = {
    'API base URL': 'https://example.invalid/v1/',
    'API key': 'session-test-key',
    Model: 'session-model',
  };
  for (const [label, value] of Object.entries(fields)) {
    await page.getByLabel(label, { exact: true }).fill(value);
  }
  await page.evaluate(() =>
    sessionStorage.setItem('unrelated-setting', 'keep'),
  );
  await page.reload();
  for (const [label, value] of Object.entries(fields)) {
    await expect(page.getByLabel(label, { exact: true })).toHaveValue(value);
  }
  await page
    .getByRole('button', { name: 'Clear configuration', exact: true })
    .click();
  await expect(page.getByLabel('API key', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Model', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('API base URL', { exact: true })).toHaveValue(
    'http://127.0.0.1:4173/cloud/v1/',
  );
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem('nearai-verification-example:configuration'),
    ),
  ).toBeNull();
  expect(
    await page.evaluate(() => sessionStorage.getItem('unrelated-setting')),
  ).toBe('keep');
});

test('uses /v1/ for bare NEAR AI Cloud origins and migrates saved configurations', async ({
  page,
}) => {
  const paths: string[] = [];
  await page.route('https://cloud-stg-api.near.ai/**', async (route) => {
    paths.push(new URL(route.request().url()).pathname);
    await route.fulfill({
      status: 401,
      headers: { 'access-control-allow-origin': '*' },
      json: { error: { message: 'Unauthorized' } },
    });
  });
  await configure(page);
  await page
    .getByLabel('API base URL', { exact: true })
    .fill('https://cloud-stg-api.near.ai');
  await page
    .getByRole('button', { name: 'Verify environment', exact: true })
    .click();
  await expect(page.getByLabel('API base URL', { exact: true })).toHaveValue(
    'https://cloud-stg-api.near.ai/v1/',
  );
  await expect(
    page.locator('#model-reports [data-field="error"]'),
  ).toContainText('HTTP 401');
  expect(paths).toHaveLength(2);
  expect(paths.every((path) => path.startsWith('/v1/'))).toBe(true);
  await page
    .getByLabel('API base URL', { exact: true })
    .fill('https://cloud-api.near.ai');
  await page.reload();
  await expect(page.getByLabel('API base URL', { exact: true })).toHaveValue(
    'https://cloud-api.near.ai/v1/',
  );
  await expect(page.getByLabel('API key', { exact: true })).toHaveValue(
    'example-test-key',
  );
  await page
    .getByLabel('API base URL', { exact: true })
    .fill('https://example.invalid/custom-proxy/');
  await page.reload();
  await expect(page.getByLabel('API base URL', { exact: true })).toHaveValue(
    'https://example.invalid/custom-proxy/',
  );
});
