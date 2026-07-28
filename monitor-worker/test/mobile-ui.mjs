import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, devices, webkit } from 'playwright';

const baseUrl = process.env.GS_MOBILE_TEST_URL || 'http://127.0.0.1:8787';
const outputDir = path.resolve(process.env.GS_MOBILE_TEST_OUTPUT || '../output/mobile-status/ios');
fs.mkdirSync(outputDir, { recursive: true });

const errors = [];
const attachErrors = (page, label) => {
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${label}: console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`${label}: pageerror: ${String(error)}`));
  page.on('requestfailed', (request) => {
    if (!request.url().startsWith(baseUrl)) return;
    errors.push(`${label}: requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText || ''}`);
  });
};

async function capture(page, filename) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(outputDir, filename) });
}

function staleResponse() {
  const now = Math.floor(Date.now() / 1000);
  return JSON.stringify({
    ok: true,
    status: {
      schemaVersion: 1,
      state: 'critical',
      freshness: 'stale',
      generatedAt: now,
      lastReportAt: now - 901,
      heartbeatAgeSeconds: 901,
      readiness: 75,
      services: { gateway: 'unknown', coop: 'unknown', site: 'unknown', tunnel: 'unknown', firewall: 'unknown', backup: 'unknown' },
      findings: [{ key: 'heartbeat-stale', severity: 'critical', message: 'Server telemetry is more than 15 minutes old' }],
      metrics: { playersOnline: null, diskUsePercent: null, backupAgeSeconds: null },
      recovery: { localRestoreTestAt: now - 86400, offsiteRestoreTestAt: now - 86400, upsState: 'OL' },
      releases: { game: 'game-last-known', website: 'site-last-known' },
      source: { kind: 'signed-home-server-heartbeat', normalIntervalSeconds: 300, staleAfterSeconds: 900 },
    },
  });
}

async function assertNoHorizontalOverflow(page, label) {
  const layout = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    bodyWidth: document.body.scrollWidth,
    documentWidth: document.documentElement.scrollWidth,
  }));
  assert.ok(layout.bodyWidth <= layout.innerWidth + 1, `${label}: body overflow ${JSON.stringify(layout)}`);
  assert.ok(layout.documentWidth <= layout.innerWidth + 1, `${label}: document overflow ${JSON.stringify(layout)}`);
}

async function assertTouchTargets(page) {
  const targets = await page.locator('button, a.signout-button').evaluateAll((elements) => elements.filter((element) => {
    const style = getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none';
  }).map((element) => {
    const box = element.getBoundingClientRect();
    return { label: element.getAttribute('aria-label') || element.textContent?.trim() || element.tagName, width: box.width, height: box.height };
  }));
  const undersized = targets.filter((target) => target.width < 44 || target.height < 44);
  assert.deepEqual(undersized, [], `undersized touch targets: ${JSON.stringify(undersized)}`);
}

async function verifyPrimaryIosFlow() {
  const browser = await webkit.launch({ headless: true });
  const context = await browser.newContext({ ...devices['iPhone 15 Pro'], serviceWorkers: 'block' });
  const page = await context.newPage();
  attachErrors(page, 'iPhone 15 Pro');
  await page.goto(baseUrl, { waitUntil: 'networkidle' });

  await page.getByRole('heading', { name: 'All systems operational' }).waitFor();
  await assertNoHorizontalOverflow(page, 'overview');
  assert.equal(await page.getByText('100%', { exact: true }).count(), 1);
  assert.equal(await page.getByText('3', { exact: true }).count(), 1);
  assert.equal(await page.locator('nav.bottom-nav button').count(), 4);
  await assertTouchTargets(page);

  await page.getByRole('button', { name: 'Systems' }).click();
  await page.getByRole('heading', { name: 'Production systems' }).waitFor();
  assert.equal(await page.locator('.service-row').count(), 6);
  assert.equal(await page.getByText('Healthy', { exact: true }).count(), 6);
  await assertNoHorizontalOverflow(page, 'systems');

  await page.getByRole('button', { name: 'Activity' }).click();
  await page.getByRole('heading', { name: 'Capacity & activity' }).waitFor();
  await page.getByRole('button', { name: '7d' }).click();
  await page.getByRole('button', { name: '7d' }).waitFor();
  await assertTouchTargets(page);

  await page.getByRole('button', { name: 'Recovery' }).click();
  await page.getByRole('heading', { name: 'Recovery posture' }).waitFor();
  assert.equal(await page.locator('.recovery-row').count(), 4);

  await page.getByRole('button', { name: 'Open owner account' }).click();
  await page.getByRole('dialog', { name: 'Owner session' }).waitFor();
  assert.equal(await page.getByRole('link', { name: 'Sign out' }).getAttribute('href'), '/cdn-cgi/access/logout');
  await assertTouchTargets(page);
  await page.getByRole('button', { name: 'Close account' }).click();

  const state = JSON.parse(await page.evaluate(() => window.render_game_to_text()));
  assert.equal(state.app, 'galactic-sovereign-mobile-status');
  assert.equal(state.activeTab, 'recovery');
  assert.equal(state.status.state, 'operational');
  assert.equal(state.status.metrics.playersOnline, 3);

  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.getByText('Your phone is offline. Showing the last loaded report.').waitFor();

  await context.close();
  await browser.close();
}

