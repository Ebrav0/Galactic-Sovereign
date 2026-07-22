#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

import { createNewGame } from '../src/js/state.js';
import { serialize } from '../src/js/save.js';

const baseUrl = process.env.GS_TEST_URL || 'http://127.0.0.1:19880';
const ownerUsername = process.env.GS_TEST_OWNER || 'commander';
const ownerPassword = process.env.GS_TEST_OWNER_PASSWORD || 'Hosted Test Password 1234';
const outputDir = path.resolve(process.env.GS_TEST_OUTPUT || 'output/hosted-account-ui');
fs.mkdirSync(outputDir, { recursive: true });

function assert(value, message) {
  if (!value) throw new Error(message);
}

async function screenshot(page, name) {
  await page.screenshot({ path: path.join(outputDir, `${name}.png`), fullPage: true });
}

const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const localEnvelope = serialize(createNewGame(8181));
await context.addInitScript((envelope) => localStorage.setItem('gs-save-slot-1', envelope), localEnvelope);
const page = await context.newPage();
const errors = [];
page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
page.on('pageerror', (error) => errors.push(`page: ${error.message}`));

try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('#account-gate:not(.hidden)').waitFor();
  await screenshot(page, '01-login');

  await page.locator('#account-username').fill(ownerUsername);
  await page.locator('#account-password').fill(ownerPassword);
  await page.locator('#account-login-form button[type=submit]').click();
  await page.locator('#account-chip:not(.hidden)').waitFor();
  await page.locator('#account-import:not(.hidden)').waitFor();
  await screenshot(page, '02-signed-in-local-import');

  await page.locator('#account-import-now').click();
  await page.locator('#account-import-now').filter({ hasText: /Copied \d+/ }).waitFor();
  await page.locator('#account-admin-open').click();
  await page.locator('#account-admin:not(.hidden)').waitFor();
  const suffix = String(Date.now()).slice(-6);
  const playerUsername = `pilot-${suffix}`;
  await page.locator('#account-create-username').fill(playerUsername);
  await page.locator('#account-create-display').fill('UI Test Pilot');
  await page.locator('#account-create-form button[type=submit]').click();
  const temporaryPassword = await page.locator('#account-temp-password code').textContent();
  assert(temporaryPassword?.length >= 12, 'Temporary password was not shown once');
  await screenshot(page, '03-admin-created-player');

  await page.locator('#account-admin-close').click();
  await page.locator('#account-logout').click();
  await page.locator('#account-gate:not(.hidden)').waitFor();
  await page.locator('#account-username').fill(playerUsername);
  await page.locator('#account-password').fill(temporaryPassword);
  await page.locator('#account-login-form button[type=submit]').click();
  await page.locator('#account-password-form:not(.hidden)').waitFor();
  await screenshot(page, '04-required-password-change');

  const newPassword = 'UI Test Pilot Password 1234';
  await page.locator('#account-current-password').fill(temporaryPassword);
  await page.locator('#account-new-password').fill(newPassword);
  await page.locator('#account-confirm-password').fill(newPassword);
  await page.locator('#account-password-form button[type=submit]').click();
  await page.locator('#account-login-form:not(.hidden)').waitFor();
  await page.locator('#account-username').fill(playerUsername);
  await page.locator('#account-password').fill(newPassword);
  await page.locator('#account-login-form button[type=submit]').click();
  await page.locator('#account-chip:not(.hidden)').waitFor();

  await page.locator('#title-multiplayer-door').click();
  await page.locator('#title-mp-server-card').click();
  await page.locator('#title-mp-join-btn').click();
  await page.waitForFunction(() => window.__coopStatus?.().active === true, null, { timeout: 15_000 });
  const firstIdentity = await page.evaluate(() => window.__coopStatus().playerId);
  assert(/^[0-9a-f-]{36}$/i.test(firstIdentity), `Expected account UUID identity, got ${firstIdentity}`);
  await page.waitForTimeout(750);
  await screenshot(page, '05-multiplayer');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__coopStatus?.().active === true, null, { timeout: 15_000 });
  const reloaded = await page.evaluate(() => ({
    identity: window.__coopStatus().playerId,
    state: JSON.parse(window.render_game_to_text()),
  }));
  assert(reloaded.identity === firstIdentity, 'Reload changed authenticated multiplayer identity');
  assert(
    Number.isFinite(reloaded.state?.flagship?.x) && Number.isFinite(reloaded.state?.flagship?.y),
    'Reload produced invalid flagship pose',
  );
  await page.waitForTimeout(750);
  await screenshot(page, '06-multiplayer-reload');
  assert(errors.length === 0, `Browser errors:\n${errors.join('\n')}`);

  console.log('[hosted-ui] PASS: login, import, admin, password change, multiplayer, and reload');
  console.log(`[hosted-ui] screenshots: ${outputDir}`);
} finally {
  await browser.close();
}
