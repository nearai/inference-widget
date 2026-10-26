import { observe } from './observe';
observe();
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto(
    `/@fs/${fileURLToPath(new URL('./app/frame.html', import.meta.url))}`,
  );
  await expect(
    page.frameLocator('#viewer').locator('[data-field="status"]'),
  ).toHaveText('Response verified');
});

test('copies report details from a cross-origin viewer', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const copy = page
    .frameLocator('#viewer')
    .getByRole('button', { name: 'Copy Signing address', exact: true })
    .first();
  await copy.click();
  await expect(copy).toHaveText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    '11'.repeat(32),
  );
});

test('embeds across origins without a dialog and requests updated reports from the host', async ({
  page,
}) => {
  const viewer = page.frameLocator('#viewer');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#refresh-count')).toHaveText('0');
  await viewer.getByRole('button', { name: 'Verify again' }).click();
  await expect(page.locator('#refresh-count')).toHaveText('1');
  await expect(viewer.locator('[data-field="status"]')).toHaveText(
    'Waiting for a report...',
  );
  const child = page
    .frames()
    .find((frame) => frame.url().startsWith('http://127.0.0.1:4174/'));
  await child?.evaluate(() => {
    for (let index = 0; index < 3; index++)
      parent.postMessage(
        {
          version: 1,
          type: 'NEAR_AI_REQUEST_VERIFICATION_REPORT',
          requestId: document.documentElement.dataset.requestId,
        },
        'http://127.0.0.1:4173',
      );
  });
  await page
    .getByRole('button', { name: 'Finish refresh', exact: true })
    .click();
  await expect(viewer.locator('[data-field="summary"]')).toContainText(
    'refreshed-1',
  );
  await expect(page.locator('#refresh-count')).toHaveText('1');
  await expect(page.locator('#frame-state')).toHaveText('ready');
});

test('ignores an obsolete refresh result after an application update and can clear the frame', async ({
  page,
}) => {
  const viewer = page.frameLocator('#viewer');
  await viewer.getByRole('button', { name: 'Verify again' }).click();
  await expect(page.locator('#refresh-count')).toHaveText('1');
  await page
    .getByRole('button', { name: 'Replace report', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Finish refresh', exact: true })
    .click();
  await expect(viewer.locator('[data-field="summary"]')).toContainText(
    'replacement',
  );
  await expect(viewer.locator('[data-field="summary"]')).not.toContainText(
    'refreshed-1',
  );
  await page
    .getByRole('button', { name: 'Clear reports', exact: true })
    .click();
  await expect(page.locator('#viewer')).not.toHaveAttribute('src');
});

test('reload replaces the request and cancels obsolete work', async ({
  page,
}) => {
  const viewer = page.frameLocator('#viewer');
  const previous = await page
    .locator('#viewer')
    .getAttribute('data-request-id');
  await viewer.getByRole('button', { name: 'Verify again' }).click();
  await expect(page.locator('#refresh-count')).toHaveText('1');
  await page.getByRole('button', { name: 'Reload frame', exact: true }).click();
  await expect(page.locator('#viewer')).not.toHaveAttribute(
    'data-request-id',
    previous ?? '',
  );
  await expect(page.locator('#refresh-count')).toHaveText('2');
  await page
    .getByRole('button', { name: 'Finish refresh', exact: true })
    .click();
  await expect(viewer.locator('[data-field="summary"]')).toContainText(
    'refreshed-2',
  );
  await page.evaluate((previous) => {
    const iframe = document.querySelector<HTMLIFrameElement>('#viewer');
    if (!iframe) throw new Error('Missing iframe');
    for (const source of [window, iframe.contentWindow])
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'http://127.0.0.1:4174',
          source,
          data: {
            version: 1,
            type: 'NEAR_AI_VERIFICATION_CLOSE',
            requestId: previous,
          },
        }),
      );
  }, previous);
  await expect(page.locator('#refresh-count')).toHaveText('2');
});

