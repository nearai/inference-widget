import { observe } from './observe';
observe();
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const appUrl = `/@fs/${fileURLToPath(new URL('./app/index.html', import.meta.url))}`;

test('nested GPU evidence stays within the input size when rendered for multiple replicas', async ({
  page,
}) => {
  await page.goto(appUrl);
  const sizes = await page.evaluate(async () => {
    const { createVerificationReportView } = (await import(
      './api.ts' as string
    )) as typeof import('../../src/index');
    const { exampleReport } = (await import(
      './fixture.ts' as string
    )) as typeof import('./app/fixture');
    const payload = `{"evidence_list":${'['.repeat(1500)}0${']'.repeat(1500)}}`;
    const report = {
      ...exampleReport,
      kind: 'model' as const,
      signature: undefined,
      completionId: undefined,
      evidence: {
        intelQuote: '00',
        nonce: 'aa',
        eventLog: '[]',
        nvidiaPayload: payload,
      },
    };
    const container = document.createElement('div');
    container.id = 'bounded-gpu';
    document.body.append(container);
    createVerificationReportView({ container, reports: [report, report] });
    const fields = [
      ...container.querySelectorAll('.nearai-report-value'),
    ].filter(
      (field) => field.querySelector('span')?.textContent === 'Evidence list',
    );
    return {
      input: new TextEncoder().encode(JSON.stringify(report)).length,
      payload: payload.length,
      rendered: fields.map(
        (field) =>
          field.querySelector('.nearai-report-code')?.textContent?.length ?? 0,
      ),
    };
  });
  expect(sizes.input).toBeLessThan(5000);
  expect(sizes.rendered).toHaveLength(2);
  for (const size of sizes.rendered) {
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThanOrEqual(sizes.payload);
  }
  await expect(page.locator('#bounded-gpu [data-field="status"]')).toHaveText(
    'Model verified',
  );
});

for (const kind of ['reply', 'model'] as const) {
  for (const replacement of ['verify', 'cached'] as const) {
    test(`switching a pending ${kind} to a ${replacement} result clears its bound button and ignores the late result`, async ({
      page,
    }) => {
      await page.goto(appUrl);
      await page.evaluate(
        async ({ kind, replacement }) => {
          const { createVerificationWidget } = (await import(
            './api.ts' as string
          )) as typeof import('../../src/index');
          const { exampleReport, exampleResult } = (await import(
            './fixture.ts' as string
          )) as typeof import('./app/fixture');
          const container = document.createElement('div');
          container.id = 'bound';
          document.body.append(container);
          let calls = 0;
          let finish: (() => void) | undefined;
          const waitForA = async (id: string) => {
            if (id !== 'A') return;
            container.dataset.calls = String(++calls);
            if (calls === 1)
              await new Promise<void>((resolve) => {
                finish = resolve;
              });
          };
          const modelReport = (model: string) => ({
            ...exampleReport,
            kind: 'model' as const,
            model,
            completionId: undefined,
            signature: undefined,
          });
          const widget = createVerificationWidget({
            container,
            target:
              kind === 'reply'
                ? { kind, completionId: 'A' }
                : { kind, model: 'A' },
            verifyUrl: new URL('/embed.html', location.origin).href,
            client: {
              async verifyResponse(id) {
                await waitForA(id);
                return { ...exampleResult, completionId: id };
              },
            },
            async getModelReport(model) {
              await waitForA(model);
              return modelReport(model);
            },
          });
          const first =
            kind === 'reply' ? widget.openReply('A') : widget.openModel('A');
          if (replacement === 'cached') {
            widget.openReport(
              kind === 'reply'
                ? { ...exampleReport, completionId: 'B' }
                : modelReport('B'),
            );
          } else if (kind === 'reply') await widget.openReply('B');
          else await widget.openModel('B');
          await first;
          const complete = document.createElement('button');
          complete.id = 'finish-obsolete';
          complete.onclick = () => finish?.();
          document.body.append(complete);
        },
        { kind, replacement },
      );
      const viewer = page.frameLocator('dialog iframe');
      await expect(viewer.getByText('B', { exact: true })).toBeVisible();
      await expect(page.locator('#bound button')).toHaveAttribute(
        'data-status',
        'idle',
      );
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await page.locator('#finish-obsolete').click();
      await expect(page.locator('#bound button')).toHaveAttribute(
        'data-status',
        'idle',
      );
      await page.locator('#bound button').click();
      await expect(viewer.locator('[data-field="status"]')).toHaveText(
        kind === 'reply' ? 'Response verified' : 'Model verified',
      );
      await expect(page.locator('#bound')).toHaveAttribute('data-calls', '2');
      await expect(page.locator('#bound button')).toHaveAttribute(
        'data-status',
        'verified',
      );
    });
  }
}

