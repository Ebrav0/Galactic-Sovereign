import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const baseUrl = process.env.GAME_URL ?? 'http://127.0.0.1:5173';
const outDir = fileURLToPath(new URL('./visuals/', import.meta.url));
fs.mkdirSync(outDir, { recursive: true });

let passed = 0;
let failed = 0;
function check(condition, label, details = '') {
  if (condition) {
    passed += 1;
    console.log(`PASS ${label}${details ? ` - ${details}` : ''}`);
  } else {
    failed += 1;
    console.error(`FAIL ${label}${details ? ` - ${details}` : ''}`);
  }
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.setDefaultTimeout(5000);
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});

try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.__newGame === 'function');
  const setup = await page.evaluate(() => {
    window.__newGame(1616, { mode: 'sandbox' });
    document.getElementById('title-screen')?.classList.add('hidden');
    document.getElementById('new-game-modal')?.classList.add('hidden');
    document.getElementById('new-game-modal-backdrop')?.classList.add('hidden');
    window.__setBootPhase('playing');
    const state = window.getGameState();
    state.paused = true;
    const pauseOverlay = document.getElementById('pause-overlay');
    if (pauseOverlay) {
      pauseOverlay.style.pointerEvents = 'none';
      pauseOverlay.style.display = 'none';
    }
    state.credits = 10_000_000;
    state.solarii = 10_000;
    window.__setCompletedDysons(1);
    for (const tech of [
      'mil_parallel_dock',
      'eco_industrial_automation',
      'eco_construction_drones',
      'eco_sector_capitals',
      'dip_truce_protocol',
      'dip_trade_charter',
      'dip_alliance_pact',
      'dip_galactic_council',
    ]) window.__forceResearch(tech);
    return window.__seedTestShipyards();
  });
  check(setup?.ok === true, 'late-game browser fixture has operational shipyards');

  await page.click('#tab-operations');
  await page.waitForSelector('#operations-command-screen:not(.hidden)');
  check(await page.locator('#operations-screen').isVisible(), 'Operations command screen opens');

  await page.click('#ops-bulk-add-ship');
  check(
    await page.locator('[data-bulk-manifest-row]').count() === 2,
    'bulk manifest can add another dropdown and quantity row',
  );
  check(
    await page.locator('#ops-bulk-hull-2 option[value="builder_drone:builder_drone"]').count() === 1,
    'Construction Drone is available in the mixed bulk-product picker',
  );
  await page.locator('[data-remove-bulk-manifest-row]').nth(1).click({ force: true, timeout: 5000 });
  check(
    await page.locator('[data-bulk-manifest-row]').count() === 1,
    'bulk manifest can remove an extra ship row',
  );
  await page.fill('#ops-bulk-quantity-1', '400');
  await page.evaluate(() => document.getElementById('ops-bulk-preview-button')?.click());
  const bulkPreview = await page.locator('#ops-bulk-preview').innerText();
  check(/400/.test(bulkPreview), '400-corvette preview is visible as one aggregate manifest');
  await page.evaluate(() => document.getElementById('ops-bulk-create-button')?.click());
  await page.waitForFunction(() => window.__bulkProductionSummary().totals?.ordered === 400);
  const bulkState = await page.evaluate(() => window.__bulkProductionSummary());
  check(bulkState.orders.length === 1, 'browser creates one aggregate bulk order');
  check(bulkState.orders[0].manifest.length === 1, '400 ships remain one manifest line in live state');

  await page.selectOption('#ops-campaign-mode', 'count');
  await page.fill('#ops-campaign-count', '50');
  await page.selectOption('#ops-campaign-owner-filter', 'neutral');
  await page.fill(
    '#ops-campaign-war-authorizations',
    'ai-0: border security\nai-1: border security\nai-2: border security\nai-3: border security',
  );
  await page.evaluate(() => document.getElementById('ops-campaign-preview-button')?.click());
  const campaignPreview = await page.locator('#ops-campaign-preview').innerText();
  check(/50/.test(campaignPreview), '50-system Auto-Route preview is visible');
  await page.evaluate(() => document.getElementById('ops-campaign-create-button')?.click());
  await page.waitForFunction(() => window.__strategicOrdersSummary().campaigns?.length === 1);
  const strategicState = await page.evaluate(() => window.__strategicOrdersSummary());
  check(strategicState.campaigns.length === 1, 'browser creates one aggregate expansion campaign');
  check(strategicState.campaigns[0].progress.total === 50, 'campaign retains fifty targets without fifty command rows');
  const operationRows = await page.locator('#operations-command-screen .command-ledger__row').count();
  check(operationRows < 40, 'Operations DOM stays aggregate at late-game scale', `rows=${operationRows}`);
  await page.screenshot({ path: path.join(outDir, 'overhaul-operations.png'), fullPage: true });

  await page.click('#tab-diplomacy');
  await page.waitForSelector('#diplomacy-command-screen');
  check(await page.locator('#diplomacy-screen').isVisible(), 'Diplomacy command screen opens');
  check(await page.locator('#diplomacy-global-factions').innerText() === '4', 'Diplomacy screen lists all four foreign powers');
  await page.click('#diplomacy-contact-button');
  await page.waitForFunction(() => window.__diplomacySummary().factions[0].contact.stage === 'established');
  check(
    await page.evaluate(() => window.__diplomacySummary().factions[0].contact.stage) === 'established',
    'Diplomacy UI establishes persistent formal contact',
  );
  check(await page.locator('#diplomacy-modifier-ledger').isVisible(), 'relationship modifier ledger is visible');
  await page.screenshot({ path: path.join(outDir, 'overhaul-diplomacy.png'), fullPage: true });
  check(errors.length === 0, 'browser emitted no console or page errors', errors.join(' | '));
} catch (error) {
  failed += 1;
  console.error(`FAIL browser verifier aborted - ${error?.stack ?? error}`);
  if (errors.length) console.error(`Browser errors: ${errors.join(' | ')}`);
} finally {
  await browser.close();
}

console.log(`\nV16 OVERHAUL BROWSER: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
