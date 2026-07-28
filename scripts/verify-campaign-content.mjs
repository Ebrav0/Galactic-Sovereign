#!/usr/bin/env node
/**
 * Victory + campaign content — unit checks for Dominion, Economic, missions, coop allow-list.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  VICTORY_DOMINION_THRESHOLD,
  VICTORY_ECONOMIC_CREDITS,
  VICTORY_ECONOMIC_SOLARII,
  VICTORY_ECONOMIC_DEPOTS,
  VICTORY_SCULPTOR_ACTIONS,
  HERO_FLAGSHIP_COST_CREDITS,
  HERO_FLAGSHIP_COST_SOLARII,
} from '../src/js/constants.js';
import {
  campaignSummary,
  checkVictory,
  setVictoryType,
  dominionProgress,
  economicProgress,
} from '../src/js/campaign.js';
import { createNewGame } from '../src/js/state.js';
import {
  setGalaxyCountForTests,
  getSystems,
  wormholeIdForGalaxy,
} from '../src/js/galaxy-scope.js';
import { setGalaxyStarCountForTests, BLACK_HOLE_ID } from '../src/js/galaxy.js';
import { registerExportDepot } from '../src/js/logistics.js';
import { startMission, advanceMissionObjective, MISSIONS, DYSON_DEFENSE_MIN_SHELLS, evaluateActiveMission, homeGalaxyDominionProgress } from '../src/js/missions.js';
import { ensureDyson } from '../src/js/state.js';
import { step } from '../src/js/simulation.js';
import {
  orderWormholeTravel,
  tickWormholeTransit,
  buildWormholeAnchor,
} from '../src/js/wormholes.js';
import { buildHeroFlagship } from '../src/js/hero-flagships.js';
import { ensureSuperweapon } from '../src/js/superweapon.js';
import { ensureResearchState } from '../src/js/research.js';
import { applyTechEffect } from '../src/js/tech-web.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = JSON.parse(
  fs.readFileSync(path.join(root, 'scripts/fixtures/campaign-content.json'), 'utf8'),
);

function freshState(seed = 270726) {
  setGalaxyCountForTests(2);
  setGalaxyStarCountForTests(20);
  return createNewGame(seed);
}

function claimSystems(state, count) {
  const systems = getSystems(state);
  const ids = Object.keys(systems).filter((id) => id !== BLACK_HOLE_ID);
  let claimed = 0;
  for (const id of ids) {
    if (claimed >= count) break;
    systems[id].owner = 'player';
    claimed += 1;
  }
  // Count stronghold if already player
  const strongholdOwned = systems[state.stronghold]?.owner === 'player' ? 1 : 0;
  return claimed + (ids.includes(state.stronghold) ? 0 : strongholdOwned);
}

function unlockHeroBuild(state) {
  ensureSuperweapon(state);
  ensureResearchState(state);
  const systems = getSystems(state);
  const stronghold = systems[state.stronghold];
  stronghold.structures ??= [];
  if (!stronghold.structures.some((s) => s.type === 'helioclast_shipyard' || s.type === 'superweapon_cradle')) {
    stronghold.structures.push({
      id: 'test-helioclast-shipyard',
      type: 'helioclast_shipyard',
      bodyId: null,
      builtAtTime: 0,
    });
  }
  state.superweapon.cradleSystemId = state.stronghold;
  state.superweapon.installedParts = {
    power: { installedAt: 0 },
    focus: { installedAt: 0 },
    create: { installedAt: 0 },
  };
  state.superweapon.online = true;
  if (!state.research.unlocked.includes('hero_hull_unlock')) {
    state.research.unlocked.push('hero_hull_unlock');
    applyTechEffect(state, 'hero_hull_unlock');
  }
  state.credits = Math.max(state.credits, HERO_FLAGSHIP_COST_CREDITS + 100);
  state.solarii = Math.max(state.solarii ?? 0, HERO_FLAGSHIP_COST_SOLARII + 1);
}

// --- Fixture freeze ---
assert.equal(fixture.thresholds.VICTORY_DOMINION_THRESHOLD, VICTORY_DOMINION_THRESHOLD);
assert.equal(fixture.thresholds.VICTORY_ECONOMIC_CREDITS, VICTORY_ECONOMIC_CREDITS);
assert.equal(fixture.thresholds.VICTORY_ECONOMIC_SOLARII, VICTORY_ECONOMIC_SOLARII);
assert.equal(fixture.thresholds.VICTORY_ECONOMIC_DEPOTS, VICTORY_ECONOMIC_DEPOTS);
assert.equal(fixture.thresholds.VICTORY_SCULPTOR_ACTIONS, VICTORY_SCULPTOR_ACTIONS);
assert.deepEqual(fixture.missions.wormhole_race.objectives, ['enter_wormhole']);
assert.deepEqual(fixture.missions.first_hero.objectives, ['build_hero']);
assert.deepEqual(fixture.missions.dyson_defense.objectives, ['hold_dyson']);
assert.deepEqual(fixture.missions.final_dominion.objectives, ['dominion']);
assert.equal(fixture.thresholds.DYSON_DEFENSE_MIN_SHELLS, DYSON_DEFENSE_MIN_SHELLS);
assert.ok(MISSIONS.wormhole_race);
assert.ok(MISSIONS.first_hero);
assert.ok(MISSIONS.dyson_defense);
assert.ok(MISSIONS.final_dominion);
assert.match(fixture.wormholeSettleHook, /tickShipWormholeTransit/);
assert.match(fixture.missionEvalHook, /evaluateActiveMission/);
assert.deepEqual(fixture.titleMissions, ['wormhole_race', 'dyson_defense', 'first_hero', 'final_dominion']);

// --- Dominion ---
{
  const state = freshState();
  setVictoryType(state, 'dominion', 'campaign');
  const progress = dominionProgress(state);
  assert.equal(state.campaign.mode, 'campaign');
  assert.equal(checkVictory(state), null, 'below threshold must not win');

  claimSystems(state, progress.systemThreshold);
  const win = checkVictory(state);
  assert.equal(win?.type, 'victory');
  assert.equal(win?.victoryType, 'dominion');
  assert.equal(win?.path, 'systems');
  assert.equal(state.campaign.won, true);
  const latched = checkVictory(state);
  assert.equal(latched?.victoryType, 'dominion');
}

{
  const state = freshState();
  setVictoryType(state, 'dominion', 'campaign');
  // Keep systems below threshold; win via anchors.
  const systems = getSystems(state);
  for (const sys of Object.values(systems)) {
    if (sys.id !== state.stronghold) sys.owner = 'neutral';
  }
  const homeWh = wormholeIdForGalaxy(state.activeGalaxyId);
  const targetGal = Object.keys(state.galaxies).find((id) => id !== state.activeGalaxyId);
  const toWh = wormholeIdForGalaxy(targetGal);
  state.wormholes[homeWh].anchor = toWh;
  state.wormholes[toWh].anchor = homeWh;
  state.wormholes[homeWh].anchorOwner = 'player';
  state.wormholes[toWh].anchorOwner = 'player';
  const dp = dominionProgress(state);
  assert.ok(dp.totalAnchors >= 2);
  assert.ok(dp.playerSystems < dp.systemThreshold, 'systems must stay below threshold');
  assert.equal(dp.anchorsMet, true);
  const win = checkVictory(state);
  assert.equal(win?.path, 'anchors');
  assert.equal(win?.victoryType, 'dominion');
}

{
  const state = freshState();
  setVictoryType(state, 'dominion', 'campaign');
  assert.equal(dominionProgress(state).totalAnchors, 0);
  assert.equal(checkVictory(state), null, 'no anchors + below systems = no win');
}

{
  const state = freshState();
  setVictoryType(state, 'sandbox', 'sandbox');
  claimSystems(state, 999);
  assert.equal(checkVictory(state), null, 'sandbox never wins');
}

{
  const state = freshState();
  setVictoryType(state, 'dominion', 'campaign');
  const summary = campaignSummary(state);
  assert.ok(summary.dominionProgress);
  assert.equal(typeof summary.dominionProgress.playerSystems, 'number');
  assert.equal(typeof summary.dominionProgress.systemThreshold, 'number');
  assert.equal(typeof summary.dominionProgress.playerAnchors, 'number');
  assert.equal(typeof summary.dominionProgress.anchorThreshold, 'number');
  assert.equal(typeof summary.dominionProgress.totalAnchors, 'number');
}

// --- Economic ---
{
  const state = freshState();
  setVictoryType(state, 'economic', 'campaign');
  state.credits = VICTORY_ECONOMIC_CREDITS;
  state.solarii = VICTORY_ECONOMIC_SOLARII;
  assert.equal(checkVictory(state), null, 'currencies alone must not win');
  const ep = economicProgress(state);
  assert.equal(ep.depotsMet, false);
  assert.ok(ep.depots < VICTORY_ECONOMIC_DEPOTS);
}

{
  const state = freshState();
  setVictoryType(state, 'economic', 'campaign');
  state.credits = VICTORY_ECONOMIC_CREDITS;
  state.solarii = VICTORY_ECONOMIC_SOLARII;
  const systems = getSystems(state);
  const ids = Object.keys(systems).filter((id) => id !== BLACK_HOLE_ID).slice(0, 3);
  assert.ok(ids.length >= 3);
  for (const id of ids) {
    systems[id].owner = 'player';
    const res = registerExportDepot(state, state.activeGalaxyId, id, { force: true });
    assert.equal(res.ok, true, res.reason);
  }
  assert.equal(economicProgress(state).depots, 3);
  const win = checkVictory(state);
  assert.equal(win?.victoryType, 'economic');
  assert.equal(state.campaign.won, true);
}

{
  const state = freshState();
  setVictoryType(state, 'economic', 'campaign');
  const systems = getSystems(state);
  const ids = Object.keys(systems).filter((id) => id !== BLACK_HOLE_ID).slice(0, 3);
  for (const id of ids) {
    systems[id].owner = 'player';
    registerExportDepot(state, state.activeGalaxyId, id, { force: true });
  }
  state.credits = 0;
  state.solarii = 0;
  assert.equal(checkVictory(state), null, 'depots without currencies must not win');
}

{
  const state = freshState();
  setVictoryType(state, 'economic', 'campaign');
  const summary = campaignSummary(state);
  assert.ok(summary.economicProgress);
  assert.equal(summary.economicProgress.creditsNeed, VICTORY_ECONOMIC_CREDITS);
  assert.equal(summary.economicProgress.solariiNeed, VICTORY_ECONOMIC_SOLARII);
  assert.equal(summary.economicProgress.depotsNeed, VICTORY_ECONOMIC_DEPOTS);
}

// --- Missions: wormhole race ---
{
  const state = freshState();
  state.flagship.systemId = BLACK_HOLE_ID;
  state.flagship.x = 0;
  state.flagship.y = 0;
  const order = orderWormholeTravel(state, { tutorialBypass: true });
  assert.equal(order.ok, true, order.reason);
  assert.equal(order.unanchored, true);
  state.time = state.flagship.wormholeTransit.startTime + state.flagship.wormholeTransit.durationMs;
  const arrival = tickWormholeTransit(state);
  assert.ok(arrival);
  assert.equal(state.campaign.activeMissionId, null);
  assert.equal(arrival.mission, null);
}

{
  const state = freshState();
  startMission(state, 'wormhole_race', { tutorialBypass: true });
  assert.equal(state.campaign.activeMissionId, 'wormhole_race');
  state.flagship.systemId = BLACK_HOLE_ID;
  const order = orderWormholeTravel(state, { tutorialBypass: true });
  assert.equal(order.ok, true, order.reason);
  assert.equal(order.unanchored, true);
  state.time = state.flagship.wormholeTransit.startTime + state.flagship.wormholeTransit.durationMs;
  const arrival = tickWormholeTransit(state);
  assert.equal(arrival?.mission?.complete, true);
  assert.ok(state.campaign.completedMissions.includes('wormhole_race'));
  assert.equal(state.campaign.activeMissionId, null);
}

{
  const state = freshState();
  startMission(state, 'wormhole_race', { tutorialBypass: true });
  state.credits = 1_000_000;
  state.flagship.systemId = BLACK_HOLE_ID;
  const targetGal = Object.keys(state.galaxies).find((id) => id !== state.activeGalaxyId);
  assert.equal(buildWormholeAnchor(state, targetGal, { tutorialBypass: true }).ok, true);
  const order = orderWormholeTravel(state, { forceAnchored: true, tutorialBypass: true });
  assert.equal(order.ok, true, order.reason);
  assert.equal(order.unanchored, false);
  state.time = state.flagship.wormholeTransit.startTime + state.flagship.wormholeTransit.durationMs;
  const arrival = tickWormholeTransit(state);
  assert.equal(arrival?.mission, null);
  assert.equal(state.campaign.activeMissionId, 'wormhole_race');
  assert.equal(state.campaign.missionProgress.wormhole_race?.enter_wormhole, undefined);
}

// --- Missions: first hero ---
{
  const state = freshState();
  unlockHeroBuild(state);
  const inactive = buildHeroFlagship(state, null, { tutorialBypass: true });
  assert.equal(inactive.ok, true, inactive.reason);
  assert.equal(inactive.mission, null);
}

{
  const state = freshState();
  startMission(state, 'first_hero', { tutorialBypass: true });
  unlockHeroBuild(state);
  const built = buildHeroFlagship(state, null, { tutorialBypass: true });
  assert.equal(built.ok, true, built.reason);
  assert.equal(built.mission?.complete, true);
  assert.ok(state.campaign.completedMissions.includes('first_hero'));
  assert.equal(state.campaign.activeMissionId, null);
}

{
  const state = freshState();
  startMission(state, 'first_hero', { tutorialBypass: true });
  unlockHeroBuild(state);
  state.credits = 0;
  const failed = buildHeroFlagship(state, null, { tutorialBypass: true });
  assert.equal(failed.ok, false);
  assert.equal(state.campaign.missionProgress.first_hero?.build_hero, undefined);
  assert.equal(state.campaign.activeMissionId, 'first_hero');
}

// advance helper clears active on complete
{
  const state = freshState();
  startMission(state, 'wormhole_race', { tutorialBypass: true });
  const res = advanceMissionObjective(state, 'wormhole_race', 'enter_wormhole');
  assert.equal(res.complete, true);
  assert.equal(state.campaign.activeMissionId, null);
}

// --- Missions: dyson defense ---
{
  const state = freshState();
  startMission(state, 'dyson_defense', { tutorialBypass: true });
  assert.equal(state.campaign.activeMissionId, 'dyson_defense');
  assert.equal(evaluateActiveMission(state), null, 'no 4-shell system yet');
  const systems = getSystems(state);
  const stronghold = systems[state.stronghold];
  const dyson = ensureDyson(stronghold);
  dyson.completedShells = DYSON_DEFENSE_MIN_SHELLS - 1;
  assert.equal(evaluateActiveMission(state), null, '3 shells must not complete');
  dyson.completedShells = DYSON_DEFENSE_MIN_SHELLS;
  const done = evaluateActiveMission(state);
  assert.equal(done?.complete, true);
  assert.ok(state.campaign.completedMissions.includes('dyson_defense'));
  assert.equal(state.campaign.activeMissionId, null);
}

{
  const state = freshState();
  const systems = getSystems(state);
  ensureDyson(systems[state.stronghold]).completedShells = DYSON_DEFENSE_MIN_SHELLS;
  // Already held when mission starts — should complete immediately.
  startMission(state, 'dyson_defense', { tutorialBypass: true });
  assert.ok(state.campaign.completedMissions.includes('dyson_defense'));
  assert.equal(state.campaign.activeMissionId, null);
}

{
  const state = freshState();
  startMission(state, 'dyson_defense', { tutorialBypass: true });
  ensureDyson(getSystems(state)[state.stronghold]).completedShells = DYSON_DEFENSE_MIN_SHELLS;
  const events = step(state, 50);
  assert.ok(
    (events.campaignEvents ?? []).some((ev) => ev.type === 'mission_complete' && ev.missionId === 'dyson_defense'),
    'simulation tick must surface mission_complete',
  );
}

// --- Missions: final dominion (home galaxy) ---
{
  const state = freshState();
  startMission(state, 'final_dominion', { tutorialBypass: true });
  const progress = homeGalaxyDominionProgress(state);
  assert.equal(progress.systemsMet, false);
  assert.equal(evaluateActiveMission(state), null);
  claimSystems(state, progress.systemThreshold);
  const done = evaluateActiveMission(state);
  assert.equal(done?.complete, true);
  assert.equal(done?.objectiveId, 'dominion');
  assert.ok(state.campaign.completedMissions.includes('final_dominion'));
  assert.equal(state.campaign.activeMissionId, null);
}

{
  const state = freshState();
  // Owning only the stronghold must stay below the home-galaxy dominion threshold.
  startMission(state, 'final_dominion', { tutorialBypass: true });
  const homeProgress = homeGalaxyDominionProgress(state);
  assert.ok(homeProgress.playerSystems < homeProgress.systemThreshold);
  assert.equal(evaluateActiveMission(state), null);
}

// --- Co-op actions allow-list ---
{
  const actionsSrc = fs.readFileSync(path.join(root, 'server/actions.mjs'), 'utf8');
  for (const action of fixture.coopActionsRequired) {
    assert.match(actionsSrc, new RegExp(`['"]${action}['"]`), `actions.mjs must allow ${action}`);
    assert.match(actionsSrc, new RegExp(`case '${action}'`), `actions.mjs must dispatch ${action}`);
  }
  assert.match(actionsSrc, /buildHeroFlagship/, 'host imports buildHeroFlagship');
}

// --- HTML labels ---
{
  const html = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
  assert.match(html, /Dominion \(35% systems or anchored wormholes\)/);
  assert.match(html, /Economic \(50k cr \+ 50 Solarii \+ 3 Export Depots\)/);
  assert.match(html, /id="new-game-mission"/);
  assert.match(html, /value="wormhole_race"/);
  assert.match(html, /value="dyson_defense"/);
  assert.match(html, /value="first_hero"/);
  assert.match(html, /value="final_dominion"/);
}

// Reset overrides so other scripts in the same process are unaffected
setGalaxyCountForTests(null);
setGalaxyStarCountForTests(null);

console.log('verify:campaign-content passed', {
  dominionThreshold: VICTORY_DOMINION_THRESHOLD,
  economicDepots: VICTORY_ECONOMIC_DEPOTS,
  titleMissions: fixture.titleMissions,
});
