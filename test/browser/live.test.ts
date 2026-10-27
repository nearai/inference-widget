import { expect, test } from '@playwright/test';

const key = process.env.WIDGET_LIVE_API_KEY;
const viewerUrl = process.env.CLOUD_VIEWER_URL;
const apiUrl =
  process.env.WIDGET_LIVE_API_URL ?? 'https://cloud-stg-api.near.ai/v1';
for (const [kind, model] of [
  ['Private Hosted', 'Qwen/Qwen3.6-35B-A3B-FP8'],
  ['Incognito', 'openai/gpt-5-nano'],
  ['Chutes', 'qwen/qwen3.5-397b-a17b'],
]) {
  test(`live ${kind} SDK verification in the hosted Cloud UI viewer`, async ({
    page,
    request,
  }, info) => {
    test.skip(
      !key || !viewerUrl,
      'Live tests require an explicit API key and Cloud UI viewer URL; API charges may apply.',
    );
    test.setTimeout(240_000);
    const metadata = await (
      await request.get(`${apiUrl}/model/${encodeURIComponent(model)}`)
    ).json();
    let inference = 0;
    page.on('request', (request) => {
      if (
        request.url().includes('/chat/completions') &&
        request.method() === 'POST'
      )
        inference++;
    });
    await page.goto('/');
    await page.getByLabel('Viewer URL').fill(viewerUrl ?? '');
    await page.getByLabel('API base URL').fill(apiUrl);
    await page.getByLabel('API key', { exact: true }).fill(key ?? '');
    await page.getByLabel('Model', { exact: true }).fill(model);
    await page
      .getByRole('button', { name: 'Verify model', exact: true })
      .click();
    const viewer = page.frameLocator('dialog iframe');
    await expect(viewer.getByRole('heading', { level: 1 })).toHaveText(
      kind === 'Private Hosted' ? 'Model verified' : 'Gateway verified',
      { timeout: 55_000 },
    );
    if (kind === 'Private Hosted')
      await viewer
        .getByRole('tab', { name: 'Gateway Verification', exact: true })
        .click();
    await expect(
      viewer
        .getByRole('button', { name: 'Copy Signing address', exact: true })
        .last(),
    ).toBeVisible();
    await page.screenshot({ path: info.outputPath('live-model.png') });
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    if (metadata.metadata?.isReady === false) {
      info.annotations.push({
        type: 'external-limitation',
        description:
          'The service marks this model unavailable; live completion/response verification cannot be exercised.',
      });
      return;
    }
    await page
      .getByLabel('Message', { exact: true })
      .fill('Reply with a short greeting.');
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(
      page.getByRole('button', { name: 'Verify response', exact: true }),
    ).toBeVisible({ timeout: 130_000 });
    await page
      .getByRole('button', { name: 'Verify response', exact: true })
      .click();
    const title =
      kind === 'Private Hosted' ? 'Response verified' : 'Gateway verified';
    await expect(viewer.getByRole('heading', { level: 1 })).toHaveText(title, {
      timeout: 55_000,
    });
    if (kind === 'Private Hosted')
      await viewer
        .getByRole('tab', { name: 'Gateway Verification', exact: true })
        .click();
    await expect(
      viewer
        .getByRole('button', { name: 'Copy Signing address', exact: true })
        .last(),
    ).toBeVisible();
    await viewer
      .getByRole('button', { name: 'Verify Again', exact: true })
      .click();
    await expect(viewer.getByRole('heading', { level: 1 })).toHaveText(title, {
      timeout: 55_000,
    });
    if (kind === 'Private Hosted')
      await viewer
        .getByRole('tab', { name: 'Gateway Verification', exact: true })
        .click();
    await expect(
      viewer
        .getByRole('button', { name: 'Copy Signing address', exact: true })
        .last(),
    ).toBeVisible();
    expect(inference).toBe(1);
    const display = await viewer.locator('body').innerText();
    expect(display.includes(key ?? '')).toBe(false);
    expect(display.includes('Reply with a short greeting.')).toBe(false);
    await page.screenshot({ path: info.outputPath('live-response.png') });
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page
      .getByRole('button', { name: 'Clear key and conversation' })
      .click();
    await expect(page.getByLabel('API key', { exact: true })).toHaveValue('');
  });
}
