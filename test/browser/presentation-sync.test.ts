import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
const url = `/@fs/${fileURLToPath(new URL('./app/report.html', import.meta.url))}`;

test('response and technical fields start collapsed and preserve their signature scope', async ({
  page,
}) => {
  await page.goto(url);
  const report = page.locator('#report .nearai-verification-report');
  const response = report.locator('[data-field="response"]');
  await expect(response).not.toHaveAttribute('open');
  await expect(
    response.getByText('Completion ID', { exact: true }),
  ).toBeHidden();
  await response.locator(':scope > summary').click();
  await expect(
    response.getByText('Completion ID', { exact: true }),
  ).toBeVisible();
  await expect(response).toContainText('Model TEE');
  const technical = response.locator('details');
  await expect(technical).not.toHaveAttribute('open');
  await technical.locator(':scope > summary').click();
  await expect(
    technical.getByText('Request hash (SHA-256)', { exact: true }),
  ).toBeVisible();
});

for (const failed of [false, true]) {
  test(`Gateway evidence stays separate after key rotation, fresh failure: ${failed}`, async ({
    page,
  }) => {
    await page.goto(url);
    await page.evaluate(async (failed) => {
      const { createVerificationReportView } = (await import(
        './api.ts' as string
      )) as typeof import('../../src/index');
      const { exampleReport, exampleResult } = (await import(
        './fixture.ts' as string
      )) as typeof import('./app/fixture');
      const signer = {
        signingAlgo: 'ecdsa' as const,
        signingAddress: '0x' + '98'.repeat(20),
      };
      const historical = {
        ...exampleReport,
        model: undefined,
        scope: 'gateway' as const,
        status: 'partial' as const,
        signature: {
          ...exampleResult.signature,
          signer,
          kind: 'gateway' as const,
          signedText: exampleResult.signature.signedText
            .split(':')
            .slice(-2)
            .join(':'),
        },
        attestation: {
          ...exampleResult.attestation,
          signer,
          tlsBinding: { kind: 'none' as const },
        },
      };
      const current = {
        schemaVersion: 1 as const,
        kind: 'model' as const,
        model: 'demo-model',
        scope: 'gateway' as const,
        status: failed ? ('failed' as const) : ('partial' as const),
        attestation: failed
          ? undefined
          : {
              ...exampleResult.attestation,
              tlsBinding: { kind: 'none' as const },
            },
        evidence: failed
          ? undefined
          : { intelQuote: 'fresh-quote', nonce: 'aa', eventLog: '[]' },
        error: failed ? { message: 'Fresh Gateway rejected' } : undefined,
      };
      const host = document.createElement('div');
      host.id = 'rotation';
      document.body.append(host);
      createVerificationReportView({
        container: host,
        reports: [historical, current],
        modelLabel: 'display-only-model',
      });
    }, failed);
    const report = page.locator('#rotation .nearai-verification-report');
    await expect(report).toHaveAttribute(
      'data-status',
      failed ? 'failed' : 'partial',
    );
    await expect(report.locator('[data-field="status"]')).toHaveText(
      failed ? 'Verification needs attention' : 'Gateway verified',
    );
    await expect(report.getByRole('tab')).toHaveCount(0);
    const hardware = report.locator('[data-field="hardware-section"]');
    await expect(hardware).not.toContainText('0x' + '98'.repeat(20));
    await expect(hardware).toContainText(
      failed ? 'Fresh Gateway rejected' : 'ED25519',
    );
    const response = report.locator('[data-field="response"]');
    await response.locator(':scope > summary').click();
    await expect(response).toContainText('Cloud gateway');
    await response.getByText('Technical details', { exact: true }).click();
    await expect(response).toContainText('Response signing key attestation');
    await expect(response).toContainText('0x' + '98'.repeat(20));
    if (!failed)
      await expect(report.locator('[data-field="status"]')).toHaveCSS(
        'color',
        'rgb(4, 120, 87)',
      );
  });
}

test('a known model label provides display context without overriding signed model data', async ({
  page,
}) => {
  await page.goto(url);
  await page.evaluate(async () => {
    const { createVerificationReportView } = (await import(
      './api.ts' as string
    )) as typeof import('../../src/index');
    const { exampleReport } = (await import(
      './fixture.ts' as string
    )) as typeof import('./app/fixture');
    const host = document.createElement('div');
    host.id = 'label';
    document.body.append(host);
    createVerificationReportView({
      container: host,
      report: exampleReport,
      modelLabel: 'unsigned-other-model',
    });
  });
  await expect(page.locator('#label')).toContainText('demo-model');
  await expect(page.locator('#label')).not.toContainText(
    'unsigned-other-model',
  );
  await expect(page.locator('#label [data-field="status"]')).toHaveText(
    'Response verified',
  );
});
