import assert from 'node:assert/strict';

import { SAVE_VERSION } from '../src/js/constants.js';
import { seedAiFaction, tickAiFaction } from '../src/js/ai-faction.js';
import { spawnAiShip } from '../src/js/ai-ships.js';
import { createNewGame } from '../src/js/state.js';
import { crc32, deserialize, serialize } from '../src/js/save.js';
import {
  AGREEMENT_ALLIANCE,
  AGREEMENT_DEFENSE,
  AGREEMENT_TRADE,
  CONTACT_CONTACTED,
  CONTACT_DETECTED,
  DIPLOMACY_SCHEMA_VERSION,
  addActorRelationshipModifier,
  addGrievance,
  castCouncilVote,
  councilAuthority,
  createAgreement,
  createClaim,
  declareWar,
  detectContact,
  diplomaticRevision,
  endAgreement,
  ensureDiplomacy,
  escalateWar,
  escalateHelioclastCrisis,
  getActorRelation,
  peaceLeverage,
  concludePeace,
  previewProposal,
  proposeCouncilResolution,
  resolveCouncilResolution,
  respondToCallToArms,
  sanctionEffects,
  settleDiplomaticTradeDelivery,
  submitProposal,
  tickDiplomacy,
} from '../src/js/diplomacy.js';

function game(seed = 20250719) {
  const state = createNewGame(seed);
  seedAiFaction(state, state.homeGalaxyId);
  ensureDiplomacy(state);
  state.paused = false;
  return state;
}

function advanceDiplomacy(state, milliseconds) {
  state.time += milliseconds;
  return tickDiplomacy(state);
}

const state = game();
const factions = state.factions.list.slice().sort((a, b) => a.id.localeCompare(b.id));
assert.equal(factions.length, 4, 'four major AI factions remain the default');
assert.equal(DIPLOMACY_SCHEMA_VERSION, 3);
assert.equal(SAVE_VERSION, 25);
assert.equal(Object.keys(state.diplomacy.pairRelations).length, 10, 'five actors produce ten unordered relationship pairs');

const rawPreviewState = createNewGame(55);
seedAiFaction(rawPreviewState, rawPreviewState.homeGalaxyId);
const rawPreviewBefore = JSON.stringify(rawPreviewState);
previewProposal(rawPreviewState, {
  from: 'player', to: rawPreviewState.factions.list[0].id,
  terms: [{ type: 'resource', resource: 'credits', amount: 1, from: 'player', to: rawPreviewState.factions.list[0].id }],
});
assert.equal(JSON.stringify(rawPreviewState), rawPreviewBefore, 'preview is pure even before diplomacy normalization');

const first = factions[0];
const unknownAttempt = submitProposal(state, {
  from: 'player', to: first.id,
  terms: [{ type: 'resource', resource: 'credits', amount: 10, from: 'player', to: first.id }],
});
assert.equal(unknownAttempt.ok, false, 'unknown factions cannot receive proposals');
assert.equal(detectContact(state, first.id, { trigger: 'verification' }).stage, CONTACT_DETECTED);
assert.equal(state.diplomacy.contacts[first.id].stage, CONTACT_DETECTED);

const beforePreview = JSON.stringify(state);
const preview = previewProposal(state, {
  from: 'player', to: first.id,
  terms: [{ type: 'resource', resource: 'credits', amount: 50, from: 'player', to: first.id }],
});
assert.equal(preview.ok, true);
assert.equal(JSON.stringify(state), beforePreview, 'previewing a deal never mutates live state');

state.diplomacy.contacts[first.id].stage = CONTACT_CONTACTED;
state.diplomacy.contacts[first.id].intelligence = 30;
const lowIntel = previewProposal(state, {
  from: 'player', to: first.id,
  terms: [{ type: 'resource', resource: 'credits', amount: 50, from: 'player', to: first.id }],
});
state.diplomacy.contacts[first.id].intelligence = 90;
const highIntel = previewProposal(state, {
  from: 'player', to: first.id,
  terms: [{ type: 'resource', resource: 'credits', amount: 50, from: 'player', to: first.id }],
});
assert.ok((lowIntel.scoreRange[1] - lowIntel.scoreRange[0]) > (highIntel.scoreRange[1] - highIntel.scoreRange[0]), 'intelligence narrows forecasts');

const alliancePreview = previewProposal(state, {
  from: 'player', to: first.id,
  terms: [{ type: 'agreement', agreementType: AGREEMENT_ALLIANCE, bypassTech: true }],
});
assert.match(alliancePreview.hardBlock, /50 trust/, 'alliances enforce the trust gate');

