import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { exampleResult } from './app/fixture';

const appUrl = `/@fs/${fileURLToPath(new URL('./app/index.html', import.meta.url))}`;

for (const status of [403, 404]) {
  test(`a real SDK provenance fetch returning ${status} remains unverifiable`, async ({
    page,
  }) => {
    await page.goto(appUrl);
    const result = await page.evaluate(async (status) => {
      const {
        verifyDeploymentImageProvenance,
        reportFromError,
        verificationStatus,
      } = (await import('./api.ts' as string)) as typeof import('./app/api');
      const { exampleReport } = (await import(
        './fixture.ts' as string
      )) as typeof import('./app/fixture');
      const originalFetch = window.fetch;
      let calls = 0;
      window.fetch = async () => {
        calls++;
        return new Response('private response must not leak', { status });
      };
      try {
        await verifyDeploymentImageProvenance({
          appCompose: JSON.stringify({
            docker_compose_file: `services:\n  model:\n    image: demo/model@sha256:${'ab'.repeat(32)}\n`,
          }),
          imagePolicies: {
            'demo/model': {
              repository: 'demo/model',
              workflow: '.github/workflows/build.yml',
            },
          },
          githubToken: 'private-github-token',
        });
        throw new Error('Expected the SDK fetch to fail');
      } catch (error) {
        const report = reportFromError(error, {
          kind: 'model',
          model: 'demo-model',
        });
        return {
          calls,
          report,
          aggregate: verificationStatus([exampleReport, report]),
        };
      } finally {
        window.fetch = originalFetch;
      }
    }, status);
    expect(result.calls).toBe(1);
    expect(result.report.error?.code).toBe('provenance.image_request_failed');
    expect(result.report.status).toBe('unverifiable');
    expect(result.aggregate).toBe('unverifiable');
    expect(JSON.stringify(result)).not.toMatch(/private|SDK rejected/);
  });
}

for (const url of ['/', 'http://127.0.0.1:4175/']) {
  test(`reply preflight times out, discards late HTTP errors and allows retry on ${url}`, async ({
    page,
  }) => {
    await page.clock.install();
    let requests = 0;
    let lateResponses = 0;
    let release = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    page.on('response', (response) => {
      if (response.status() === 403) lateResponses++;
    });
    await page.route('https://cloud-stg-api.near.ai/**', async (route) => {
      const first = ++requests === 1;
      if (first) await blocked;
      await route.fulfill({
        status: first ? 403 : 401,
        json: { error: { message: 'Unauthorized' } },
      });
    });
    await page.goto(url);
    await page.getByLabel('API key', { exact: true }).fill('synthetic-key');
    await page.getByLabel('Model', { exact: true }).fill('demo-model');
    const send = page.getByRole('button', {
      name: 'Send message',
      exact: true,
    });
    await page.getByLabel('Message', { exact: true }).fill('hello');
    await send.click();
    await expect.poll(() => requests).toBe(1);
    await page.clock.fastForward(120_001);
    await expect(send).toBeEnabled();
    await expect(page.locator('#status')).toContainText('Request timed out');
    release();
    await expect.poll(() => lateResponses).toBe(1);
    await expect(page.locator('#status')).toContainText('Request timed out');
    await expect(page.locator('#reply')).toBeHidden();
    await expect(page.locator('#response-verification')).toBeEmpty();
    await page.getByLabel('Message', { exact: true }).fill('hello');
    await send.click();
    await expect(page.locator('#status')).toContainText('HTTP 401');
    await expect(send).toBeEnabled();
    expect(requests).toBe(2);
  });
}

for (const outcome of ['resolve', 'reject'] as const) {
  test(`a late preflight ${outcome} cannot send inference and a fresh submission succeeds`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.install();
    await page.route('**/@nearai_inference-sdk.js*', (route) =>
      route.fulfill({
        contentType: 'text/javascript',
        body: `
        const result = ${JSON.stringify(exampleResult)};
        const calls = globalThis.__preflightCalls = { verify: 0, inference: 0 };
        export class InferenceClient {
          async verify() {
            if (++calls.verify === 1) await new Promise((resolve, reject) => {
              globalThis.__finishPreflight = () => ${outcome === 'resolve' ? 'resolve()' : "reject(new Error('late failure'))"};
            });
          }
          chat = { completions: { create: async () => {
            calls.inference++;
            return { id: result.completionId, choices: [{ message: { content: 'Hello after retry!' } }] };
          } } };
          async verifyResponse() { return result; }
        }
        export class AttestationClient { async fetchModelMetadata() { return { providerType: 'vllm', attestationSupported: true }; } }
        export const createTdxQuoteVerifier = () => () => {};
        export const createGpuEvidenceVerifier = () => () => {};
        export const verifyGatewayAttestation = () => {};
        export const verifyModelAttestation = () => {};
      `,
      }),
    );
    await page.goto('/');
    await page.getByLabel('API key', { exact: true }).fill('synthetic-key');
    await page.getByLabel('Model', { exact: true }).fill('demo-model');
    const send = page.getByRole('button', {
      name: 'Send message',
      exact: true,
    });
    await page.getByLabel('Message', { exact: true }).fill('hello');
    await send.click();
    await page.clock.fastForward(120_001);
    await expect(page.locator('#status')).toContainText('Request timed out');
    await page.evaluate(async () => {
      (
        globalThis as unknown as { __finishPreflight: () => void }
      ).__finishPreflight();
      await Promise.resolve();
    });
    await expect(page.locator('#status')).toContainText('Request timed out');
    expect(
      await page.evaluate(
        () =>
          (globalThis as unknown as { __preflightCalls: unknown })
            .__preflightCalls,
      ),
    ).toEqual({ verify: 1, inference: 0 });
    await page.getByLabel('Message', { exact: true }).fill('hello');
    await send.click();
    await expect(page.locator('#reply')).toHaveText('Hello after retry!');
    await expect(page.locator('#response-verification button')).toHaveText(
      'Verify response',
    );
    await page.clock.fastForward(120_001);
    expect(
      await page.evaluate(
        () =>
          (globalThis as unknown as { __preflightCalls: unknown })
            .__preflightCalls,
      ),
    ).toEqual({ verify: 2, inference: 1 });
    await expect(page.locator('#status')).toContainText('Response received');
    expect(errors).toEqual([]);
  });
}

