import { expect, test } from '@playwright/test';
import { exampleResult } from './app/fixture';

test('example success flow renders model reports, verifies a reply and refreshes its iframe with synthetic SDK results', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // These results exercise the example integration, not cryptographic validation.
  await page.route('**/@nearai_inference-sdk.js*', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `
        const result = ${JSON.stringify(exampleResult)};
        const calls = globalThis.__exampleSdkCalls = {};
        const count = name => calls[name] = (calls[name] || 0) + 1;
        const evidence = {
          signer: result.attestation.signer,
          intelQuote: 'synthetic-quote',
          nonce: 'aa'.repeat(32),
          eventLog: [],
          reportedQuoteData: 'bb'.repeat(64),
        };
        export class AttestationClient {
          async fetchGatewayAttestation() {
            count('gateway');
            return { attestation: evidence };
          }
          async fetchModelMetadata() {
            return { providerType: 'vllm', attestationSupported: true };
          }
          async fetchModelAttestations() {
            count('replicas');
            return { attestations: [evidence, evidence] };
          }
        }
        export class InferenceClient {
          async verify() { count('preflight'); }
          chat = { completions: { create: async () => {
            count('inference');
            return {
              id: result.completionId,
              choices: [{ message: { content: 'Hello from the SDK test fixture!' } }],
            };
          } } };
          async verifyResponse(id) {
            if (id !== result.completionId) throw new Error('Wrong completion');
            count('reply');
            return result;
          }
        }
        export const createTdxQuoteVerifier = () => () => {};
        export const createGpuEvidenceVerifier = () => () => {};
        export const verifyGatewayAttestation = async () => ({
          ...result.attestation, tlsBinding: { kind: 'none' },
        });
        export const verifyModelAttestation = async () => result.attestation;
      `,
    }),
  );
  await page.goto('/');
  await page.getByLabel('API key', { exact: true }).fill('synthetic-test-key');
  await page.getByLabel('Model', { exact: true }).fill('demo-model');
  await page
    .getByRole('button', { name: 'Verify environment', exact: true })
    .click();
  await expect(page.locator('#verify-page-status')).toContainText(
    'Checks completed',
  );
  await expect(page.locator('#model-reports [data-field="status"]')).toHaveText(
    'Model verified',
  );
  await page
    .locator('#model-reports')
    .getByRole('tab', { name: 'Model Verification', exact: true })
    .click();
  await expect(page.locator('#model-reports')).toContainText('Model replica 2');
  await page.locator('#model-reports').screenshot({
    path: testInfo.outputPath('synthetic-model-success.png'),
    animations: 'disabled',
  });
  await page.locator('#model-verification button').click();
  const dialog = page.frameLocator('dialog iframe');
  await expect(dialog.locator('[data-field="status"]')).toHaveText(
    'Model verified',
  );
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Send request', exact: true }).click();
  await expect(page.locator('#reply-text')).toHaveText(
    'Hello from the SDK test fixture!',
  );
  await page.locator('#reply-verification button').click();
  await expect(dialog.locator('[data-field="status"]')).toHaveText(
    'Reply verified',
  );
  await dialog
    .getByRole('button', { name: 'Verify again', exact: true })
    .click();
  await expect(dialog.locator('[data-field="status"]')).toHaveText(
    'Reply verified',
  );
  await expect(page.locator('#reply-verification button')).toHaveText(
    'Verified',
  );
  await page.screenshot({
    path: testInfo.outputPath('synthetic-reply-success.png'),
    animations: 'disabled',
  });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page
    .getByRole('button', { name: 'Verify in iframe', exact: true })
    .click();
  const embedded = page.frameLocator('#example-iframe');
  await expect(embedded.locator('[data-field="status"]')).toHaveText(
    'Model verified',
  );
  await embedded
    .getByRole('button', { name: 'Verify again', exact: true })
    .click();
  await expect(page.locator('#iframe-status')).toHaveText(
    'Reports sent to viewer.',
  );
  await expect(embedded.locator('[data-field="status"]')).toHaveText(
    'Model verified',
  );
  await page.locator('#example-iframe').screenshot({
    path: testInfo.outputPath('synthetic-iframe-success.png'),
    animations: 'disabled',
  });
  expect(
    await page.evaluate(
      () =>
        (globalThis as unknown as { __exampleSdkCalls: unknown })
          .__exampleSdkCalls,
    ),
  ).toEqual({
    gateway: 3,
    replicas: 3,
    preflight: 1,
    inference: 1,
    reply: 2,
  });
  expect(errors).toEqual([]);
});
