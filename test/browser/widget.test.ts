import { observe } from './observe';
observe();
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto(
    `/@fs/${fileURLToPath(new URL('./app/index.html', import.meta.url))}`,
  );
});

test('opens the SDK reply report and restores focus on Escape', async ({
  page,
}) => {
  const trigger = page.locator('#reply button');
  await trigger.click();
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('[data-field="status"]')).toHaveText(
    'Response verified',
  );
  await expect(frame.locator('[data-field="summary"]')).toContainText(
    'Verification results from http://127.0.0.1:4173.',
  );
  await expect(frame.locator('[data-field="evidence"]')).toContainText(
    'Approval not checked',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(
    page.frameLocator('iframe').locator('[data-field="status"]'),
  ).toHaveText('Response verified');
});

test('shows missing reply context without falling back to model verification', async ({
  page,
}) => {
  await page.locator('#missing button').click();
  const frame = page.frameLocator('iframe');
  await expect(frame.locator('[data-field="status"]')).toHaveText(
    'Unable to verify',
  );
  await expect(frame.locator('[data-field="error"]')).toContainText(
    'no retained record',
  );
  await expect(frame.locator('[data-field="response"]')).toHaveCount(0);
  await expect(frame.locator('[data-field="hardware"]')).toHaveCount(0);
});

test('closing a refresh ignores its late result and permits a fresh verification', async ({
  page,
}) => {
  await page.evaluate(async () => {
    const { createVerificationWidget } = (await import(
      './api.ts' as string
    )) as typeof import('../../src/index');
    const { exampleResult } = (await import(
      './fixture.ts' as string
    )) as typeof import('./app/fixture');
    let calls = 0;
    let finish: (() => void) | undefined;
    const container = document.createElement('div');
    container.id = 'close-refresh';
    document.body.append(container);
    const widget = createVerificationWidget({
      container,
      target: { kind: 'reply', completionId: exampleResult.completionId },
      verifyUrl: new URL('/embed.html', location.origin).href,
      client: {
        async verifyResponse() {
          calls += 1;
          container.dataset.calls = String(calls);
          if (calls > 1)
            await new Promise<void>((resolve) => {
              finish = resolve;
            });
          return exampleResult;
        },
      },
    });
    const complete = document.createElement('button');
    complete.textContent = 'Complete verification';
    complete.onclick = () => finish?.();
    document.body.append(complete);
    await widget.openReply(exampleResult.completionId);
  });
  const viewer = page.frameLocator('iframe');
  await expect(viewer.locator('[data-field="status"]')).toHaveText(
    'Response verified',
  );
  await viewer
    .getByRole('button', { name: 'Verify Again', exact: true })
    .click();
  await expect(page.locator('#close-refresh')).toHaveAttribute(
    'data-calls',
    '2',
  );
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page
    .getByRole('button', { name: 'Complete verification', exact: true })
    .click();
  await expect(page.locator('#close-refresh button')).toHaveText(
    'Verify response',
  );
  await expect(page.locator('iframe')).toHaveCount(0);
  await page.locator('#close-refresh button').click();
  await page
    .getByRole('button', { name: 'Complete verification', exact: true })
    .dispatchEvent('click');
  await expect(viewer.locator('[data-field="status"]')).toHaveText(
    'Response verified',
  );
  await expect(page.locator('#close-refresh')).toHaveAttribute(
    'data-calls',
    '3',
  );
});

test('refreshes the reply report in the existing iframe and updates the trigger status', async ({
  page,
}) => {
  await page.evaluate(async () => {
    const { createVerificationWidget } = (await import(
      './api.ts' as string
    )) as typeof import('../../src/index');
    const { exampleResult } = (await import(
      './fixture.ts' as string
    )) as typeof import('./app/fixture');
    let calls = 0;
    const container = document.createElement('div');
    container.id = 'refresh-reply';
    document.body.append(container);
    const widget = createVerificationWidget({
      container,
      target: { kind: 'reply', completionId: exampleResult.completionId },
      verifyUrl: new URL('/embed.html', location.origin).href,
      client: {
        async verifyResponse() {
          calls += 1;
          if (calls > 1)
            throw { failure: { code: 'signature.payload_mismatch' } };
          return exampleResult;
        },
      },
    });
    await widget.openReply(exampleResult.completionId);
  });
  const viewer = page.frameLocator('iframe');
  await expect(viewer.locator('[data-field="status"]')).toHaveText(
    'Response verified',
  );
  const source = await page.locator('iframe').getAttribute('src');
  await viewer
    .getByRole('button', { name: 'Verify Again', exact: true })
    .click();
  await expect(viewer.locator('[data-field="status"]')).toHaveText(
    'Verification needs attention',
  );
  await expect(page.locator('#refresh-reply button')).toHaveText(
    'Verification failed',
  );
  await expect(page.locator('iframe')).toHaveAttribute('src', source ?? '');
});

