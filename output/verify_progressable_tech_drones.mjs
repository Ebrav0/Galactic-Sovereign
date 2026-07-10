import playwright from '/Users/emmanuelbravo/.codex/skills/develop-web-game/node_modules/playwright/index.js';

const { chromium } = playwright;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});
page.on('pageerror', (err) => errors.push(err.message));

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

await page.goto('http://127.0.0.1:5173', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => typeof window.__forceResearch === 'function');

// The Sail Foundry technology must work by itself; Construction Drones are only
// required for remote work, not a hidden prerequisite for the building unlock.
const localFoundry = await page.evaluate(() => {
  window.__newGame();
  window.__setBootPhase('playing');
  const state = window.getGameState();
  state.credits = 5000;
  window.__forceResearch('eco_surveyor');
  window.__forceResearch('eco_outpost_2');
  window.__forceResearch('res_lab_1');
  window.__forceResearch('mega_foundry_unlock');
  const planet = state.galaxies[state.activeGalaxyId].systems[state.stronghold].bodies.find((body) => body.type === 'habitable');
  return { result: window.__buildFoundry(planet.id), unlocked: state.research.unlocked.includes('eco_construction_drones') };
});
check('Sail Foundry can be started without Construction Drones', localFoundry.result.ok, localFoundry.result.reason ?? '');
check('Construction Drones remain a separate early technology', !localFoundry.unlocked);

// Set up a claimed neighbouring target and unlock the new early drone technology.
const target = await page.evaluate(() => {
  window.__newGame();
  window.__setBootPhase('playing');
  const state = window.getGameState();
  window.__hydrateGalaxy(state.activeGalaxyId);
  state.paused = false;
  state.credits = 10000;
  const galaxy = state.galaxies[state.activeGalaxyId];
  const home = state.stronghold;
  const neighbourIds = galaxy.graph.lanes
    .map(([a, b]) => a === home ? b : b === home ? a : null)
    .filter(Boolean);
  const targetId = neighbourIds.find((id) => galaxy.systems[id]?.bodies.some((body) => body.type === 'habitable'))
    ?? neighbourIds[0];
  const targetSystem = galaxy.systems[targetId];
  if (!targetSystem.bodies.some((body) => body.type === 'habitable')) {
    const template = galaxy.systems[home].bodies.find((body) => body.type === 'habitable');
    targetSystem.bodies = [{ ...structuredClone(template), id: 'test-drone-world' }];
  }
  targetSystem.owner = 'player';
  targetSystem.star.kind = 'yellow';
  targetSystem.dyson.disabled = false;
  targetSystem.dyson.disabledReason = null;
  window.__forceResearch('eco_surveyor');
  window.__forceResearch('eco_construction_drones');
  window.__forceResearch('eco_outpost_2');
  window.__forceResearch('res_lab_1');
  window.__forceResearch('mega_foundry_unlock');
  const star = galaxy.graph.stars.find((entry) => entry.id === targetId);
  return { targetId, targetName: targetSystem.name, star };
});
check('claimed remote target exists', !!target.targetId, target.targetName ?? '');

// A real map click selects the target. Centering the galaxy camera makes the
// target star land at the center of the canvas for a stable browser click.
await page.evaluate(({ star }) => {
  window.__setView('galaxy');
  window.__snapGalaxyCamera(star.x, star.y, 1);
}, target);
const canvas = page.locator('#game-canvas');
const box = await canvas.boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForSelector('#builder-drone-galaxy-panel:not(.hidden)');
const deployButton = page.locator('#builder-drone-deploy-btn');
check('map target deploy button is enabled for claimed system', await deployButton.isEnabled());
await deployButton.click();
let droneState = await page.evaluate(() => window.__listBuilderDrones());
check('deploy button sends a drone into transit', droneState.drones.some((drone) => drone.status === 'outbound'));

await page.evaluate(() => {
  window.getGameState().time += 120000;
  window.advanceTime(250);
});
droneState = await page.evaluate(() => window.__listBuilderDrones());
check('deployed drone arrives and stations at target', droneState.drones.some((drone) => drone.status === 'idle' && drone.systemId === target.targetId));

await page.evaluate((targetId) => {
  window.__targetForTest = targetId;
  window.__viewSystem(targetId);
  const state = window.getGameState();
  const planet = state.galaxies[state.activeGalaxyId].systems[targetId].bodies.find((body) => body.type === 'habitable');
  window.__selectPlanet(planet.id);
}, target.targetId);
await page.waitForFunction(() => [...document.querySelectorAll('button')].some((button) => button.textContent.includes('Assign Drone: Sail Foundry')));
const foundryButton = page.getByRole('button', { name: /Assign Drone: Sail Foundry/ });
check('assigned-drone Sail Foundry button is enabled', await foundryButton.isEnabled());
await foundryButton.click();
droneState = await page.evaluate(() => window.__listBuilderDrones());
check('Sail Foundry button starts the stationed drone', droneState.drones.some((drone) => drone.status === 'building' && drone.buildType === 'sail_foundry'));

await page.evaluate(() => {
  window.getGameState().time += 30000;
  window.advanceTime(250);
});
const foundryBuilt = await page.evaluate((targetId) => {
  const state = window.getGameState();
  return state.galaxies[state.activeGalaxyId].systems[targetId].structures.some((structure) => structure.type === 'sail_foundry');
}, target.targetId);
check('stationed drone completes Sail Foundry construction', foundryBuilt);

await page.evaluate(() => window.__forceResearch('mega_sail_weave'));
await page.evaluate(() => window.__forceResearch('mega_foundry_2'));
await page.evaluate(() => window.__forceResearch('mega_launcher_unlock'));
await page.waitForFunction(() => [...document.querySelectorAll('button')].some((button) => button.textContent.includes('Assign Drone: Dyson Launcher')));
const launcherButton = page.getByRole('button', { name: /Assign Drone: Dyson Launcher/ });
check('assigned-drone Dyson Launcher button is enabled', await launcherButton.isEnabled());
await launcherButton.click({ force: true, timeout: 5000 });
droneState = await page.evaluate(() => window.__listBuilderDrones());
check('Dyson Launcher button starts the stationed drone', droneState.drones.some((drone) => drone.status === 'building' && drone.buildType === 'dyson_launcher'));
await page.evaluate(() => {
  window.getGameState().time += 30000;
  window.advanceTime(250);
});
const launcherBuilt = await page.evaluate((targetId) => {
  const state = window.getGameState();
  return state.galaxies[state.activeGalaxyId].systems[targetId].structures.some((structure) => structure.type === 'dyson_launcher');
}, target.targetId);
check('stationed drone completes Dyson Launcher construction', launcherBuilt);

await page.screenshot({ path: 'output/web-game/progressable-tech-drones.png', fullPage: true });
check('no browser console errors', errors.length === 0, errors.join('\n'));

await browser.close();
if (checks.some((entry) => !entry.ok)) process.exitCode = 1;
