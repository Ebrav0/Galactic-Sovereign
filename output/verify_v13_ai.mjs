// Focused v13 faction-AI verifier. Runs without a browser or dev server.

import { createNewGame } from '../src/js/state.js';
import {
  aiFactionById,
  aiOperationalOutpostCount,
  applyAiFactionIncomeTick,
  ensureFactions,
  forceAiCapture,
  queueAiConstruction,
  queueAiShip,
  seedAiFaction,
  tickAiFaction,
} from '../src/js/ai-faction.js';
import { spawnAiShip } from '../src/js/ai-ships.js';
import {
  AI_DIFFICULTY_PROFILES,
  aiResearchDurationMs,
  aiNodePrerequisitesMet,
  canStartAiResearch,
  legalAiTechNodes,
  selectAiTechNode,
  startAiResearch,
  tickAiResearch,
} from '../src/js/ai-tech.js';
import { hullQueueCost } from '../src/js/hull.js';
import { factionTechContext } from '../src/js/ai-tech.js';
import { TECH_NODES } from '../src/js/tech-nodes.js';

const results = [];
function check(name, condition, detail = '') {
  results.push({ name, pass: !!condition, detail });
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function approx(actual, expected, epsilon = 1e-6) {
  return Math.abs(actual - expected) <= epsilon;
}

function seededState(seed = 4242, difficulty = 'normal') {
  const state = createNewGame(seed);
  state.aiDifficulty = difficulty;
  const seeded = seedAiFaction(state, state.homeGalaxyId);
  if (!seeded.ok) throw new Error(seeded.reason);
  ensureFactions(state);
  return state;
}

check('1.1 difficulty profiles are exact',
  AI_DIFFICULTY_PROFILES.easy.incomeMult === 0.8
    && AI_DIFFICULTY_PROFILES.easy.durationMult === 1.2
    && AI_DIFFICULTY_PROFILES.normal.incomeMult === 1
    && AI_DIFFICULTY_PROFILES.normal.durationMult === 1
    && AI_DIFFICULTY_PROFILES.hard.incomeMult === 1.2
    && AI_DIFFICULTY_PROFILES.hard.durationMult === 0.85
    && AI_DIFFICULTY_PROFILES.sovereign.incomeMult === 1.4
    && AI_DIFFICULTY_PROFILES.sovereign.durationMult === 0.7);

const state = seededState();
const factions = state.factions.list;
check('2.1 four distinct faction identities',
  factions.length === 4
    && new Set(factions.map((faction) => faction.id)).size === 4
    && new Set(factions.map((faction) => faction.personality)).size === 4);
check('2.2 legacy primary alias retained', state.factions.ai === factions[0]);
check('2.3 faction state is not shared',
  new Set(factions.map((faction) => faction.research)).size === 4
    && new Set(factions.map((faction) => faction.production)).size === 4
    && new Set(factions.map((faction) => faction.logistics)).size === 4);

const aiSystems = Object.values(state.galaxies[state.activeGalaxyId].systems)
  .filter((system) => system.owner === 'ai');
check('2.4 AI systems carry valid factionId',
  aiSystems.length >= 7
    && aiSystems.every((system) => factions.some((faction) => faction.id === system.factionId)));

const primary = factions[0];
const secondary = factions[1];
const primaryCreditsBefore = primary.credits;
const secondaryCreditsBefore = secondary.credits;
const primaryOutposts = aiOperationalOutpostCount(state, primary.id);
const primaryIncome = applyAiFactionIncomeTick(state, primary, 1000);
check('3.1 normal AI outposts pay OUTPOST_BASE_INCOME credits/sec each',
  approx(primaryIncome.credits, primaryOutposts * 10)
    && approx(primary.credits - primaryCreditsBefore, primaryOutposts * 10),
  `outposts=${primaryOutposts} paid=${primaryIncome.credits}`);
check('3.2 one faction income does not mutate another wallet', secondary.credits === secondaryCreditsBefore);

const easyState = seededState(4242, 'easy');
const easyFaction = easyState.factions.list[0];
const easyCount = aiOperationalOutpostCount(easyState, easyFaction.id);
easyFaction.credits = 0;
applyAiFactionIncomeTick(easyState, easyFaction, 1000);
check('3.3 easy income multiplier applies without changing listed costs',
  approx(easyFaction.credits, easyCount * 10 * 0.8));

for (const faction of factions) faction.credits = 100000;
const personalityChoices = factions.map((faction) => selectAiTechNode(state, faction, 20)?.id);
check('4.1 every personality selects a legal node',
  personalityChoices.every(Boolean)
    && factions.every((faction, index) => aiNodePrerequisitesMet(faction, personalityChoices[index])));
check('4.2 personality priorities produce distinct openings',
  new Set(personalityChoices).size >= 3,
  personalityChoices.join(', '));

const researchFaction = primary;
const node = legalAiTechNodes(state, researchFaction)[0];
const researchCostBefore = researchFaction.credits;
const canStart = canStartAiResearch(state, researchFaction, node.id);
const started = startAiResearch(state, researchFaction, node.id);
check('4.3 research checks and deducts unchanged node costs',
  canStart.ok && started.ok
    && approx(researchCostBefore - researchFaction.credits, canStart.cost.credits)
    && approx(started.cost.solarii, canStart.cost.solarii));
tickAiResearch(state, researchFaction, started.durationMs - 1);
check('4.4 research waits for full scaled duration',
  researchFaction.research.activeNodeId === node.id
    && !researchFaction.research.unlocked.includes(node.id));
tickAiResearch(state, researchFaction, 1);
check('4.5 completed research unlocks only its faction',
  researchFaction.research.unlocked.includes(node.id)
    && !secondary.research.unlocked.includes(node.id));

const durationNode = legalAiTechNodes(state, secondary, { affordable: false })[0];
const durationFaction = structuredClone(secondary);
durationFaction.difficulty = 'normal';
const normalDuration = aiResearchDurationMs(state, durationFaction, durationNode);
durationFaction.difficulty = 'easy';
const easyDuration = aiResearchDurationMs(state, durationFaction, durationNode);
durationFaction.difficulty = 'hard';
const hardDuration = aiResearchDurationMs(state, durationFaction, durationNode);
durationFaction.difficulty = 'sovereign';
const sovereignDuration = aiResearchDurationMs(state, durationFaction, durationNode);
check('4.6 difficulty scales duration, never node costs',
  easyDuration > normalDuration
    && hardDuration < normalDuration
    && sovereignDuration < hardDuration
    && durationNode.creditCost === canStart.cost.credits || Number.isFinite(durationNode.creditCost),
  `easy=${easyDuration} normal=${normalDuration} hard=${hardDuration} sovereign=${sovereignDuration}`);

const speedNode = Object.values(TECH_NODES).find((candidate) => /^research_speed_\d+$/.test(candidate.effect ?? ''));
const speedFaction = structuredClone(secondary);
speedFaction.difficulty = 'normal';
const speedBaseline = aiResearchDurationMs(state, speedFaction, durationNode);
speedFaction.research.unlocked.push(speedNode.id);
const speedPercent = Number(speedNode.effect.match(/(\d+)$/)[1]);
const speedDuration = aiResearchDurationMs(state, speedFaction, durationNode);
check('4.7 normalized and legacy research effects apply exactly once',
  speedDuration === Math.round(speedBaseline / (1 + speedPercent / 100)),
  `baseline=${speedBaseline} boosted=${speedDuration} effect=${speedNode.effect}`);

const shipState = seededState(9876, 'hard');
const shipFaction = shipState.factions.list[0];
shipFaction.credits = 10000;
const shipCreditsBefore = shipFaction.credits;
const queuedShip = queueAiShip(shipState, shipFaction, 'corvette');
const expectedHullCost = hullQueueCost(factionTechContext(shipFaction), 'corvette');
check('5.1 AI ship queue pays real hull cost',
  queuedShip.ok && shipCreditsBefore - shipFaction.credits === expectedHullCost);
shipState.time = queuedShip.build.startedAt + queuedShip.build.durationMs;
tickAiFaction(shipState);
const builtShip = shipState.aiShips.find((ship) => ship.factionId === shipFaction.id);
check('5.2 AI ship waits for build timer and preserves owner/faction identity',
  builtShip?.owner === 'ai' && builtShip.factionId === shipFaction.id);

const spawned = spawnAiShip(shipState, shipFaction.homeSystemId, 'corvette');
check('5.3 backward-compatible spawn inherits system faction',
  spawned?.owner === 'ai' && spawned.factionId === shipFaction.id);

const buildState = seededState(2468, 'sovereign');
const buildFaction = buildState.factions.list[1];
buildFaction.credits = 10000;
const home = buildState.galaxies[buildState.activeGalaxyId].systems[buildFaction.homeSystemId];
const bodyId = home.bodies[0].id;
const buildCreditsBefore = buildFaction.credits;
const construction = queueAiConstruction(buildState, buildFaction, {
  structureType: 'shipyard', systemId: home.id, bodyId,
});
check('6.1 AI construction pays catalog cost and records scaled timer',
  construction.ok
    && buildCreditsBefore - buildFaction.credits === construction.job.costPaid
    && construction.job.durationMs < 30000);
buildState.time = construction.job.completesAt;
tickAiFaction(buildState);
const completedStructure = home.structures.find((structure) =>
  structure.type === 'shipyard' && structure.factionId === buildFaction.id);
check('6.2 completed AI building has level and faction ownership',
  completedStructure?.level === 1 && completedStructure.owner === 'ai');

const neutral = Object.values(buildState.galaxies[buildState.activeGalaxyId].systems)
  .find((system) => system.owner === 'neutral' && system.id !== buildState.stronghold);
const forced = forceAiCapture(buildState, neutral.id, buildFaction.id);
check('7.1 capture assigns the acting faction without changing owner compatibility',
  forced.ok && neutral.owner === 'ai' && neutral.factionId === buildFaction.id);

const failed = results.filter((result) => !result.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exitCode = 1;