state.research.unlocked.push('dip_truce_protocol', 'dip_trade_charter', 'dip_embassy_network', 'dip_embassy_complex', 'dip_alliance_pact', 'dip_galactic_council');
state.milestones.diplomacyUnlocked = true;
const creditsBefore = state.credits;
const trade = submitProposal(state, {
  from: 'player', to: first.id,
  terms: [{ type: 'agreement', agreementType: AGREEMENT_TRADE }],
}, { autoResolve: true });
assert.equal(trade.ok, true);
assert.equal(trade.proposal.status, 'accepted');
assert.equal(creditsBefore - state.credits, trade.applied.administrativeCost.credits, 'accepted treaty cost is charged exactly once');
const creditsAfter = state.credits;
previewProposal(state, { from: 'player', to: first.id, terms: [{ type: 'agreement', agreementType: AGREEMENT_TRADE }] });
assert.equal(state.credits, creditsAfter, 'preview does not charge accepted-deal costs');

const recipientCredits = first.credits;
const delivery = settleDiplomaticTradeDelivery(state, { from: 'player', to: first.id, baseValue: 100 });
assert.equal(delivery.value, 120, 'trade adds twenty percent delivery value');
assert.equal(delivery.partnerShare, 10, 'trade pays ten percent of base value to partner');
assert.equal(first.credits, recipientCredits + 10);

const second = factions[1];
const third = factions[2];
const aiWalletBefore = second.credits;
const playerWalletBefore = state.credits;
const aiDeal = submitProposal(state, {
  from: second.id, to: third.id,
  terms: [{ type: 'resource', resource: 'credits', amount: 25, from: second.id, to: third.id }],
}, { autoResolve: true });
assert.equal(aiDeal.ok, true, 'AI factions negotiate through the shared proposal engine');
if (aiDeal.proposal?.status === 'accepted') assert.equal(second.credits, aiWalletBefore - 25);
assert.equal(state.credits, playerWalletBefore, 'AI-to-AI deals never use the player wallet');
assert.ok(getActorRelation(state, second.id, third.id));

addActorRelationshipModifier(state, second.id, third.id, { source: 'verification', label: 'verification trust', trust: 80, opinion: 30 });
const defense = createAgreement(state, { type: AGREEMENT_DEFENSE, parties: [second.id, third.id] }, { bypassTech: true });
assert.equal(defense.ok, true);
const war = declareWar(state, { attacker: first.id, defender: second.id, goals: [{ type: 'border_security', systemIds: [] }], force: true });
assert.equal(war.ok, true);
const call = state.diplomacy.callsToArms.find((entry) => entry.warId === war.war.id && entry.ally === third.id);
assert.ok(call, 'defensive agreements issue mandatory calls-to-arms');
assert.ok(Number.isFinite(call.expiresAt) && call.expiresAt > state.time, 'defensive calls have a finite response deadline');
assert.equal(respondToCallToArms(state, call.id, true, third.id).accepted, true);
assert.ok(war.war.defenders.includes(third.id));

const breachAgreement = createAgreement(state, { type: AGREEMENT_TRADE, parties: [second.id, third.id] }, { bypassTech: true });
const reputationBefore = state.diplomacy.profiles[second.id].reputation;
endAgreement(state, breachAgreement.agreement.id, { reason: 'verification_breach', breachedBy: second.id });
assert.equal(state.diplomacy.profiles[second.id].reputation, reputationBefore - 25);
assert.ok(state.diplomacy.grievances.some((entry) => entry.aggrieved === third.id && entry.against === second.id));

assert.ok(peaceLeverage(state, war.war.id, second.id) >= 0);
const coalitionPeace = concludePeace(state, war.war.id, {
  proposer: second.id,
  force: true,
  truceMs: 180000,
});
assert.equal(coalitionPeace.ok, true, 'multi-party defensive wars conclude atomically');
assert.equal(coalitionPeace.truces.length, 2, 'peace creates an enforceable truce across every opposing pair');
assert.equal(war.war.status, 'ended');
assert.ok(councilAuthority(state, 'player') >= 1 && councilAuthority(state, 'player') <= 12);
const resolution = proposeCouncilResolution(state, {
  proposer: 'player', target: first.id, type: 'sanction', votingDurationMs: 1000,
});
assert.equal(resolution.ok, true);
const loneVote = proposeCouncilResolution(state, {
  proposer: 'player', target: second.id, type: 'condemnation', votingDurationMs: 60000,
});
assert.equal(resolveCouncilResolution(state, loneVote.resolution.id, { force: true }).resolution.passed, false,
  'a single player vote cannot carry the weighted council');