test('passes existing reports and model provider reports to the viewer', async ({
  page,
}) => {
  await page.locator('#report button').click();
  await expect(
    page.frameLocator('iframe').locator('[data-field="status"]'),
  ).toHaveText('Response verified');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.locator('#model button').click();
  await expect(
    page.frameLocator('iframe').locator('[data-field="hardware-section"]'),
  ).toContainText('demo-model');
});

test('passes Gateway and all replicas through the model callback and existing-result API', async ({
  page,
}) => {
  await page.evaluate(async () => {
    const { createVerificationWidget } = (await import(
      './api.ts' as string
    )) as typeof import('../../src/index');
    const { exampleReport, exampleResult } = (await import(
      './fixture.ts' as string
    )) as typeof import('./app/fixture');
    const { gpuEvidence: _, ...attestation } = exampleResult.attestation;
    const reports = [
      {
        schemaVersion: 1 as const,
        kind: 'model' as const,
        model: 'demo-model',
        status: 'partial' as const,
        scope: 'gateway' as const,
        attestation: { ...attestation, tlsBinding: { kind: 'none' as const } },
      },
      {
        ...exampleReport,
        kind: 'model' as const,
        completionId: undefined,
        signature: undefined,
      },
      {
        schemaVersion: 1 as const,
        kind: 'model' as const,
        model: 'demo-model',
        status: 'failed' as const,
        scope: 'model' as const,
        error: {
          message: 'The second replica failed.',
          code: 'binding.nonce_mismatch',
        },
      },
    ];
    const container = document.createElement('div');
    container.id = 'collection';
    document.body.append(container);
    const widget = createVerificationWidget({
      container,
      target: { kind: 'model', model: 'demo-model' },
      verifyUrl: new URL('/embed.html', location.origin).href,
      getModelReport: async () => reports,
    });
    await widget.openModel('demo-model');
    const update = document.createElement('button');
    update.textContent = 'Use existing reports';
    update.onclick = () => widget.setReports(reports.slice(0, 2));
    document.body.append(update);
    const clear = document.createElement('button');
    clear.textContent = 'Clear reports';
    clear.onclick = () => widget.setReports([]);
    document.body.append(clear);
  });
  const viewer = page.frameLocator('iframe');
  await expect(viewer.locator('[data-field="status"]')).toHaveText(
    'Verification needs attention',
  );
  await expect(page.locator('#collection button')).toHaveText(
    'Verification failed',
  );
  await expect(
    viewer.getByRole('tab', { name: 'Model Verification', exact: true }),
  ).toBeVisible();
  await expect(viewer.locator('[role="tabpanel"]:visible')).toContainText(
    'Model replica 2',
  );
  await viewer
    .getByRole('tab', { name: 'Gateway Verification', exact: true })
    .click();
  await expect(viewer.locator('[role="tabpanel"]:visible')).toContainText(
    'TLS binding',
  );
  await page
    .getByRole('button', { name: 'Use existing reports', exact: true })
    .evaluate((button) => (button as HTMLButtonElement).click());
  await expect(viewer.locator('[data-field="status"]')).toHaveText(
    'Model verified',
  );
  await expect(page.locator('#collection button')).toHaveText('Verified');
  await page
    .getByRole('button', { name: 'Clear reports', exact: true })
    .evaluate((button) => (button as HTMLButtonElement).click());
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.locator('#collection button')).toHaveText('Verify model');
});