test('Escape closes the modal after a cross-origin viewer refresh and restores focus and scrolling', async ({
  page,
}) => {
  await page.goto(appUrl);
  await page.evaluate(async () => {
    const { createVerificationWidget } = (await import(
      './api.ts' as string
    )) as typeof import('../../src/index');
    const { exampleReport, exampleResult } = (await import(
      './fixture.ts' as string
    )) as typeof import('./app/fixture');
    document.documentElement.style.overflow = 'auto';
    const container = document.createElement('div');
    container.id = 'escape-widget';
    document.body.append(container);
    createVerificationWidget({
      container,
      target: { kind: 'reply', completionId: exampleResult.completionId },
      reports: [exampleReport],
      verifyUrl: 'http://127.0.0.1:4174/embed.html',
      client: {
        async verifyResponse() {
          return exampleResult;
        },
      },
    });
  });
  const trigger = page.locator('#escape-widget button');
  await trigger.click();
  const viewer = page.frameLocator('dialog iframe');
  await expect(viewer.locator('[data-field="status"]')).toHaveText(
    'Response verified',
  );
  await viewer
    .getByRole('button', { name: 'Verify again', exact: true })
    .click();
  await expect(viewer.locator('[data-field="status"]')).toHaveText(
    'Response verified',
  );
  await viewer
    .getByRole('tab', { name: 'Model Verification', exact: true })
    .press('Escape');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.locator('html')).toHaveCSS('overflow', 'auto');
});

test('close messages require readiness, the exact sender and current routing, and stop after destroy', async ({
  page,
}) => {
  await page.goto(appUrl);
  await page.evaluate(async () => {
    const { createVerificationFrame } = (await import(
      './api.ts' as string
    )) as typeof import('../../src/index');
    const { exampleReport } = (await import(
      './fixture.ts' as string
    )) as typeof import('./app/fixture');
    const iframe = document.createElement('iframe');
    iframe.id = 'close-frame';
    document.body.append(iframe);
    let calls = 0;
    const connection = createVerificationFrame({
      iframe,
      reports: [exampleReport],
      verifyUrl: 'http://127.0.0.1:4174/embed.html',
      onClose() {
        document.body.dataset.closeCalls = String(++calls);
      },
    });
    document.body.dataset.closeCalls = '0';

    const message = {
      type: 'NEAR_AI_VERIFICATION_CLOSE',
      version: 1,
      requestId: iframe.dataset.requestId,
    };
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'http://127.0.0.1:4174',
        source: iframe.contentWindow,
        data: message,
      }),
    );
    const reload = document.createElement('button');
    reload.id = 'reload-close-frame';
    reload.onclick = () => connection.reload();
    const destroy = document.createElement('button');
    destroy.id = 'destroy-close-frame';
    destroy.onclick = () => connection.destroy();
    document.body.append(reload, destroy);
  });
  const viewer = page.frameLocator('#close-frame');
  await expect(viewer.locator('[data-field="status"]')).toHaveText(
    'Response verified',
  );
  const previous = await page
    .locator('#close-frame')
    .getAttribute('data-request-id');
  if (!previous) throw new Error('Missing viewer URL');
  await page.locator('#reload-close-frame').click();
  await expect(page.locator('#close-frame')).not.toHaveAttribute(
    'data-request-id',
    previous,
  );
  const reloaded = await page.locator('#close-frame').getAttribute('src');
  await expect
    .poll(() => page.frames().some((frame) => frame.url() === reloaded))
    .toBe(true);
  await expect(viewer.locator('[data-field="status"]')).toHaveText(
    'Response verified',
  );
  await page.evaluate((previous) => {
    const iframe = document.querySelector<HTMLIFrameElement>('#close-frame');
    if (!iframe) throw new Error('Missing viewer');

    const message = {
      type: 'NEAR_AI_VERIFICATION_CLOSE',
      version: 1,
      requestId: iframe.dataset.requestId,
    };
    for (const invalid of [
      { origin: location.origin, source: iframe.contentWindow, data: message },
      { origin: 'http://127.0.0.1:4174', source: window, data: message },
      ...[
        { version: 2 },

        { requestId: previous },
      ].map((override) => ({
        origin: 'http://127.0.0.1:4174',
        source: iframe.contentWindow,
        data: { ...message, ...override },
      })),
    ])
      window.dispatchEvent(new MessageEvent('message', invalid));
  }, previous);
  await expect(page.locator('body')).toHaveAttribute('data-close-calls', '0');
  const child = page
    .frames()
    .find((frame) => frame.url().startsWith('http://127.0.0.1:4174/'));
  if (!child) throw new Error('Missing child frame');
  await child.evaluate(() => {
    document.addEventListener('keydown', (event) => event.preventDefault(), {
      once: true,
    });
  });
  await child
    .getByRole('tab', { name: 'Model Verification', exact: true })
    .press('Escape');
  await expect(page.locator('body')).toHaveAttribute('data-close-calls', '0');
  // A persisted pagehide preserves the viewer and its key handler.
  await child.evaluate(() => {
    dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await child
    .getByRole('tab', { name: 'Model Verification', exact: true })
    .press('Escape');
  await expect(page.locator('body')).toHaveAttribute('data-close-calls', '1');
  // A real teardown removes the viewer's key handler as well.
  await expect(viewer.locator('[data-field="status"]')).toHaveText(
    'Response verified',
  );
  await child.evaluate(() =>
    dispatchEvent(new PageTransitionEvent('pagehide')),
  );
  const prevented = await child.evaluate(() => {
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      cancelable: true,
    });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(prevented).toBe(false);
  await page.locator('#destroy-close-frame').click();
  await expect(page.locator('#close-frame')).not.toHaveAttribute('src');
  await expect(page.locator('body')).toHaveAttribute('data-close-calls', '1');
});

