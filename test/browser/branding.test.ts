import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const url = `/@fs/${fileURLToPath(new URL('./app/report.html', import.meta.url))}`;

for (const theme of ['light', 'dark'] as const) {
  test(`report branding is bundled, decorative and fits a narrow ${theme} view`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto(url);
    await page.evaluate(async (theme) => {
      const { createVerificationReportView } = (await import(
        './api.ts' as string
      )) as typeof import('../../src/index');
      const { exampleReport } = (await import(
        './fixture.ts' as string
      )) as typeof import('./app/fixture');
      document.body.replaceChildren();
      createVerificationReportView({
        container: document.body,
        report: exampleReport,
        theme,
      });
    }, theme);
    const heading = page.locator('[data-field="status"]');
    await expect(heading).toHaveText('Response verified');
    const brand = heading.locator('img');
    const src = await brand.getAttribute('src');
    expect(src).toMatch(/data:image\/svg\+xml|\/logos\/nearai/);
    if (src?.startsWith('data:'))
      expect(decodeURIComponent(src).includes('#f3f3f2')).toBe(
        theme === 'dark',
      );
    await expect(brand).toHaveAttribute('aria-hidden', 'true');
    await expect
      .poll(() =>
        brand.evaluate((image: HTMLImageElement) => image.naturalWidth),
      )
      .toBeGreaterThan(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await expect(
      page.locator('.nearai-report-model-icon img').first(),
    ).toHaveJSProperty('complete', true);
    await page.screenshot({
      path: test.info().outputPath('report.png'),
      fullPage: true,
    });
  });
}

for (const source of ['valid', 'missing', 'unsafe', 'invalid'] as const) {
  test(`model artwork is display-only and falls back when ${source}`, async ({
    page,
  }) => {
    let leakedReferrer: string | undefined;
    await page.route('**/catalog-art.svg', async (route) => {
      leakedReferrer = route.request().headers().referer;
      await route.fulfill({
        status: source === 'missing' ? 404 : 200,
        contentType: 'image/svg+xml',
        body:
          source === 'missing'
            ? ''
            : '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="blue"/></svg>',
      });
    });
    await page.goto(url);
    await page.evaluate(async (source) => {
      const { createVerificationReportView } = (await import(
        './api.ts' as string
      )) as typeof import('../../src/index');
      const { exampleReport } = (await import(
        './fixture.ts' as string
      )) as typeof import('./app/fixture');
      document.body.replaceChildren();
      const view = createVerificationReportView({
        container: document.body,
        report: exampleReport,
        modelIcons: {
          'demo-model':
            source === 'unsafe'
              ? 'javascript:alert(1)'
              : source === 'invalid'
                ? (123 as unknown as string)
                : '/catalog-art.svg',
        },
      });
      const update = document.createElement('button');
      update.textContent = 'Change model';
      update.onclick = () =>
        view.setReports([
          {
            schemaVersion: 1,
            kind: 'model',
            model: 'other-model',
            status: 'unverifiable',
            scope: 'model',
            error: { message: 'Evidence unavailable' },
          },
        ]);
      document.body.append(update);
    }, source);
    const tile = page.locator('.nearai-report-model-icon');
    const fallback = tile.locator('img').first();
    if (source === 'valid') {
      await expect(fallback).toBeHidden();
      await expect(tile.locator('img').last()).toBeVisible();
      expect(leakedReferrer).toBeUndefined();
      await page.screenshot({
        path: test.info().outputPath('model-artwork.png'),
        fullPage: true,
      });
    } else {
      await expect(fallback).toBeVisible();
      if (source === 'missing')
        await expect(tile.locator('img').last()).toBeHidden();
      else await expect(tile.locator('img')).toHaveCount(1);
    }
    await expect(page.locator('[data-field="status"]')).toHaveText(
      'Response verified',
    );
    await expect(page.locator('.nearai-verification-report')).toHaveAttribute(
      'data-status',
      'verified',
    );
    await page.getByRole('button', { name: 'Change model' }).click();
    await expect(tile.locator('img')).toHaveCount(1);
    await expect(tile.locator('img')).toBeVisible();
    await expect(page.locator('[data-field="status"]')).toHaveText(
      'Unable to verify',
    );
  });
}

test('self-hosted viewer suppresses the referrer for outgoing requests', async ({
  page,
}) => {
  await page.goto('/embed.html');
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute(
    'content',
    'no-referrer',
  );
});

test('successful Response button stays concise without upgrading Gateway proof', async ({
  page,
}) => {
  await page.goto(url);
  await page.evaluate(async () => {
    const { createVerificationWidget } = (await import(
      './api.ts' as string
    )) as typeof import('../../src/index');
    const { exampleReport } = (await import(
      './fixture.ts' as string
    )) as typeof import('./app/fixture');
    document.body.replaceChildren();
    const { completionId, signature, attestation } = exampleReport;
    if (!completionId || !signature || !attestation)
      throw new Error('Missing fixture evidence');
    createVerificationWidget({
      container: document.body,
      target: { kind: 'reply', completionId },
      verifyUrl: 'http://127.0.0.1:4174/embed.html',
      reports: [
        {
          ...exampleReport,
          model: undefined,
          status: 'partial',
          scope: 'gateway',
          signature: {
            ...signature,
            kind: 'gateway',
            signedText: signature.signedText.split(':').slice(-2).join(':'),
          },
          attestation: {
            ...attestation,
            tlsBinding: { kind: 'none' },
          },
        },
      ],
    });
  });
  const button = page.getByRole('button', { name: 'Verified', exact: true });
  await expect(button).toHaveAttribute('data-status', 'partial');
  await expect(button).toHaveAttribute('data-scope', 'gateway');
  await expect(button).toHaveAttribute(
    'title',
    'Gateway verified; model execution is not attested.',
  );
  await button.click();
  const iframe = page.locator('dialog iframe');
  await expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer');
  await expect(
    page.frameLocator('dialog iframe').locator('[data-field="status"]'),
  ).toHaveText('Gateway verified');
});

test('caller-owned frames suppress referrers before navigation', async ({
  page,
}) => {
  await page.goto(url);
  await page.evaluate(async () => {
    const { createVerificationFrame } = (await import(
      './api.ts' as string
    )) as typeof import('../../src/index');
    const iframe = document.createElement('iframe');
    iframe.id = 'caller-frame';
    document.body.append(iframe);
    createVerificationFrame({
      iframe,
      verifyUrl: 'http://127.0.0.1:4174/embed.html',
    });
  });
  await expect(page.locator('#caller-frame')).toHaveAttribute(
    'referrerpolicy',
    'no-referrer',
  );
});