test('ignores stale SDK results after switching replies across origins', async ({
  page,
}) => {
  await page.evaluate(async () => {
    const { createVerificationWidget } = (await import(
      './api.ts' as string
    )) as typeof import('../../src/index');
    const { exampleResult } = (await import(
      './fixture.ts' as string
    )) as typeof import('./app/fixture');
    let finish: ((value: typeof exampleResult) => void) | undefined;
    const widget = createVerificationWidget({
      verifyUrl: 'http://127.0.0.1:4174/embed.html',
      client: {
        verifyResponse(id) {
          if (id === 'slow')
            return new Promise((resolve) => {
              finish = resolve;
            });
          return Promise.resolve({ ...exampleResult, completionId: id });
        },
      },
    });
    const first = widget.openReply('slow');
    await widget.openReply('current');
    finish?.({ ...exampleResult, completionId: 'slow' });
    await first;
  });
  await expect(
    page.frameLocator('iframe').locator('[data-field="summary"]'),
  ).toContainText('current');
  await expect(
    page.frameLocator('iframe').locator('[data-field="summary"]'),
  ).not.toContainText('slow');
});

test('rejects spoofed sources, times out and reloads without repeating verification', async ({
  page,
}) => {
  await page.evaluate(async () => {
    const { createVerificationWidget } = (await import(
      './api.ts' as string
    )) as typeof import('../../src/index');
    const { exampleResult } = (await import(
      './fixture.ts' as string
    )) as typeof import('./app/fixture');
    const widget = createVerificationWidget({
      verifyUrl: 'http://127.0.0.1:4174/index.html',
      loadTimeoutMs: 100,
      client: {
        async verifyResponse() {
          document.body.dataset.verifications = String(
            Number(document.body.dataset.verifications ?? '0') + 1,
          );
          return exampleResult;
        },
      },
    });
    await widget.openReply(exampleResult.completionId);
    const frame = document.querySelector('iframe');
    if (!frame) throw new Error('Missing iframe');
    const url = new URL(frame.src);
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: url.origin,
        source: window,
        data: {
          type: 'NEAR_AI_VERIFICATION_CENTER_READY',
          version: 1,
          requestId: frame.dataset.requestId,
        },
      }),
    );
  });
  await expect(page.getByRole('status')).toContainText('did not become ready');
  await expect(
    page.getByRole('button', { name: 'Reload verification page' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Reload verification page' }).click();
  await expect(page.getByRole('status')).toContainText('did not become ready');
  await expect(page.locator('body')).toHaveAttribute('data-verifications', '1');
});

test('destroys all owned elements and blocks future operations', async ({
  page,
}) => {
  const initialDialogs = await page
    .locator('.nearai-verification-dialog')
    .count();
  const result = await page.evaluate(async () => {
    const { createVerificationWidget } = (await import(
      './api.ts' as string
    )) as typeof import('../../src/index');
    const { exampleReport } = (await import(
      './fixture.ts' as string
    )) as typeof import('./app/fixture');
    const widget = createVerificationWidget({
      verifyUrl: new URL('/embed.html', location.href).href,
    });
    widget.openReport(exampleReport);
    widget.destroy();
    widget.destroy();
    try {
      widget.openReport(exampleReport);
    } catch {
      return 'destroyed';
    }
    return 'unexpected';
  });
  expect(result).toBe('destroyed');
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.locator('.nearai-verification-dialog')).toHaveCount(
    initialDialogs,
  );
});

test('receiving viewer rejects a report from an untrusted origin', async ({
  page,
}) => {
  await page.evaluate(() => {
    const frame = document.createElement('iframe');
    frame.src = 'http://127.0.0.1:4174/embed.html';
    document.body.append(frame);
  });
  const viewer = page.frameLocator('iframe');
  await expect(viewer.locator('[data-field="status"]')).toHaveText(
    'Waiting for a report...',
  );
  const child = page
    .frames()
    .find((frame) => frame.url().startsWith('http://127.0.0.1:4174/'));
  if (!child) throw new Error('Missing iframe');
  await child.evaluate(() =>
    window.dispatchEvent(
      new MessageEvent('message', {
        source: parent,
        origin: 'https://untrusted.invalid',
        data: {
          type: 'NEAR_AI_VERIFICATION_REPORT',
          version: 1,
          requestId: document.documentElement.dataset.requestId,
          reports: [],
        },
      }),
    ),
  );
  await expect(viewer.locator('[data-field="status"]')).toHaveText(
    'Waiting for a report...',
  );
});