async function verifyViewportBounds() {
  const browser = await chromium.launch({ headless: true });
  for (const deviceName of ['iPhone SE', 'iPhone 15 Pro Max']) {
    const context = await browser.newContext({ ...devices[deviceName], serviceWorkers: 'block' });
    const page = await context.newPage();
    attachErrors(page, deviceName);
    await page.goto(baseUrl, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'All systems operational' }).waitFor();
    await assertNoHorizontalOverflow(page, deviceName);
    await capture(page, `${deviceName.toLowerCase().replaceAll(' ', '-')}-overview.png`);
    await context.close();
  }
  await browser.close();
}

async function captureIosVisualStates() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ...devices['iPhone 15 Pro'], serviceWorkers: 'block' });
  const page = await context.newPage();
  attachErrors(page, 'iPhone 15 Pro visual');
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await capture(page, 'iphone-15-pro-overview.png');
  for (const [tab, filename] of [
    ['Systems', 'iphone-15-pro-systems.png'],
    ['Activity', 'iphone-15-pro-activity.png'],
    ['Recovery', 'iphone-15-pro-recovery.png'],
  ]) {
    await page.getByRole('button', { name: tab }).click();
    await capture(page, filename);
  }
  await page.getByRole('button', { name: 'Open owner account' }).click();
  await capture(page, 'iphone-15-pro-account.png');
  await page.getByRole('button', { name: 'Close account' }).click();
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await capture(page, 'iphone-15-pro-offline.png');
  await context.close();

  const staleContext = await browser.newContext({ ...devices['iPhone 15 Pro'], serviceWorkers: 'block' });
  const stalePage = await staleContext.newPage();
  attachErrors(stalePage, 'stale visual');
  await stalePage.route('**/api/status', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: staleResponse() }));
  await stalePage.goto(baseUrl, { waitUntil: 'networkidle' });
  await stalePage.getByRole('button', { name: 'Systems' }).click();
  await capture(stalePage, 'iphone-15-pro-stale.png');
  await staleContext.close();
  await browser.close();
}

async function verifyStaleTruthState() {
  const browser = await webkit.launch({ headless: true });
  const context = await browser.newContext({ ...devices['iPhone 15 Pro'], serviceWorkers: 'block' });
  const page = await context.newPage();
  attachErrors(page, 'stale-state');
  await page.route('**/api/status', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: staleResponse(),
    });
  });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Attention required' }).waitFor();
  assert.equal(await page.getByText('—', { exact: true }).count(), 3);
  await page.getByRole('button', { name: 'Systems' }).click();
  assert.equal(await page.getByText('Unknown', { exact: true }).count(), 6);
  await context.close();
  await browser.close();
}

await verifyPrimaryIosFlow();
await captureIosVisualStates();
await verifyViewportBounds();
await verifyStaleTruthState();
assert.deepEqual(errors, [], `browser errors: ${JSON.stringify(errors, null, 2)}`);
console.log(JSON.stringify({ ok: true, outputDir, scenarios: ['iPhone 15 Pro full flow', 'iPhone SE bounds', 'iPhone 15 Pro Max bounds', 'stale truth state'] }));