for (const faction of factions) castCouncilVote(state, resolution.resolution.id, faction.id, 'yes');
advanceDiplomacy(state, 1000);
assert.notEqual(resolution.resolution.status, 'voting');
assert.equal(resolution.resolution.passed, true);
assert.equal(sanctionEffects(state, first.id).tradeRevenueMultiplier, 0.7);
advanceDiplomacy(state, 300000);
assert.equal(sanctionEffects(state, first.id).tradeRevenueMultiplier, 1, 'sanction effects restore on expiration');

const crisis1 = escalateHelioclastCrisis(state, { actor: 'player', destructive: false });
assert.ok(crisis1.crisis.level >= 1);
const crisis2 = escalateHelioclastCrisis(state, { actor: 'player', destructive: true, foreignOrInhabited: true });
assert.ok(crisis2.crisis.level >= 4, 'destructive use accelerates directly to coalition containment');

const ultimatumState = game(4422);
const ultimatumAttacker = ultimatumState.factions.list.find((entry) => entry.personality === 'expansionist');
const ultimatumDefender = ultimatumState.factions.list.find((entry) => entry.id !== ultimatumAttacker.id);
addActorRelationshipModifier(ultimatumState, ultimatumAttacker.id, ultimatumDefender.id, {
  source: 'verification_hostility', opinion: -100, trust: -100,
});
addGrievance(ultimatumState, {
  aggrieved: ultimatumAttacker.id, against: ultimatumDefender.id,
  type: 'verification', severity: 90,
});
ultimatumState.time = 10000;
const ultimatumEvents = tickDiplomacy(ultimatumState);
assert.ok(ultimatumEvents.some((entry) => entry.type === 'ai_ultimatum'));
assert.ok(ultimatumState.diplomacy.proposals.some((entry) => (
  entry.ultimatum && entry.from === ultimatumAttacker.id && entry.to === ultimatumDefender.id
)), 'hostile AI issues an enforceable ultimatum before declaring a limited war');

const betrayalState = game(9912);
const betrayer = betrayalState.factions.list[0];
const betrayed = betrayalState.factions.list[1];
const vulnerableTreaty = createAgreement(betrayalState, {
  type: AGREEMENT_TRADE, parties: [betrayer.id, betrayed.id],
}, { bypassTech: true }).agreement;
betrayalState.diplomacy.profiles[betrayer.id].reliability = 0.25;
addActorRelationshipModifier(betrayalState, betrayer.id, betrayed.id, {
  source: 'betrayal_pressure', opinion: -100, trust: -100,
});
addGrievance(betrayalState, {
  aggrieved: betrayer.id, against: betrayed.id,
  type: 'strategic_pressure', severity: 100,
});
let betrayalObserved = false;
for (let window = 1; window <= 40 && vulnerableTreaty.status === 'active'; window++) {
  betrayalState.time = window * 10000;
  betrayalObserved ||= tickDiplomacy(betrayalState).some((entry) => entry.type === 'ai_treaty_betrayal');
}
assert.equal(betrayalObserved, true, 'low-reliability AI can deliberately betray under strategic pressure');
assert.equal(vulnerableTreaty.status, 'ended');
assert.ok(betrayalState.diplomacy.grievances.some((entry) => (
  entry.type === 'treaty_breach' && entry.aggrieved === betrayed.id
)), 'AI betrayal uses the same breach consequences as the player');

const escalationState = game(7711);
escalationState.research.unlocked.push('dip_galactic_council');
const escalationActors = escalationState.factions.list.slice(0, 2);
const escalationWar = declareWar(escalationState, {
  attacker: escalationActors[0].id,
  defender: escalationActors[1].id,
  force: true,
}).war;
const reputationAtDeclaration = escalationState.diplomacy.profiles[escalationActors[0].id].reputation;
escalationState.time = 60000;
assert.equal(escalateWar(escalationState, escalationWar.id, 'expanded', { actor: escalationActors[0].id }).ok, true);
assert.equal(escalationState.diplomacy.profiles[escalationActors[0].id].reputation, reputationAtDeclaration - 10);
escalationState.time = 180000;
assert.equal(escalateWar(escalationState, escalationWar.id, 'total', { actor: escalationActors[0].id }).ok, true);
assert.equal(escalationState.diplomacy.profiles[escalationActors[0].id].reputation, reputationAtDeclaration - 35);
assert.ok(escalationState.diplomacy.council.resolutions.some((entry) => (
  entry.type === 'emergency_coalition' && entry.target === escalationActors[0].id
)), 'total war triggers a council emergency');