test('waits for SDK results after the viewer is ready and ignores results after closing', async ({
  page,
}) => {
  await page.evaluate(async () => {
    const { createVerificationWidget } = (await import(
      './api.ts' as string
    )) as typeof import('../../src/index');
    const { exampleResult } = (await import(
      './fixture.ts' as string
    )) as typeof import('./app/fixture');
    const client = {
      verifyResponse(id: string) {
        return new Promise<typeof exampleResult>((resolve) => {
          const finish = document.createElement('button');
          finish.textContent = `Finish ${id}`;
          finish.addEventListener('click', () =>
            resolve({ ...exampleResult, completionId: id }),
          );
          document.body.append(finish);
        });
      },
    };
    const widget = createVerificationWidget({
      client,
      verifyUrl: 'http://127.0.0.1:4174/embed.html',
    });
    void widget.openReply('pending');
  });
  await expect(page.getByRole('status')).toHaveText('Verifying...');
  await page
    .getByRole('button', { name: 'Finish pending' })
    .dispatchEvent('click');
  await expect(
    page.frameLocator('iframe').locator('[data-field="summary"]'),
  ).toContainText('pending');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page
    .getByRole('button', { name: 'Finish pending' })
    .dispatchEvent('click');
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('isolates instances and removes old success when an invalid report is opened', async ({
  page,
}) => {
  await page.evaluate(async () => {
    const { createVerificationWidget } = (await import(
      './api.ts' as string
    )) as typeof import('../../src/index');
    const { exampleReport } = (await import(
      './fixture.ts' as string
    )) as typeof import('./app/fixture');
    const first = createVerificationWidget({
      verifyUrl: 'http://127.0.0.1:4174/embed.html',
    });
    const second = createVerificationWidget({
      verifyUrl: 'http://127.0.0.1:4174/embed.html',
    });
    first.openReport({ ...exampleReport, completionId: 'first-instance' });
    second.openReport({ ...exampleReport, completionId: 'second-instance' });
  });
  await expect(
    page.frameLocator('iframe').nth(0).locator('[data-field="summary"]'),
  ).toContainText('first-instance');
  await expect(
    page.frameLocator('iframe').nth(1).locator('[data-field="summary"]'),
  ).toContainText('second-instance');
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  await expect(page.locator('iframe')).toHaveCount(1);
  await page.evaluate(async () => {
    const { createVerificationWidget } = (await import(
      './api.ts' as string
    )) as typeof import('../../src/index');
    const { exampleReport } = (await import(
      './fixture.ts' as string
    )) as typeof import('./app/fixture');
    const widget = createVerificationWidget({
      verifyUrl: 'http://127.0.0.1:4174/embed.html',
    });
    widget.openReport(exampleReport);
    try {
      widget.openReport({
        ...exampleReport,
        status: 'verified',
        scope: 'gateway',
      });
    } catch {
      return;
    }
    throw new Error('Expected invalid report rejection.');
  });
  await expect(page.getByRole('status').last()).toContainText(
    'invalid or too large',
  );
  await expect(page.locator('iframe').last()).toBeHidden();
});

test('binds existing reports to the built-in status button without verifying again', async ({
  page,
}) => {
  await page.evaluate(async () => {
    const { createVerificationWidget } = (await import(
      './api.ts' as string
    )) as typeof import('../../src/index');
    const { exampleReport } = (await import(
      './fixture.ts' as string
    )) as typeof import('./app/fixture');
    const container = document.createElement('div');
    container.id = 'bound-report';
    document.body.append(container);
    const widget = createVerificationWidget({
      container,
      verifyUrl: new URL('/embed.html', location.href).href,
      target: { kind: 'reply', completionId: exampleReport.completionId ?? '' },
      client: {
        async verifyResponse() {
          throw new Error('This report must not trigger verification.');
        },
      },
    });
    widget.setReport(exampleReport);
    const update = document.createElement('button');
    update.id = 'update-report';
    update.addEventListener('click', () =>
      widget.setReport({
        schemaVersion: 1,
        kind: 'reply',
        completionId: exampleReport.completionId,
        status: 'failed',
        scope: 'unknown',
        error: { message: 'The SDK rejected this signature.' },
      }),
    );
    document.body.append(update);
    try {
      widget.setReport({ ...exampleReport, completionId: 'a-different-reply' });
      throw new Error('A different reply must not update this button.');
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
    }
  });
  const button = page.locator('#bound-report button');
  await expect(button).toHaveText('Verified');
  await expect(button).toHaveAttribute('data-status', 'verified');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await button.click();
  await expect(
    page.frameLocator('iframe').locator('[data-field="status"]'),
  ).toHaveText('Response verified');
  await page.locator('#update-report').dispatchEvent('click');
  await expect(button).toHaveAttribute('data-status', 'failed');
  await expect(button).toHaveText('Verification failed');
  await expect(
    page.frameLocator('iframe').locator('[data-field="error"]'),
  ).toHaveText('The SDK rejected this signature.');
});

test('closing cancels obsolete verification and preserves backdrop dismissal after retry', async ({
  page,
}) => {
  await page.evaluate(async () => {
    const { createVerificationWidget } = (await import(
      './api.ts' as string
    )) as typeof import('../../src/index');
    const { exampleResult } = (await import(
      './fixture.ts' as string
    )) as typeof import('./app/fixture');
    document.documentElement.style.overflow = 'auto';
    const container = document.createElement('div');
    container.id = 'background-verification';
    document.body.append(container);
    const finish = document.createElement('button');
    finish.id = 'finish-background';
    finish.textContent = 'Finish verification';
    document.body.append(finish);
    createVerificationWidget({
      container,
      verifyUrl: new URL('/embed.html', location.href).href,
      target: { kind: 'reply', completionId: exampleResult.completionId },
      client: {
        verifyResponse() {
          document.body.dataset.sdkCalls = String(
            Number(document.body.dataset.sdkCalls ?? 0) + 1,
          );
          return new Promise((resolve) => {
            finish.addEventListener('click', () => resolve(exampleResult), {
              once: true,
            });
          });
        },
      },
    });
  });
  const button = page.locator('#background-verification button');
  await button.click();
  await expect(button).toHaveText('Verifying');
  await expect(page.locator('html')).toHaveCSS('overflow', 'hidden');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('html')).toHaveCSS('overflow', 'auto');
  await page.locator('#finish-background').click();
  await expect(button).toHaveText('Verify response');
  await expect(page.locator('iframe')).toHaveCount(0);
  await button.click();
  await page.locator('#finish-background').dispatchEvent('click');
  await expect(
    page.frameLocator('iframe').locator('[data-field="status"]'),
  ).toHaveText('Response verified');
  await expect(page.locator('body')).toHaveAttribute('data-sdk-calls', '2');
  await page.mouse.click(5, 5);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('html')).toHaveCSS('overflow', 'auto');
  await expect(button).toBeFocused();
});

