import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto(
    `/@fs/${fileURLToPath(new URL('./app/frame.html', import.meta.url))}`,
  );
  await expect(
    page.frameLocator('#viewer').locator('[data-field="status"]'),
  ).toHaveText('Reply verified');
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
    const params = new URLSearchParams(location.search);
    for (let index = 0; index < 3; index++)
      parent.postMessage(
        {
          protocolVersion: 1,
          type: 'nearai:request-reports',
          instanceId: params.get('instanceId'),
          requestId: params.get('requestId'),
        },
        params.get('parentOrigin') ?? '',
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
  await expect(viewer.locator('[data-field="status"]')).toHaveText(
    'Waiting for a report...',
  );
});

test('keeps a pending refresh across reload and ignores messages from another window or an old request', async ({
  page,
}) => {
  const viewer = page.frameLocator('#viewer');
  const previous = await page.locator('#viewer').getAttribute('src');
  await viewer.getByRole('button', { name: 'Verify again' }).click();
  await expect(page.locator('#refresh-count')).toHaveText('1');
  await page.getByRole('button', { name: 'Reload frame', exact: true }).click();
  await expect(page.locator('#viewer')).not.toHaveAttribute(
    'src',
    previous ?? '',
  );
  await expect(viewer.locator('[data-field="status"]')).toHaveText(
    'Waiting for a report...',
  );
  await page
    .getByRole('button', { name: 'Finish refresh', exact: true })
    .click();
  await expect(viewer.locator('[data-field="summary"]')).toContainText(
    'refreshed-1',
  );
  const old = new URL(previous ?? '');
  await page.evaluate(
    ({ instanceId, requestId }) => {
      window.dispatchEvent(
        new MessageEvent('message', {
          origin: 'http://127.0.0.1:4174',
          source: window,
          data: {
            protocolVersion: 1,
            type: 'nearai:request-reports',
            instanceId,
            requestId,
          },
        }),
      );
    },
    {
      instanceId: old.searchParams.get('instanceId'),
      requestId: old.searchParams.get('requestId'),
    },
  );
  const child = page
    .frames()
    .find((frame) => frame.url().startsWith('http://127.0.0.1:4174/'));
  await child?.evaluate(
    ({ instanceId, requestId }) => {
      parent.postMessage(
        {
          protocolVersion: 1,
          type: 'nearai:request-reports',
          instanceId,
          requestId,
        },
        new URLSearchParams(location.search).get('parentOrigin') ?? '',
      );
    },
    {
      instanceId: old.searchParams.get('instanceId'),
      requestId: old.searchParams.get('requestId'),
    },
  );
  await expect(page.locator('#refresh-count')).toHaveText('1');
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
  await expect(viewer.locator('[data-field="status"]')).toHaveText(
    'Waiting for a report...',
  );
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
    'Reply verified',
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
    'Reply verified',
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
    'Reply verified',
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
