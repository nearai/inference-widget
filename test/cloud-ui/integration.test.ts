import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const viewerUrl = 'http://127.0.0.1:3011/verify';
test.beforeEach(async ({ page }) => {
  await page.goto(
    `/@fs/${fileURLToPath(new URL('../browser/app/index.html', import.meta.url))}`,
  );
});

test('the widget dialog verifies a reply, refreshes failures and preserves dark appearance in Cloud UI', async ({
  page,
}) => {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.url().startsWith('http://127.0.0.1:3011/api/'))
      requests.push(request.url());
  });
  await page.evaluate(async (verifyUrl) => {
    const { createVerificationWidget } = (await import(
      './api.ts' as string
    )) as typeof import('../../src/index');
    const { exampleResult } = (await import(
      './fixture.ts' as string
    )) as typeof import('../browser/app/fixture');
    const host = document.createElement('span');
    host.id = 'cloud-widget';
    document.body.append(host);
    let calls = 0;
    createVerificationWidget({
      container: host,
      theme: 'dark',
      verifyUrl,
      target: { kind: 'reply', completionId: exampleResult.completionId },
      client: {
        async verifyResponse() {
          calls++;
          host.dataset.calls = String(calls);
          if (calls === 2)
            throw {
              failure: {
                code: 'gpu.nras_request_failed',
                details: { reason: 'http_status', status: 403 },
              },
              retryable: false,
            };
          return exampleResult;
        },
      },
    });
  }, viewerUrl);
  const button = page.locator('#cloud-widget button');
  await button.click();
  const viewer = page.frameLocator('dialog iframe');
  await expect(
    viewer.getByRole('heading', { name: 'Reply verified', exact: true }),
  ).toBeVisible();
  await expect(viewer.locator('html')).toHaveClass(/dark/);
  await viewer
    .getByRole('button', { name: 'Verify again', exact: true })
    .click();
  await expect(
    viewer.getByRole('heading', { name: 'Unable to verify', exact: true }),
  ).toBeVisible();
  await expect(viewer.getByRole('alert').first()).toContainText('HTTP 403');
  await expect(button).toHaveText('Unable to verify');
  await viewer
    .getByRole('button', { name: 'Verify again', exact: true })
    .click();
  await expect(
    viewer.getByRole('heading', { name: 'Reply verified', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await button.click();
  await expect(
    viewer.getByRole('heading', { name: 'Reply verified', exact: true }),
  ).toBeVisible();
  await expect(page.locator('#cloud-widget')).toHaveAttribute(
    'data-calls',
    '3',
  );
  expect(errors).toEqual([]);
  expect(requests).toEqual([]);
});

test('Cloud UI displays every replica, rejects wrong routing and survives reload during a refresh', async ({
  page,
}) => {
  await page.evaluate(async (verifyUrl) => {
    const { createVerificationFrame } = (await import(
      './api.ts' as string
    )) as typeof import('../../src/index');
    const { exampleReport, exampleResult } = (await import(
      './fixture.ts' as string
    )) as typeof import('../browser/app/fixture');
    const iframe = document.createElement('iframe');
    iframe.id = 'cloud-frame';
    iframe.style.cssText = 'width:800px;height:1000px';
    document.body.append(iframe);
    const gateway = {
      ...exampleReport,
      kind: 'model' as const,
      scope: 'gateway' as const,
      status: 'partial' as const,
      attestation: {
        ...exampleResult.attestation,
        tlsBinding: { kind: 'none' as const },
      },
      signature: undefined,
    };
    const reports = [
      gateway,
      { ...exampleReport, kind: 'model' as const },
      {
        schemaVersion: 1 as const,
        kind: 'model' as const,
        model: 'demo-model',
        scope: 'model' as const,
        status: 'failed' as const,
        error: { message: 'Replica rejected.' },
      },
    ];
    let finish: (() => void) | undefined;
    let calls = 0;
    const connection = createVerificationFrame({
      iframe,
      verifyUrl,
      reports,
      async getReports() {
        document.body.dataset.refreshCalls = String(++calls);
        if (calls === 1)
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
        return reports;
      },
    });
    for (const [id, run] of Object.entries({
      'cloud-reload': () => connection.reload(),
      'cloud-finish': () => finish?.(),
      'cloud-replace': () =>
        connection.setReport({
          ...exampleReport,
          completionId: 'replacement-reply',
        }),
    })) {
      const button = document.createElement('button');
      button.id = id;
      button.onclick = run;
      document.body.append(button);
    }
  }, viewerUrl);
  const viewer = page.frameLocator('#cloud-frame');
  await expect(
    viewer.getByRole('heading', { name: 'Verification failed', exact: true }),
  ).toBeVisible();
  await expect(
    viewer.getByRole('heading', { name: 'Model replica 2', exact: true }),
  ).toBeVisible();
  await viewer
    .getByRole('button', { name: 'Verify again', exact: true })
    .click();
  await expect(
    viewer.getByRole('heading', {
      name: 'Waiting for a verification report…',
      exact: true,
    }),
  ).toBeVisible();
  const previous = await page.locator('#cloud-frame').getAttribute('src');
  if (!previous) throw new Error('Missing Cloud UI iframe URL');
  await expect(page.locator('body')).toHaveAttribute('data-refresh-calls', '1');
  await page.locator('#cloud-reload').dispatchEvent('click');
  await expect(page.locator('#cloud-frame')).not.toHaveAttribute(
    'src',
    previous,
  );
  await expect(
    viewer.getByRole('heading', {
      name: 'Waiting for a verification report…',
      exact: true,
    }),
  ).toBeVisible();
  await page.locator('#cloud-replace').dispatchEvent('click');
  await expect(
    viewer.getByRole('heading', { name: 'Reply verified', exact: true }),
  ).toBeVisible();
  await page.locator('#cloud-finish').dispatchEvent('click');
  const child = page
    .frames()
    .find((frame) => frame.url().startsWith(viewerUrl));
  if (!child) throw new Error('Missing Cloud UI iframe');
  await child.evaluate((oldUrl) => {
    const old = new URL(oldUrl);
    parent.postMessage(
      {
        protocolVersion: 1,
        type: 'nearai:error',
        message: 'obsolete request',
        instanceId: old.searchParams.get('instanceId'),
        requestId: old.searchParams.get('requestId'),
      },
      'http://127.0.0.1:4173',
    );
  }, previous);
  await page.evaluate(() => {
    const iframe = document.querySelector<HTMLIFrameElement>('#cloud-frame');
    if (!iframe?.contentWindow) throw new Error('Missing Cloud UI iframe');
    const params = new URL(iframe.src).searchParams;
    for (const override of [
      { instanceId: 'other-instance' },
      { requestId: 'old-request' },
      { protocolVersion: 2 },
    ])
      iframe.contentWindow.postMessage(
        {
          protocolVersion: 1,
          instanceId: params.get('instanceId'),
          requestId: params.get('requestId'),
          type: 'nearai:reports',
          reports: [],
          ...override,
        },
        'http://127.0.0.1:3011',
      );
  });
  await expect(
    viewer.getByText('replacement-reply', { exact: true }),
  ).toBeVisible();
  await expect(
    viewer.getByRole('heading', { name: 'Reply verified', exact: true }),
  ).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-refresh-calls', '1');
});

test('a timed-out provider recovers after reloading the real Cloud UI viewer', async ({
  page,
}) => {
  await page.evaluate(async (verifyUrl) => {
    const { createVerificationFrame } = (await import(
      './api.ts' as string
    )) as typeof import('../../src/index');
    const { exampleReport } = (await import(
      './fixture.ts' as string
    )) as typeof import('../browser/app/fixture');
    const iframe = document.createElement('iframe');
    iframe.id = 'cloud-frame';
    iframe.style.cssText = 'width:800px;height:800px';
    document.body.append(iframe);
    let calls = 0;
    const connection = createVerificationFrame({
      iframe,
      verifyUrl,
      reports: [exampleReport],
      verificationTimeoutMs: 200,
      getReports: () =>
        ++calls === 1
          ? new Promise(() => {})
          : Promise.resolve([exampleReport]),
      onStateChange(state) {
        document.body.dataset.connectionState = state;
      },
    });
    const reload = document.createElement('button');
    reload.id = 'cloud-reload';
    reload.onclick = () => connection.reload();
    document.body.append(reload);
  }, viewerUrl);
  const viewer = page.frameLocator('#cloud-frame');
  await expect(
    viewer.getByRole('heading', { name: 'Reply verified', exact: true }),
  ).toBeVisible();
  await viewer
    .getByRole('button', { name: 'Verify again', exact: true })
    .click();
  await expect(page.locator('body')).toHaveAttribute(
    'data-connection-state',
    'error',
  );
  await page.locator('#cloud-reload').dispatchEvent('click');
  await expect(
    viewer.getByRole('heading', { name: 'Reply verified', exact: true }),
  ).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute(
    'data-connection-state',
    'ready',
  );
});

test('cached widget reports hide reverify and Cloud UI retains its legacy handshake', async ({
  page,
}) => {
  await page.evaluate(async (verifyUrl) => {
    const { createVerificationWidget } = (await import(
      './api.ts' as string
    )) as typeof import('../../src/index');
    const { exampleReport } = (await import(
      './fixture.ts' as string
    )) as typeof import('../browser/app/fixture');
    createVerificationWidget({ verifyUrl }).openReport(exampleReport);
  }, viewerUrl);
  const cached = page.frameLocator('dialog iframe');
  await expect(
    cached.getByRole('heading', { name: 'Reply verified', exact: true }),
  ).toBeVisible();
  await expect(
    cached.getByRole('button', { name: 'Verify again' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(async (verifyUrl) => {
    const { exampleReport } = (await import(
      './fixture.ts' as string
    )) as typeof import('../browser/app/fixture');
    const iframe = document.createElement('iframe');
    iframe.id = 'legacy';
    iframe.style.cssText = 'width:800px;height:800px';
    window.addEventListener('message', (event) => {
      if (
        event.source !== iframe.contentWindow ||
        event.origin !== 'http://127.0.0.1:3011' ||
        event.data.version !== 1 ||
        ![
          'NEAR_AI_VERIFICATION_CENTER_READY',
          'NEAR_AI_REQUEST_VERIFICATION_DOCUMENT',
        ].includes(event.data.type)
      )
        return;
      iframe.contentWindow?.postMessage(
        {
          type: 'NEAR_AI_VERIFICATION_DOCUMENT',
          version: 1,
          requestId: event.data.requestId,
          document: { schemaVersion: 1, reports: [exampleReport] },
        },
        event.origin,
      );
    });
    iframe.src = verifyUrl;
    document.body.append(iframe);
  }, viewerUrl);
  const legacy = page.frameLocator('#legacy');
  await expect(
    legacy.getByRole('heading', { name: 'Reply verified', exact: true }),
  ).toBeVisible();
  await legacy
    .getByRole('button', { name: 'Verify again', exact: true })
    .click();
  await expect(
    legacy.getByRole('heading', { name: 'Reply verified', exact: true }),
  ).toBeVisible();
});