for (const kind of ['reply', 'model'] as const) {
  test(`times out ${kind} verification, supports retry and ignores a late result`, async ({
    page,
  }) => {
    await page.clock.install();
    await page.evaluate(async (kind) => {
      const { createVerificationWidget } = (await import(
        './api.ts' as string
      )) as typeof import('../../src/index');
      const { exampleReport, exampleResult } = (await import(
        './fixture.ts' as string
      )) as typeof import('./app/fixture');
      const container = document.createElement('div');
      container.id = 'timed-verification';
      const finish = document.createElement('button');
      finish.id = 'finish-timed-verification';
      finish.textContent = 'Finish late verification';
      document.body.append(container, finish);
      let calls = 0;
      const widget = createVerificationWidget({
        container,
        verifyUrl: new URL('/embed.html', location.href).href,
        verificationTimeoutMs: 1000,
        target:
          kind === 'reply'
            ? { kind, completionId: exampleResult.completionId }
            : { kind, model: 'demo-model' },
        client: {
          verifyResponse() {
            calls += 1;
            if (calls > 1) return Promise.resolve(exampleResult);
            return new Promise((resolve) =>
              finish.addEventListener(
                'click',
                () => resolve({ ...exampleResult, completionId: 'late-reply' }),
                { once: true },
              ),
            );
          },
        },
        getModelReport: async () => {
          calls += 1;
          if (calls === 1)
            await new Promise<void>((resolve) =>
              finish.addEventListener('click', () => resolve(), { once: true }),
            );
          return {
            ...exampleReport,
            kind: 'model',
            model: 'demo-model',
            completionId: undefined,
          };
        },
      });
      const close = document.createElement('button');
      close.id = 'destroy-timed-verification';
      close.addEventListener('click', () => widget.destroy());
      document.body.append(close);
    }, kind);
    const button = page.locator('#timed-verification button');
    await button.click();
    const viewer = page.frameLocator('iframe');
    await expect(viewer.locator('[data-field="status"]')).toHaveText(
      'Waiting for a report...',
    );
    await page.clock.fastForward(1001);
    await expect(button).toHaveText('Unable to verify');
    await expect(viewer.locator('[data-field="error"]')).toContainText(
      'Verification timed out. Try again.',
    );
    await viewer.getByRole('button', { name: 'Verify Again' }).click();
    await expect(button).toHaveText('Verified');
    await page.locator('#finish-timed-verification').dispatchEvent('click');
    await expect(button).toHaveText('Verified');
    await expect(viewer.locator('[data-field="summary"]')).not.toContainText(
      'late-reply',
    );
    await page.locator('#destroy-timed-verification').dispatchEvent('click');
    await page.clock.fastForward(1001);
    await expect(page.locator('iframe')).toHaveCount(0);
  });
}

