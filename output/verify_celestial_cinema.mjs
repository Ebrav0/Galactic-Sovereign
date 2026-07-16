import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { SAVE_VERSION } from '../src/js/constants.js';
import { createNewGame } from '../src/js/state.js';
import {
  STAR_TYPES,
  CANONICAL_STAR_TYPES,
  STELLAR_GENERATION_PROFILES,
  stellarRenderParameters,
  stellarPhysicalProperties,
} from '../src/js/star-types.js';
import { crc32, deserialize, serialize } from '../src/js/save.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../package.json'));
const { chromium } = require('playwright');
const outDir = path.join(here, 'visuals', 'celestial-cinema');
fs.mkdirSync(outDir, { recursive: true });

const checks = [];
function check(name, condition, detail = '') {
  checks.push({ name, pass: !!condition, detail });
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const catalogMap = (state) => Object.fromEntries(Object.values(state.galaxies).map((galaxy) => [
  galaxy.id,
  Object.fromEntries(galaxy.graph.stars
    .map((star) => [star.id, [star.stellarClass, star.catalogNumber]])),
]));

const seededA = createNewGame(190019);
const seededB = createNewGame(190019);
check('save version 20 active', SAVE_VERSION === 20, String(SAVE_VERSION));
check('stellar catalog deterministic by seed', JSON.stringify(catalogMap(seededA)) === JSON.stringify(catalogMap(seededB)));

let excludedOk = true;
let floorsOk = true;
let numberingOk = true;
const classCounts = Object.fromEntries(CANONICAL_STAR_TYPES.map((type) => [type, 0]));
for (const galaxy of Object.values(seededA.galaxies)) {
  const numbers = galaxy.graph.stars.map((star) => star.catalogNumber);
  numberingOk &&= new Set(numbers).size === 400 && Math.min(...numbers) === 1 && Math.max(...numbers) === 400;
  const present = new Set(galaxy.graph.stars.map((star) => star.stellarClass).filter(Boolean));
  floorsOk &&= CANONICAL_STAR_TYPES.every((type) => present.has(type));
  for (const star of galaxy.graph.stars) {
    if (star.kind === 'trade_nexus') {
      excludedOk &&= !star.stellarClass;
      continue;
    }
    classCounts[star.stellarClass]++;
  }
}
check('Trade Nexus systems are excluded from stellar classes', excludedOk);
check('every galaxy reserves all 16 classes', floorsOk);
check('catalog numbers are unique 001–400 per galaxy', numberingOk);
check('real galaxy generation follows cinematic weights',
  CANONICAL_STAR_TYPES.every((type) => {
    const actual = classCounts[type] / Object.values(classCounts).reduce((a, b) => a + b, 0);
    const target = Object.keys(STELLAR_GENERATION_PROFILES).includes(type)
      ? ({ yellow_dwarf: .12, orange_dwarf: .15, red_dwarf: .18, brown_dwarf: .10,
        red_giant: .08, white_dwarf: .07, neutron_star: .05, pulsar: .04, magnetar: .03,
        wolf_rayet: .04, red_supergiant: .015, blue_supergiant: .015, hypergiant: .03,
        black_hole_system: .02, binary: .05, quasar: .01 })[type] : 0;
    return Math.abs(actual - target) <= .035;
  }), JSON.stringify(classCounts));

const binarySystem = Object.values(seededA.galaxies['gal-0'].systems)
  .find((system) => system.star?.type === 'binary');
if (binarySystem) {
check('binary render parameters stable',
    JSON.stringify(stellarRenderParameters(binarySystem.star, STAR_TYPES.binary))
      === JSON.stringify(stellarRenderParameters(binarySystem.star, STAR_TYPES.binary)));
  const separation = stellarRenderParameters(binarySystem.star, STAR_TYPES.binary).separation;
  check('binary separation has a clear orbital gap', separation >= 1.45 && separation <= 1.75, separation.toFixed(3));
  const params = stellarRenderParameters(binarySystem.star, STAR_TYPES.binary);
  let gapFrames = 0;
  let eclipseFrames = 0;
  const phaseSamples = 720;
  for (let index = 0; index < phaseSamples; index++) {
    const phase = index / phaseSamples * Math.PI * 2;
    const projectedAxis = Math.hypot(Math.cos(phase), Math.sin(phase) * params.axisCompression);
    const surfaceGap = 1.1 * params.separation * projectedAxis - 0.67 * (1 + params.companionScale);
    if (surfaceGap > 0.05) gapFrames++;
    if (surfaceGap < 0) eclipseFrames++;
  }
  check('binary phases show a clear gap most of the orbit', gapFrames / phaseSamples >= 0.70,
    `${Math.round(gapFrames / phaseSamples * 100)}%`);
  check('binary edge-on eclipse interval stays brief', eclipseFrames > 0 && eclipseFrames / phaseSamples <= 0.15,
    `${Math.round(eclipseFrames / phaseSamples * 100)}%`);
}

const roundTrip = deserialize(serialize(seededA));
check('v20 save round-trip keeps classes and catalog numbers', roundTrip.ok
  && JSON.stringify(catalogMap(roundTrip.state)) === JSON.stringify(catalogMap(seededA)));

const frozenCatalog = structuredClone(seededA);
const frozenGalaxy = frozenCatalog.galaxies['gal-0'];
const legacyNodes = frozenGalaxy.graph.stars.filter((star) => star.kind !== 'trade_nexus'
  && star.id !== frozenGalaxy.strongholdStarId).slice(0, 5);
const oldTypes = ['white_main', 'blue_white', 'blue_giant', 'subgiant', 'flare_star'];
const mappedTypes = ['wolf_rayet', 'wolf_rayet', 'blue_supergiant', 'red_giant', 'red_dwarf'];
legacyNodes.forEach((node, index) => {
  node.stellarOverride = oldTypes[index];
  delete node.stellarClass;
  frozenGalaxy.systems[node.id].star.type = oldTypes[index];
});
const frozenBodies = JSON.stringify(frozenGalaxy.systems[legacyNodes[0].id].bodies);
const frozenJson = JSON.stringify(frozenCatalog);
const migrated = deserialize(JSON.stringify({ saveVersion: 19, checksum: crc32(frozenJson), savedAt: 20, state: frozenCatalog }));
check('v19 migration maps every removed class', migrated.ok && legacyNodes.every((node, index) =>
  migrated.state.galaxies['gal-0'].graph.stars.find((star) => star.id === node.id)?.stellarClass === mappedTypes[index]));
check('v19 migration preserves existing planet rosters', migrated.ok
  && JSON.stringify(migrated.state.galaxies['gal-0'].systems[legacyNodes[0].id].bodies) === frozenBodies);
check('v20 physical properties are deterministic', migrated.ok && legacyNodes.every((node) => {
  const star = migrated.state.galaxies['gal-0'].systems[node.id].star;
  return JSON.stringify(stellarPhysicalProperties(star)) === JSON.stringify(stellarPhysicalProperties(star));
}));

const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => {
  const text = message.text();
  if (/GPU stall due to ReadPixels/i.test(text)) return;
  if (message.type() === 'error' || /shader compile|program link/i.test(text)) errors.push(text);
});

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
await page.evaluate(() => window.__newGame(190019, { mode: 'sandbox' }));

