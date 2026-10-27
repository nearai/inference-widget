import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { VerificationReport } from '../../src/report';
import { observe } from './observe';
observe();

const cloud = process.env.CLOUD_VIEWER_URL ?? '';
const reports = JSON.parse(
  readFileSync(
    new URL('../fixtures/cloud-reports.json', import.meta.url),
    'utf8',
  ),
) as VerificationReport[];
const attestation = reports[0].attestation;
if (!attestation)
  throw new Error('The shared fixture needs attestation evidence.');
reports.push({
  schemaVersion: 1,
  kind: 'model',
  model: reports[0].model,
  scope: 'gateway',
  status: 'partial',
  attestation: { ...attestation, tlsBinding: { kind: 'none' } },
});
const parentUrl = `/@fs/${fileURLToPath(new URL('./app/index.html', import.meta.url))}`;
test.skip(
  !cloud,
  'Set CLOUD_VIEWER_URL to a running Cloud UI /verify deployment.',
);

test('real widget parent exchanges full response collections with Cloud UI, refreshes and closes', async ({
  page,
}, info) => {
  await page.goto(parentUrl);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.evaluate(
    async ({ reports, cloud }) => {
      const { createVerificationWidget } = (await import(
        './api.ts' as string
      )) as typeof import('../../src/index');
      const host = document.createElement('span');
      host.id = 'cloud-trigger';
      document.body.append(host);
      let calls = 0;
      const widget = createVerificationWidget({
        container: host,
        verifyUrl: cloud,
        showHeader: false,
        target: { kind: 'reply', completionId: reports[0].completionId ?? '' },
        getResponseReports: async () => {
          document.body.dataset.responseCalls = String(++calls);
          return reports;
        },
      });
      const clear = document.createElement('button');
      clear.id = 'clear-cloud';
      clear.onclick = () => widget.setReports([]);
      document.body.append(clear);
    },
    { reports, cloud: cloud },
  );
  await page.locator('#cloud-trigger button').click();
  const viewer = page.frameLocator('dialog iframe');
  await expect(viewer.getByRole('heading', { level: 1 })).toHaveText(
    'Response verified',
  );
  await expect(
    viewer.getByText('Response signature', { exact: true }),
  ).toBeVisible();
  await expect(
    viewer.getByText('Verification results from', { exact: false }),
  ).toContainText('127.0.0.1:4173');
  await expect(viewer.getByText('Report details', { exact: true })).toHaveCount(
    0,
  );
  await expect(
    viewer.getByText('Verification time:', { exact: false }),
  ).toHaveCount(0);
  await viewer
    .getByRole('tab', { name: 'Gateway Verification', exact: true })
    .click();
  await expect(viewer.getByRole('tabpanel')).toContainText('Verified');
  await expect(viewer.getByRole('tabpanel')).toContainText(
    'Measurements verified',
  );
  await viewer
    .getByRole('button', { name: 'Verify Again', exact: true })
    .click();
  await expect(page.locator('body')).toHaveAttribute(
    'data-response-calls',
    '2',
  );
  await expect(viewer.getByRole('heading', { level: 1 })).toHaveText(
    'Response verified',
  );
  await viewer
    .getByRole('tab', { name: 'Gateway Verification', exact: true })
    .click();
  await expect(viewer.getByRole('tabpanel')).toContainText('Verified');
  await page.screenshot({ path: info.outputPath('cloud-response.png') });
  await viewer
    .getByRole('tab', { name: 'Gateway Verification', exact: true })
    .press('Escape');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.locator('#cloud-trigger button')).toBeFocused();
  await page.locator('#cloud-trigger button').click();
  await expect(viewer.getByRole('heading', { level: 1 })).toHaveText(
    'Response verified',
  );
  await expect(page.locator('body')).toHaveAttribute(
    'data-response-calls',
    '2',
  );
  await page.locator('#clear-cloud').dispatchEvent('click');
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.locator('#cloud-trigger button')).toHaveText(
    'Verify response',
  );
  expect(errors).toEqual([]);
});