test('a caller-owned iframe does not capture Escape without an onClose handler', async ({
  page,
}) => {
  await page.goto(appUrl);
  await page.evaluate(async () => {
    const { createVerificationFrame } = (await import(
      './api.ts' as string
    )) as typeof import('../../src/index');
    const { exampleReport } = (await import(
      './fixture.ts' as string
    )) as typeof import('./app/fixture');
    const iframe = document.createElement('iframe');
    iframe.id = 'plain-frame';
    document.body.append(iframe);
    createVerificationFrame({
      iframe,
      reports: [exampleReport],
      verifyUrl: 'http://127.0.0.1:4174/embed.html?canClose=true',
    });
  });
  await expect(
    page.frameLocator('#plain-frame').locator('[data-field="status"]'),
  ).toHaveText('Response verified');
  const child = page
    .frames()
    .find((frame) => frame.url().startsWith('http://127.0.0.1:4174/'));
  if (!child) throw new Error('Missing child frame');
  expect(
    await child.evaluate(() => {
      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        cancelable: true,
      });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(false);
});

for (const pending of [false, true]) {
  test(`example resets safely after back-forward lifecycle events, pending: ${pending}`, async ({
    page,
  }) => {
    let release = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let requests = 0;
    await page.route('https://cloud-stg-api.near.ai/**', async (route) => {
      const call = ++requests;
      if (pending && call <= 2) await blocked;
      await route.fulfill({
        status: pending && call <= 2 ? 403 : 401,
        json: { error: { message: 'Unauthorized' } },
      });
    });
    await page.goto('/');
    await page
      .getByLabel('Viewer URL')
      .fill('http://127.0.0.1:4174/embed.html');
    await page.getByLabel('API key', { exact: true }).fill('synthetic-key');
    await page
      .getByRole('button', { name: 'Verify model', exact: true })
      .click();
    await expect.poll(() => requests).toBe(2);
    for (let index = 0; index < 2; index++) {
      await page.evaluate(() => {
        dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
        dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      });
      await expect(page.locator('iframe')).toHaveCount(0);
      await expect(page.getByLabel('API key', { exact: true })).toHaveValue('');
    }
    await page.getByLabel('API key', { exact: true }).fill('synthetic-key');
    await page
      .getByRole('button', { name: 'Verify model', exact: true })
      .click();
    const viewer = page.frameLocator('dialog iframe');
    await expect(viewer.locator('[data-field="status"]')).toHaveText(
      'Unable to verify',
    );
    release();
    await expect(viewer.locator('body')).toContainText('HTTP 401');
    await expect(viewer.locator('body')).not.toContainText('HTTP 403');
  });
}
