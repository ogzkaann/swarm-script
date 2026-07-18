import { expect, test } from '@playwright/test';

test('default squad compiles and completes a deterministic playable flow', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.goto('/?e2e=1');
  await expect(page.getByTestId('compile-status')).toContainText('ALL SYSTEMS VALID');
  await expect(page.getByTestId('arena').locator('canvas')).toBeVisible();
  await page.getByTestId('run-button').click();
  await expect(page.getByText(/Run 43110 deployed/)).toBeVisible();
  await expect(page.getByTestId('pause-button')).toBeEnabled();
  await page.getByTestId('pause-button').click();
  await expect(page.getByText('SIMULATION HELD')).toBeVisible();
  await expect
    .poll(async () => page.getByLabel('Development performance overlay').textContent())
    .toContain('ENT');
  await page.getByTestId('pause-button').click();
  await page.waitForTimeout(650);
  await page.screenshot({
    path: 'docs/screenshots/swarm-script-v0.1.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: '4×' }).click();
  const upgradeDialog = page.getByRole('dialog', { name: 'Choose an upgrade' });
  await expect(upgradeDialog).toBeVisible({ timeout: 35_000 });
  await upgradeDialog.getByRole('button').first().click();
  await expect(upgradeDialog).toBeHidden();
  await expect(upgradeDialog).toBeVisible({ timeout: 35_000 });
  await upgradeDialog.getByRole('button').first().click();
  const results = page.getByRole('dialog', { name: 'Run results' });
  await expect(results).toBeVisible({ timeout: 35_000 });
  await expect(results).toContainText('RUN ANALYSIS');
  await expect(results).toContainText('Protocol survived.');
  expect(consoleErrors).toEqual([]);
});

test('layout remains usable at the supported compact desktop size', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await expect(page.getByTestId('run-button')).toBeVisible();
  await expect(page.getByTestId('arena').locator('canvas')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'striker robot script editor' })).toBeVisible();
  await page.screenshot({ path: 'test-results/swarm-script-1024.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024);
});