test('Cloud UI hides reverify for static reports and shows Gateway-only and failed scopes accurately', async ({
  page,
}) => {
  await page.goto(parentUrl);
  await page.evaluate(
    async ({ reports, cloud }) => {
      const { createVerificationWidget } = (await import(
        './api.ts' as string
      )) as typeof import('../../src/index');
      const widget = createVerificationWidget({ verifyUrl: cloud });
      widget.openReports(
        reports.filter((report) => report.scope === 'gateway'),
      );
      const failed = document.createElement('button');
      failed.id = 'cloud-failed';
      failed.onclick = () =>
        widget.setReports([
          {
            schemaVersion: 1,
            kind: 'model',
            model: reports[0].model,
            status: 'failed',
            scope: 'model',
            error: { message: 'Rejected replica' },
          },
          ...reports.filter((report) => report.scope === 'gateway'),
        ]);
      document.body.append(failed);
    },
    { reports, cloud: cloud },
  );
  const viewer = page.frameLocator('dialog iframe');
  await expect(viewer.getByRole('heading', { level: 1 })).toHaveText(
    'Gateway verified',
  );
  await expect(
    viewer.getByRole('button', { name: 'Verify Again', exact: true }),
  ).toHaveCount(0);
  await page.locator('#cloud-failed').dispatchEvent('click');
  await expect(viewer.getByRole('heading', { level: 1 })).toHaveText(
    'Verification needs attention',
  );
  await viewer
    .getByRole('tab', { name: 'Model Verification', exact: true })
    .click();
  await expect(
    viewer.getByText('Rejected replica', { exact: true }),
  ).toContainText('Rejected replica');
});

test('production widget bundle can display reports in the real Cloud UI iframe', async ({
  page,
}) => {
  await page.route('https://cloud-stg-api.near.ai/**', (route) =>
    route.fulfill({
      status: 401,
      json: { error: { message: 'Unauthorized' } },
    }),
  );
  await page.goto('http://127.0.0.1:4175/');
  await page.getByLabel('Viewer URL').fill(cloud);
  await page
    .getByLabel('API key', { exact: true })
    .fill('synthetic-production-key');
  await page.getByRole('button', { name: 'Verify model', exact: true }).click();
  const viewer = page.frameLocator('dialog iframe');
  await expect(viewer.getByRole('heading', { level: 1 })).toHaveText(
    'Unable to verify',
  );
  await expect(viewer.locator('body')).not.toContainText(
    'synthetic-production-key',
  );
  await expect(page.locator('iframe')).not.toHaveAttribute(
    'src',
    /synthetic-production-key/,
  );
  await viewer
    .getByRole('button', { name: 'Verify Again', exact: true })
    .click();
  await expect(viewer.getByRole('heading', { level: 1 })).toHaveText(
    'Unable to verify',
  );
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
});

test('Cloud UI reload, clear and retry ignore obsolete callback results and message IDs', async ({
  page,
}) => {
  await page.goto(parentUrl);
  await page.evaluate(
    async ({ reports, cloud }) => {
      const { createVerificationFrame } = (await import(
        './api.ts' as string
      )) as typeof import('../../src/index');
      const iframe = document.createElement('iframe');
      iframe.id = 'cloud-frame';
      document.body.append(iframe);
      const state = document.createElement('p');
      state.id = 'cloud-state';
      document.body.append(state);
      const resolvers: (() => void)[] = [];
      let calls = 0;
      const connection = createVerificationFrame({
        iframe,
        verifyUrl: cloud,
        reports,
        verificationTimeoutMs: 2_000,
        getReports: async () => {
          const call = ++calls;
          state.dataset.calls = String(calls);
          await new Promise<void>((resolve) => {
            resolvers.push(resolve);
          });
          return reports.map((report) =>
            report.kind === 'reply'
              ? { ...report, completionId: `fresh-${call}` }
              : report,
          );
        },
        onStateChange: (value) => {
          state.textContent = value;
        },
      });
      for (const [id, action] of Object.entries({
        'cloud-finish-old': () => resolvers[0]?.(),
        'cloud-finish-new': () => resolvers.at(-1)?.(),
        'cloud-reload': () => connection.reload(),
        'cloud-clear': () => connection.setReports([]),
        'cloud-restore': () => connection.setReports(reports),
        'cloud-destroy': () => connection.destroy(),
      })) {
        const button = document.createElement('button');
        button.id = id;
        button.onclick = action;
        document.body.append(button);
      }
    },
    { reports, cloud: cloud ?? '' },
  );
  const viewer = page.frameLocator('#cloud-frame');
  await expect(viewer.getByRole('heading', { level: 1 })).toHaveText(
    'Response verified',
  );
  const oldId = await page
    .locator('#cloud-frame')
    .getAttribute('data-request-id');
  await viewer
    .getByRole('button', { name: 'Verify Again', exact: true })
    .click();
  await expect(page.locator('#cloud-state')).toHaveAttribute('data-calls', '1');
  await page.locator('#cloud-reload').click();
  await expect(page.locator('#cloud-frame')).not.toHaveAttribute(
    'data-request-id',
    oldId ?? '',
  );
  await expect(page.locator('#cloud-state')).toHaveAttribute('data-calls', '2');
  await page.locator('#cloud-finish-old').click();
  await page.evaluate(
    ({ cloud, oldId }) => {
      const iframe = document.querySelector<HTMLIFrameElement>('#cloud-frame');
      if (!iframe) throw new Error('Missing iframe');
      for (const origin of [new URL(cloud).origin, 'https://untrusted.invalid'])
        window.dispatchEvent(
          new MessageEvent('message', {
            origin,
            source: iframe.contentWindow,
            data: {
              version: 1,
              type: 'NEAR_AI_VERIFICATION_ERROR',
              requestId: oldId,
              message: 'obsolete',
            },
          }),
        );
    },
    { cloud: cloud ?? '', oldId },
  );
  await expect(page.locator('#cloud-state')).toHaveText('refreshing');
  await page.locator('#cloud-finish-new').click();
  await viewer.getByRole('button', { name: /^Response\s+Verified/ }).click();
  await expect(viewer.locator('body')).toContainText('fresh-2');
  await viewer
    .getByRole('button', { name: 'Verify Again', exact: true })
    .click();
  await expect(page.locator('#cloud-state')).toHaveText('error', {
    timeout: 5_000,
  });
  await page.locator('#cloud-reload').click();
  await expect(page.locator('#cloud-state')).toHaveAttribute('data-calls', '4');
  await page.locator('#cloud-finish-new').click();
  await viewer.getByRole('button', { name: /^Response\s+Verified/ }).click();
  await expect(viewer.locator('body')).toContainText('fresh-4');
  await page.locator('#cloud-clear').click();
  await expect(page.locator('#cloud-frame')).not.toHaveAttribute('src');
  await page.locator('#cloud-restore').click();
  await expect(viewer.getByRole('heading', { level: 1 })).toHaveText(
    'Response verified',
  );
  await page.locator('#cloud-destroy').click();
  await expect(page.locator('#cloud-frame')).not.toHaveAttribute('src');
});