test('recovers the trigger and report refresh when the viewer fails during verification', async ({
  page,
}) => {
  await page.evaluate(async () => {
    const { createVerificationWidget } = (await import(
      './api.ts' as string
    )) as typeof import('../../src/index');
    const { exampleResult } = (await import(
      './fixture.ts' as string
    )) as typeof import('./app/fixture');
    const container = document.createElement('div');
    container.id = 'viewer-failure';
    const finish = document.createElement('button');
    finish.id = 'finish-failed-viewer';
    document.body.append(container, finish);
    let calls = 0;
    createVerificationWidget({
      container,
      verifyUrl: new URL('/embed.html', location.href).href,
      target: { kind: 'reply', completionId: exampleResult.completionId },
      client: {
        async verifyResponse() {
          calls += 1;
          if (calls !== 2) return exampleResult;
          return new Promise((resolve) =>
            finish.addEventListener(
              'click',
              () => resolve({ ...exampleResult, completionId: 'late-reply' }),
              { once: true },
            ),
          );
        },
      },
    });
  });
  const button = page.locator('#viewer-failure button');
  await button.click();
  const viewer = page.frameLocator('iframe');
  await expect(viewer.locator('[data-field="status"]')).toHaveText(
    'Response verified',
  );
  await viewer.getByRole('button', { name: 'Verify Again' }).click();
  await expect(button).toHaveText('Verifying');
  const child = page
    .frames()
    .find((frame) => frame.url().includes('/embed.html?'));
  if (!child) throw new Error('Missing verification viewer');
  await child.evaluate(() => {
    parent.postMessage(
      {
        version: 1,
        type: 'NEAR_AI_VERIFICATION_ERROR',
        message: 'private-viewer-error',
        requestId: document.documentElement.dataset.requestId,
      },
      'http://127.0.0.1:4173',
    );
  });
  await expect(button).toHaveText('Unable to verify');
  await expect(
    page.getByRole('button', { name: 'Reload verification page' }),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).not.toContainText(
    'private-viewer-error',
  );
  await page.getByRole('button', { name: 'Reload verification page' }).click();
  await expect(viewer.locator('[data-field="status"]')).toHaveText(
    'Response verified',
  );
  await expect(button).toHaveText('Verified');
  await page.locator('#finish-failed-viewer').dispatchEvent('click');
  await expect(button).toHaveText('Verified');
  await expect(viewer.locator('[data-field="summary"]')).not.toContainText(
    'late-reply',
  );
});