const typeIds = CANONICAL_STAR_TYPES;
const starFrameHashes = new Set();
for (const type of typeIds) {
  const profile = STAR_TYPES[type];
  await page.evaluate(({ type, profile }) => {
    const state = window.getGameState();
    const system = state.galaxies[state.activeGalaxyId].systems[state.stronghold];
    system.star.type = type;
    system.star.color = profile.color;
    system.star.radius = Math.round((profile.radiusRange[0] + profile.radiusRange[1]) / 2);
    system.star.visualSeed = 190019 + type.length * 997;
    // Re-entering the system forces the Intel panel to refresh even when the
    // previous catalog sample used the same underlying stronghold node.
    window.__setView('galaxy');
    window.__viewSystem(state.stronghold);
    const zoom = type.includes('supergiant') ? 0.42 : type === 'quasar' || type === 'pulsar' ? 0.72 : 0.62;
    window.__snapCamera(0, 0, zoom);
    window.advanceTime(120);
  }, { type, profile });
  await page.waitForTimeout(120);
  const stateText = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
  check(`${type} text renderer kind`, stateText.stellarRendererKind === profile.rendererKind,
    `${stateText.stellarRendererKind}`);
  await page.waitForFunction((label) => document.getElementById('intel-panel-body')?.innerText.includes(label),
    profile.displayName);
  const intelText = await page.locator('#intel-panel-body').innerText();
  check(`${type} Intel label`, intelText.includes(profile.displayName));
  const file = path.join(outDir, `star-${type}.png`);
  await page.locator('#game-canvas').screenshot({ path: file });
  check(`${type} screenshot non-empty`, fs.statSync(file).size > 15000, `${fs.statSync(file).size} bytes`);
  starFrameHashes.add(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
}
check('all 16 system silhouettes produce distinct frames', starFrameHashes.size === typeIds.length,
  `${starFrameHashes.size}/${typeIds.length}`);

const revealResult = await page.evaluate(({ typeIds, profiles }) => {
  const state = window.getGameState();
  const galaxy = state.galaxies[state.activeGalaxyId];
  const nodes = galaxy.graph.stars.filter((node) => node.kind !== 'trade_nexus').slice(0, typeIds.length);
  nodes.forEach((node, index) => {
    node.x = (index % 4 - 1.5) * 420;
    node.y = (Math.floor(index / 4) - 1.5) * 360;
    node.stellarClass = typeIds[index];
    const system = galaxy.systems[node.id];
    system.star.type = typeIds[index];
    system.star.color = profiles[typeIds[index]].color;
  });
  const reveal = window.__devAction('revealAllIntel');
  window.__setView('galaxy');
  window.__snapGalaxyCamera(0, 0, 0.52);
  return reveal;
}, { typeIds, profiles: STAR_TYPES });
await page.waitForTimeout(240);
check('Reveal All reports every galaxy, system, and wormhole', revealResult.ok
  && revealResult.details.systems === 4010 && revealResult.details.galaxies === 10
  && revealResult.details.wormholes === 10, JSON.stringify(revealResult.details));
const galleryFile = path.join(outDir, 'galaxy-all-16-classes.png');
await page.locator('#game-canvas').screenshot({ path: galleryFile });
check('all-class galaxy silhouette gallery captured', fs.statSync(galleryFile).size > 20000,
  `${fs.statSync(galleryFile).size} bytes`);

async function setWormholePhase(name, progress, anchored = false) {
  await page.evaluate(({ name, progress, anchored }) => {
    const state = window.getGameState();
    const whId = `wh-${state.activeGalaxyId}`;
    state.flagship.galaxyId = state.activeGalaxyId;
    state.flagship.systemId = 'core';
    state.flagship.transit = null;
    state.wormholes[whId].anchor = anchored ? 'wh-gal-1' : null;
    state.wormholes[whId].anchorOwner = anchored ? 'player' : null;
    if (['charging', 'opening', 'transit', 'collapse'].includes(name)) {
      state.flagship.wormholeTransit = {
        fromWh: whId,
        toWh: 'wh-gal-1',
        startTime: state.time - progress * 100000,
        durationMs: 100000,
      };
    } else {
      state.flagship.wormholeTransit = null;
    }
    window.__viewSystem('core');
    window.__snapCamera(0, 0, 0.82);
  }, { name, progress, anchored });
  await page.waitForTimeout(140);
  const snapshot = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
  check(`wormhole ${name} phase exposed`, snapshot.wormholeVisualPhase === name,
    snapshot.wormholeVisualPhase);
  const file = path.join(outDir, `wormhole-${name}.png`);
  await page.locator('#game-canvas').screenshot({ path: file });
  check(`wormhole ${name} screenshot non-empty`, fs.statSync(file).size > 12000, `${fs.statSync(file).size} bytes`);
  if (name === 'dormant') {
    const signaturePixels = await page.locator('#game-canvas').evaluate((canvas) => {
      const context = canvas.getContext('2d');
      if (!context) return 0;
      const size = Math.min(180, canvas.width, canvas.height);
      const image = context.getImageData(
        Math.floor(canvas.width / 2 - size / 2),
        Math.floor(canvas.height / 2 - size / 2),
        size,
        size,
      ).data;
      let count = 0;
      for (let i = 0; i < image.length; i += 4) {
        const red = image[i];
        const green = image[i + 1];
        const blue = image[i + 2];
        if (Math.max(red, green, blue) > 88 && Math.max(red, green, blue) - Math.min(red, green, blue) > 24) count++;
      }
      return count;
    });
    check('first-visit dormant gateway has a visible cinematic signature', signaturePixels > 220,
      `${signaturePixels} chromatic center pixels`);
  }
}

async function captureGalaxyWormholePhase(name) {
  await page.evaluate(() => {
    window.__setView('galaxy');
    window.__snapGalaxyCamera(0, 0, 0.52);
  });
  await page.waitForTimeout(180);
  const file = path.join(outDir, `galaxy-wormhole-${name}.png`);
  await page.locator('#game-canvas').screenshot({ path: file });
  check(`galaxy wormhole ${name} screenshot non-empty`, fs.statSync(file).size > 20000,
    `${fs.statSync(file).size} bytes`);
  const signature = await page.locator('#game-canvas').evaluate((canvas) => {
    const context = canvas.getContext('2d');
    if (!context) return { chromatic: 0, outerBright: 0 };
    const size = Math.min(260, canvas.width, canvas.height);
    const left = Math.floor(canvas.width / 2 - size / 2);
    const top = Math.floor(canvas.height / 2 - size / 2);
    const pixels = context.getImageData(left, top, size, size).data;
    let chromatic = 0;
    let outerBright = 0;
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        const index = (py * size + px) * 4;
        const red = pixels[index];
        const green = pixels[index + 1];
        const blue = pixels[index + 2];
        const max = Math.max(red, green, blue);
        const min = Math.min(red, green, blue);
        const radius = Math.hypot(px - size / 2, py - size / 2);
        if (max > 90 && max - min > 30) chromatic++;
        if (radius > 42 && radius < 118 && max > 78) outerBright++;
      }
    }
    return { chromatic, outerBright };
  });
  check(`galaxy wormhole ${name} has a streamlined chromatic gateway`,
    signature.chromatic > 350 && signature.outerBright > 160,
    `${signature.chromatic} chromatic / ${signature.outerBright} outer pixels`);
}