for (const kind of ['modal', 'shadow-modal', 'nonmodal'] as const) {
  test(`Escape gives the viewer's native ${kind} dialog priority over the widget`, async ({
    page,
  }) => {
    await page.goto(appUrl);
    const trigger = page.locator('#report button');
    await trigger.click();
    const viewer = page.frameLocator('dialog iframe');
    await expect(viewer.locator('[data-field="status"]')).toHaveText(
      'Response verified',
    );
    const child = page
      .frames()
      .find((frame) => frame.url().includes('/embed.html?'));
    if (!child) throw new Error('Missing viewer');
    await child.evaluate((kind) => {
      const host = document.createElement('div');
      document.body.append(host);
      const root =
        kind === 'shadow-modal' ? host.attachShadow({ mode: 'open' }) : host;
      const inner = document.createElement('dialog');
      inner.id = 'native-inner';
      const action = document.createElement('button');
      action.textContent = 'Inner action';
      inner.append(action);
      root.append(inner);
      if (kind === 'nonmodal') inner.show();
      else {
        inner.addEventListener(
          'cancel',
          (event) => {
            event.preventDefault();
            host.dataset.canceled = 'true';
          },
          { once: true },
        );
        inner.showModal();
      }
      host.id = 'native-host';
      action.focus();
    }, kind);
    if (kind !== 'nonmodal') {
      // The inner dialog can veto native cancellation without dismissing the widget.
      await child
        .getByRole('button', { name: 'Inner action', exact: true })
        .press('Escape');
      await expect(child.locator('#native-host')).toHaveAttribute(
        'data-canceled',
        'true',
      );
      await expect(page.locator('dialog[open]')).toHaveCount(1);
      await expect(child.locator('#native-inner[open]')).toHaveCount(1);
      // On the next Escape the browser closes only the inner modal.
      await child
        .getByRole('button', { name: 'Inner action', exact: true })
        .press('Escape');
      await expect(child.locator('#native-inner[open]')).toHaveCount(0);
      await expect(page.locator('dialog[open]')).toHaveCount(1);
      await viewer
        .getByRole('tab', { name: 'Model Verification', exact: true })
        .press('Escape');
    } else {
      // A nonmodal dialog has no native Escape dismissal to consume the key.
      await child
        .getByRole('button', { name: 'Inner action', exact: true })
        .press('Escape');
    }
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
}

for (const kind of ['auto', 'shadow-auto', 'manual'] as const) {
  test(`Escape respects a native ${kind} popover before dismissing the widget`, async ({
    page,
  }) => {
    await page.goto(appUrl);
    const trigger = page.locator('#report button');
    await trigger.click();
    const viewer = page.frameLocator('dialog iframe');
    await expect(viewer.locator('[data-field="status"]')).toHaveText(
      'Response verified',
    );
    const child = page
      .frames()
      .find((frame) => frame.url().includes('/embed.html?'));
    if (!child) throw new Error('Missing viewer');
    await child.evaluate((kind) => {
      const host = document.createElement('div');
      document.body.append(host);
      const root =
        kind === 'shadow-auto' ? host.attachShadow({ mode: 'open' }) : host;
      const popover = document.createElement('div');
      popover.id = 'inner-popover';
      popover.popover = kind === 'manual' ? 'manual' : 'auto';
      const action = document.createElement('button');
      action.textContent = 'Popover action';
      popover.append(action);
      root.append(popover);
      popover.showPopover();
      action.focus();
    }, kind);
    await child
      .getByRole('button', { name: 'Popover action', exact: true })
      .press('Escape');
    if (kind !== 'manual') {
      await expect(child.locator('#inner-popover:popover-open')).toHaveCount(0);
      await expect(page.locator('dialog[open]')).toHaveCount(1);
      await viewer
        .getByRole('tab', { name: 'Model Verification', exact: true })
        .press('Escape');
    }
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
}
