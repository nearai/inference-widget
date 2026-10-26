import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { observe } from './observe';
observe();
const url = `/@fs/${fileURLToPath(new URL('./app/index.html', import.meta.url))}`;

test('a caller-owned frame accepts only its current close message after a report error', async ({
  page,
}) => {
  await page.goto(url);
  await page.evaluate(async () => {
    const { createVerificationFrame } = (await import(
      './api.ts' as string
    )) as typeof import('../../src/index');
    const { exampleReport } = (await import(
      './fixture.ts' as string
    )) as typeof import('./app/fixture');
    const iframe = document.createElement('iframe');
    iframe.id = 'recovery';
    document.body.append(iframe);
    document.body.dataset.closed = '0';
    createVerificationFrame({
      iframe,
      verifyUrl: 'http://127.0.0.1:4174/embed.html',
      reports: [exampleReport],
      onClose: () => {
        document.body.dataset.closed = String(
          Number(document.body.dataset.closed) + 1,
        );
      },
      onStateChange: (state) => {
        document.body.dataset.frameState = state;
      },
    });
  });
  const viewer = page.frameLocator('#recovery');
  await expect(viewer.locator('[data-field="status"]')).toHaveText(
    'Response verified',
  );
  const child = page
    .frames()
    .find((frame) => frame.url().startsWith('http://127.0.0.1:4174/'));
  if (!child) throw new Error('Missing viewer');
  await child.evaluate(() =>
    parent.postMessage(
      {
        type: 'NEAR_AI_VERIFICATION_ERROR',
        version: 1,
        requestId: document.documentElement.dataset.requestId,
        message: 'Generic report error',
      },
      'http://127.0.0.1:4173',
    ),
  );
  await expect(page.locator('body')).toHaveAttribute(
    'data-frame-state',
    'error',
  );
  await page.evaluate(() => {
    const iframe = document.querySelector<HTMLIFrameElement>('#recovery');
    if (!iframe) throw new Error('Missing iframe');
    for (const source of [window, iframe.contentWindow])
      window.dispatchEvent(
        new MessageEvent('message', {
          source,
          origin: 'http://127.0.0.1:4174',
          data: {
            type: 'NEAR_AI_VERIFICATION_CLOSE',
            version: 1,
            requestId: 'obsolete',
          },
        }),
      );
  });
  await expect(page.locator('body')).toHaveAttribute('data-closed', '0');
  await viewer
    .getByRole('button', { name: 'Copy Signing address', exact: true })
    .press('Escape');
  await expect(page.locator('body')).toHaveAttribute('data-closed', '1');
});

test('self-hosted viewer retains close correlation after its initial report timeout', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto(url);
  await page.evaluate(async () => {
    const { createVerificationFrame } = (await import(
      './api.ts' as string
    )) as typeof import('../../src/index');
    const iframe = document.createElement('iframe');
    iframe.id = 'timeout-recovery';
    document.body.append(iframe);
    document.body.dataset.closed = '0';
    createVerificationFrame({
      iframe,
      verifyUrl: 'http://127.0.0.1:4174/embed.html',
      onClose: () => {
        document.body.dataset.closed = '1';
      },
      onStateChange: (state) => {
        document.body.dataset.frameState = state;
      },
    });
  });
  const viewer = page.frameLocator('#timeout-recovery');
  await expect(viewer.locator('[data-field="status"]')).toContainText(
    'Waiting',
  );
  await page.clock.fastForward(60_001);
  await expect(page.locator('body')).toHaveAttribute(
    'data-frame-state',
    'error',
  );
  const child = page
    .frames()
    .find((frame) => frame.url().startsWith('http://127.0.0.1:4174/'));
  if (!child) throw new Error('Missing viewer');
  await child.evaluate(() => {
    const button = document.createElement('button');
    button.textContent = 'Focus recovery';
    document.body.append(button);
  });
  await viewer.getByRole('button', { name: 'Focus recovery' }).press('Escape');
  await expect(page.locator('body')).toHaveAttribute('data-closed', '1');
});