await setWormholePhase('dormant', 0, false);
await captureGalaxyWormholePhase('dormant');
await setWormholePhase('anchored', 0, true);
await captureGalaxyWormholePhase('anchored');
await setWormholePhase('charging', 0.1);
await captureGalaxyWormholePhase('charging');
await setWormholePhase('opening', 0.28);
await captureGalaxyWormholePhase('opening');
await setWormholePhase('transit', 0.55);
await captureGalaxyWormholePhase('transit');
await setWormholePhase('collapse', 0.9);
await captureGalaxyWormholePhase('collapse');

await page.evaluate(() => {
  const state = window.getGameState();
  state.flagship.wormholeTransit = {
    fromWh: `wh-${state.activeGalaxyId}`,
    toWh: 'wh-gal-1',
    startTime: state.time - 100000,
    durationMs: 100000,
  };
  window.__completeWormholeTransit();
  window.__viewSystem('core');
  window.__snapCamera(0, 0, 0.82);
  window.advanceTime(500);
});
await page.waitForTimeout(140);
let arrivalText = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
check('wormhole arrival phase exposed', arrivalText.wormholeVisualPhase === 'arrival', arrivalText.wormholeVisualPhase);
await page.locator('#game-canvas').screenshot({ path: path.join(outDir, 'wormhole-arrival.png') });
await page.evaluate(() => window.advanceTime(1500));
arrivalText = await page.evaluate(() => JSON.parse(window.render_game_to_text()));
check('wormhole arrival effect expires', ['dormant', 'anchored'].includes(arrivalText.wormholeVisualPhase), arrivalText.wormholeVisualPhase);

