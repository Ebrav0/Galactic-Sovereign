import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const baseUrl = process.env.GAME_URL ?? 'http://127.0.0.1:5173';
const outDir = fileURLToPath(new URL('./visuals/', import.meta.url));
fs.mkdirSync(outDir, { recursive: true });

let passed = 0;
let failed = 0;
function check(condition, label, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`PASS ${label}${detail ? ` - ${detail}` : ''}`);
  } else {
    failed += 1;
    console.error(`FAIL ${label}${detail ? ` - ${detail}` : ''}`);
  }
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.setDefaultTimeout(8000);
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});

try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.__newGame === 'function');
  await page.evaluate(() => {
    window.__newGame(181820, { mode: 'sandbox' });
    document.getElementById('title-screen')?.classList.add('hidden');
    document.getElementById('new-game-modal')?.classList.add('hidden');
    document.getElementById('new-game-modal-backdrop')?.classList.add('hidden');
    window.__setBootPhase('playing');
    const state = window.getGameState();
    state.paused = true;
    state.credits = 50_000_000;
    const overlay = document.getElementById('pause-overlay');
    if (overlay) overlay.style.display = 'none';
    for (const tech of [
      'mil_parallel_dock',
      'eco_industrial_automation',
      'eco_construction_drones',
      'eco_sector_capitals',
      'mil_destroyer',
      'mil_patrol_cutter',
      'mil_frigate',
      'mil_cruiser',
      'mil_light_carrier',
      'eco_armored_convoy',
      'wh_sensor_ship',
      'mil_builder_ship',
      'mil_command_cruiser',
    ]) window.__forceResearch(tech);
    window.__seedTestShipyards();
    document.getElementById('tab-operations')?.click();
  });
  await page.waitForSelector('#operations-command-screen');
  const result = await page.evaluate(() => {
    const mode = document.getElementById('ops-campaign-mode');
    const count = document.getElementById('ops-campaign-count');
    const owner = document.getElementById('ops-campaign-owner-filter');
    const wars = document.getElementById('ops-campaign-war-authorizations');
    if (mode) mode.value = 'count';
    mode?.dispatchEvent(new Event('change', { bubbles: true }));
    if (count) count.value = '50';
    if (owner) owner.value = 'neutral';
    if (wars) wars.value = 'ai-0: border security\nai-1: border security\nai-2: border security\nai-3: border security';

    const presets = ['frontier', 'industrial', 'military', 'research', 'trade', 'dyson'];
    const previews = presets.map((templateId) => window.__previewExpansionCampaign({
      templateId,
      count: 1,
      filters: { owner: 'neutral' },
      warAuthorizations: [
        { factionId: 'ai-0', goal: 'border_security' },
        { factionId: 'ai-1', goal: 'border_security' },
        { factionId: 'ai-2', goal: 'border_security' },
        { factionId: 'ai-3', goal: 'border_security' },
      ],
      allowPartial: true,
    }));
    document.getElementById('ops-campaign-preview-button')?.click();
    document.getElementById('ops-campaign-create-button')?.click();
    return {
      campaignCount: window.__strategicOrdersSummary().campaigns.length,
      uiPreview: document.getElementById('ops-campaign-preview')?.innerText ?? '',
      previews: previews.map((preview) => ({
        ok: preview.ok,
        doctrine: preview.doctrine,
        manifest: preview.targets?.[0]?.projectedOperation?.manifest ?? [],
      })),
    };
  });

  if (result.campaignCount !== 1) throw new Error(`Campaign creation failed: ${result.uiPreview}`);
  await page.waitForFunction(() => window.__strategicOrdersSummary().campaigns?.length === 1);
  const state = await page.evaluate(() => ({
    campaign: window.__strategicOrdersSummary().campaigns[0],
    products: window.__productionProducts(),
    text: JSON.parse(window.render_game_to_text()),
  }));
  const previewText = await page.locator('#ops-campaign-preview').innerText();
  check(result.previews.every((preview) => preview.ok), 'all six operation presets preview in the live browser');
  check(new Set(result.previews.map((preview) => JSON.stringify(preview.doctrine))).size === 6,
    'browser previews retain six distinct doctrine snapshots');
  check(result.previews.every((preview) => preview.manifest.length > 0),
    'each browser preset produces a projected operation manifest');
  check(state.products.some((product) => product.productId === 'builder_drone' && product.cost === 120),
    'browser production catalog exposes the 120-credit Construction Drone');
  check(state.campaign.progress.total === 50, 'browser creates one 50-target aggregate campaign');
  check(await page.locator('[data-testid^="ops-campaign-target-"]').count() === 0,
    '50-target campaign renders no per-target DOM rows');
  check(/Doctrine:/.test(previewText)
    && /Production shortage for \d+ coordinated packages:/.test(previewText)
    && /Post-capture build:/.test(previewText),
    'Operations preview reports doctrine, shortage, and build plan');
  check(await page.locator('[data-testid="ops-metric-drones-available"]').count() === 1
    && await page.locator('[data-testid="ops-metric-drones-reserved"]').count() === 1
    && await page.locator('[data-testid="ops-metric-drones-embarked"]').count() === 1
    && await page.locator('[data-testid="ops-metric-drones-active"]').count() === 1
    && await page.locator('[data-testid="ops-metric-drones-building"]').count() === 1,
  'Operations screen exposes all five drone lifecycle counters');
  check(state.text.saveVersion === 20 && state.text.strategicOrders.version === 2,
    'render_game_to_text exposes v19 and strategic schema v2');
  check(errors.length === 0, 'browser emitted zero console or page errors', errors.join(' | '));
  await page.screenshot({ path: path.join(outDir, 'v18-operation-presets.png'), fullPage: true });
  await page.locator('#ops-campaign-preview').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(outDir, 'v18-operation-preview.png'), fullPage: false });
} catch (error) {
  failed += 1;
  console.error(`FAIL v18 browser verifier aborted - ${error?.stack ?? error}`);
} finally {
  await browser.close();
}

console.log(`\nV18 OPERATIONS BROWSER: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
