import { expect, test } from '@playwright/test';

test('landing, navigation, and deterministic playable flow work at 1440x900', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
  });

  await page.goto('/');
  await expect(page).toHaveTitle('Swarm Script — Program Your Squad');
  await expect(page.getByRole('heading', { name: 'SWARM SCRIPT' })).toBeVisible();
  await expect(page.getByText('Program your squad. Watch the logic fight.')).toBeVisible();
  await expect(page.getByRole('img', { name: /Swarm Script gameplay/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/swarm-script-landing-1440.png', fullPage: true });
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.screenshot({ path: 'apps/web/public/swarm-script-social.png' });
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.getByTestId('play-now').click();
  await expect(page).toHaveURL(/\/play$/);
  await expect(page.getByText('About / Technical Details')).toBeVisible();

  await page.goto('/play?e2e=1');
  await expect(page.getByTestId('compile-status')).toContainText('ALL SYSTEMS VALID');
  await expect(page.getByTestId('arena').locator('canvas')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'striker robot script editor' })).toBeVisible();
  const loadedResources = await page.evaluate(() =>
    performance.getEntriesByType('resource').map((entry) => entry.name),
  );
  expect(loadedResources.some((url) => url.includes('simulation.worker'))).toBe(true);
  expect(loadedResources.some((url) => url.includes('createGame'))).toBe(true);
  expect(
    loadedResources.some((url) => /editor(?:\.|_)api/.test(url) || url.includes('monaco-editor')),
  ).toBe(true);
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
    path: 'docs/screenshots/swarm-script-gameplay.png',
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
  await page.screenshot({
    path: 'docs/screenshots/swarm-script-victory.png',
    fullPage: true,
  });

  await results.getByRole('button', { name: 'PRESENTATION' }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(consoleErrors).toEqual([]);
  expect(failedResponses).toEqual([]);
});

test('presentation and game remain usable at 1024x768', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await expect(page.getByTestId('play-now')).toBeVisible();
  await page.screenshot({ path: 'test-results/swarm-script-landing-1024.png', fullPage: true });

  await page.goto('/play');
  await expect(page.getByTestId('run-button')).toBeVisible();
  await expect(page.getByTestId('arena').locator('canvas')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'striker robot script editor' })).toBeVisible();
  await page.screenshot({ path: 'test-results/swarm-script-game-1024.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024);
});

test('technical route refreshes and narrow game screens receive a friendly fallback', async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 760 });
  await page.goto('/architecture');
  await expect(page.getByRole('heading', { name: /Logic stays authoritative/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: /Logic stays authoritative/ })).toBeVisible();

  await page.goto('/play');
  await expect(page.getByText('Swarm Script needs a wider screen.')).toBeVisible();
  await expect(
    page.getByText('The behavior editor and arena require at least 1024 pixels.'),
  ).toBeVisible();
});
