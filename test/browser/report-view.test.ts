import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto(
    `/@fs/${fileURLToPath(new URL('./app/report.html', import.meta.url))}`,
  );
});

test('renders the public component using only packaged styles without affecting host elements', async ({
  page,
}) => {
  const report = page.locator('#report .nearai-verification-report');
  await expect(report.locator('[data-field="status"]')).toHaveText(
    'Reply verified',
  );
  await expect(report.locator('[data-field="summary"]')).toContainText(
    'demo-model',
  );
  await expect(
    report
      .getByRole('tabpanel', { name: 'Model Verification', exact: true })
      .locator('[data-field="evidence"]'),
  ).toContainText('approval not checked');
  await expect(report).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(report.locator('.nearai-report-card').first()).toHaveCSS(
    'background-color',
    'rgb(255, 255, 255)',
  );
  await expect(report.locator('[data-field="status"]')).toHaveCSS(
    'font-size',
    '20px',
  );
  await expect(
    page.locator('#second-report .nearai-verification-report'),
  ).toHaveCSS('background-color', 'rgb(5, 5, 5)');
  await expect(page.locator('#host-status')).toHaveCSS(
    'text-transform',
    'none',
  );
  await expect(page.locator('#host-content')).toHaveText('Host content');
  await report.getByText('Report details', { exact: true }).click();
  await expect(report.locator('pre')).toBeVisible();
});

test('a partial model report does not claim Gateway verification', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Set partial model', exact: true })
    .click();
  await expect(page.locator('#report [data-field="status"]')).toHaveText(
    'Model partially verified',
  );
});

test('replaces reports, clears obsolete evidence and rejects invalid updates without stale success', async ({
  page,
}) => {
  const report = page.locator('#report .nearai-verification-report');
  await page
    .getByRole('button', { name: 'Set failed report', exact: true })
    .click();
  await expect(report.locator('[data-field="status"]')).toHaveText(
    'Verification failed',
  );
  await expect(report.locator('[data-field="error"]')).toContainText(
    'quote.verification_failed',
  );
  await expect(report.locator('[data-field="hardware"]')).toBeHidden();
  await expect(report.locator('[data-field="summary"]')).not.toContainText(
    'demo-model',
  );
  await page
    .getByRole('button', { name: 'Set invalid report', exact: true })
    .click();
  await expect(page.locator('#report')).toHaveAttribute(
    'data-rejected',
    'true',
  );
  await expect(report.locator('[data-field="status"]')).toContainText(
    'Waiting',
  );
  await expect(report).not.toHaveAttribute('data-status', 'verified');
  await expect(report.locator('pre')).toBeEmpty();
});

test('renders report text without interpreting HTML and cleans up only owned DOM', async ({
  page,
}) => {
  const report = page.locator('#report .nearai-verification-report');
  await page
    .getByRole('button', { name: 'Set unsafe text', exact: true })
    .click();
  await expect(report.locator('[data-field="summary"]')).toContainText(
    '<img src=x onerror="alert(1)">',
  );
  await expect(report.locator('img[src="x"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(report.locator('[data-field="status"]')).toContainText(
    'Waiting',
  );
  await expect(report.locator('[data-field="hardware"]')).toBeHidden();
  await page.getByRole('button', { name: 'Destroy', exact: true }).click();
  await expect(report).toHaveCount(0);
  await expect(page.locator('#host-content')).toHaveText('Host content');
  await expect(
    page.locator('#second-report .nearai-verification-report'),
  ).toHaveCount(1);
});

test('matches Cloud UI tabs, keyboard navigation, expandable evidence, copying and reverify controls', async ({
  page,
  context,
}) => {
  const report = page.locator('#report .nearai-verification-report');
  const modelTab = report.getByRole('tab', {
    name: 'Model Verification',
    exact: true,
  });
  const gatewayTab = report.getByRole('tab', {
    name: 'Gateway Verification',
    exact: true,
  });
  await expect(modelTab).toHaveAttribute('aria-selected', 'true');
  await modelTab.press('ArrowRight');
  await expect(gatewayTab).toBeFocused();
  await expect(gatewayTab).toHaveAttribute('aria-selected', 'true');
  const panel = report.getByRole('tabpanel', {
    name: 'Gateway Verification',
    exact: true,
  });
  await expect(panel).toContainText('TCB status');
  await expect(panel).not.toContainText('GPU Attestation');
  await panel.getByText('TDX Attestation', { exact: true }).click();
  await expect(panel.getByText('Quote', { exact: true })).toBeVisible();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await panel.getByRole('button', { name: 'Copy Quote', exact: true }).click();
  await expect(
    panel.getByRole('button', { name: 'Copy Quote', exact: true }),
  ).toHaveText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('00');
  await report
    .getByRole('button', { name: 'Verify again', exact: true })
    .click();
  await expect(page.locator('#report')).toHaveAttribute(
    'data-reverified',
    'true',
  );
});

test('a failed model replica remains failed when Gateway and other model evidence passed', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Set mixed failure', exact: true })
    .click();
  const report = page.locator('#report .nearai-verification-report');
  await expect(report).toHaveAttribute('data-status', 'failed');
  await expect(report.locator('[data-field="status"]')).toHaveText(
    'Verification failed',
  );
  await expect(report.locator('[data-field="error"]')).toContainText(
    'Another replica failed',
  );
  await expect(
    report.getByRole('tabpanel', { name: 'Model Verification', exact: true }),
  ).toContainText('Model replica 2');
  await report
    .getByRole('tab', { name: 'Gateway Verification', exact: true })
    .click();
  await expect(
    report.getByRole('tabpanel', { name: 'Gateway Verification', exact: true }),
  ).toContainText('Verified');
  await expect(report).toHaveAttribute('data-status', 'failed');
});