test('a mixed report collection refreshes the displayed reply regardless of report ordering', async ({
  page,
}) => {
  await page.evaluate(async () => {
    const { createVerificationWidget } = (await import(
      './api.ts' as string
    )) as typeof import('../../src/index');
    const { exampleReport, exampleResult } = (await import(
      './fixture.ts' as string
    )) as typeof import('./app/fixture');
    const widget = createVerificationWidget({
      verifyUrl: new URL('/embed.html', location.href).href,
      client: {
        async verifyResponse(completionId) {
          document.body.dataset.refreshedReply = completionId;
          return { ...exampleResult, completionId };
        },
      },
      async getModelReport(model) {
        document.body.dataset.refreshedModel = model;
        return { ...exampleReport, kind: 'model', model };
      },
    });
    const gateway = {
      ...exampleReport,
      kind: 'model' as const,
      scope: 'gateway' as const,
      status: 'partial' as const,
      signature: undefined,
      attestation: {
        ...exampleResult.attestation,
        tlsBinding: { kind: 'none' as const },
      },
    };
    widget.openReports([gateway, exampleReport]);
  });
  const viewer = page.frameLocator('iframe');
  await expect(viewer.locator('[data-field="status"]')).toHaveText(
    'Response verified',
  );
  await viewer.getByRole('button', { name: 'Verify Again' }).click();
  await expect(page.locator('body')).toHaveAttribute(
    'data-refreshed-reply',
    'demo-completion',
  );
  await expect(page.locator('body')).not.toHaveAttribute(
    'data-refreshed-model',
  );
  await expect(viewer.locator('[data-field="status"]')).toHaveText(
    'Response verified',
  );
});

test('updating the displayed report changes the reply used for subsequent verification', async ({
  page,
}) => {
  await page.evaluate(async () => {
    const { createVerificationWidget } = (await import(
      './api.ts' as string
    )) as typeof import('../../src/index');
    const { exampleReport, exampleResult } = (await import(
      './fixture.ts' as string
    )) as typeof import('./app/fixture');
    const widget = createVerificationWidget({
      verifyUrl: new URL('/embed.html', location.href).href,
      client: {
        async verifyResponse(completionId) {
          document.body.dataset.refreshedReply = completionId;
          return { ...exampleResult, completionId };
        },
      },
    });
    widget.openReport(exampleReport);
    const update = document.createElement('button');
    update.id = 'switch-displayed-reply';
    update.addEventListener('click', () =>
      widget.setReport({ ...exampleReport, completionId: 'reply-b' }),
    );
    document.body.append(update);
  });
  let viewer = page.frameLocator('iframe');
  await expect(viewer.locator('[data-field="summary"]')).toContainText(
    'demo-completion',
  );
  await page.locator('#switch-displayed-reply').dispatchEvent('click');
  viewer = page.frameLocator('iframe');
  await expect(viewer.locator('[data-field="summary"]')).toContainText(
    'reply-b',
  );
  await viewer.getByRole('button', { name: 'Verify Again' }).click();
  await expect(page.locator('body')).toHaveAttribute(
    'data-refreshed-reply',
    'reply-b',
  );
  await expect(viewer.locator('[data-field="summary"]')).toContainText(
    'reply-b',
  );
});

test('a closed verification timeout cannot update the trigger', async ({
  page,
}) => {
  await page.clock.install();
  await page.evaluate(async () => {
    const { createVerificationWidget } = (await import(
      './api.ts' as string
    )) as typeof import('../../src/index');
    const container = document.createElement('div');
    container.id = 'closed-timeout';
    document.body.append(container);
    createVerificationWidget({
      container,
      verifyUrl: new URL('/embed.html', location.href).href,
      verificationTimeoutMs: 1000,
      target: { kind: 'reply', completionId: 'pending-reply' },
      client: { verifyResponse: () => new Promise(() => {}) },
    });
  });
  const button = page.locator('#closed-timeout button');
  await button.click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.clock.fastForward(1001);
  await expect(button).toHaveText('Verify response');
  await expect(page.locator('iframe')).toHaveCount(0);
});
