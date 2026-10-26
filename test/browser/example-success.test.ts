import { expect, type Page, test } from '@playwright/test';
import { exampleResult } from './app/fixture';

// Synthetic SDK outputs exercise integration and transport, not cryptographic verification.
export async function mockSdk(page: Page, provider = 'vllm') {
  await page.route('**/@nearai_inference-sdk.js*', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `
    const base = ${JSON.stringify(exampleResult)};
    const privateModel = ${JSON.stringify(provider)} === 'vllm';
    const calls = globalThis.__exampleSdkCalls = { inference: 0, response: 0, gateway: 0 };
    const result = privateModel ? base : { ...base, signatureKind: 'gateway', signature: {
      ...base.signature, kind: 'gateway', signedText: base.signature.signedText.split(':').slice(-2).join(':'),
    }, attestation: { ...base.attestation, tlsBinding: { kind: 'none' } } };
    export class AttestationClient {
      async fetchModelMetadata() { return { providerType: ${JSON.stringify(provider)}, attestationSupported: privateModel }; }
      async fetchGatewayAttestation() { calls.gateway++; return { attestation: {} }; }
      async fetchModelAttestations() { return { attestations: [{}, {}] }; }
    }
    export class InferenceClient {
      constructor(options) { calls.options = options; }
      async verify() {}
      chat = { completions: { create: async (params) => { calls.inference++; calls.params = params; return {
        id: base.completionId, choices: [{ message: { content: 'Fixture response' } }],
      }; } } };
      async verifyResponse(id) { calls.response++; if (id !== base.completionId) throw new Error('Wrong target'); return result; }
    }
    export const createTdxQuoteVerifier = () => () => {};
    export const createGpuEvidenceVerifier = () => () => {};
    export const verifyGatewayAttestation = async () => ({ ...base.attestation, tlsBinding: { kind: 'none' } });
    export const verifyModelAttestation = async () => base.attestation;
  `,
    }),
  );
}
for (const provider of ['vllm', 'external', 'chutes']) {
  test(`example ${provider} model and response flow keeps scope and Gateway on refresh`, async ({
    page,
  }, info) => {
    await mockSdk(page, provider);
    await page.goto('/');
    await page
      .getByLabel('Viewer URL')
      .fill('http://127.0.0.1:4174/embed.html');
    await page.getByLabel('API key', { exact: true }).fill('synthetic-key');
    await page
      .getByLabel('Model', { exact: true })
      .fill(provider === 'external' ? 'openai/gpt-5-nano' : 'demo-model');
    await page
      .getByRole('button', { name: 'Verify model', exact: true })
      .click();
    const viewer = page.frameLocator('dialog iframe');
    await expect(viewer.locator('[data-field="status"]')).toHaveText(
      provider === 'vllm' ? 'Model verified' : 'Gateway verified',
    );
    await viewer
      .getByRole('tab', { name: 'Gateway Verification', exact: true })
      .click();
    await expect(
      viewer
        .getByRole('button', { name: 'Copy Signing address', exact: true })
        .last(),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByLabel('Message', { exact: true }).fill('fixture message');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.locator('#reply')).toHaveText('Fixture response');
    await page
      .getByRole('button', { name: 'Verify response', exact: true })
      .click();
    await expect(viewer.locator('[data-field="status"]')).toHaveText(
      provider === 'vllm' ? 'Response verified' : 'Response partially verified',
    );
    await viewer
      .getByRole('tab', { name: 'Gateway Verification', exact: true })
      .click();
    await expect(
      viewer
        .getByRole('button', { name: 'Copy Signing address', exact: true })
        .last(),
    ).toBeVisible();
    await viewer
      .getByRole('button', { name: 'Verify again', exact: true })
      .click();
    await expect(viewer.locator('[data-field="status"]')).toHaveText(
      provider === 'vllm' ? 'Response verified' : 'Response partially verified',
    );
    await viewer
      .getByRole('tab', { name: 'Gateway Verification', exact: true })
      .click();
    await expect(
      viewer
        .getByRole('button', { name: 'Copy Signing address', exact: true })
        .last(),
    ).toBeVisible();
    const calls = await page.evaluate(
      () =>
        (
          globalThis as unknown as {
            __exampleSdkCalls: {
              inference: number;
              response: number;
              options: { e2ee: boolean; signingAlgo: string };
              params: Record<string, unknown>;
            };
          }
        ).__exampleSdkCalls,
    );
    expect(calls.inference).toBe(1);
    expect(calls.response).toBe(2);
    expect(calls.options.e2ee).toBe(provider === 'vllm');
    expect(calls.options.signingAlgo).toBe(
      provider === 'vllm' ? 'ed25519' : 'ecdsa',
    );
    expect(
      calls.params[
        provider === 'external' ? 'max_completion_tokens' : 'max_tokens'
      ],
    ).toBe(2048);
    await page.screenshot({
      path: info.outputPath(`${provider}-response.png`),
    });
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    // An existing response remains bound to its original context after settings are edited.
    await page.getByLabel('Model', { exact: true }).fill('another-model');
    await page.locator('#response-verification button').click();
    await expect(viewer.locator('[data-field="status"]')).toHaveText(
      provider === 'vllm' ? 'Response verified' : 'Response partially verified',
    );
  });
}