const rivalWarState = game(8801);
const rivalAttacker = rivalWarState.factions.list[0];
const rivalDefender = rivalWarState.factions.list[1];
const rivalTarget = Object.values(rivalWarState.galaxies[rivalWarState.activeGalaxyId].systems)
  .find((system) => system.owner === 'ai' && system.factionId === rivalDefender.id);
assert.ok(rivalTarget, 'rival defender owns a target system');
rivalWarState.aiShips = [];
const assaultFleet = Array.from({ length: 5 }, () => (
  spawnAiShip(rivalWarState, rivalTarget.id, 'dreadnought', null, { factionId: rivalAttacker.id })
));
const assaultShip = assaultFleet[0];
const defenseShip = spawnAiShip(rivalWarState, rivalTarget.id, 'corvette', null, { factionId: rivalDefender.id });
assert.ok(assaultShip && defenseShip);
defenseShip.hp = Math.min(defenseShip.hp, 20);
const rivalWar = declareWar(rivalWarState, {
  attacker: rivalAttacker.id,
  defender: rivalDefender.id,
  goals: [{ type: 'claimed_conquest', systemIds: [rivalTarget.id] }],
  force: true,
});
assert.equal(rivalWar.ok, true);
for (let step = 0; step < 800 && rivalTarget.factionId !== rivalAttacker.id; step++) {
  rivalWarState.time += 100;
  tickAiFaction(rivalWarState);
}
assert.equal(defenseShip.hp, 0, 'AI-to-AI combat inflicts physical fleet losses');
assert.equal(rivalTarget.factionId, rivalAttacker.id, 'victorious AI fleets occupy hostile AI systems');
assert.ok(rivalWarState.diplomacy.occupations.some((entry) => (
  entry.systemId === rivalTarget.id
    && entry.occupier === rivalAttacker.id
    && entry.previousActor === rivalDefender.id
)), 'AI-to-AI occupation preserves the prior sovereign for peace restoration');

const roundTrip = deserialize(serialize(state));
assert.equal(roundTrip.ok, true);
assert.equal(roundTrip.state.diplomacy.schemaVersion, 3);
assert.equal(JSON.parse(serialize(roundTrip.state)).saveVersion, 25);

const legacyState = structuredClone(state);
legacyState.diplomacy.version = 2;
legacyState.diplomacy.schemaVersion = 2;
legacyState.diplomacy.proposals.push({
  id: 'legacy-invalid', from: 'player', to: first.id, status: 'pending', createdAt: 0, expiresAt: 999999,
  terms: [{ type: 'legacy_magic_term' }],
});
const legacyJson = JSON.stringify(legacyState);
const migrated = deserialize(JSON.stringify({ saveVersion: 24, checksum: crc32(legacyJson), savedAt: 1, state: legacyState }));
assert.equal(migrated.ok, true);
assert.equal(migrated.state.diplomacy.schemaVersion, 3);
assert.equal(migrated.state.diplomacy.migrationV25Derived, true, 'v24 migration derives v3 intelligence and reputation');
assert.equal(migrated.state.diplomacy.proposals.find((entry) => entry.id === 'legacy-invalid').reason, 'migration_invalid_legacy_terms');
assert.ok(migrated.state.diplomacy.wars.length >= state.diplomacy.wars.length, 'active wars survive migration');
assert.ok(migrated.state.diplomacy.agreements.length >= state.diplomacy.agreements.length, 'agreements survive migration');
assert.ok(diplomaticRevision(migrated.state) > 0);

const deterministicA = game(77);
const deterministicB = game(77);
advanceDiplomacy(deterministicA, 90000);
advanceDiplomacy(deterministicB, 90000);
const politicalFingerprint = (candidate) => JSON.stringify({
  profiles: candidate.diplomacy.profiles,
  proposals: candidate.diplomacy.proposals.map((entry) => ({ from: entry.from, to: entry.to, terms: entry.terms, status: entry.status })),
  wars: candidate.diplomacy.wars.map((entry) => ({ attackers: entry.attackers, defenders: entry.defenders, goals: entry.goals })),
});
assert.equal(politicalFingerprint(deterministicA), politicalFingerprint(deterministicB),
  'identical campaign seeds produce identical AI political decisions');

console.log('Diplomacy v3 verification passed', {
  factions: factions.length,
  pairs: Object.keys(state.diplomacy.pairRelations).length,
  revision: diplomaticRevision(state),
  saveVersion: SAVE_VERSION,
});