async function measureGalaxy(exoticsEnabled) {
  await page.evaluate(({ exoticsEnabled, profiles }) => {
    const state = window.getGameState();
    const galaxy = state.galaxies[state.activeGalaxyId];
    for (const node of galaxy.graph.stars) {
      const system = galaxy.systems[node.id];
      if (!system || !node.stellarClass) continue;
      const profile = exoticsEnabled ? profiles[node.stellarClass] : profiles.yellow_dwarf;
      system.star.type = profile.id;
      system.star.color = profile.color;
    }
    window.__setView('galaxy');
    window.__snapGalaxyCamera(0, 0, 0.28);
  }, { exoticsEnabled, profiles: STAR_TYPES });
  await page.waitForTimeout(300);
  const samples = [];
  for (let i = 0; i < 18; i++) {
    const value = await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => {
      resolve(window.__galaxyPerfSummary().lastDrawMs);
    })));
    if (i >= 5) samples.push(value);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
}

const baselineMs = await measureGalaxy(false);
const exoticMs = await measureGalaxy(true);
check('close galaxy exotic renderer stays within 20% baseline', exoticMs <= baselineMs * 1.2,
  `baseline=${baselineMs.toFixed(2)}ms exotic=${exoticMs.toFixed(2)}ms`);

const fallbackContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await fallbackContext.addInitScript(() => {
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function getContext(type, ...args) {
    if (type === 'webgl' || type === 'webgl2') return null;
    return original.call(this, type, ...args);
  };
});
const fallbackPage = await fallbackContext.newPage();
const fallbackErrors = [];
fallbackPage.on('pageerror', (error) => fallbackErrors.push(String(error)));
fallbackPage.on('console', (message) => {
  if (message.type() === 'error') fallbackErrors.push(message.text());
});
await fallbackPage.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await fallbackPage.waitForFunction(() => typeof window.render_game_to_text === 'function');
await fallbackPage.evaluate(() => window.__newGame(190019, { mode: 'sandbox' }));
const fallbackHashes = new Set();
for (const type of typeIds) {
  const profile = STAR_TYPES[type];
  await fallbackPage.evaluate(({ type, profile }) => {
    const state = window.getGameState();
    const system = state.galaxies[state.activeGalaxyId].systems[state.stronghold];
    system.star.type = type;
    system.star.color = profile.color;
    system.star.radius = Math.round((profile.radiusRange[0] + profile.radiusRange[1]) / 2);
    system.star.visualSeed = 290019 + type.length * 991;
    window.__viewSystem(state.stronghold);
    window.__snapCamera(0, 0, type.includes('giant') ? 0.44 : 0.64);
  }, { type, profile });
  await fallbackPage.waitForTimeout(70);
  const file = path.join(outDir, `fallback-star-${type}.png`);
  await fallbackPage.locator('#game-canvas').screenshot({ path: file });
  check(`${type} Canvas2D fallback non-empty`, fs.statSync(file).size > 12000,
    `${fs.statSync(file).size} bytes`);
  fallbackHashes.add(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
}
check('all 16 Canvas2D fallbacks produce distinct frames', fallbackHashes.size === typeIds.length,
  `${fallbackHashes.size}/${typeIds.length}`);
check('Canvas2D fallback has no browser errors', fallbackErrors.length === 0, fallbackErrors.join(' | '));
await fallbackContext.close();

check('no shader or browser console errors', errors.length === 0, errors.join(' | '));
await browser.close();

const failed = checks.filter((entry) => !entry.pass);
console.log(`\nCelestial cinema: ${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) process.exit(1);