test('Cloud UI lets an internal modal consume Escape before closing the host dialog', async ({
  page,
}) => {
  await page.goto(parentUrl);
  await page.evaluate(
    async ({ reports, cloud }) => {
      const { createVerificationWidget } = (await import(
        './api.ts' as string
      )) as typeof import('../../src/index');
      createVerificationWidget({ verifyUrl: cloud }).openReports(reports);
    },
    { reports, cloud },
  );
  const viewer = page.frameLocator('dialog iframe');
  await expect(viewer.getByRole('heading', { level: 1 })).toHaveText(
    'Response verified',
  );
  const child = page.frames().find((frame) => frame.url().startsWith(cloud));
  if (!child) throw new Error('Missing Cloud UI viewer');
  await child.evaluate(() => {
    const dialog = document.createElement('dialog');
    dialog.id = 'internal-modal';
    const button = document.createElement('button');
    button.textContent = 'Internal close';
    dialog.append(button);
    document.body.append(dialog);
    dialog.showModal();
    button.focus();
  });
  await viewer
    .getByRole('button', { name: 'Internal close', exact: true })
    .press('Escape');
  await expect(viewer.locator('#internal-modal')).not.toBeVisible();
  await expect(page.locator('dialog[open]')).toHaveCount(1);
  await viewer
    .getByRole('tab', { name: 'Model Verification', exact: true })
    .press('Escape');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
});

test('Cloud UI preserves Escape close correlation after report delivery times out', async ({
  page,
}) => {
  await page.clock.install();
  await page.goto(parentUrl);
  await page.evaluate(async (cloud) => {
    const { createVerificationFrame } = (await import(
      './api.ts' as string
    )) as typeof import('../../src/index');
    const iframe = document.createElement('iframe');
    iframe.id = 'cloud-close-timeout';
    document.body.append(iframe);
    document.body.dataset.closedAfterTimeout = '0';
    createVerificationFrame({
      iframe,
      verifyUrl: cloud,
      onClose: () => {
        document.body.dataset.closedAfterTimeout = '1';
      },
      onStateChange: (state) => {
        document.body.dataset.timeoutState = state;
      },
    });
  }, cloud);
  await expect(page.locator('body')).toHaveAttribute(
    'data-timeout-state',
    'ready',
  );
  await page.clock.fastForward(60_001);
  await expect(page.locator('body')).toHaveAttribute(
    'data-timeout-state',
    'error',
  );
  const child = page.frames().find((frame) => frame.url().startsWith(cloud));
  if (!child) throw new Error('Missing Cloud UI viewer');
  await child.evaluate(() => {
    const button = document.createElement('button');
    button.textContent = 'Focus timed out viewer';
    document.body.append(button);
  });
  await page
    .frameLocator('#cloud-close-timeout')
    .getByRole('button', { name: 'Focus timed out viewer' })
    .press('Escape');
  await expect(page.locator('body')).toHaveAttribute(
    'data-closed-after-timeout',
    '1',
  );
});
