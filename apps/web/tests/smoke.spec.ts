import { expect, test, type Page } from '@playwright/test';

const screenshotPath = (name: string): string =>
  process.env.UPDATE_SCREENSHOTS === '1' ? `docs/screenshots/${name}` : `test-results/${name}`;

async function renderedTick(page: Page): Promise<number> {
  const text = await page.getByTestId('render-metrics').textContent();
  return Number(text?.match(/DRAW\s+(\d+)/)?.[1] ?? 0);
}

test('landing, navigation, and deterministic playable flow work at 1440x900', async ({ page }) => {
  test.setTimeout(100_000);
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
  await page.screenshot({
    path: screenshotPath('swarm-script-v0.2-landing-1440.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.screenshot({ path: 'apps/web/public/swarm-script-social.png' });
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.getByTestId('play-now').click();
  await expect(page).toHaveURL(/\/play$/);
  await expect(page.getByText('About / Technical Details')).toBeVisible();

  await page.goto('/play');
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
  await expect(page.getByText(/Run 43105 deployed/)).toBeVisible();
  await expect(page.getByTestId('pause-button')).toBeEnabled();
  await expect(page.locator('.ability-readout')).toContainText('ACTIVE');
  await page.screenshot({
    path: screenshotPath('swarm-script-v0.2-ability.png'),
    fullPage: true,
  });
  await page.getByTestId('pause-button').click();
  await expect(page.getByText('SIMULATION HELD')).toBeVisible();
  await expect
    .poll(async () => page.getByLabel('Development performance overlay').textContent())
    .toContain('DRAW');
  await page.getByTestId('pause-button').click();

  await expect(page.locator('.ability-readout')).toContainText('OVERCHARGE');
  await expect(page.locator('.ability-readout')).toContainText(/READY|ACTIVE|READY IN/);

  const beforeSpeedChanges = await renderedTick(page);
  for (const speed of ['2×', '4×', '1×', '4×']) {
    await page.getByRole('button', { name: speed, exact: true }).click();
    await page.waitForTimeout(50);
  }
  await expect.poll(() => renderedTick(page)).toBeGreaterThan(beforeSpeedChanges + 3);
  await expect(page.getByTestId('render-metrics')).toContainText('SIM 4×');
  await page.waitForTimeout(900);
  await expect.poll(() => renderedTick(page)).toBeGreaterThan(beforeSpeedChanges + 70);
  await page.screenshot({
    path: screenshotPath('swarm-script-v0.2-combat.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'AUDIO ON' }).click();
  await expect(page.getByRole('button', { name: 'AUDIO OFF' })).toBeVisible();
  await page.getByRole('button', { name: 'AUDIO OFF' }).click();
  await expect(page.getByLabel('Sound volume')).toBeVisible();
  const upgradeDialog = page.getByRole('dialog', { name: 'Choose an upgrade' });
  await expect(upgradeDialog).toBeVisible({ timeout: 35_000 });
  await expect(upgradeDialog).toContainText('BUILD SYNERGY');
  await page.screenshot({
    path: screenshotPath('swarm-script-v0.2-upgrade.png'),
    fullPage: true,
  });
  await upgradeDialog.getByRole('button').nth(1).click();
  await expect(upgradeDialog).toBeHidden();
  await expect(upgradeDialog).toBeVisible({ timeout: 35_000 });
  await upgradeDialog.getByRole('button').nth(1).click();
  const results = page.getByRole('dialog', { name: 'Run results' });
  await expect(results).toBeVisible({ timeout: 35_000 });
  await expect(results).toContainText('RUN ANALYSIS');
  await expect(results).toContainText('Protocol survived.');
  await expect(results).toContainText('ABILITY USES');
  await expect(results).toContainText(/Overcharge [1-9]\d*/);
  await expect(results).toContainText(/Shield [1-9]\d*/);
  await expect(results).toContainText(/Mark [1-9]\d*/);
  await expect(results.getByTestId('final-build')).toContainText('FINAL BUILD');
  await expect(results.getByTestId('final-build').locator('article')).toHaveCount(2);
  await page.screenshot({
    path: screenshotPath('swarm-script-v0.2-results.png'),
    fullPage: true,
  });

  await results.getByRole('button', { name: 'PRESENTATION' }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(consoleErrors).toEqual([]);
  expect(failedResponses).toEqual([]);
});

test('passive scripts reach an understandable browser defeat', async ({ page }) => {
  test.setTimeout(70_000);
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/play?e2e=1&passive=1');
  await expect(page.getByTestId('compile-status')).toContainText('ALL SYSTEMS VALID');
  await page.getByTestId('run-button').click();
  await page.getByRole('button', { name: '4×', exact: true }).click();
  const results = page.getByRole('dialog', { name: 'Run results' });
  await expect(results).toBeVisible({ timeout: 45_000 });
  await expect(results).toContainText('Squad signal lost.');
  await expect(results).toContainText('Rework the rules');
  expect(consoleErrors).toEqual([]);
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
  await page.locator('.motion-toggle').click();
  await expect(page.getByLabel('REDUCED MOTION')).toBeChecked();
  await page.screenshot({
    path: 'test-results/swarm-script-game-1024.png',
    animations: 'disabled',
  });
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