test('destroy removes message handling and ignores the result of pending work', async ({
  page,
}) => {
  const viewer = page.frameLocator('#viewer');
  await viewer.getByRole('button', { name: 'Verify again' }).click();
  await expect(page.locator('#refresh-count')).toHaveText('1');
  await page
    .getByRole('button', { name: 'Destroy connection', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Finish refresh', exact: true })
    .click();
  await expect(page.locator('#viewer')).not.toHaveAttribute('src');
  await expect(page.locator('#viewer')).toHaveCount(1);
});

test('keeps an application update made inside the report callback', async ({
  page,
}) => {
  await page.goto(
    `/@fs/${fileURLToPath(new URL('./app/frame.html', import.meta.url))}?replace-on-report`,
  );
  const viewer = page.frameLocator('#viewer');
  await expect(viewer.locator('[data-field="status"]')).toHaveText(
    'Response verified',
  );
  await viewer.getByRole('button', { name: 'Verify again' }).click();
  await expect(page.locator('#refresh-count')).toHaveText('1');
  await page
    .getByRole('button', { name: 'Finish refresh', exact: true })
    .click();
  await expect(viewer.locator('[data-field="summary"]')).toContainText(
    'callback-replacement',
  );
});

test('can recover a rejected refresh by reloading without displaying the old success', async ({
  page,
}) => {
  const viewer = page.frameLocator('#viewer');
  await viewer.getByRole('button', { name: 'Verify again' }).click();
  await expect(page.locator('#refresh-count')).toHaveText('1');
  await page
    .getByRole('button', { name: 'Reject refresh', exact: true })
    .click();
  await expect(page.locator('#frame-state')).toHaveText('error');
  await expect(page.locator('#frame-error')).not.toContainText(
    'private-callback-key',
  );
  await expect(viewer.locator('[data-field="status"]')).toHaveText(
    'Waiting for a report...',
  );
  await page.getByRole('button', { name: 'Reload frame', exact: true }).click();
  await expect(page.locator('#refresh-count')).toHaveText('2');
  await page
    .getByRole('button', { name: 'Finish refresh', exact: true })
    .click();
  await expect(viewer.locator('[data-field="summary"]')).toContainText(
    'refreshed-2',
  );
});

test('times out a pending provider, ignores its late result and retries after reload', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto(
    `/@fs/${fileURLToPath(new URL('./app/frame.html', import.meta.url))}?verification-timeout=1000`,
  );
  const viewer = page.frameLocator('#viewer');
  await expect(viewer.locator('[data-field="status"]')).toHaveText(
    'Response verified',
  );
  await viewer.getByRole('button', { name: 'Verify again' }).click();
  await expect(page.locator('#refresh-count')).toHaveText('1');
  await page.clock.fastForward(1001);
  await expect(page.locator('#frame-state')).toHaveText('error');
  await expect(page.locator('#frame-error')).toHaveText(
    'Verification timed out. Try again.',
  );
  await page
    .getByRole('button', { name: 'Finish refresh', exact: true })
    .click();
  await expect(page.locator('#frame-state')).toHaveText('error');
  await expect(viewer.locator('[data-field="status"]')).toHaveText(
    'Waiting for a report...',
  );
  await page.getByRole('button', { name: 'Reload frame', exact: true }).click();
  await expect(page.locator('#refresh-count')).toHaveText('2');
  await page
    .getByRole('button', { name: 'Finish refresh', exact: true })
    .click();
  await expect(viewer.locator('[data-field="summary"]')).toContainText(
    'refreshed-2',
  );
  await page.clock.fastForward(1001);
  await expect(page.locator('#frame-state')).toHaveText('ready');
});

test('an application report update cancels the pending verification deadline', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto(
    `/@fs/${fileURLToPath(new URL('./app/frame.html', import.meta.url))}?verification-timeout=1000`,
  );
  const viewer = page.frameLocator('#viewer');
  await expect(viewer.locator('[data-field="status"]')).toHaveText(
    'Response verified',
  );
  await viewer.getByRole('button', { name: 'Verify again' }).click();
  await expect(page.locator('#refresh-count')).toHaveText('1');
  await page
    .getByRole('button', { name: 'Replace report', exact: true })
    .click();
  await page.clock.fastForward(1001);
  await expect(page.locator('#frame-state')).toHaveText('ready');
  await expect(viewer.locator('[data-field="summary"]')).toContainText(
    'replacement',
  );
});
