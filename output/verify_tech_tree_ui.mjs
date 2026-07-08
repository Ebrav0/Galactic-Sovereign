// Browser verification for tech-tree section chips and focused section views.

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:5173';
const outDir = path.resolve('output/web-game/tech-tree-sections-ui');
fs.mkdirSync(outDir, { recursive: true });

const clusters = [
  ['economy', 'Economy'],
  ['military', 'Military'],
  ['megastructure', 'Dyson'],
  ['trade', 'Trade'],
  ['wormhole', 'Wormhole'],
  ['research', 'Research'],
  ['diplomacy', 'Diplomacy'],
  ['superweapon', 'Superweapon'],
  ['flagship', 'Flagship'],
];

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond, detail });
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`);
};

async function clickChip(page, label) {
  const clicked = await page.evaluate((text) => {
    const chip = [...document.querySelectorAll('.tech-web-legend__chip')]
      .find((btn) => btn.textContent.trim() === text);
    chip?.click();
    return !!chip;
  }, label);
  check(`${label} chip exists`, clicked);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => consoleErrors.push(err.message));

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.click('#title-new-campaign-btn');
await page.click('#new-game-sandbox-btn');
await page.waitForFunction(() => document.querySelector('#title-screen')?.classList.contains('hidden'));
await page.click('#tab-tech');
await page.waitForSelector('.tech-web-node');
await page.screenshot({ path: path.join(outDir, 'tech-all.png'), fullPage: true });

const labels = await page.$$eval('.tech-web-band-label', (els) => els.map((el) => el.textContent.trim()).filter(Boolean));
for (const [, label] of clusters) {
  check(`band label exists for ${label}`, labels.includes(label), labels.join(', '));
}

const fullViewBox = await page.$eval('.tech-web-graph', (svg) => svg.getAttribute('viewBox'));
for (const [clusterId, label] of clusters) {
  await clickChip(page, label);
  await page.waitForTimeout(80);
  const focused = await page.evaluate((id) => {
    const nodes = [...document.querySelectorAll('.tech-web-node')];
    const edges = [...document.querySelectorAll('.tech-web-edge')];
    const sectionNodes = nodes.filter((node) => node.dataset.cluster === id);
    const activeSectionNodes = sectionNodes.filter((node) => !node.classList.contains('tech-web-node--filtered'));
    const filteredOtherNodes = nodes.filter((node) => node.dataset.cluster !== id && node.classList.contains('tech-web-node--filtered'));
    return {
      sectionCount: sectionNodes.length,
      activeSectionCount: activeSectionNodes.length,
      filteredOtherCount: filteredOtherNodes.length,
      filteredEdgeCount: edges.filter((edge) => edge.classList.contains('tech-web-edge--filtered')).length,
      viewBox: document.querySelector('.tech-web-graph')?.getAttribute('viewBox') ?? '',
    };
  }, clusterId);
  check(`${label} chip keeps its nodes active`, focused.activeSectionCount === focused.sectionCount && focused.sectionCount > 0);
  check(`${label} chip filters other node sections`, focused.filteredOtherCount > 0);
  check(`${label} chip filters unrelated connector lanes`, focused.filteredEdgeCount > 0);
  check(`${label} chip focuses away from full view`, focused.viewBox !== fullViewBox, focused.viewBox);
  if (clusterId === 'superweapon') {
    await page.screenshot({ path: path.join(outDir, 'tech-superweapon.png'), fullPage: true });
  }
}

await clickChip(page, 'All');
await page.waitForTimeout(80);
const allReset = await page.evaluate(() => ({
  filteredNodes: document.querySelectorAll('.tech-web-node--filtered').length,
  filteredEdges: document.querySelectorAll('.tech-web-edge--filtered').length,
}));
check('All chip clears node filtering', allReset.filteredNodes === 0, String(allReset.filteredNodes));
check('All chip clears edge filtering', allReset.filteredEdges === 0, String(allReset.filteredEdges));
check('browser console stayed clean', consoleErrors.length === 0, consoleErrors.join(' | '));

await browser.close();

const failed = results.filter((r) => !r.pass);
if (failed.length > 0) {
  console.error(`\n${failed.length} tech-tree UI checks failed.`);
  process.exit(1);
}

console.log(`\n${results.length}/${results.length} tech-tree UI checks passed.`);
