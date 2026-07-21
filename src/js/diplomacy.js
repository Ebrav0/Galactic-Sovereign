// Persistent diplomacy, negotiation, war, occupation, and council simulation.

import {
  DIPLOMACY_TRUCE_COST,
  DIPLOMACY_TRADE_TREATY_COST,
  DIPLOMACY_ALLIANCE_COST,
  DIPLOMACY_ALLIANCE_SOLARII,
  DIPLOMACY_TRADE_INCOME_BONUS,
} from './constants.js';
import { refreshMilestones } from './milestones.js';
import { isTechUnlocked, techEffects } from './tech-web.js';
import { empireStructureEffectValue, reconcileStructureTechnology } from './body-structures.js';
import {
  COUNCIL_RESOLUTION_TYPES,
  DIPLOMACY_CONFIG,
  DIPLOMATIC_AGENDAS,
  HELIOCLAST_CRISIS_STAGES,
} from './diplomacy-config.js';

export const DIPLOMACY_SCHEMA_VERSION = 3;

export const RELATION_WAR = 'war';
export const RELATION_NEUTRAL = 'neutral';
export const RELATION_TRUCE = 'truce';
export const RELATION_TRADE = 'trade';
export const RELATION_ALLIANCE = 'alliance';

export const CONTACT_UNKNOWN = 'unknown';
export const CONTACT_DETECTED = 'detected';
export const CONTACT_CONTACTED = 'contacted';
export const CONTACT_ESTABLISHED = 'established';

export const AGREEMENT_CEASEFIRE = 'ceasefire';
export const AGREEMENT_TRUCE = 'truce';
export const AGREEMENT_TRADE = 'trade';
export const AGREEMENT_OPEN_BORDERS = 'open_borders';
export const AGREEMENT_DEFENSE = 'defense';
export const AGREEMENT_ALLIANCE = 'alliance';
export const AGREEMENT_TRIBUTE = 'tribute';
export const AGREEMENT_NON_AGGRESSION = 'non_aggression';

export const PROPOSAL_PENDING = 'pending';
export const PROPOSAL_ACCEPTED = 'accepted';
export const PROPOSAL_REJECTED = 'rejected';
export const PROPOSAL_COUNTERED = 'countered';
export const PROPOSAL_EXPIRED = 'expired';

export const WAR_GOAL_TYPES = Object.freeze([
  'claimed_conquest',
  'border_security',
  'tribute',
  'forced_treaty',
  'humiliation',
  'superweapon_containment',
]);

export const AGREEMENT_TYPES = Object.freeze([
  AGREEMENT_CEASEFIRE,
  AGREEMENT_TRUCE,
  AGREEMENT_TRADE,
  AGREEMENT_OPEN_BORDERS,
  AGREEMENT_DEFENSE,
  AGREEMENT_ALLIANCE,
  AGREEMENT_TRIBUTE,
  AGREEMENT_NON_AGGRESSION,
]);

const PLAYER_ID = 'player';
const PROPOSAL_LIFETIME_MS = DIPLOMACY_CONFIG.proposalLifetimeMs;
const AI_PROPOSAL_COOLDOWN_MS = DIPLOMACY_CONFIG.proactiveOfferCooldownMs;
const DIPLOMACY_TICK_INTERVAL_MS = DIPLOMACY_CONFIG.simulationTickMs;
const DEFAULT_PEACE_TRUCE_MS = DIPLOMACY_CONFIG.truceDurationMs;
const METRIC_KEYS = Object.freeze(['opinion', 'trust', 'fear', 'respect']);
const CONTACT_RANK = Object.freeze({ unknown: 0, detected: 1, contacted: 2, established: 3 });
const VALID_RELATIONS = new Set([
  RELATION_WAR,
  RELATION_NEUTRAL,
  RELATION_TRUCE,
  RELATION_TRADE,
  RELATION_ALLIANCE,
]);
const VALID_RESOLUTION_TYPES = new Set(COUNCIL_RESOLUTION_TYPES);
const ID_PREFIX = Object.freeze({
  proposal: 'dip-proposal',
  agreement: 'dip-agreement',
  claim: 'dip-claim',
  war: 'dip-war',
  occupation: 'dip-occupation',
  modifier: 'dip-modifier',
  resolution: 'dip-resolution',
  sanction: 'dip-sanction',
  history: 'dip-history',
  favor: 'dip-favor',
  grievance: 'dip-grievance',
  transmission: 'dip-transmission',
  call: 'dip-call',
});
const PERSONALITY_METRICS = Object.freeze({
  expansionist: Object.freeze({ opinion: -5, trust: -5, fear: 0, respect: 5 }),
  economic: Object.freeze({ opinion: 5, trust: 5, fear: 0, respect: 0 }),
  megastructure: Object.freeze({ opinion: 0, trust: 2, fear: 0, respect: 5 }),
  wormhole: Object.freeze({ opinion: 2, trust: -2, fear: 0, respect: 3 }),
});
const normalizedDiplomacyObjects = new WeakSet();

function stableHash(value) {
  let hash = 2166136261;
  const text = String(value ?? '');
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function actorPersonality(state, actorId) {
  return actorId === PLAYER_ID ? 'player' : factionById(state, actorId)?.personality ?? 'expansionist';
}

function actorAgenda(state, actorId) {
  if (actorId === PLAYER_ID) return {
    priorities: ['sovereignty', 'stability', 'player_choice'],
    redLines: [],
    reliability: 1,
    riskTolerance: 0.5,
  };
  return DIPLOMATIC_AGENDAS[actorPersonality(state, actorId)] ?? DIPLOMATIC_AGENDAS.expansionist;
}

function defaultProfile(state, actorId) {
  const agenda = actorAgenda(state, actorId);
  const seed = stableHash(`${state?.meta?.seed ?? 1}:${actorId}:diplomacy-v3`);
  const difficulty = {
    easy: { planningHorizon: 1, coordination: 0.35, risk: -0.12 },
    normal: { planningHorizon: 2, coordination: 0.55, risk: 0 },
    hard: { planningHorizon: 3, coordination: 0.75, risk: 0.08 },
    sovereign: { planningHorizon: 4, coordination: 0.9, risk: 0.12 },
  }[state?.aiDifficulty] ?? { planningHorizon: 2, coordination: 0.55, risk: 0 };
  return {
    actorId,
    personality: actorPersonality(state, actorId),
    priorities: [...agenda.priorities],
    redLines: [...agenda.redLines],
    reliability: clamp(agenda.reliability + ((seed % 11) - 5) / 100, 0.25, 1),
    riskTolerance: clamp(agenda.riskTolerance + difficulty.risk + (((seed >>> 8) % 11) - 5) / 100, 0, 1),
    planningHorizon: difficulty.planningHorizon,
    coordination: difficulty.coordination,
    reputation: 0,
    lastStrategicAt: 0,
  };
}

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function round2(value) {
  return Math.round((finite(value) + Number.EPSILON) * 100) / 100;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, finite(value)));
}

function now(state) {
  return Math.max(0, finite(state?.time));
}

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function noteDiplomacyMissionObjective(state, missionId, objectiveId, requiredObjectives) {
  if (!state.campaign) return;
  state.campaign.missionProgress ??= {};
  const progress = state.campaign.missionProgress[missionId] ?? {};
  progress[objectiveId] = true;
  progress.complete = requiredObjectives.every((id) => progress[id]);
  state.campaign.missionProgress[missionId] = progress;
  if (progress.complete) {
    state.campaign.completedMissions ??= [];
    if (!state.campaign.completedMissions.includes(missionId)) state.campaign.completedMissions.push(missionId);
    if (state.campaign.activeMissionId === missionId) state.campaign.activeMissionId = null;
  }
}

function normalizeMetrics(value = {}) {
  return {
    opinion: clamp(value.opinion, -100, 100),
    trust: clamp(value.trust, -100, 100),
    fear: clamp(value.fear, 0, 100),
    respect: clamp(value.respect, 0, 100),
  };
}

function normalizeParties(parties) {
  return [...new Set(asArray(parties).filter((id) => typeof id === 'string' && id))].sort();
}

function pairKey(a, b) {
  return [a, b].sort().join('|');
}

function relationFactionFromParties(parties) {
  if (!parties.includes(PLAYER_ID)) return null;
  return parties.find((id) => id !== PLAYER_ID) ?? null;
}

function activeAt(record, at) {
  return record?.status === 'active'
    && (record.expiresAt == null || at < record.expiresAt);
}

function factionList(state) {
  if (state.factions?.list?.length) return state.factions.list;
  if (state.factions?.ai) return [state.factions.ai];
  return [];
}

function actorIds(state) {
  return [PLAYER_ID, ...factionList(state).map((faction) => faction.id)];
}

function actorExists(state, actorId) {
  return actorId === PLAYER_ID || factionList(state).some((faction) => faction.id === actorId);
}

function factionById(state, factionId) {
  return factionList(state).find((faction) => faction.id === factionId) ?? null;
}

function walletForActor(state, actorId) {
  return actorId === PLAYER_ID ? state : factionById(state, actorId);
}

function normalizeRelation(relation) {
  const rel = relation && typeof relation === 'object' ? relation : {};
  rel.status = VALID_RELATIONS.has(rel.status) ? rel.status : RELATION_NEUTRAL;
  rel.treaties = [...new Set(asArray(rel.treaties).filter((type) => typeof type === 'string'))];
  rel.lastChangedAt = Math.max(0, finite(rel.lastChangedAt));
  rel.baseMetrics = normalizeMetrics(rel.baseMetrics ?? rel.metrics ?? rel);
  rel.metrics = normalizeMetrics(rel.metrics ?? rel.baseMetrics);
  for (const key of METRIC_KEYS) rel[key] = rel.metrics[key];
  return rel;
}

function normalizeCounter(value) {
  return Math.max(1, Math.floor(finite(value, 1)));
}

function normalizeRecordsInPlace(records, normalizer) {
  for (let index = records.length - 1; index >= 0; index--) {
    const entry = records[index];
    if (!entry || typeof entry !== 'object') {
      records.splice(index, 1);
      continue;
    }
    Object.assign(entry, normalizer(entry));
  }
  return records;
}

function rebuildIdCounters(diplomacy) {
  const collections = {
    proposal: diplomacy.proposals,
    agreement: diplomacy.agreements,
    claim: diplomacy.claims,
    war: diplomacy.wars,
    occupation: diplomacy.occupations,
    resolution: diplomacy.council.resolutions,
    sanction: diplomacy.council.sanctions,
    history: diplomacy.history,
    favor: diplomacy.favors,
    grievance: diplomacy.grievances,
    transmission: diplomacy.transmissions,
    call: diplomacy.callsToArms,
  };
  for (const [kind, records] of Object.entries(collections)) {
    let max = normalizeCounter(diplomacy.nextIds[kind]) - 1;
    for (const record of records) {
      const match = String(record?.id ?? '').match(/(\d+)$/);
      if (match) max = Math.max(max, Number(match[1]));
    }
    diplomacy.nextIds[kind] = max + 1;
  }
  let modifierMax = normalizeCounter(diplomacy.nextIds.modifier) - 1;
  for (const records of Object.values(diplomacy.modifiers)) {
    for (const record of asArray(records)) {
      const match = String(record?.id ?? '').match(/(\d+)$/);
      if (match) modifierMax = Math.max(modifierMax, Number(match[1]));
    }
  }
  for (const records of Object.values(diplomacy.pairModifiers ?? {})) {
    for (const record of asArray(records)) {
      const match = String(record?.id ?? '').match(/(\d+)$/);
      if (match) modifierMax = Math.max(modifierMax, Number(match[1]));
    }
  }
  diplomacy.nextIds.modifier = modifierMax + 1;
}

function rawNextId(diplomacy, kind) {
  const prefix = ID_PREFIX[kind] ?? `dip-${kind}`;
  const id = `${prefix}-${normalizeCounter(diplomacy.nextIds[kind])}`;
  diplomacy.nextIds[kind] = normalizeCounter(diplomacy.nextIds[kind]) + 1;
  return id;
}

function migrateLegacyRelations(state, diplomacy) {
  if (diplomacy.schemaVersion >= DIPLOMACY_SCHEMA_VERSION) return;
  const at = now(state);
  for (const [factionId, rawRelation] of Object.entries(diplomacy.relations)) {
    const relation = normalizeRelation(rawRelation);
    diplomacy.relations[factionId] = relation;
    const legacyContactAt = relation.lastChangedAt || at;
    const contact = diplomacy.contacts[factionId] ?? { factionId };
    if (CONTACT_RANK[contact.stage] == null || CONTACT_RANK[contact.stage] < CONTACT_RANK[CONTACT_ESTABLISHED]) {
      contact.stage = CONTACT_ESTABLISHED;
      contact.firstContactAt ??= legacyContactAt;
      contact.establishedAt ??= legacyContactAt;
      contact.trigger = 'legacy_save';
    }
    diplomacy.contacts[factionId] = contact;
    const parties = normalizeParties([PLAYER_ID, factionId]);
    if (relation.status === RELATION_WAR
        && !diplomacy.wars.some((war) => activeAt(war, at) && war.parties?.includes(factionId))) {
      diplomacy.wars.push({
        id: rawNextId(diplomacy, 'war'),
        status: 'active',
        attackers: [PLAYER_ID],
        defenders: [factionId],
        parties,
        primaryAttacker: PLAYER_ID,
        primaryDefender: factionId,
        factionId,
        goals: [{ type: 'border_security', systemIds: [] }],
        score: 0,
        scoreByActor: { [PLAYER_ID]: 0, [factionId]: 0 },
        exhaustion: { [PLAYER_ID]: 0, [factionId]: 0 },
        events: [],
        startedAt: relation.lastChangedAt || at,
        lastExhaustionAt: at,
        legacy: true,
      });
    }
    const agreementType = relation.status === RELATION_TRUCE
      ? AGREEMENT_TRUCE
      : relation.status === RELATION_TRADE
        ? AGREEMENT_TRADE
        : relation.status === RELATION_ALLIANCE
          ? AGREEMENT_ALLIANCE
          : null;
    if (agreementType && !diplomacy.agreements.some((agreement) => (
      activeAt(agreement, at) && agreement.type === agreementType
      && pairKey(...agreement.parties) === pairKey(...parties)
    ))) {
      diplomacy.agreements.push({
        id: rawNextId(diplomacy, 'agreement'),
        type: agreementType,
        parties,
        status: 'active',
        startedAt: relation.lastChangedAt || at,
        expiresAt: null,
        terms: {},
        legacy: true,
      });
    }
  }
  diplomacy.schemaVersion = DIPLOMACY_SCHEMA_VERSION;
}

/** Backfills old `{ relations: {} }` saves without discarding any legacy fields. */
export function ensureDiplomacy(state) {
  if (!state.diplomacy || typeof state.diplomacy !== 'object') state.diplomacy = {};
  const diplomacy = state.diplomacy;
  if (normalizedDiplomacyObjects.has(diplomacy)) {
    diplomacy.version = DIPLOMACY_SCHEMA_VERSION;
    diplomacy.schemaVersion = DIPLOMACY_SCHEMA_VERSION;
    for (const faction of factionList(state)) {
      diplomacy.contacts[faction.id] ??= {
        factionId: faction.id,
        stage: CONTACT_UNKNOWN,
        firstContactAt: null,
        establishedAt: null,
      };
      diplomacy.modifiers[faction.id] ??= [];
      diplomacy.profiles[faction.id] ??= defaultProfile(state, faction.id);
      const key = pairKey(PLAYER_ID, faction.id);
      diplomacy.pairRelations[key] ??= diplomacy.relations[faction.id] ?? defaultRelation();
      diplomacy.pairModifiers[key] ??= diplomacy.modifiers[faction.id];
    }
    diplomacy.profiles[PLAYER_ID] ??= defaultProfile(state, PLAYER_ID);
    const currentActors = actorIds(state);
    for (let left = 0; left < currentActors.length; left++) {
      for (let right = left + 1; right < currentActors.length; right++) {
        const key = pairKey(currentActors[left], currentActors[right]);
        diplomacy.pairRelations[key] ??= defaultRelation();
        diplomacy.pairModifiers[key] ??= [];
      }
    }
    return diplomacy;
  }
  diplomacy.relations = diplomacy.relations && typeof diplomacy.relations === 'object'
    ? diplomacy.relations
    : {};
  diplomacy.contacts = diplomacy.contacts && typeof diplomacy.contacts === 'object'
    ? diplomacy.contacts
    : {};
  diplomacy.modifiers = diplomacy.modifiers && typeof diplomacy.modifiers === 'object'
    ? diplomacy.modifiers
    : {};
  diplomacy.pairRelations = diplomacy.pairRelations && typeof diplomacy.pairRelations === 'object'
    ? diplomacy.pairRelations
    : {};
  diplomacy.pairModifiers = diplomacy.pairModifiers && typeof diplomacy.pairModifiers === 'object'
    ? diplomacy.pairModifiers
    : {};
  diplomacy.profiles = diplomacy.profiles && typeof diplomacy.profiles === 'object'
    ? diplomacy.profiles
    : {};
  diplomacy.favors = asArray(diplomacy.favors);
  diplomacy.grievances = asArray(diplomacy.grievances);
  diplomacy.transmissions = asArray(diplomacy.transmissions);
  diplomacy.callsToArms = asArray(diplomacy.callsToArms);
  diplomacy.proposals = asArray(diplomacy.proposals);
  diplomacy.agreements = asArray(diplomacy.agreements);
  diplomacy.claims = asArray(diplomacy.claims);
  diplomacy.wars = asArray(diplomacy.wars);
  diplomacy.occupations = asArray(diplomacy.occupations);
  diplomacy.history = asArray(diplomacy.history);
  diplomacy.nextIds = diplomacy.nextIds && typeof diplomacy.nextIds === 'object'
    ? diplomacy.nextIds
    : {};
  diplomacy.ai = diplomacy.ai && typeof diplomacy.ai === 'object' ? diplomacy.ai : {};
  diplomacy.ai.lastProposalAt = diplomacy.ai.lastProposalAt && typeof diplomacy.ai.lastProposalAt === 'object'
    ? diplomacy.ai.lastProposalAt
    : {};
  diplomacy.ai.ultimatumAt = diplomacy.ai.ultimatumAt && typeof diplomacy.ai.ultimatumAt === 'object'
    ? diplomacy.ai.ultimatumAt
    : {};
  diplomacy.council = diplomacy.council && typeof diplomacy.council === 'object'
    ? diplomacy.council
    : {};
  diplomacy.council.resolutions = asArray(diplomacy.council.resolutions);
  diplomacy.council.sanctions = asArray(diplomacy.council.sanctions);
  diplomacy.council.lastSessionAt = Math.max(0, finite(diplomacy.council.lastSessionAt));
  diplomacy.council.activeResolutionId ??= null;
  diplomacy.helioclastCrisis = diplomacy.helioclastCrisis && typeof diplomacy.helioclastCrisis === 'object'
    ? diplomacy.helioclastCrisis
    : { stage: 'dormant', level: 0, startedAt: null, lastEscalatedAt: null, incidents: [] };
  if (!HELIOCLAST_CRISIS_STAGES.includes(diplomacy.helioclastCrisis.stage)) diplomacy.helioclastCrisis.stage = 'dormant';
  diplomacy.helioclastCrisis.level = clamp(diplomacy.helioclastCrisis.level, 0, HELIOCLAST_CRISIS_STAGES.length - 1);
  diplomacy.helioclastCrisis.incidents = asArray(diplomacy.helioclastCrisis.incidents);
  diplomacy.lastTickAt = Math.max(0, finite(diplomacy.lastTickAt));
  diplomacy.lastStrategicTickAt = Math.max(0, finite(diplomacy.lastStrategicTickAt));
  diplomacy.revision = Math.max(0, Math.floor(finite(diplomacy.revision)));
  diplomacy.panicUntil = Math.max(0, finite(diplomacy.panicUntil));

  normalizeRecordsInPlace(diplomacy.proposals, (entry) => ({
    ...entry,
    from: entry.from ?? PLAYER_ID,
    to: entry.to ?? entry.factionId ?? null,
    terms: asArray(entry.terms),
    ultimatum: !!entry.ultimatum,
    status: entry.status ?? PROPOSAL_PENDING,
    createdAt: Math.max(0, finite(entry.createdAt)),
    expiresAt: Math.max(0, finite(entry.expiresAt, finite(entry.createdAt) + PROPOSAL_LIFETIME_MS)),
  }));
  normalizeRecordsInPlace(diplomacy.agreements, (entry) => ({
    ...entry,
    parties: normalizeParties(entry.parties ?? [PLAYER_ID, entry.factionId]),
    status: entry.status ?? 'active',
    startedAt: Math.max(0, finite(entry.startedAt)),
    expiresAt: entry.expiresAt == null ? null : Math.max(0, finite(entry.expiresAt)),
    terms: entry.terms && typeof entry.terms === 'object' ? entry.terms : {},
    lastPaidAt: Math.max(0, finite(entry.lastPaidAt, entry.startedAt)),
  }));
  normalizeRecordsInPlace(diplomacy.claims, (entry) => ({
    ...entry,
    claimant: entry.claimant ?? PLAYER_ID,
    status: entry.status ?? 'active',
    createdAt: Math.max(0, finite(entry.createdAt)),
  }));
  normalizeRecordsInPlace(diplomacy.wars, (entry) => {
    const attackers = normalizeParties(entry.attackers ?? [entry.primaryAttacker ?? PLAYER_ID]);
    const defenders = normalizeParties(entry.defenders ?? [entry.primaryDefender ?? entry.factionId]);
    const parties = normalizeParties(entry.parties ?? [...attackers, ...defenders]);
    const exhaustion = entry.exhaustion && typeof entry.exhaustion === 'object' ? entry.exhaustion : {};
    const scoreByActor = entry.scoreByActor && typeof entry.scoreByActor === 'object' ? entry.scoreByActor : {};
    for (const actorId of parties) {
      exhaustion[actorId] = clamp(exhaustion[actorId], 0, 100);
      scoreByActor[actorId] = round2(scoreByActor[actorId]);
    }
    return {
      ...entry,
      attackers,
      defenders,
      parties,
      status: entry.status ?? 'active',
      goals: normalizeWarGoals(entry.goals),
      escalation: ['limited', 'expanded', 'total'].includes(entry.escalation) ? entry.escalation : 'limited',
      escalationAt: Math.max(0, finite(entry.escalationAt, entry.startedAt)),
      legitimacy: clamp(entry.legitimacy, -100, 100),
      score: clamp(entry.score, -100, 100),
      scoreByActor,
      exhaustion,
      events: asArray(entry.events),
      startedAt: Math.max(0, finite(entry.startedAt)),
      lastExhaustionAt: Math.max(0, finite(entry.lastExhaustionAt, entry.startedAt)),
    };
  });
  normalizeRecordsInPlace(diplomacy.occupations, (entry) => ({
    ...entry,
    status: entry.status ?? 'active',
    occupiedAt: Math.max(0, finite(entry.occupiedAt)),
  }));
  normalizeRecordsInPlace(diplomacy.history, (entry) => entry);
  normalizeRecordsInPlace(diplomacy.council.resolutions, (entry) => ({
      ...entry,
      status: entry.status ?? 'voting',
      votes: entry.votes && typeof entry.votes === 'object' ? entry.votes : {},
      proposedAt: Math.max(0, finite(entry.proposedAt)),
      votingEndsAt: Math.max(0, finite(entry.votingEndsAt, finite(entry.proposedAt) + 30000)),
      weights: entry.weights && typeof entry.weights === 'object' ? entry.weights : {},
      voteWeights: entry.voteWeights && typeof entry.voteWeights === 'object' ? entry.voteWeights : {},
      committed: entry.committed && typeof entry.committed === 'object' ? entry.committed : {},
      votePromises: asArray(entry.votePromises),
    }));
  normalizeRecordsInPlace(diplomacy.council.sanctions, (entry) => ({
      ...entry,
      status: entry.status ?? 'active',
      startedAt: Math.max(0, finite(entry.startedAt)),
      expiresAt: entry.expiresAt == null ? null : Math.max(0, finite(entry.expiresAt)),
      supporters: [...new Set(asArray(entry.supporters))],
    }));

  for (const kind of Object.keys(ID_PREFIX)) diplomacy.nextIds[kind] = normalizeCounter(diplomacy.nextIds[kind]);
  for (const [factionId, relation] of Object.entries(diplomacy.relations)) {
    diplomacy.relations[factionId] = normalizeRelation(relation);
  }
  for (const [key, relation] of Object.entries(diplomacy.pairRelations)) {
    diplomacy.pairRelations[key] = normalizeRelation(relation);
  }
  for (const [key, records] of Object.entries(diplomacy.pairModifiers)) {
    diplomacy.pairModifiers[key] = asArray(records);
  }
  for (const actorId of [PLAYER_ID, ...factionList(state).map((faction) => faction.id)]) {
    diplomacy.profiles[actorId] = {
      ...defaultProfile(state, actorId),
      ...(diplomacy.profiles[actorId] ?? {}),
      actorId,
      reputation: clamp(diplomacy.profiles[actorId]?.reputation, -100, 100),
    };
  }
  normalizeRecordsInPlace(diplomacy.favors, (entry) => ({
    ...entry, status: entry.status ?? 'owed', value: clamp(entry.value, 1, 100), createdAt: Math.max(0, finite(entry.createdAt)),
  }));
  normalizeRecordsInPlace(diplomacy.grievances, (entry) => ({
    ...entry, status: entry.status ?? 'active', severity: clamp(entry.severity, 0, 100), createdAt: Math.max(0, finite(entry.createdAt)),
    expiresAt: entry.expiresAt == null ? null : Math.max(0, finite(entry.expiresAt)),
  }));
  normalizeRecordsInPlace(diplomacy.transmissions, (entry) => ({
    ...entry, createdAt: Math.max(0, finite(entry.createdAt)), read: !!entry.read, status: entry.status ?? 'open',
  }));
  normalizeRecordsInPlace(diplomacy.callsToArms, (entry) => ({
    ...entry, createdAt: Math.max(0, finite(entry.createdAt)), expiresAt: Math.max(0, finite(entry.expiresAt)), status: entry.status ?? 'pending',
  }));
  for (const faction of factionList(state)) {
    const contact = diplomacy.contacts[faction.id];
    if (contact && typeof contact === 'object') {
      contact.factionId = faction.id;
      contact.stage = CONTACT_RANK[contact.stage] == null ? CONTACT_UNKNOWN : contact.stage;
      contact.intelligence = clamp(contact.intelligence, 0, 100);
    } else {
      diplomacy.contacts[faction.id] = {
        factionId: faction.id,
        stage: CONTACT_UNKNOWN,
        firstContactAt: null,
        establishedAt: null,
        intelligence: 0,
      };
    }
    const modifiers = asArray(diplomacy.modifiers[faction.id]);
    diplomacy.modifiers[faction.id] = modifiers;
    normalizeRecordsInPlace(modifiers, (entry) => ({
        ...entry,
        opinion: clamp(entry.opinion, -100, 100),
        trust: clamp(entry.trust, -100, 100),
        fear: clamp(entry.fear, -100, 100),
        respect: clamp(entry.respect, -100, 100),
        createdAt: Math.max(0, finite(entry.createdAt)),
        expiresAt: entry.expiresAt == null ? null : Math.max(0, finite(entry.expiresAt)),
      }));
  }
  rebuildIdCounters(diplomacy);
  migrateLegacyRelations(state, diplomacy);
  for (const faction of factionList(state)) {
    const key = pairKey(PLAYER_ID, faction.id);
    diplomacy.pairRelations[key] ??= diplomacy.relations[faction.id] ?? defaultRelation();
    diplomacy.pairModifiers[key] ??= diplomacy.modifiers[faction.id] ?? [];
    diplomacy.relations[faction.id] = diplomacy.pairRelations[key];
    diplomacy.modifiers[faction.id] = diplomacy.pairModifiers[key];
  }
  const actors = [PLAYER_ID, ...factionList(state).map((faction) => faction.id)];
  for (let left = 0; left < actors.length; left++) {
    for (let right = left + 1; right < actors.length; right++) {
      const key = pairKey(actors[left], actors[right]);
      diplomacy.pairRelations[key] ??= defaultRelation();
      diplomacy.pairModifiers[key] ??= [];
    }
  }
  rebuildIdCounters(diplomacy);
  diplomacy.version = DIPLOMACY_SCHEMA_VERSION;
  diplomacy.schemaVersion = DIPLOMACY_SCHEMA_VERSION;
  normalizedDiplomacyObjects.add(diplomacy);
  return diplomacy;
}

function nextId(state, kind) {
  return rawNextId(ensureDiplomacy(state), kind);
}

function recordHistory(state, type, details = {}) {
  const diplomacy = ensureDiplomacy(state);
  const entry = { id: nextId(state, 'history'), type, at: now(state), ...clone(details) };
  diplomacy.history.push(entry);
  if (diplomacy.history.length > 400) diplomacy.history.splice(0, diplomacy.history.length - 400);
  touchDiplomacy(state, diplomacy);
  return entry;
}

function touchDiplomacy(state, diplomacy = ensureDiplomacy(state)) {
  diplomacy.revision = Math.max(0, Math.floor(finite(diplomacy.revision))) + 1;
  if (state.strategicOrders) state.strategicOrders.diplomacyRevision = diplomacy.revision;
  return diplomacy.revision;
}

export function diplomaticRevision(state) {
  return Math.max(0, Math.floor(finite(ensureDiplomacy(state).revision)));
}

export function actorProfile(state, actorId) {
  const diplomacy = ensureDiplomacy(state);
  diplomacy.profiles[actorId] ??= defaultProfile(state, actorId);
  return diplomacy.profiles[actorId];
}

export function actorReputation(state, actorId) {
  return clamp(actorProfile(state, actorId).reputation, -100, 100);
}

export function adjustActorReputation(state, actorId, delta, reason = 'diplomatic_event') {
  if (!actorExists(state, actorId)) return { ok: false, reason: 'Unknown actor' };
  const profile = actorProfile(state, actorId);
  const previous = profile.reputation;
  profile.reputation = clamp(previous + finite(delta), -100, 100);
  recordHistory(state, 'reputation_changed', { actorId, previous, value: profile.reputation, delta: profile.reputation - previous, reason });
  return { ok: true, actorId, previous, value: profile.reputation };
}

export function addTransmission(state, input = {}) {
  const diplomacy = ensureDiplomacy(state);
  const transmission = {
    id: nextId(state, 'transmission'),
    from: input.from ?? 'council',
    to: input.to ?? PLAYER_ID,
    subject: input.subject ?? 'Diplomatic transmission',
    body: input.body ?? '',
    tone: input.tone ?? 'neutral',
    kind: input.kind ?? 'diplomatic_event',
    relatedId: input.relatedId ?? null,
    createdAt: now(state),
    read: false,
    status: input.status ?? 'open',
    actions: clone(input.actions ?? []),
  };
  diplomacy.transmissions.push(transmission);
  if (diplomacy.transmissions.length > 100) diplomacy.transmissions.splice(0, diplomacy.transmissions.length - 100);
  recordHistory(state, 'transmission_received', { transmissionId: transmission.id, from: transmission.from, to: transmission.to, kind: transmission.kind });
  return transmission;
}

export function markTransmissionRead(state, transmissionId) {
  const entry = ensureDiplomacy(state).transmissions.find((candidate) => candidate.id === transmissionId);
  if (!entry) return { ok: false, reason: 'Unknown transmission' };
  if (!entry.read) {
    entry.read = true;
    recordHistory(state, 'transmission_read', { transmissionId });
  }
  return { ok: true, transmission: entry };
}

export function defaultRelation() {
  return normalizeRelation({ status: RELATION_NEUTRAL, treaties: [], lastChangedAt: 0 });
}

export function getActorRelation(state, actorA, actorB) {
  if (!actorExists(state, actorA) || !actorExists(state, actorB) || actorA === actorB) return defaultRelation();
  const diplomacy = ensureDiplomacy(state);
  const key = pairKey(actorA, actorB);
  diplomacy.pairRelations[key] ??= defaultRelation();
  if (actorA === PLAYER_ID || actorB === PLAYER_ID) {
    const factionId = actorA === PLAYER_ID ? actorB : actorA;
    diplomacy.relations[factionId] = diplomacy.pairRelations[key];
  }
  return diplomacy.pairRelations[key];
}

export function getRelation(state, factionId, actorId = PLAYER_ID) {
  return getActorRelation(state, actorId, factionId);
}

export function listAiFactionsFromState(state) {
  return factionList(state);
}

export function isDiplomacyUnlocked(state) {
  refreshMilestones(state);
  return !!state.milestones?.diplomacyUnlocked
    || factionList(state).some((faction) => CONTACT_RANK[getContact(state, faction.id).stage] >= CONTACT_RANK[CONTACT_DETECTED]);
}

export function getContact(state, factionId) {
  const diplomacy = ensureDiplomacy(state);
  diplomacy.contacts[factionId] ??= {
    factionId,
    stage: CONTACT_UNKNOWN,
    firstContactAt: null,
    establishedAt: null,
    intelligence: 0,
  };
  return diplomacy.contacts[factionId];
}

export function detectContact(state, factionId, options = {}) {
  if (!factionById(state, factionId)) return { ok: false, reason: 'Unknown faction' };
  const contact = getContact(state, factionId);
  const previousStage = contact.stage;
  if (CONTACT_RANK[contact.stage] < CONTACT_RANK[CONTACT_DETECTED]) contact.stage = CONTACT_DETECTED;
  contact.detectedAt ??= now(state);
  contact.firstContactAt ??= now(state);
  contact.intelligence = clamp(Math.max(contact.intelligence ?? 0, finite(options.intelligence, 20)), 0, 100);
  contact.trigger = options.trigger ?? contact.trigger ?? 'detection';
  if (contact.stage !== previousStage) {
    noteDiplomacyMissionObjective(state, 'diplomacy_intro', 'detect_faction', ['detect_faction', 'open_channel', 'send_proposal']);
    addTransmission(state, {
      from: factionId,
      to: PLAYER_ID,
      kind: 'first_detection',
      subject: `${factionById(state, factionId)?.name ?? factionId} detected`,
      body: 'Long-range intelligence has identified a sovereign power. Open a channel to begin formal contact.',
      tone: 'cautious',
    });
    recordHistory(state, 'contact_stage_changed', { factionId, previousStage, stage: contact.stage, trigger: contact.trigger });
  }
  return { ok: true, factionId, previousStage, stage: contact.stage, contact };
}

export function establishContact(state, factionId, options = {}) {
  if (!factionById(state, factionId)) return { ok: false, reason: 'Unknown faction' };
  const requestedStage = options.stage ?? CONTACT_ESTABLISHED;
  if (CONTACT_RANK[requestedStage] == null) return { ok: false, reason: 'Unknown contact stage' };
  const contact = getContact(state, factionId);
  const discoveryTriggers = new Set(['agreement', 'war', 'claim', 'legacy_save', 'legacy_relation', 'superweapon', 'council']);
  if (contact.stage === CONTACT_UNKNOWN && !options.force && !discoveryTriggers.has(options.trigger)) {
    return { ok: false, reason: 'Detect this faction through exploration or a border encounter first' };
  }
  const previousStage = contact.stage;
  if (CONTACT_RANK[requestedStage] > CONTACT_RANK[contact.stage]) contact.stage = requestedStage;
  if (contact.stage !== CONTACT_UNKNOWN && contact.firstContactAt == null) contact.firstContactAt = now(state);
  if (contact.stage === CONTACT_ESTABLISHED && contact.establishedAt == null) contact.establishedAt = now(state);
  contact.intelligence = clamp(Math.max(contact.intelligence ?? 0,
    contact.stage === CONTACT_ESTABLISHED ? 50 : contact.stage === CONTACT_CONTACTED ? 30 : 20), 0, 100);
  contact.trigger = options.trigger ?? contact.trigger ?? 'manual';
  if (contact.stage !== previousStage) {
    if (CONTACT_RANK[contact.stage] >= CONTACT_RANK[CONTACT_CONTACTED]) {
      noteDiplomacyMissionObjective(state, 'diplomacy_intro', 'open_channel', ['detect_faction', 'open_channel', 'send_proposal']);
    }
    if (contact.stage === CONTACT_ESTABLISHED) {
      addTransmission(state, {
        from: factionId,
        to: PLAYER_ID,
        kind: 'contact_established',
        subject: `Channel established: ${factionById(state, factionId)?.name ?? factionId}`,
        body: 'Formal communications are open. Our response will depend on your conduct, strength, and respect for our interests.',
        tone: actorPersonality(state, factionId),
      });
    }
    recordHistory(state, 'contact_stage_changed', { factionId, previousStage, stage: contact.stage, trigger: contact.trigger });
  }
  return { ok: true, factionId, previousStage, stage: contact.stage, contact };
}

function personalityMetricEntry(state, observerId) {
  const personality = actorPersonality(state, observerId);
  if (personality === 'player') return {
    id: 'personality:player', source: 'personality', label: 'Sovereign policy',
    opinion: 0, trust: 0, fear: 0, respect: 0,
  };
  return {
    id: `personality:${personality}`,
    source: 'personality',
    label: `${personality.replace(/_/g, ' ')} outlook`,
    ...normalizeMetrics(PERSONALITY_METRICS[personality] ?? PERSONALITY_METRICS.expansionist),
  };
}

function agreementMetricEntry(agreement, factionId) {
  const values = {
    ceasefire: { opinion: 3, trust: 5, fear: 0, respect: 0 },
    truce: { opinion: 8, trust: 12, fear: 0, respect: 1 },
    trade: { opinion: 12, trust: 10, fear: 0, respect: 2 },
    open_borders: { opinion: 7, trust: 12, fear: 0, respect: 1 },
    defense: { opinion: 18, trust: 22, fear: 0, respect: 8 },
    alliance: { opinion: 28, trust: 30, fear: 0, respect: 12 },
    tribute: agreement.terms?.payer === factionId
      ? { opinion: -8, trust: -3, fear: 8, respect: -2 }
      : { opinion: 5, trust: 2, fear: 0, respect: 3 },
  };
  return {
    id: `agreement:${agreement.id}`,
    source: `agreement:${agreement.type}`,
    label: `${agreement.type.replace(/_/g, ' ')} agreement`,
    ...(values[agreement.type] ?? { opinion: 0, trust: 0, fear: 0, respect: 0 }),
  };
}

function dynamicMetricEntries(state, actorA, actorB, at) {
  const diplomacy = ensureDiplomacy(state);
  const entries = [];
  for (const agreement of diplomacy.agreements) {
    if (activeAt(agreement, at) && agreement.parties?.includes(actorA) && agreement.parties.includes(actorB)) {
      entries.push(agreementMetricEntry(agreement, actorA));
    }
  }
  for (const claim of diplomacy.claims) {
    if (claim.status === 'active'
        && ((claim.claimant === actorA && claim.target === actorB) || (claim.claimant === actorB && claim.target === actorA))) {
      const hostileToObserver = claim.target === actorA;
      entries.push({
        id: `claim:${claim.id}`,
        source: 'claim',
        label: `Claim on ${claim.systemId}`,
        opinion: hostileToObserver ? -12 : -4,
        trust: hostileToObserver ? -8 : -3,
        fear: 1,
        respect: 1,
      });
    }
  }
  const war = getActiveWar(state, [actorA, actorB]);
  if (war) {
    const scoreForObserver = actorA === PLAYER_ID ? war.score
      : actorB === PLAYER_ID ? -war.score
        : finite(war.scoreByActor?.[actorA]) - finite(war.scoreByActor?.[actorB]);
    entries.push({
      id: `war:${war.id}`,
      source: 'war',
      label: 'Active war',
      opinion: -40,
      trust: -35,
      fear: clamp(Math.abs(scoreForObserver) * 0.2, 0, 25),
      respect: clamp(scoreForObserver * 0.08, -10, 10),
    });
  }
  for (const sanction of diplomacy.council.sanctions) {
    if (activeAt(sanction, at) && (sanction.target === actorA || sanction.target === actorB)) {
      const observerTargeted = sanction.target === actorA;
      entries.push({
        id: `sanction:${sanction.id}`,
        source: 'council_sanction',
        label: observerTargeted ? 'Council sanction against observer' : 'Council sanction against counterpart',
        opinion: observerTargeted ? -10 : -20,
        trust: -15,
        fear: observerTargeted ? 4 : 8,
        respect: -3,
      });
    }
  }
  return entries;
}

export function addActorRelationshipModifier(state, actorA, actorB, modifier = {}) {
  if (!actorExists(state, actorA) || !actorExists(state, actorB) || actorA === actorB) {
    return { ok: false, reason: 'Relationship modifier requires two known actors' };
  }
  const diplomacy = ensureDiplomacy(state);
  const key = pairKey(actorA, actorB);
  const records = diplomacy.pairModifiers[key] ?? (diplomacy.pairModifiers[key] = []);
  if (modifier.stackKey) {
    const existingIndex = records.findIndex((entry) => entry.stackKey === modifier.stackKey);
    if (existingIndex >= 0) records.splice(existingIndex, 1);
  }
  const durationMs = modifier.durationMs == null ? null : Math.max(0, finite(modifier.durationMs));
  const record = {
    id: nextId(state, 'modifier'),
    source: modifier.source ?? 'event',
    label: modifier.label ?? String(modifier.source ?? 'Diplomatic event').replace(/_/g, ' '),
    opinion: clamp(modifier.opinion, -100, 100),
    trust: clamp(modifier.trust, -100, 100),
    fear: clamp(modifier.fear, -100, 100),
    respect: clamp(modifier.respect, -100, 100),
    createdAt: now(state),
    expiresAt: durationMs == null ? null : now(state) + durationMs,
    stackKey: modifier.stackKey ?? null,
    details: clone(modifier.details ?? {}),
  };
  records.push(record);
  if (actorA === PLAYER_ID || actorB === PLAYER_ID) {
    const factionId = actorA === PLAYER_ID ? actorB : actorA;
    diplomacy.modifiers[factionId] = records;
  }
  recordHistory(state, 'relationship_modifier_added', { actorA, actorB, modifier: record });
  return { ok: true, modifier: record };
}

export function addRelationshipModifier(state, factionId, modifier = {}) {
  return addActorRelationshipModifier(state, PLAYER_ID, factionId, modifier);
}

export const recordDiplomaticModifier = addRelationshipModifier;

export function recordBorderFriction(state, factionId, severity = 1) {
  const amount = clamp(severity, 0, 10);
  return addRelationshipModifier(state, factionId, {
    source: 'border',
    label: 'Border friction',
    opinion: -2 * amount,
    trust: -amount,
    fear: amount * 0.5,
    respect: 0,
    durationMs: 180000,
    stackKey: `border:${factionId}`,
  });
}

export function recordBattleDiplomacy(state, factionId, outcome = 'victory', scale = 1) {
  const won = outcome === 'victory' || outcome === 'won';
  const amount = clamp(scale, 0.25, 10);
  return addRelationshipModifier(state, factionId, {
    source: 'battle',
    label: won ? 'Defeated in battle' : 'Victorious in battle',
    opinion: -4 * amount,
    trust: -2 * amount,
    fear: won ? 3 * amount : -amount,
    respect: won ? 2 * amount : -amount,
    durationMs: 300000,
  });
}

export function recordBrokenPromise(state, factionId, severity = 1) {
  const amount = clamp(severity, 0.25, 10);
  return addRelationshipModifier(state, factionId, {
    source: 'broken_promise',
    label: 'Broken diplomatic promise',
    opinion: -8 * amount,
    trust: -12 * amount,
    fear: 0,
    respect: -2 * amount,
  });
}

export function setRelationshipBase(state, factionId, metrics = {}) {
  const relation = getRelation(state, factionId);
  relation.baseMetrics = normalizeMetrics(metrics);
  return { ok: true, factionId, baseMetrics: relation.baseMetrics };
}

export function getActorRelationshipBreakdown(state, observerId, counterpartId, options = {}) {
  const at = options.at ?? now(state);
  const relation = getActorRelation(state, observerId, counterpartId);
  const key = pairKey(observerId, counterpartId);
  const stored = asArray(ensureDiplomacy(state).pairModifiers[key]).filter((entry) => (
    entry.expiresAt == null || at < entry.expiresAt
  ));
  const modifiers = [
    {
      id: 'base', source: 'base', label: 'Base relationship',
      ...normalizeMetrics(relation.baseMetrics),
    },
    personalityMetricEntry(state, observerId),
    ...stored.map((entry) => ({ ...entry })),
    ...dynamicMetricEntries(state, observerId, counterpartId, at),
  ];
  const rawTotals = { opinion: 0, trust: 0, fear: 0, respect: 0 };
  for (const modifier of modifiers) {
    for (const key of METRIC_KEYS) rawTotals[key] = round2(rawTotals[key] + finite(modifier[key]));
  }
  const metrics = {
    opinion: clamp(rawTotals.opinion, -100, 100),
    trust: clamp(rawTotals.trust, -100, 100),
    fear: clamp(rawTotals.fear, 0, 100),
    respect: clamp(rawTotals.respect, 0, 100),
  };
  const grievances = ensureDiplomacy(state).grievances.filter((entry) => entry.status === 'active'
    && entry.aggrieved === observerId && entry.against === counterpartId
    && (entry.expiresAt == null || at < entry.expiresAt));
  return {
    observerId,
    counterpartId,
    factionId: counterpartId === PLAYER_ID ? observerId : counterpartId,
    metrics,
    rawTotals,
    modifiers,
    grievances: grievances.map((entry) => clone(entry)),
    grievanceSeverity: clamp(grievances.reduce((sum, entry) => sum + finite(entry.severity), 0), 0, 100),
  };
}

export function getRelationshipBreakdown(state, factionId, options = {}) {
  return getActorRelationshipBreakdown(state, factionId, PLAYER_ID, options);
}

export function addGrievance(state, input = {}) {
  if (!actorExists(state, input.aggrieved) || !actorExists(state, input.against)
      || input.aggrieved === input.against) return { ok: false, reason: 'Invalid grievance actors' };
  const diplomacy = ensureDiplomacy(state);
  const stackKey = input.stackKey ?? `${input.type ?? 'incident'}:${input.aggrieved}:${input.against}`;
  const existing = diplomacy.grievances.find((entry) => entry.status === 'active' && entry.stackKey === stackKey);
  if (existing) {
    existing.severity = clamp(Math.max(existing.severity, finite(input.severity)), 0, 100);
    existing.expiresAt = input.durationMs == null ? existing.expiresAt : now(state) + Math.max(0, finite(input.durationMs));
    recordHistory(state, 'grievance_updated', { grievanceId: existing.id, severity: existing.severity });
    return { ok: true, grievance: existing, updated: true };
  }
  const grievance = {
    id: nextId(state, 'grievance'),
    aggrieved: input.aggrieved,
    against: input.against,
    type: input.type ?? 'incident',
    label: input.label ?? String(input.type ?? 'Diplomatic incident').replaceAll('_', ' '),
    severity: clamp(input.severity, 0, 100),
    status: 'active',
    createdAt: now(state),
    expiresAt: input.durationMs == null ? null : now(state) + Math.max(0, finite(input.durationMs)),
    permanent: input.permanent === true,
    stackKey,
    details: clone(input.details ?? {}),
  };
  diplomacy.grievances.push(grievance);
  recordHistory(state, 'grievance_added', { grievance });
  return { ok: true, grievance };
}

export function createFavor(state, input = {}) {
  if (!actorExists(state, input.debtor) || !actorExists(state, input.creditor)
      || input.debtor === input.creditor) return { ok: false, reason: 'Invalid favor actors' };
  const favor = {
    id: nextId(state, 'favor'),
    debtor: input.debtor,
    creditor: input.creditor,
    value: clamp(input.value, 1, 100),
    purpose: input.purpose ?? 'general',
    status: 'owed',
    createdAt: now(state),
    expiresAt: input.expiresAt ?? null,
    sourceProposalId: input.sourceProposalId ?? null,
  };
  ensureDiplomacy(state).favors.push(favor);
  recordHistory(state, 'favor_created', { favor });
  return { ok: true, favor };
}

export function consumeFavor(state, favorId, options = {}) {
  const favor = ensureDiplomacy(state).favors.find((entry) => entry.id === favorId);
  if (!favor || favor.status !== 'owed') return { ok: false, reason: 'Favor is not available' };
  favor.status = options.status ?? 'honored';
  favor.resolvedAt = now(state);
  favor.resolutionId = options.resolutionId ?? null;
  recordHistory(state, 'favor_resolved', { favorId, status: favor.status, resolutionId: favor.resolutionId });
  return { ok: true, favor };
}

export function registerTreatyBreach(state, breacher, harmed, options = {}) {
  if (!actorExists(state, breacher) || !actorExists(state, harmed) || breacher === harmed) {
    return { ok: false, reason: 'Invalid treaty breach actors' };
  }
  const scale = clamp(options.severity ?? 1, 0.25, 3);
  const breach = DIPLOMACY_CONFIG.breach;
  addActorRelationshipModifier(state, harmed, breacher, {
    source: 'treaty_breach',
    label: 'Betrayed an agreement',
    opinion: breach.opinion * scale,
    trust: breach.trust * scale,
    respect: -8 * scale,
    fear: 2 * scale,
    durationMs: breach.memoryDurationMs,
    stackKey: `treaty_breach:${breacher}:${harmed}`,
  });
  adjustActorReputation(state, breacher, breach.reputation * scale, options.reason ?? 'treaty_breach');
  addGrievance(state, {
    aggrieved: harmed,
    against: breacher,
    type: 'treaty_breach',
    label: 'Treaty betrayal',
    severity: breach.grievance,
    durationMs: breach.memoryDurationMs,
    stackKey: `treaty_breach:${breacher}:${harmed}`,
    details: { agreementId: options.agreementId ?? null, reason: options.reason ?? null },
  });
  for (const witness of actorIds(state)) {
    if (witness === breacher || witness === harmed) continue;
    const playerKnows = witness !== PLAYER_ID || (
      (breacher === PLAYER_ID || getContact(state, breacher).stage !== CONTACT_UNKNOWN)
      && (harmed === PLAYER_ID || getContact(state, harmed).stage !== CONTACT_UNKNOWN)
    );
    if (playerKnows) {
      addActorRelationshipModifier(state, witness, breacher, {
        source: 'witnessed_betrayal', label: 'Witnessed treaty betrayal', trust: breach.witnessTrust * scale,
        opinion: -4 * scale, durationMs: breach.memoryDurationMs,
        stackKey: `witnessed_breach:${witness}:${breacher}`,
      });
    }
  }
  addTransmission(state, {
    from: harmed,
    to: breacher,
    kind: 'treaty_breach',
    subject: 'Agreement breached',
    body: 'Your violation has ended the agreement. This betrayal will shape every negotiation that follows.',
    tone: 'hostile',
    relatedId: options.agreementId ?? null,
  });
  return { ok: true, breacher, harmed };
}

export function recordDiplomaticEvent(state, event = {}) {
  const actor = event.actor ?? PLAYER_ID;
  const target = event.target ?? event.factionId ?? null;
  if (event.type === 'contact_detected') return detectContact(state, target, {
    trigger: event.trigger ?? 'exploration', intelligence: event.intelligence ?? 20,
  });
  if (!target || !actorExists(state, actor) || !actorExists(state, target) || actor === target) {
    return { ok: false, reason: 'Diplomatic event requires two known actors' };
  }
  const severity = clamp(event.severity ?? 1, 0.1, 10);
  const presets = {
    border_friction: { opinion: -2, trust: -1, fear: 0.5, respect: 0, durationMs: 180000 },
    trespass: { opinion: -5, trust: -4, fear: 1, respect: -1, durationMs: 300000 },
    convoy_delivered: { opinion: 3, trust: 4, fear: 0, respect: 1, durationMs: 300000 },
    convoy_intercepted: { opinion: -8, trust: -6, fear: 2, respect: -1, durationMs: 420000 },
    blockade: { opinion: -10, trust: -8, fear: 2, respect: 1, durationMs: 420000 },
    battle_victory: { opinion: -4, trust: -2, fear: 3, respect: 2, durationMs: 300000 },
    occupation: { opinion: -15, trust: -10, fear: 6, respect: 2, durationMs: 600000 },
    gift: { opinion: 5, trust: 3, fear: 0, respect: 1, durationMs: 300000 },
    promise_honored: { opinion: 4, trust: 8, fear: 0, respect: 2, durationMs: 600000 },
    aid_honored: { opinion: 8, trust: 12, fear: 0, respect: 5, durationMs: 600000 },
    council_support: { opinion: 4, trust: 5, fear: 0, respect: 2, durationMs: 300000 },
    dyson_completed: { opinion: 0, trust: 0, fear: 4, respect: 8, durationMs: 600000 },
  };
  if (event.type === 'treaty_breach') return registerTreatyBreach(state, actor, target, event);
  if (event.type === 'helioclast_create' || event.type === 'helioclast_destroy' || event.type === 'helioclast_threat') {
    return escalateHelioclastCrisis(state, {
      actor, target, destructive: event.type === 'helioclast_destroy', systemId: event.systemId,
    });
  }
  const preset = presets[event.type];
  if (!preset) {
    recordHistory(state, 'diplomatic_event', { event });
    return { ok: true, event };
  }
  const result = addActorRelationshipModifier(state, target, actor, {
    source: event.type,
    label: event.label ?? event.type.replaceAll('_', ' '),
    opinion: preset.opinion * severity,
    trust: preset.trust * severity,
    fear: preset.fear * severity,
    respect: preset.respect * severity,
    durationMs: event.durationMs ?? preset.durationMs,
    stackKey: event.stackKey ?? null,
    details: event.details ?? { systemId: event.systemId ?? null },
  });
  return { ...result, event };
}

function requiredTreatyTech(statusOrType) {
  switch (statusOrType) {
    case AGREEMENT_TRUCE:
      return { id: 'dip_truce_protocol', label: 'Truce Protocol' };
    case AGREEMENT_TRADE:
    case AGREEMENT_OPEN_BORDERS:
      return { id: 'dip_trade_charter', label: 'Trade Charter' };
    case AGREEMENT_DEFENSE:
    case AGREEMENT_ALLIANCE:
      return { id: 'dip_alliance_pact', label: 'Alliance Pact' };
    default:
      return null;
  }
}

export function requiredDiplomacyTech(statusOrType) {
  return requiredTreatyTech(statusOrType);
}

function treatyTechCheck(state, statusOrType) {
  const requirement = requiredTreatyTech(statusOrType);
  if (!requirement) return { ok: true };
  if (!isTechUnlocked(state, requirement.id)) {
    return { ok: false, reason: `Research ${requirement.label} first` };
  }
  return { ok: true };
}

function activeAgreementRecords(state, type = null, parties = null) {
  const at = now(state);
  const key = parties ? pairKey(...normalizeParties(parties)) : null;
  return ensureDiplomacy(state).agreements.filter((agreement) => (
    activeAt(agreement, at)
    && (!type || agreement.type === type)
    && (!key || pairKey(...normalizeParties(agreement.parties)) === key)
  ));
}

export function listActiveAgreements(state, factionId = null) {
  return activeAgreementRecords(state).filter((agreement) => (
    !factionId || agreement.parties.includes(factionId)
  ));
}

export function hasAgreement(state, factionId, type, actorId = PLAYER_ID) {
  return activeAgreementRecords(state, type, [actorId, factionId]).length > 0;
}

function syncActorRelationStatus(state, actorA, actorB) {
  const relation = getActorRelation(state, actorA, actorB);
  let status = RELATION_NEUTRAL;
  if (getActiveWar(state, [actorA, actorB])) status = RELATION_WAR;
  else if (hasAgreement(state, actorB, AGREEMENT_ALLIANCE, actorA)
      || hasAgreement(state, actorB, AGREEMENT_DEFENSE, actorA)) status = RELATION_ALLIANCE;
  else if (hasAgreement(state, actorB, AGREEMENT_TRADE, actorA)) status = RELATION_TRADE;
  else if (hasAgreement(state, actorB, AGREEMENT_TRUCE, actorA)
      || hasAgreement(state, actorB, AGREEMENT_CEASEFIRE, actorA)
      || hasAgreement(state, actorB, AGREEMENT_NON_AGGRESSION, actorA)) status = RELATION_TRUCE;
  relation.status = status;
  relation.treaties = activeAgreementRecords(state, null, [actorA, actorB]).map((agreement) => agreement.type);
  relation.lastChangedAt = now(state);
  return relation;
}

function syncRelationStatus(state, factionId) {
  return syncActorRelationStatus(state, PLAYER_ID, factionId);
}

function validateAgreement(state, input, options = {}) {
  if (!AGREEMENT_TYPES.includes(input.type)) return { ok: false, reason: 'Unknown agreement type' };
  const parties = normalizeParties(input.parties);
  if (parties.length !== 2 || !parties.every((actorId) => actorExists(state, actorId))) {
    return { ok: false, reason: 'Agreement requires two known parties' };
  }
  if (!options.bypassTech && parties.includes(PLAYER_ID)) {
    const tech = treatyTechCheck(state, input.type);
    if (!tech.ok) return tech;
  }
  const war = getActiveWar(state, parties);
  if (war && ![AGREEMENT_CEASEFIRE, AGREEMENT_TRUCE, AGREEMENT_TRIBUTE].includes(input.type)) {
    return { ok: false, reason: 'End the active war before forming this agreement' };
  }
  if ([AGREEMENT_TRADE, AGREEMENT_ALLIANCE].includes(input.type)) {
    for (const actorId of parties) {
      const counterpart = parties.find((party) => party !== actorId);
      if (sanctionEffects(state, actorId, counterpart).blocksTradeOrAlliance) {
        return { ok: false, reason: 'Council sanctions block a new trade or alliance agreement with a supporting voter' };
      }
    }
  }
  if (input.type === AGREEMENT_TRIBUTE) {
    const payer = input.terms?.payer;
    const payee = input.terms?.payee;
    if (!parties.includes(payer) || !parties.includes(payee) || payer === payee) {
      return { ok: false, reason: 'Tribute requires a payer and payee in the agreement' };
    }
    if (finite(input.terms?.creditsPerMinute) <= 0 && finite(input.terms?.solariiPerMinute) <= 0) {
      return { ok: false, reason: 'Tribute must transfer Credits or Solarii' };
    }
  }
  return { ok: true, parties, war };
}

export function createAgreement(state, typeOrInput, factionIdOrOptions = null, maybeOptions = {}) {
  const input = typeof typeOrInput === 'object'
    ? { ...typeOrInput }
    : {
        type: typeOrInput,
        parties: Array.isArray(factionIdOrOptions)
          ? factionIdOrOptions
          : [PLAYER_ID, typeof factionIdOrOptions === 'string' ? factionIdOrOptions : maybeOptions.factionId],
        ...(typeof factionIdOrOptions === 'object' && !Array.isArray(factionIdOrOptions)
          ? factionIdOrOptions
          : maybeOptions),
      };
  const options = typeof typeOrInput === 'object' ? factionIdOrOptions ?? {} : maybeOptions;
  input.parties = normalizeParties(input.parties);
  input.terms = clone(input.terms ?? {});
  const validation = validateAgreement(state, input, options);
  if (!validation.ok) return validation;
  const existing = activeAgreementRecords(state, input.type, validation.parties)[0];
  if (existing) return { ok: true, agreement: existing, existing: true };

  if (validation.war && input.type === AGREEMENT_TRUCE) {
    const ended = endWar(state, validation.war.id, {
      reason: input.type,
      restoreOccupations: options.restoreOccupations !== false,
    });
    if (!ended.ok) return ended;
  }
  const durationMs = input.durationMs == null ? null : Math.max(0, finite(input.durationMs));
  const agreement = {
    id: nextId(state, 'agreement'),
    type: input.type,
    parties: validation.parties,
    status: 'active',
    startedAt: now(state),
    expiresAt: durationMs == null ? null : now(state) + durationMs,
    terms: input.terms,
    sourceProposalId: input.sourceProposalId ?? null,
    lastPaidAt: now(state),
  };
  ensureDiplomacy(state).agreements.push(agreement);
  if (validation.war && input.type === AGREEMENT_CEASEFIRE) {
    validation.war.ceasefireUntil = agreement.expiresAt ?? now(state) + DIPLOMACY_CONFIG.ceasefireDurationMs;
    for (const battle of Object.values(state.systemBattles ?? {})) {
      if (!battle?.active) continue;
      const enemyIds = asArray(battle.enemyFactionIds);
      if (!validation.parties.includes(PLAYER_ID)
          || !enemyIds.some((actorId) => validation.parties.includes(actorId))) continue;
      battle.active = false;
      battle.endedAt = now(state);
      battle.winner = 'ceasefire';
      battle.resolveReason = 'diplomatic_ceasefire';
    }
  }
  if (agreement.type === AGREEMENT_TRADE && agreement.parties.includes(PLAYER_ID)
      && state.milestones?.diplomacyUnlocked) {
    noteDiplomacyMissionObjective(state, 'diplomatic_legitimacy', 'trade_treaty', ['trade_treaty']);
  }
  const factionId = relationFactionFromParties(agreement.parties);
  if (factionId) {
    establishContact(state, factionId, { stage: CONTACT_ESTABLISHED, trigger: 'agreement' });
    syncRelationStatus(state, factionId);
  }
  if (!factionId) syncActorRelationStatus(state, agreement.parties[0], agreement.parties[1]);
  recordHistory(state, 'agreement_created', { agreement });
  return { ok: true, agreement };
}

export function endAgreement(state, agreementId, options = {}) {
  const agreement = ensureDiplomacy(state).agreements.find((entry) => entry.id === agreementId);
  if (!agreement) return { ok: false, reason: 'Unknown agreement' };
  if (agreement.status !== 'active') return { ok: true, agreement, alreadyEnded: true };
  agreement.status = options.status ?? 'ended';
  agreement.endedAt = now(state);
  agreement.endedReason = options.reason ?? 'cancelled';
  agreement.breachedBy = options.breachedBy ?? null;
  const factionId = relationFactionFromParties(agreement.parties);
  if (factionId) {
    syncRelationStatus(state, factionId);
  }
  if (!factionId && agreement.parties.length === 2) syncActorRelationStatus(state, agreement.parties[0], agreement.parties[1]);
  if (agreement.breachedBy && agreement.parties.includes(agreement.breachedBy)) {
    const harmed = agreement.parties.find((actorId) => actorId !== agreement.breachedBy);
    registerTreatyBreach(state, agreement.breachedBy, harmed, {
      agreementId: agreement.id,
      severity: options.severity ?? 1,
      reason: agreement.endedReason,
    });
  }
  recordHistory(state, 'agreement_ended', { agreementId, reason: agreement.endedReason, breachedBy: agreement.breachedBy });
  return { ok: true, agreement };
}

export function createClaim(state, factionIdOrInput, systemId = null, options = {}) {
  const input = typeof factionIdOrInput === 'object'
    ? { ...factionIdOrInput }
    : { target: factionIdOrInput, systemId, ...options };
  input.claimant ??= PLAYER_ID;
  if (!actorExists(state, input.claimant) || !actorExists(state, input.target)) {
    return { ok: false, reason: 'Unknown claimant or target' };
  }
  if (!input.systemId) return { ok: false, reason: 'Claim requires a system' };
  const existing = ensureDiplomacy(state).claims.find((claim) => (
    claim.status === 'active' && claim.claimant === input.claimant && claim.systemId === input.systemId
  ));
  if (existing) return { ok: true, claim: existing, existing: true };
  const claim = {
    id: nextId(state, 'claim'),
    claimant: input.claimant,
    target: input.target,
    systemId: input.systemId,
    galaxyId: input.galaxyId ?? state.activeGalaxyId ?? null,
    status: 'active',
    createdAt: now(state),
    source: input.source ?? 'manual',
  };
  const competing = ensureDiplomacy(state).claims.filter((entry) => (
    entry.status === 'active' && entry.systemId === input.systemId && entry.claimant !== input.claimant
  ));
  ensureDiplomacy(state).claims.push(claim);
  for (const rival of competing) recordDiplomaticEvent(state, {
    type: 'border_friction', actor: input.claimant, target: rival.claimant,
    systemId: input.systemId, severity: 1.5,
  });
  if (input.target !== PLAYER_ID) establishContact(state, input.target, { stage: CONTACT_CONTACTED, trigger: 'claim' });
  recordHistory(state, 'claim_created', { claim });
  return { ok: true, claim };
}

export function withdrawClaim(state, claimId, options = {}) {
  const claim = ensureDiplomacy(state).claims.find((entry) => entry.id === claimId);
  if (!claim) return { ok: false, reason: 'Unknown claim' };
  claim.status = 'withdrawn';
  claim.withdrawnAt = now(state);
  claim.reason = options.reason ?? 'withdrawn';
  recordHistory(state, 'claim_withdrawn', { claimId, reason: claim.reason });
  return { ok: true, claim };
}

export function listClaims(state, options = {}) {
  return ensureDiplomacy(state).claims.filter((claim) => (
    (!options.activeOnly || claim.status === 'active')
    && (!options.factionId || claim.claimant === options.factionId || claim.target === options.factionId)
    && (!options.systemId || claim.systemId === options.systemId)
  ));
}

function normalizeWarGoals(goals, fallbackSystems = []) {
  const source = asArray(goals).length ? goals : [{ type: 'border_security', systemIds: fallbackSystems }];
  return source.map((goal) => ({
    type: WAR_GOAL_TYPES.includes(goal?.type) ? goal.type : 'border_security',
    systemIds: [...new Set(asArray(goal?.systemIds).filter(Boolean))],
    target: goal?.target ?? null,
    fulfilled: !!goal?.fulfilled,
  }));
}

export function getActiveWar(state, factionIdOrParties = null) {
  const at = now(state);
  const wars = ensureDiplomacy(state).wars.filter((war) => activeAt(war, at));
  if (!factionIdOrParties) return wars[0] ?? null;
  if (Array.isArray(factionIdOrParties)) {
    const parties = normalizeParties(factionIdOrParties);
    return wars.find((war) => {
      if (!parties.every((actorId) => war.parties.includes(actorId))) return false;
      if (parties.length !== 2) return true;
      return (war.attackers.includes(parties[0]) && war.defenders.includes(parties[1]))
        || (war.attackers.includes(parties[1]) && war.defenders.includes(parties[0]));
    }) ?? null;
  }
  return wars.find((war) => war.id === factionIdOrParties
    || (war.parties.includes(PLAYER_ID) && war.parties.includes(factionIdOrParties))) ?? null;
}

export function declareWar(state, factionIdOrInput, options = {}) {
  const input = typeof factionIdOrInput === 'object'
    ? { ...factionIdOrInput }
    : { attacker: options.attacker ?? PLAYER_ID, defender: factionIdOrInput, ...options };
  const attacker = input.attacker ?? PLAYER_ID;
  const defender = input.defender;
  if (!actorExists(state, attacker) || !actorExists(state, defender) || attacker === defender) {
    return { ok: false, reason: 'War requires two different known parties' };
  }
  const existing = getActiveWar(state, [attacker, defender]);
  if (existing) return { ok: true, war: existing, existing: true };
  const blockingTruce = activeAgreementRecords(state, null, [attacker, defender])
    .find((agreement) => [AGREEMENT_CEASEFIRE, AGREEMENT_TRUCE, AGREEMENT_NON_AGGRESSION].includes(agreement.type));
  if (blockingTruce && !input.force) return { ok: false, reason: 'An enforced ceasefire or truce is active' };

  let breachRecorded = false;
  for (const agreement of activeAgreementRecords(state, null, [attacker, defender])) {
    endAgreement(state, agreement.id, {
      reason: 'war_declared',
      breachedBy: breachRecorded ? null : attacker,
      severity: [AGREEMENT_ALLIANCE, AGREEMENT_DEFENSE].includes(agreement.type) ? 2 : 1,
    });
    breachRecorded = true;
  }
  const parties = normalizeParties([attacker, defender]);
  const goals = normalizeWarGoals(input.goals, input.systemIds);
  const validClaimedGoals = goals.filter((goal) => goal.type === 'claimed_conquest')
    .flatMap((goal) => goal.systemIds)
    .filter((systemId) => listClaims(state, { activeOnly: true, systemId })
      .some((claim) => claim.claimant === attacker && claim.target === defender));
  const legitimacy = clamp(input.legitimacy ?? (validClaimedGoals.length
    ? 100
    : goals.some((goal) => goal.type === 'superweapon_containment')
      ? 85
      : goals.some((goal) => goal.type === 'border_security' && goal.systemIds.length)
        ? 60
        : 25), 0, 100);
  const war = {
    id: nextId(state, 'war'),
    status: 'active',
    attackers: [attacker],
    defenders: [defender],
    parties,
    primaryAttacker: attacker,
    primaryDefender: defender,
    factionId: attacker === PLAYER_ID ? defender : attacker,
    goals,
    escalation: 'limited',
    escalationAt: now(state),
    legitimacy,
    score: 0,
    scoreByActor: { [attacker]: 0, [defender]: 0 },
    exhaustion: { [attacker]: 0, [defender]: 0 },
    events: [],
    startedAt: now(state),
    lastExhaustionAt: now(state),
    authorizedByCampaignId: input.authorizedByCampaignId ?? null,
  };
  ensureDiplomacy(state).wars.push(war);
  syncActorRelationStatus(state, attacker, defender);
  const factionId = relationFactionFromParties(parties);
  if (factionId) {
    establishContact(state, factionId, { stage: CONTACT_ESTABLISHED, trigger: 'war' });
    addActorRelationshipModifier(state, defender, attacker, {
      source: 'war_declaration', label: 'Declaration of war', opinion: -15, trust: -20, fear: 5, respect: 2,
    });
  }
  if (legitimacy < 50) adjustActorReputation(state, attacker, -15, 'unjustified_war');
  issueDefensiveCalls(state, war, defender, attacker);
  if (parties.includes(PLAYER_ID)) {
    const counterpart = parties.find((actorId) => actorId !== PLAYER_ID);
    addTransmission(state, {
      from: counterpart,
      to: PLAYER_ID,
      kind: 'threat',
      subject: input.ultimatum ? 'Ultimatum failed — hostilities begin' : 'Formal declaration of war',
      body: `War has begun at ${war.escalation} escalation. Declared goals: ${war.goals.map((goal) => goal.type.replaceAll('_', ' ')).join(', ')}.`,
      tone: 'hostile',
      relatedId: war.id,
    });
  }
  recordHistory(state, 'war_declared', { war });
  return { ok: true, war };
}

function warFromReference(state, warIdOrFaction) {
  return ensureDiplomacy(state).wars.find((war) => war.id === warIdOrFaction)
    ?? getActiveWar(state, warIdOrFaction);
}

export function recordWarEvent(state, warIdOrFaction, event = {}) {
  const war = warFromReference(state, warIdOrFaction);
  if (!war || war.status !== 'active') return { ok: false, reason: 'No active war' };
  const actor = event.actor ?? PLAYER_ID;
  if (!war.parties.includes(actor)) return { ok: false, reason: 'Actor is not part of this war' };
  const defaultScores = {
    battle_victory: 10,
    battle_defeat: -10,
    occupation: 15,
    lost_system: -15,
    blockade: 5,
    strategic_asset_destroyed: 20,
    goal_fulfilled: 25,
  };
  const actorDelta = finite(event.scoreDelta, defaultScores[event.type] ?? 0);
  const scoreSign = war.parties.includes(PLAYER_ID)
    ? (actor === PLAYER_ID ? 1 : -1)
    : (war.attackers.includes(actor) ? 1 : -1);
  war.score = clamp(war.score + actorDelta * scoreSign, -100, 100);
  war.scoreByActor[actor] = round2(finite(war.scoreByActor[actor]) + actorDelta);
  const exhaustionDelta = Math.max(0, finite(event.exhaustionDelta,
    ['battle_defeat', 'lost_system'].includes(event.type) ? Math.abs(actorDelta) * 0.5 : 1));
  war.exhaustion[actor] = clamp(finite(war.exhaustion[actor]) + exhaustionDelta, 0, 100);
  const entry = {
    id: `${war.id}:event:${war.events.length + 1}`,
    at: now(state),
    type: event.type ?? 'war_event',
    actor,
    scoreDelta: actorDelta,
    exhaustionDelta,
    galaxyId: event.galaxyId ?? null,
    systemId: event.systemId ?? null,
    details: clone(event.details ?? {}),
  };
  war.events.push(entry);
  if (event.type === 'occupation' && event.systemId) {
    for (const goal of war.goals) {
      if (goal.fulfilled || !goal.systemIds.includes(event.systemId)) continue;
      const correctSide = war.attackers.includes(actor) && ['claimed_conquest', 'border_security'].includes(goal.type);
      if (!correctSide) continue;
      goal.fulfilled = true;
      goal.fulfilledAt = now(state);
      goal.fulfilledBy = actor;
      war.score = clamp(war.score + 25 * scoreSign, -100, 100);
      war.scoreByActor[actor] = round2(finite(war.scoreByActor[actor]) + 25);
    }
  }
  if (event.type?.startsWith('battle')) {
    const opponents = war.attackers.includes(actor) ? war.defenders : war.attackers;
    for (const opponent of opponents) recordDiplomaticEvent(state, {
      type: 'battle_victory',
      actor: event.type === 'battle_defeat' ? opponent : actor,
      target: event.type === 'battle_defeat' ? actor : opponent,
      severity: Math.max(0.5, Math.abs(actorDelta) / 10),
      systemId: event.systemId,
    });
  }
  recordHistory(state, 'war_event', { warId: war.id, event: entry });
  return { ok: true, war, event: entry };
}

export function escalateWar(state, warIdOrFaction, level, options = {}) {
  const war = warFromReference(state, warIdOrFaction);
  if (!war || war.status !== 'active') return { ok: false, reason: 'No active war' };
  const order = { limited: 0, expanded: 1, total: 2 };
  if (!(level in order) || order[level] <= order[war.escalation ?? 'limited']) {
    return { ok: false, reason: 'Escalation must increase the current war level' };
  }
  const elapsed = now(state) - finite(war.startedAt);
  const majorIncident = !!options.majorIncident || !!options.homeSystemAttacked || !!options.destructiveHelioclast;
  if (!options.force && level === 'expanded' && elapsed < DIPLOMACY_CONFIG.war.expandedAfterMs && !majorIncident) {
    return { ok: false, reason: 'Expanded war is not yet available' };
  }
  if (!options.force && level === 'total' && elapsed < DIPLOMACY_CONFIG.war.totalAfterMs && !majorIncident) {
    return { ok: false, reason: 'Total war is not yet available' };
  }
  const actor = options.actor ?? war.primaryAttacker;
  war.escalation = level;
  war.escalationAt = now(state);
  war.exhaustion[actor] = clamp(finite(war.exhaustion[actor])
    + (level === 'expanded' ? DIPLOMACY_CONFIG.war.expandedExhaustion : 10), 0, 100);
  adjustActorReputation(state, actor, level === 'expanded'
    ? DIPLOMACY_CONFIG.war.expandedReputation
    : DIPLOMACY_CONFIG.war.totalReputation, `war_${level}`);
  if (level === 'total' && isTechUnlocked(state, 'dip_galactic_council')) {
    const proposer = actorIds(state).filter((actorId) => actorId !== actor).sort()[0];
    if (proposer && !ensureDiplomacy(state).council.resolutions.some((resolution) => (
      resolution.status === 'voting' && resolution.type === 'emergency_coalition' && resolution.target === actor
    ))) {
      proposeCouncilResolution(state, {
        proposer,
        target: actor,
        type: 'emergency_coalition',
        reason: `Emergency session after ${actor} escalated to total war`,
      });
    }
  }
  recordHistory(state, 'war_escalated', { warId: war.id, actor, level, majorIncident });
  return { ok: true, war };
}

export function peaceLeverage(state, warIdOrFaction, actorId = PLAYER_ID) {
  const war = warFromReference(state, warIdOrFaction);
  if (!war || war.status !== 'active' || !war.parties.includes(actorId)) return 0;
  const sideScore = war.parties.includes(PLAYER_ID)
    ? (actorId === PLAYER_ID ? war.score : -war.score)
    : (war.attackers.includes(actorId) ? war.score : -war.score);
  const opponents = war.attackers.includes(actorId) ? war.defenders : war.attackers;
  const opponentExhaustion = opponents.length
    ? opponents.reduce((sum, opponent) => sum + finite(war.exhaustion[opponent]), 0) / opponents.length
    : 0;
  const fulfilledGoals = war.goals.filter((goal) => goal.fulfilled && goal.fulfilledBy === actorId).length;
  const occupiedGoals = ensureDiplomacy(state).occupations.filter((occupation) => occupation.status === 'active'
    && occupation.warId === war.id && occupation.occupier === actorId
    && war.goals.some((goal) => goal.systemIds.includes(occupation.systemId))).length;
  return round2(clamp(Math.max(0, sideScore) + opponentExhaustion * 0.35 + fulfilledGoals * 10 + occupiedGoals * 5, 0, 100));
}

export function peaceDemandCost(state, demand = {}) {
  if (demand.type === 'cession' || demand.type === 'system_transfer') return systemNegotiationValue(state, demand);
  if (demand.type === 'reparations') return round2(finite(demand.credits) * 0.01 + finite(demand.solarii) * 4);
  if (demand.type === 'tribute') {
    const minutes = Math.max(1, finite(demand.durationMs, 300000) / 60000);
    return round2(minutes * (finite(demand.creditsPerMinute) * 0.01 + finite(demand.solariiPerMinute) * 4));
  }
  if (demand.type === 'forced_treaty') return 15;
  if (demand.type === 'humiliation') return 25;
  if (demand.type === 'superweapon_containment') return 30;
  return 0;
}

function mutableSystemRecord(state, systemId, galaxyId = null) {
  if (state.galaxies) {
    const preferredGalaxyId = galaxyId ?? state.activeGalaxyId;
    const galaxyIds = preferredGalaxyId && state.galaxies[preferredGalaxyId]
      ? [preferredGalaxyId]
      : Object.keys(state.galaxies);
    for (const id of galaxyIds) {
      const galaxy = state.galaxies[id];
      if (galaxy?.systems?.[systemId]) return { galaxyId: id, system: galaxy.systems[systemId] };
      if (galaxy?.abstract?.systemOverlays?.[systemId]) {
        return { galaxyId: id, system: galaxy.abstract.systemOverlays[systemId], abstract: true };
      }
    }
    return null;
  }
  const system = state.systems?.[systemId];
  return system ? { galaxyId: galaxyId ?? state.activeGalaxyId ?? 'gal-0', system } : null;
}

function actorForSystem(system, state = null) {
  if (system?.owner === 'player') return PLAYER_ID;
  if (system?.owner === 'ai') {
    return system.factionId
      ?? state?.factions?.ai?.id
      ?? state?.factions?.list?.[0]?.id
      ?? 'unknown-ai';
  }
  return system?.owner === 'neutral' ? 'neutral' : system?.factionId ?? system?.owner ?? null;
}

function setSystemActor(system, actorId) {
  if (actorId === PLAYER_ID) {
    system.owner = 'player';
    system.factionId = null;
  } else if (actorId === 'neutral') {
    system.owner = 'neutral';
    system.factionId = null;
  } else {
    system.owner = 'ai';
    system.factionId = actorId;
  }
  for (const structure of system.structures ?? []) structure.factionId = actorId === PLAYER_ID ? null : actorId;
}

function reconcileTransferredSystem(state, record, actorId) {
  if (!record || record.abstract) return { ok: true, skipped: true };
  return reconcileStructureTechnology(state, record.system.id, actorId === PLAYER_ID
    ? { owner: 'player', galaxyId: record.galaxyId }
    : { owner: 'ai', factionId: actorId, galaxyId: record.galaxyId });
}

function scopedSystemKey(galaxyId, systemId) {
  return `${galaxyId ?? ''}:${systemId ?? ''}`;
}

export function recordOccupation(state, input = {}) {
  const galaxyId = input.galaxyId ?? state.activeGalaxyId ?? null;
  const record = mutableSystemRecord(state, input.systemId, galaxyId);
  if (!record) return { ok: false, reason: 'Unknown system' };
  const occupier = input.occupier ?? PLAYER_ID;
  if (!actorExists(state, occupier)) return { ok: false, reason: 'Unknown occupying faction' };
  const existing = ensureDiplomacy(state).occupations.find((occupation) => (
    occupation.status === 'active' && occupation.systemId === input.systemId && occupation.galaxyId === record.galaxyId
  ));
  if (existing?.occupier === occupier) return { ok: true, occupation: existing, existing: true };
  const controllerBeforeCapture = actorForSystem(record.system, state);
  const previousActor = input.previousActor ?? controllerBeforeCapture;
  if (previousActor !== 'neutral' && previousActor != null && !actorExists(state, previousActor)) {
    return { ok: false, reason: 'Unknown previous controller' };
  }
  const sovereignActor = input.sovereignActor ?? existing?.sovereignActor ?? existing?.previousActor ?? previousActor;
  const war = input.warId ? warFromReference(state, input.warId) : getActiveWar(state, [occupier, previousActor]);
  if (war?.status !== 'active' && !input.force) return { ok: false, reason: 'Occupation requires an active war' };
  if (existing) {
    existing.status = 'superseded';
    existing.settledAt = now(state);
    existing.supersededAt = now(state);
    existing.supersededByActor = occupier;
  }
  const occupation = {
    id: nextId(state, 'occupation'),
    warId: war?.id ?? input.warId ?? null,
    galaxyId: record.galaxyId,
    systemId: input.systemId,
    occupier,
    previousActor,
    sovereignActor,
    previousOwner: input.previousOwner ?? record.system.owner,
    previousFactionId: input.previousFactionId ?? record.system.factionId ?? null,
    sovereignOwner: input.sovereignOwner ?? existing?.sovereignOwner ?? existing?.previousOwner ?? record.system.owner,
    sovereignFactionId: input.sovereignFactionId ?? existing?.sovereignFactionId ?? existing?.previousFactionId ?? record.system.factionId ?? null,
    status: 'active',
    occupiedAt: now(state),
  };
  if (existing) existing.supersededBy = occupation.id;
  setSystemActor(record.system, occupier);
  reconcileTransferredSystem(state, record, occupier);
  ensureDiplomacy(state).occupations.push(occupation);
  if (war) recordWarEvent(state, war.id, {
    type: 'occupation', actor: occupier, galaxyId: record.galaxyId, systemId: input.systemId,
  });
  if (previousActor && previousActor !== 'neutral') recordDiplomaticEvent(state, {
    type: 'occupation', actor: occupier, target: previousActor, systemId: input.systemId,
  });
  recordHistory(state, 'system_occupied', { occupation });
  return { ok: true, occupation, supersededOccupationId: existing?.id ?? null };
}

export function settleOccupation(state, occupationId, options = {}) {
  const occupation = ensureDiplomacy(state).occupations.find((entry) => entry.id === occupationId);
  if (!occupation) return { ok: false, reason: 'Unknown occupation' };
  if (occupation.status !== 'active') return { ok: true, occupation, alreadySettled: true };
  const record = mutableSystemRecord(state, occupation.systemId, occupation.galaxyId);
  if (!record) return { ok: false, reason: 'Occupied system is unavailable' };
  const recipient = options.recipient ?? (options.ceded
    ? occupation.occupier
    : occupation.sovereignActor ?? occupation.previousActor);
  setSystemActor(record.system, recipient);
  reconcileTransferredSystem(state, record, recipient);
  occupation.status = options.ceded ? 'ceded' : 'restored';
  occupation.settledAt = now(state);
  occupation.recipient = recipient;
  recordHistory(state, 'occupation_settled', { occupationId, status: occupation.status, recipient });
  return { ok: true, occupation };
}

export function endWar(state, warIdOrFaction, options = {}) {
  const war = warFromReference(state, warIdOrFaction);
  if (!war) return { ok: false, reason: 'Unknown war' };
  if (war.status !== 'active') return { ok: true, war, alreadyEnded: true };
  if (options.restoreOccupations) {
    const activeOccupations = ensureDiplomacy(state).occupations
      .filter((entry) => entry.status === 'active' && entry.warId === war.id);
    const cessionRefs = asArray(options.cededSystems ?? options.cededSystemRefs)
      .filter((entry) => entry && typeof entry === 'object' && entry.systemId);
    const ceded = new Set(cessionRefs
      .filter((entry) => entry.galaxyId)
      .map((entry) => scopedSystemKey(entry.galaxyId, entry.systemId)));
    const legacyIds = [
      ...asArray(options.cededSystemIds),
      ...cessionRefs.filter((entry) => !entry.galaxyId).map((entry) => entry.systemId),
    ];
    for (const systemId of legacyIds) {
      const matches = activeOccupations.filter((occupation) => occupation.systemId === systemId);
      if (matches.length > 1) {
        return { ok: false, reason: `Ambiguous cession ${systemId}; include galaxyId`, systemId };
      }
      if (matches.length === 1) ceded.add(scopedSystemKey(matches[0].galaxyId, matches[0].systemId));
    }
    for (const occupation of activeOccupations) {
      const settled = settleOccupation(state, occupation.id, {
        ceded: ceded.has(scopedSystemKey(occupation.galaxyId, occupation.systemId)),
      });
      if (!settled.ok) return { ok: false, reason: settled.reason, occupationId: occupation.id };
    }
  }
  war.status = 'ended';
  war.endedAt = now(state);
  war.endedReason = options.reason ?? 'peace';
  war.outcome = options.outcome ?? (war.score > 10 ? 'player_victory' : war.score < -10 ? 'faction_victory' : 'negotiated');
  for (let index = 0; index < war.parties.length; index++) {
    for (let other = index + 1; other < war.parties.length; other++) {
      syncActorRelationStatus(state, war.parties[index], war.parties[other]);
    }
  }
  recordHistory(state, 'war_ended', { warId: war.id, reason: war.endedReason, outcome: war.outcome });
  return { ok: true, war };
}

export function issueDefensiveCalls(state, warIdOrWar, defendedActor = null, aggressor = null) {
  const war = typeof warIdOrWar === 'object' ? warIdOrWar : warFromReference(state, warIdOrWar);
  if (!war || war.status !== 'active') return [];
  const defended = defendedActor ?? war.primaryDefender;
  const attacker = aggressor ?? war.primaryAttacker;
  const diplomacy = ensureDiplomacy(state);
  const created = [];
  for (const agreement of activeAgreementRecords(state).filter((entry) => (
    [AGREEMENT_DEFENSE, AGREEMENT_ALLIANCE].includes(entry.type) && entry.parties.includes(defended)
  ))) {
    const ally = agreement.parties.find((actorId) => actorId !== defended);
    if (!ally || ally === attacker || war.parties.includes(ally)) continue;
    const existing = diplomacy.callsToArms.find((call) => call.warId === war.id && call.ally === ally
      && ['pending', 'accepted'].includes(call.status));
    if (existing) continue;
    const call = {
      id: nextId(state, 'call'),
      warId: war.id,
      agreementId: agreement.id,
      caller: defended,
      ally,
      aggressor: attacker,
      status: 'pending',
      createdAt: now(state),
      expiresAt: now(state) + DIPLOMACY_CONFIG.proposalLifetimeMs,
    };
    diplomacy.callsToArms.push(call);
    created.push(call);
    if ([ally, defended].includes(PLAYER_ID)) addTransmission(state, {
      from: defended,
      to: ally,
      kind: 'call_to_arms',
      subject: 'Mandatory defensive call',
      body: `${defended} requests immediate support against ${attacker}. Refusal will breach the defense pact.`,
      actionable: true,
      referenceId: call.id,
    });
    recordHistory(state, 'call_to_arms_issued', { call });
  }
  return created;
}

export function respondToCallToArms(state, callId, accept, actorId = null) {
  const call = ensureDiplomacy(state).callsToArms.find((entry) => entry.id === callId);
  if (!call || call.status !== 'pending') return { ok: false, reason: 'No pending call-to-arms' };
  const actor = actorId ?? call.ally;
  if (actor !== call.ally) return { ok: false, reason: 'Only the called ally may respond' };
  const war = warFromReference(state, call.warId);
  if (!war || war.status !== 'active') {
    call.status = 'expired';
    call.resolvedAt = now(state);
    return { ok: false, reason: 'The war has already ended' };
  }
  call.resolvedAt = now(state);
  if (!accept) {
    call.status = 'refused';
    endAgreement(state, call.agreementId, { reason: 'call_to_arms_refused', breachedBy: actor, severity: 2 });
    recordDiplomaticEvent(state, { type: 'aid_refused', actor, target: call.caller, warId: war.id });
    recordHistory(state, 'call_to_arms_refused', { callId, actor, warId: war.id });
    return { ok: true, call, accepted: false };
  }
  call.status = 'accepted';
  if (!war.defenders.includes(actor)) war.defenders.push(actor);
  if (!war.parties.includes(actor)) war.parties.push(actor);
  war.scoreByActor[actor] ??= 0;
  war.exhaustion[actor] ??= 0;
  recordDiplomaticEvent(state, { type: 'aid_honored', actor, target: call.caller, warId: war.id });
  addActorRelationshipModifier(state, call.caller, actor, {
    source: `call:${call.id}`, label: 'Honored defensive call', opinion: 12, trust: 15, respect: 10,
  });
  recordHistory(state, 'call_to_arms_accepted', { callId, actor, warId: war.id });
  return { ok: true, call, accepted: true, war };
}

function transferResources(state, from, to, resource, amount) {
  const normalizedAmount = Math.max(0, finite(amount));
  const source = walletForActor(state, from);
  const destination = walletForActor(state, to);
  if (!source || !destination) throw new Error('Unknown resource-transfer party');
  if (!['credits', 'solarii'].includes(resource)) throw new Error('Unknown resource type');
  if (finite(source[resource]) < normalizedAmount) throw new Error(`${from} lacks ${resource}`);
  source[resource] = finite(source[resource]) - normalizedAmount;
  destination[resource] = finite(destination[resource]) + normalizedAmount;
}

export function concludePeace(state, factionIdOrWar, terms = {}) {
  const war = warFromReference(state, factionIdOrWar);
  if (!war || war.status !== 'active') return { ok: false, reason: 'No active war' };
  const proposer = terms.proposer ?? PLAYER_ID;
  const demands = [
    ...asArray(terms.cededSystems ?? terms.cededSystemRefs).map((entry) => ({ type: 'cession', ...entry })),
    ...asArray(terms.cededSystemIds).map((systemId) => ({ type: 'cession', systemId })),
    ...(terms.reparations ? [{ type: 'reparations', ...terms.reparations }] : []),
    ...(terms.tribute ? [{ type: 'tribute', ...terms.tribute }] : []),
    ...asArray(terms.demands),
  ];
  if (!war.parties.includes(proposer)) return { ok: false, reason: 'Peace proposer is not part of this war' };
  if (!terms.force && (war.escalation ?? 'limited') === 'limited') {
    const declaredSystems = new Set(war.goals.flatMap((goal) => goal.systemIds));
    const declaredTypes = new Set(war.goals.map((goal) => goal.type));
    const illegitimate = demands.find((demand) => {
      if (['cession', 'system_transfer'].includes(demand.type)) return !declaredSystems.has(demand.systemId);
      if (demand.type === 'tribute') return !declaredTypes.has('tribute');
      if (demand.type === 'forced_treaty') return !declaredTypes.has('forced_treaty');
      if (demand.type === 'humiliation' || demand.type === 'reparations') return !declaredTypes.has('humiliation');
      if (demand.type === 'superweapon_containment') return !declaredTypes.has('superweapon_containment');
      return false;
    });
    if (illegitimate) return { ok: false, reason: 'Limited-war peace demands must follow the declared war goals', demand: illegitimate };
  }
  const demandCost = round2(demands.reduce((sum, demand) => sum + peaceDemandCost(state, demand), 0));
  const leverage = peaceLeverage(state, war.id, proposer);
  if (!terms.force && demandCost > leverage + 0.001) {
    return { ok: false, reason: `Peace demands cost ${demandCost} leverage; only ${leverage} is available`, demandCost, leverage };
  }
  const cededSystemIds = [...new Set(asArray(terms.cededSystemIds))];
  const cededSystems = asArray(terms.cededSystems ?? terms.cededSystemRefs)
    .filter((entry) => entry && typeof entry === 'object' && entry.systemId)
    .map((entry) => ({ galaxyId: entry.galaxyId, systemId: entry.systemId }));
  const reparations = terms.reparations ?? null;
  if (reparations) {
    const source = walletForActor(state, reparations.from);
    if (!source) return { ok: false, reason: 'Unknown reparations payer' };
    if (finite(reparations.credits) > finite(source.credits)) return { ok: false, reason: 'Insufficient Credits for reparations' };
    if (finite(reparations.solarii) > finite(source.solarii)) return { ok: false, reason: 'Insufficient Solarii for reparations' };
  }
  const snapshot = snapshotAtomicState(state);
  try {
    if (reparations?.credits) transferResources(state, reparations.from, reparations.to, 'credits', reparations.credits);
    if (reparations?.solarii) transferResources(state, reparations.from, reparations.to, 'solarii', reparations.solarii);
    const ended = endWar(state, war.id, {
      reason: terms.reason ?? 'peace_treaty',
      outcome: terms.outcome,
      restoreOccupations: true,
      cededSystemIds,
      cededSystems,
    });
    if (!ended.ok) throw new Error(ended.reason);
    const factionId = relationFactionFromParties(war.parties);
    const truceResults = [];
    for (const attacker of war.attackers) {
      for (const defender of war.defenders) {
        if (attacker === defender) continue;
        const truce = createAgreement(state, {
          type: AGREEMENT_TRUCE,
          parties: [attacker, defender],
          durationMs: terms.truceMs ?? DEFAULT_PEACE_TRUCE_MS,
          terms: { peaceWarId: war.id },
        }, { bypassTech: true });
        if (!truce.ok) throw new Error(truce.reason);
        truceResults.push(truce.agreement);
      }
    }
    const truce = truceResults.find((agreement) => agreement.parties.includes(proposer)) ?? truceResults[0];
    if (!truce) throw new Error('Peace settlement could not establish cross-side truces');
    let tribute = null;
    if (terms.tribute) {
      const payer = terms.tribute.payer ?? terms.tribute.from;
      const payee = terms.tribute.payee ?? terms.tribute.to;
      tribute = createAgreement(state, {
        type: AGREEMENT_TRIBUTE,
        parties: [payer, payee],
        durationMs: terms.tribute.durationMs ?? 300000,
        terms: { ...terms.tribute, payer, payee },
      }, { bypassTech: true });
      if (!tribute.ok) throw new Error(tribute.reason);
    }
    const opponent = war.parties.find((actorId) => actorId !== proposer) ?? war.primaryDefender;
    for (const demand of asArray(terms.demands)) {
      if (demand.type === 'forced_treaty' && demand.agreementType) {
        const forced = createAgreement(state, {
          type: demand.agreementType,
          parties: [proposer, opponent],
          durationMs: demand.durationMs ?? DEFAULT_PEACE_TRUCE_MS,
          terms: { forcedByWarId: war.id },
        }, { bypassTech: true });
        if (!forced.ok) throw new Error(forced.reason);
      }
      if (demand.type === 'humiliation') {
        adjustActorReputation(state, opponent, -15, 'war_humiliation');
        addActorRelationshipModifier(state, proposer, opponent, {
          source: 'war_humiliation', label: 'Humiliated in peace settlement', respect: -20, opinion: -10, durationMs: 600000,
        });
      }
      if (demand.type === 'superweapon_containment') {
        const containment = createAgreement(state, {
          type: AGREEMENT_NON_AGGRESSION,
          parties: [proposer, opponent],
          durationMs: demand.durationMs ?? 300000,
          terms: { commitment: demand.commitment ?? 'inspection', actor: opponent, helioclast: true, forcedByWarId: war.id },
        }, { bypassTech: true });
        if (!containment.ok) throw new Error(containment.reason);
      }
    }
    if (war.goals.some((goal) => goal.type === 'border_security')) {
      for (const claim of listClaims(state, { activeOnly: true })) {
        if (claim.claimant === opponent && claim.target === proposer) withdrawClaim(state, claim.id, { reason: 'border_security_peace' });
      }
    }
    if (war.parties.includes(PLAYER_ID)) {
      const counterpart = war.parties.find((actorId) => actorId !== PLAYER_ID);
      addTransmission(state, {
        from: counterpart ?? proposer,
        to: PLAYER_ID,
        kind: 'peace',
        subject: 'Peace settlement ratified',
        body: `The war has ended. Cross-side truces will remain enforceable for ${Math.round((terms.truceMs ?? DEFAULT_PEACE_TRUCE_MS) / 1000)} seconds.`,
        tone: 'formal',
        relatedId: war.id,
      });
    }
    recordHistory(state, 'peace_concluded', { warId: war.id, factionId, cededSystemIds, reparations, tributeId: tribute?.agreement?.id ?? null });
    return { ok: true, war: ended.war, truce, truces: truceResults, tribute: tribute?.agreement ?? null };
  } catch (error) {
    restoreAtomicState(state, snapshot);
    return { ok: false, reason: error?.message ?? 'Peace terms could not be applied atomically' };
  }
}

export function isAtWar(state, factionId) {
  return !!getActiveWar(state, factionId) || getRelation(state, factionId).status === RELATION_WAR;
}

export function isAllied(state, factionId) {
  return hasAgreement(state, factionId, AGREEMENT_ALLIANCE)
    || getRelation(state, factionId).status === RELATION_ALLIANCE;
}

export function aiShouldContestPlayer(state, factionId = 'ai-0') {
  return isAtWar(state, factionId);
}

export function canAttackFaction(state, targetFactionId, actorId = PLAYER_ID) {
  if (actorId === targetFactionId) return { ok: false, reason: 'Cannot attack your own forces' };
  if (!actorExists(state, actorId) || !actorExists(state, targetFactionId)) {
    return { ok: false, reason: 'Unknown attacker or target faction' };
  }
  const war = getActiveWar(state, [actorId, targetFactionId]);
  const ceasefire = activeAgreementRecords(state, AGREEMENT_CEASEFIRE, [actorId, targetFactionId])[0];
  if (ceasefire) return { ok: false, reason: 'An active ceasefire suspends combat', agreementId: ceasefire.id };
  return war ? { ok: true, warId: war.id } : { ok: false, reason: 'A formal war is required' };
}

export function canAttackSystem(state, systemOrId, actorId = PLAYER_ID, options = {}) {
  const system = typeof systemOrId === 'string'
    ? mutableSystemRecord(state, systemOrId, options.galaxyId)?.system
    : systemOrId;
  if (!system) return { ok: false, reason: 'Unknown system' };
  const owner = actorForSystem(system, state);
  if (owner === 'neutral' || owner == null) return { ok: true, neutral: true };
  return canAttackFaction(state, owner, actorId);
}

export function canTransitFactionTerritory(state, territoryFactionId, actorId = PLAYER_ID, options = {}) {
  if (territoryFactionId === actorId || territoryFactionId === 'neutral' || territoryFactionId == null) return { ok: true };
  if (!actorExists(state, territoryFactionId) || !actorExists(state, actorId)) return { ok: false, reason: 'Unknown territory owner' };
  const parties = [actorId, territoryFactionId];
  const permitted = [AGREEMENT_OPEN_BORDERS, AGREEMENT_DEFENSE, AGREEMENT_ALLIANCE]
    .some((type) => activeAgreementRecords(state, type, parties).length > 0);
  if (permitted) return { ok: true, agreement: true };
  if (options.allowHostile && getActiveWar(state, parties)) return { ok: true, hostile: true };
  return { ok: false, reason: 'Closed borders' };
}

export function canRouteThroughSystem(state, systemOrId, actorId = PLAYER_ID, options = {}) {
  const system = typeof systemOrId === 'string'
    ? mutableSystemRecord(state, systemOrId, options.galaxyId)?.system
    : systemOrId;
  if (!system) return { ok: false, reason: 'Unknown system' };
  return canTransitFactionTerritory(state, actorForSystem(system, state), actorId, options);
}

export function routeLegality(state, path, actorId = PLAYER_ID, options = {}) {
  const systems = asArray(path);
  const startIndex = options.skipOrigin ? 1 : 0;
  for (let index = startIndex; index < systems.length; index++) {
    const systemId = systems[index];
    const result = canRouteThroughSystem(state, systemId, actorId, options);
    if (!result.ok) return { ok: false, index, systemId, reason: result.reason };
  }
  return { ok: true, path: [...systems] };
}

function normalizeProposalTerm(term, proposal) {
  const source = term && typeof term === 'object' ? clone(term) : {};
  if (['credits', 'solarii'].includes(source.type)) {
    source.resource = source.type;
    source.type = 'resource';
  }
  if (source.type === 'treaty') source.type = 'agreement';
  if (source.type === 'agreement') source.agreementType ??= source.agreement ?? source.treatyType;
  if (source.type === 'resource') {
    source.from ??= proposal.from;
    source.to ??= proposal.to;
    source.amount = Math.max(0, finite(source.amount));
  }
  if (source.type === 'system_transfer') {
    source.from ??= proposal.from;
    source.to ??= proposal.to;
  }
  if (source.type === 'tribute') {
    source.payer ??= proposal.from;
    source.payee ??= proposal.to;
  }
  if (source.type === 'reparations') {
    source.from ??= proposal.from;
    source.to ??= proposal.to;
    source.credits = Math.max(0, finite(source.credits));
    source.solarii = Math.max(0, finite(source.solarii));
  }
  if (source.type === 'favor') {
    source.debtor ??= proposal.to;
    source.creditor ??= proposal.from;
    source.value = clamp(source.value ?? 25, 1, 100);
  }
  if (source.type === 'helioclast_commitment') {
    source.actor ??= proposal.to;
    source.commitment ??= 'non_use';
    source.durationMs = Math.max(60000, finite(source.durationMs, 300000));
  }
  return source;
}

function normalizeProposalInput(input) {
  const proposal = {
    from: input?.from ?? PLAYER_ID,
    to: input?.to ?? input?.factionId,
    message: input?.message ?? '',
    ultimatum: !!input?.ultimatum,
    terms: [],
  };
  proposal.terms = asArray(input?.terms).map((term) => normalizeProposalTerm(term, proposal));
  return proposal;
}

function validateProposalTerms(state, proposal) {
  const errors = [];
  if (!actorExists(state, proposal.from) || !actorExists(state, proposal.to) || proposal.from === proposal.to) {
    errors.push('Proposal requires two different known parties');
  }
  if (!proposal.terms.length) errors.push('Proposal requires at least one term');
  for (const [index, term] of proposal.terms.entries()) {
    const prefix = `Term ${index + 1}`;
    if (term.type === 'resource') {
      if (!['credits', 'solarii'].includes(term.resource)) errors.push(`${prefix}: unknown resource`);
      if (!actorExists(state, term.from) || !actorExists(state, term.to) || term.from === term.to) errors.push(`${prefix}: invalid transfer parties`);
      if (term.amount <= 0) errors.push(`${prefix}: amount must be positive`);
      if (finite(walletForActor(state, term.from)?.[term.resource]) < term.amount) errors.push(`${prefix}: ${term.from} lacks ${term.resource}`);
    } else if (term.type === 'agreement') {
      const check = validateAgreement(state, {
        type: term.agreementType,
        parties: term.parties ?? [proposal.from, proposal.to],
        terms: term.terms ?? {},
      }, { bypassTech: !!term.bypassTech });
      if (!check.ok) errors.push(`${prefix}: ${check.reason}`);
    } else if (term.type === 'system_transfer') {
      const record = mutableSystemRecord(state, term.systemId, term.galaxyId);
      if (!record) errors.push(`${prefix}: unknown system`);
      else if (actorForSystem(record.system, state) !== term.from) errors.push(`${prefix}: transferor does not control the system`);
      if (!actorExists(state, term.to)) errors.push(`${prefix}: unknown recipient`);
    } else if (term.type === 'tribute') {
      if (!actorExists(state, term.payer) || !actorExists(state, term.payee) || term.payer === term.payee) errors.push(`${prefix}: invalid tribute parties`);
      if (finite(term.creditsPerMinute) <= 0 && finite(term.solariiPerMinute) <= 0) errors.push(`${prefix}: tribute has no value`);
    } else if (term.type === 'reparations') {
      if (!actorExists(state, term.from) || !actorExists(state, term.to) || term.from === term.to) errors.push(`${prefix}: invalid reparations parties`);
      if (finite(term.credits) <= 0 && finite(term.solarii) <= 0) errors.push(`${prefix}: reparations have no value`);
      if (finite(walletForActor(state, term.from)?.credits) < finite(term.credits)) errors.push(`${prefix}: ${term.from} lacks Credits`);
      if (finite(walletForActor(state, term.from)?.solarii) < finite(term.solarii)) errors.push(`${prefix}: ${term.from} lacks Solarii`);
    } else if (term.type === 'claim') {
      if (!term.systemId || !actorExists(state, term.target ?? proposal.to)) errors.push(`${prefix}: invalid claim`);
    } else if (term.type === 'end_war') {
      if (!getActiveWar(state, term.warId ?? [proposal.from, proposal.to])) errors.push(`${prefix}: no active war`);
    } else if (term.type === 'join_war') {
      const war = warFromReference(state, term.warId);
      if (!war || war.status !== 'active' || !actorExists(state, term.actor ?? proposal.to)) errors.push(`${prefix}: invalid war participation`);
    } else if (term.type === 'sanction' || term.type === 'lift_sanction') {
      if (!actorExists(state, term.target)) errors.push(`${prefix}: unknown sanction target`);
      if (term.actor && !actorExists(state, term.actor)) errors.push(`${prefix}: unknown sanctioning actor`);
    } else if (term.type === 'favor') {
      if (!actorExists(state, term.debtor) || !actorExists(state, term.creditor) || term.debtor === term.creditor) {
        errors.push(`${prefix}: invalid favor actors`);
      }
    } else if (term.type === 'helioclast_commitment') {
      if (!actorExists(state, term.actor) || !['inspection', 'non_use'].includes(term.commitment)) {
        errors.push(`${prefix}: invalid Helioclast commitment`);
      }
    } else {
      errors.push(`${prefix}: unknown term type`);
    }
  }
  return errors;
}

function actorPower(state, actorId) {
  const faction = walletForActor(state, actorId) ?? {};
  const credits = finite(faction.credits);
  const solarii = finite(faction.solarii);
  let fleet = 0;
  if (actorId === PLAYER_ID) {
    fleet += asArray(state.playerShips).reduce((sum, ship) => sum + Math.max(0, finite(ship.hp, 100)), 0);
    fleet += Math.max(0, finite(state.flagship?.hp));
    fleet += asArray(state.heroFlagships).reduce((sum, ship) => sum + Math.max(0, finite(ship.hp, 1000)), 0);
  } else {
    fleet += asArray(state.aiShips).filter((ship) => ship.factionId === actorId)
      .reduce((sum, ship) => sum + Math.max(0, finite(ship.hp, 100)), 0);
  }
  let systems = 0;
  if (state.galaxies) {
    for (const galaxy of Object.values(state.galaxies)) {
      const records = Object.values(galaxy.systems ?? {}).length
        ? Object.values(galaxy.systems ?? {})
        : Object.values(galaxy.abstract?.systemOverlays ?? {});
      systems += records.filter((system) => actorForSystem(system, state) === actorId).length;
    }
  } else {
    systems = Object.values(state.systems ?? {}).filter((system) => actorForSystem(system, state) === actorId).length;
  }
  return { credits, solarii, fleet, systems, total: credits + solarii * 250 + fleet * 0.5 + systems * 300 };
}

export function diplomaticLeverage(state, from, to) {
  const fromPower = actorPower(state, from);
  const toPower = actorPower(state, to);
  const war = getActiveWar(state, [from, to]);
  const occupationBalance = ensureDiplomacy(state).occupations
    .filter((occupation) => occupation.status === 'active' && war && occupation.warId === war.id)
    .reduce((sum, occupation) => sum + (occupation.occupier === from ? 1 : -1), 0);
  const warScore = war ? (war.parties.includes(PLAYER_ID)
    ? (from === PLAYER_ID ? war.score : -war.score)
    : (war.attackers.includes(from) ? war.score : -war.score)) : 0;
  const value = round2(clamp((fromPower.total - toPower.total) / 500 + occupationBalance * 4 + warScore * 0.15, -30, 30));
  return { from, to, fromPower, toPower, occupationBalance, warScore, value };
}

function systemNegotiationValue(state, term) {
  const system = mutableSystemRecord(state, term.systemId, term.galaxyId)?.system;
  if (!system) return 0;
  return 15 + asArray(system.bodies).length * 2 + asArray(system.structures).length * 3
    + finite(system.dyson?.completedShells) * 5;
}

function actorEmbassyCount(state, actorId) {
  let count = 0;
  for (const galaxy of Object.values(state.galaxies ?? {})) {
    for (const system of Object.values(galaxy.systems ?? {})) {
      if (actorForSystem(system, state) !== actorId) continue;
      count += asArray(system.structures).filter((structure) => structure.type === 'embassy_complex'
        && !structure.destroyed && structure.hp !== 0 && !structure.construction && !structure.mothballed).length;
    }
  }
  return Math.min(3, count);
}

function agreementAdministrativeCost(state, actorId, agreementType) {
  const baseCredits = [AGREEMENT_CEASEFIRE, AGREEMENT_TRUCE, AGREEMENT_NON_AGGRESSION].includes(agreementType)
    ? DIPLOMACY_TRUCE_COST
    : [AGREEMENT_TRADE, AGREEMENT_OPEN_BORDERS].includes(agreementType)
      ? DIPLOMACY_TRADE_TREATY_COST
      : [AGREEMENT_DEFENSE, AGREEMENT_ALLIANCE].includes(agreementType)
        ? DIPLOMACY_ALLIANCE_COST
        : 0;
  const playerMult = actorId === PLAYER_ID
    ? empireStructureEffectValue(state, 'treatyCostMult', { base: 1, op: 'mult' })
    : Math.pow(0.9, actorEmbassyCount(state, actorId));
  return {
    credits: Math.ceil(baseCredits * playerMult),
    solarii: [AGREEMENT_DEFENSE, AGREEMENT_ALLIANCE].includes(agreementType)
      ? Math.ceil(DIPLOMACY_ALLIANCE_SOLARII * playerMult * 100) / 100
      : 0,
  };
}

export function proposalAdministrativeCost(state, input) {
  const proposal = normalizeProposalInput(input);
  return proposal.terms.filter((term) => term.type === 'agreement'
      && !activeAgreementRecords(state, term.agreementType, term.parties ?? [proposal.from, proposal.to]).length)
    .reduce((cost, term) => {
      const next = agreementAdministrativeCost(state, proposal.from, term.agreementType);
      cost.credits += next.credits;
      cost.solarii += next.solarii;
      return cost;
    }, { credits: 0, solarii: 0 });
}

function termAcceptanceValue(state, term, recipient, personality, proposal) {
  if (term.type === 'resource') {
    const scale = term.resource === 'solarii' ? 4 : 0.01;
    return round2(term.amount * scale * (term.to === recipient ? 1 : term.from === recipient ? -1 : 0));
  }
  if (term.type === 'system_transfer') {
    const value = systemNegotiationValue(state, term);
    return round2(value * (term.to === recipient ? 1 : term.from === recipient ? -1 : 0));
  }
  if (term.type === 'agreement') {
    const base = {
      ceasefire: 8,
      truce: 10,
      trade: 12,
      open_borders: 5,
      defense: 8,
      alliance: 10,
    }[term.agreementType] ?? 0;
    const personalityBonus = (personality === 'economic' && term.agreementType === 'trade')
      ? 8
      : (personality === 'wormhole' && term.agreementType === 'open_borders')
        ? 10
        : (personality === 'megastructure' && [AGREEMENT_DEFENSE, AGREEMENT_ALLIANCE].includes(term.agreementType))
          ? 6
          : 0;
    const agendaPenalty = personality === 'expansionist' && term.agreementType === AGREEMENT_OPEN_BORDERS ? -5 : 0;
    return base + personalityBonus + agendaPenalty;
  }
  if (term.type === 'tribute') {
    const durationMinutes = Math.max(1, finite(term.durationMs, 300000) / 60000);
    const value = durationMinutes * (finite(term.creditsPerMinute) * 0.01 + finite(term.solariiPerMinute) * 4);
    return round2(value * (term.payee === recipient ? 1 : term.payer === recipient ? -1 : 0));
  }
  if (term.type === 'reparations') {
    const value = finite(term.credits) * 0.01 + finite(term.solarii) * 4;
    return round2(value * (term.to === recipient ? 1 : term.from === recipient ? -1 : 0));
  }
  if (term.type === 'claim') return (term.claimant ?? proposal.from) === recipient ? 5 : -8;
  if (term.type === 'end_war') {
    const war = getActiveWar(state, term.warId ?? [proposal.from, proposal.to]);
    if (!war) return 0;
    const exhaustion = finite(war.exhaustion?.[recipient]);
    const ownScore = war.parties.includes(PLAYER_ID)
      ? (recipient === PLAYER_ID ? war.score : -war.score)
      : (war.attackers.includes(recipient) ? war.score : -war.score);
    const scoreAgainst = -ownScore;
    return round2(5 + exhaustion * 0.25 + scoreAgainst * 0.12);
  }
  if (term.type === 'join_war') return (term.actor ?? proposal.to) === recipient ? -8 : 5;
  if (term.type === 'sanction') return term.target === recipient ? -20 : 4;
  if (term.type === 'lift_sanction') return term.target === recipient ? 12 : -2;
  if (term.type === 'favor') return term.debtor === recipient ? -term.value * 0.2 : term.creditor === recipient ? term.value * 0.2 : 0;
  if (term.type === 'helioclast_commitment') {
    const value = term.commitment === 'non_use' ? 18 : 10;
    return term.actor === recipient ? -value : value;
  }
  return 0;
}

function proposalThreshold(proposal) {
  let threshold = 0;
  for (const term of proposal.terms) {
    const key = term.type === 'agreement' ? term.agreementType
      : term.type === 'end_war' ? 'peace'
        : term.type;
    threshold = Math.max(threshold, DIPLOMACY_CONFIG.acceptanceThresholds[key] ?? 0);
  }
  return threshold;
}

function proposalIntelligence(state, proposal) {
  const factionId = proposal.from === PLAYER_ID ? proposal.to
    : proposal.to === PLAYER_ID ? proposal.from
      : null;
  if (!factionId) return { level: 100, error: 0, band: 'shared' };
  const contact = getContact(state, factionId);
  const shared = hasAgreement(state, factionId, AGREEMENT_ALLIANCE);
  const embassy = actorEmbassyCount(state, PLAYER_ID) > 0;
  const band = shared ? 'shared' : embassy ? 'embassy' : contact.stage;
  const level = shared ? 100 : embassy ? Math.max(75, contact.intelligence) : contact.intelligence;
  const baseError = DIPLOMACY_CONFIG.intelligenceForecastError[band] ?? 20;
  return {
    level,
    band,
    error: shared ? 0 : round2(baseError * Math.max(0.25, 1 - level / 100)),
  };
}

function previewProposalOnState(state, input, options = {}) {
  const proposal = normalizeProposalInput(input);
  const errors = validateProposalTerms(state, proposal);
  const recipient = options.perspective ?? proposal.to;
  const counterpart = recipient === proposal.from ? proposal.to : proposal.from;
  const personality = actorPersonality(state, recipient);
  const relationship = getActorRelationshipBreakdown(state, recipient, counterpart);
  const weights = DIPLOMACY_CONFIG.acceptanceWeights;
  const modifiers = [
    { id: 'opinion', label: 'Opinion', value: round2(relationship.metrics.opinion * weights.opinion), known: true },
    { id: 'trust', label: 'Trust', value: round2(relationship.metrics.trust * weights.trust), known: true },
    { id: 'fear', label: 'Fear', value: round2(relationship.metrics.fear * weights.fear), known: true },
    { id: 'respect', label: 'Respect', value: round2(relationship.metrics.respect * weights.respect), known: true },
  ];
  const leverage = diplomaticLeverage(state, proposal.from, proposal.to);
  modifiers.push({ id: 'leverage', label: 'Strategic leverage', value: recipient === proposal.to ? leverage.value : -leverage.value, known: true });
  let hardBlock = null;
  proposal.terms.forEach((term, index) => {
    modifiers.push({
      id: `term:${index}`,
      label: term.type === 'agreement' ? `${term.agreementType?.replace(/_/g, ' ')} term` : `${term.type.replace(/_/g, ' ')} term`,
      value: termAcceptanceValue(state, term, recipient, personality, proposal), known: true,
    });
    if (term.type === 'agreement' && term.agreementType === AGREEMENT_DEFENSE
        && relationship.metrics.trust < DIPLOMACY_CONFIG.defenseTrustGate) {
      hardBlock = `Mutual defense requires ${DIPLOMACY_CONFIG.defenseTrustGate} trust`;
    }
    if (term.type === 'agreement' && term.agreementType === AGREEMENT_ALLIANCE
        && relationship.metrics.trust < DIPLOMACY_CONFIG.allianceTrustGate) {
      hardBlock = `Alliance requires ${DIPLOMACY_CONFIG.allianceTrustGate} trust`;
    }
  });
  if (relationship.grievanceSeverity >= DIPLOMACY_CONFIG.severeGrievanceThreshold
      && proposal.terms.some((term) => term.type === 'agreement'
        && [AGREEMENT_DEFENSE, AGREEMENT_ALLIANCE].includes(term.agreementType))) {
    hardBlock = 'A severe unresolved grievance blocks a defensive commitment';
  }
  if (isSanctioned(state, proposal.from)
      && !activeAgreementRecords(state, AGREEMENT_ALLIANCE, [proposal.from, proposal.to]).length) {
    modifiers.push({ id: 'sanctioned', label: 'Council isolation', value: -DIPLOMACY_CONFIG.sanctionAcceptancePenalty, known: true });
  }
  const agenda = actorAgenda(state, recipient);
  const agendaValue = proposal.terms.reduce((sum, term) => {
    const label = term.type === 'agreement' ? term.agreementType : term.type;
    return sum + (agenda.priorities.includes(label) ? 8 : agenda.redLines.includes(label) ? -15 : 0);
  }, 0);
  if (agendaValue) modifiers.push({ id: 'agenda', label: 'Strategic agenda', value: agendaValue, known: false });
  const score = round2(modifiers.reduce((sum, modifier) => sum + modifier.value, 0));
  const threshold = proposalThreshold(proposal);
  const intelligence = proposalIntelligence(state, proposal);
  const forecastError = options.omniscient ? 0 : intelligence.error;
  const knownModifiers = modifiers.filter((modifier) => modifier.known || intelligence.level >= 75);
  const reasons = [...knownModifiers]
    .sort((left, right) => Math.abs(right.value) - Math.abs(left.value))
    .slice(0, 2)
    .map((modifier) => ({ label: modifier.label, value: modifier.value }));
  return {
    ok: errors.length === 0,
    errors,
    proposal,
    perspective: recipient,
    personality,
    relationship,
    leverage,
    modifiers: knownModifiers,
    allModifiers: modifiers,
    score,
    scoreRange: [round2(score - forecastError), round2(score + forecastError)],
    threshold,
    intelligence,
    reasons,
    hardBlock,
    acceptable: errors.length === 0 && !hardBlock && score >= threshold,
    counterable: errors.length === 0 && !hardBlock && score < threshold && score >= threshold - DIPLOMACY_CONFIG.counterOfferWindow,
    administrativeCost: proposalAdministrativeCost(state, proposal),
  };
}

export function previewProposal(state, input, options = {}) {
  const previewState = {
    ...state,
    diplomacy: clone(state?.diplomacy ?? {}),
    milestones: clone(state?.milestones ?? {}),
  };
  ensureDiplomacy(previewState);
  return previewProposalOnState(previewState, input, options);
}

export const evaluateProposal = previewProposal;

export function buildSmallestCounterOffer(state, input, previewInput = null) {
  const proposal = normalizeProposalInput(input);
  const preview = previewInput ?? previewProposal(state, proposal, { perspective: proposal.to, omniscient: true });
  if (!preview.ok || preview.hardBlock || !preview.counterable) return { ok: false, reason: 'Proposal is not within counteroffer range', preview };
  const deficit = Math.max(0.01, round2(preview.threshold - preview.score));
  const payer = walletForActor(state, proposal.from);
  const credits = Math.ceil(deficit * 100);
  const terms = clone(proposal.terms);
  if (finite(payer?.credits) >= credits) {
    terms.push({ type: 'resource', resource: 'credits', amount: credits, from: proposal.from, to: proposal.to });
  } else if (finite(payer?.solarii) >= Math.ceil(deficit / 4 * 100) / 100) {
    terms.push({ type: 'resource', resource: 'solarii', amount: Math.ceil(deficit / 4 * 100) / 100, from: proposal.from, to: proposal.to });
  } else {
    terms.push({ type: 'favor', debtor: proposal.from, creditor: proposal.to, value: Math.ceil(deficit * 5) });
  }
  return { ok: true, terms, deficit, preview };
}

function snapshotAtomicState(state) {
  const systems = [];
  if (state.galaxies) {
    for (const [galaxyId, galaxy] of Object.entries(state.galaxies)) {
      for (const [systemId, system] of Object.entries(galaxy.systems ?? {})) systems.push({ galaxyId, systemId, abstract: false, value: clone(system) });
      for (const [systemId, system] of Object.entries(galaxy.abstract?.systemOverlays ?? {})) systems.push({ galaxyId, systemId, abstract: true, value: clone(system) });
    }
  } else {
    for (const [systemId, system] of Object.entries(state.systems ?? {})) systems.push({ galaxyId: null, systemId, abstract: false, value: clone(system) });
  }
  return {
    diplomacy: clone(ensureDiplomacy(state)),
    player: { credits: finite(state.credits), solarii: finite(state.solarii) },
    factions: factionList(state).map((faction) => ({ id: faction.id, credits: finite(faction.credits), solarii: finite(faction.solarii) })),
    systems,
    systemBattles: clone(state.systemBattles ?? {}),
    battleReports: clone(state.battleReports ?? []),
    campaign: clone(state.campaign ?? null),
  };
}

function restoreObject(target, source) {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, clone(source));
}

function restoreAtomicState(state, snapshot) {
  if (state.diplomacy && typeof state.diplomacy === 'object') {
    restoreObject(state.diplomacy, snapshot.diplomacy);
  } else {
    state.diplomacy = clone(snapshot.diplomacy);
  }
  state.credits = snapshot.player.credits;
  state.solarii = snapshot.player.solarii;
  for (const wallet of snapshot.factions) {
    const faction = factionById(state, wallet.id);
    if (faction) {
      faction.credits = wallet.credits;
      faction.solarii = wallet.solarii;
    }
  }
  for (const item of snapshot.systems) {
    let target;
    if (state.galaxies) {
      target = item.abstract
        ? state.galaxies?.[item.galaxyId]?.abstract?.systemOverlays?.[item.systemId]
        : state.galaxies?.[item.galaxyId]?.systems?.[item.systemId];
    } else target = state.systems?.[item.systemId];
    if (target) restoreObject(target, item.value);
  }
  state.systemBattles = clone(snapshot.systemBattles);
  state.battleReports = clone(snapshot.battleReports);
  if (snapshot.campaign != null) state.campaign = clone(snapshot.campaign);
}

function applySanction(state, target, options = {}) {
  const diplomacy = ensureDiplomacy(state);
  const existing = diplomacy.council.sanctions.find((sanction) => activeAt(sanction, now(state)) && sanction.target === target);
  if (existing) return existing;
  const durationMs = options.durationMs == null ? DIPLOMACY_CONFIG.sanctionDurationMs : Math.max(0, finite(options.durationMs));
  const sanction = {
    id: nextId(state, 'sanction'),
    target,
    issuer: options.issuer ?? 'council',
    resolutionId: options.resolutionId ?? null,
    supporters: [...new Set(asArray(options.supporters))],
    type: options.type ?? 'sanction',
    status: 'active',
    startedAt: now(state),
    expiresAt: durationMs == null ? null : now(state) + durationMs,
  };
  diplomacy.council.sanctions.push(sanction);
  return sanction;
}

function applyProposalTerm(state, proposal, term) {
  if (term.type === 'resource') {
    transferResources(state, term.from, term.to, term.resource, term.amount);
    if (term.to === proposal.to || term.to === proposal.from) {
      addActorRelationshipModifier(state, term.to, term.from, {
        source: 'gift', label: `${term.resource} gift`, opinion: term.resource === 'credits' ? term.amount / 100 : term.amount * 2,
        trust: term.resource === 'credits' ? term.amount / 200 : term.amount, fear: 0, respect: 1,
      });
    }
    return;
  }
  if (term.type === 'agreement') {
    const result = createAgreement(state, {
      type: term.agreementType,
      parties: term.parties ?? [proposal.from, proposal.to],
      durationMs: term.durationMs,
      terms: term.terms ?? {},
      sourceProposalId: proposal.id ?? null,
    }, { bypassTech: !!term.bypassTech });
    if (!result.ok) throw new Error(result.reason);
    return;
  }
  if (term.type === 'system_transfer') {
    const record = mutableSystemRecord(state, term.systemId, term.galaxyId);
    if (!record || actorForSystem(record.system, state) !== term.from) throw new Error('System transfer is no longer valid');
    setSystemActor(record.system, term.to);
    reconcileTransferredSystem(state, record, term.to);
    recordHistory(state, 'system_transferred', { systemId: term.systemId, galaxyId: record.galaxyId, from: term.from, to: term.to });
    return;
  }
  if (term.type === 'tribute') {
    const result = createAgreement(state, {
      type: AGREEMENT_TRIBUTE,
      parties: [term.payer, term.payee],
      durationMs: term.durationMs ?? 300000,
      terms: {
        payer: term.payer,
        payee: term.payee,
        creditsPerMinute: Math.max(0, finite(term.creditsPerMinute)),
        solariiPerMinute: Math.max(0, finite(term.solariiPerMinute)),
      },
      sourceProposalId: proposal.id ?? null,
    }, { bypassTech: true });
    if (!result.ok) throw new Error(result.reason);
    return;
  }
  if (term.type === 'reparations') {
    if (finite(term.credits) > 0) transferResources(state, term.from, term.to, 'credits', term.credits);
    if (finite(term.solarii) > 0) transferResources(state, term.from, term.to, 'solarii', term.solarii);
    addActorRelationshipModifier(state, term.to, term.from, {
      source: 'reparations', label: 'Paid reparations', opinion: 4, trust: 3, respect: 2,
      durationMs: 300000,
    });
    return;
  }
  if (term.type === 'claim') {
    const result = createClaim(state, {
      claimant: term.claimant ?? proposal.from,
      target: term.target ?? proposal.to,
      systemId: term.systemId,
      galaxyId: term.galaxyId,
      source: 'proposal',
    });
    if (!result.ok) throw new Error(result.reason);
    return;
  }
  if (term.type === 'end_war') {
    const result = concludePeace(state, term.warId ?? proposal.to, {
      cededSystemIds: term.cededSystemIds,
      cededSystems: term.cededSystems ?? term.cededSystemRefs,
      reparations: term.reparations,
      tribute: term.tribute,
      truceMs: term.truceMs ?? DEFAULT_PEACE_TRUCE_MS,
      reason: 'negotiated_peace',
      proposer: proposal.from,
      demands: term.demands,
    });
    if (!result.ok) throw new Error(result.reason);
    return;
  }
  if (term.type === 'join_war') {
    const war = warFromReference(state, term.warId);
    if (!war || war.status !== 'active') throw new Error('War is no longer active');
    const actor = term.actor ?? proposal.to;
    const side = term.side === 'attacker' ? war.attackers : war.defenders;
    if (!side.includes(actor)) side.push(actor);
    if (!war.parties.includes(actor)) war.parties.push(actor);
    war.scoreByActor[actor] ??= 0;
    war.exhaustion[actor] ??= 0;
    war.parties.sort();
    const beneficiary = side.find((actorId) => actorId !== actor) ?? proposal.from;
    if (beneficiary && beneficiary !== actor) recordDiplomaticEvent(state, {
      type: 'aid_honored', actor, target: beneficiary, warId: war.id,
    });
    return;
  }
  if (term.type === 'sanction') {
    applySanction(state, term.target, {
      durationMs: term.durationMs,
      issuer: term.issuer ?? term.actor ?? proposal.from,
      supporters: term.actor ? [term.actor] : [],
    });
    return;
  }
  if (term.type === 'lift_sanction') {
    for (const sanction of ensureDiplomacy(state).council.sanctions) {
      if (sanction.status === 'active' && sanction.target === term.target) {
        sanction.status = 'repealed';
        sanction.endedAt = now(state);
      }
    }
    return;
  }
  if (term.type === 'favor') {
    const result = createFavor(state, {
      debtor: term.debtor,
      creditor: term.creditor,
      value: term.value,
      purpose: term.purpose,
      sourceProposalId: proposal.id ?? null,
    });
    if (!result.ok) throw new Error(result.reason);
    return;
  }
  if (term.type === 'helioclast_commitment') {
    const result = createAgreement(state, {
      type: AGREEMENT_NON_AGGRESSION,
      parties: [proposal.from, proposal.to],
      durationMs: term.durationMs,
      terms: {
        commitment: term.commitment,
        actor: term.actor,
        helioclast: true,
      },
      sourceProposalId: proposal.id ?? null,
    }, { bypassTech: true });
    if (!result.ok) throw new Error(result.reason);
  }
}

/** Close diplomacy records before a star and its system record are removed. */
export function recordSystemDestroyed(state, input = {}) {
  const galaxyId = input.galaxyId ?? state.activeGalaxyId ?? null;
  const systemId = input.systemId;
  if (!systemId) return { ok: false, reason: 'System id is required' };
  const diplomacy = ensureDiplomacy(state);
  const destroyedRecord = mutableSystemRecord(state, systemId, galaxyId);
  const harmedActor = destroyedRecord ? actorForSystem(destroyedRecord.system, state) : null;
  const voidedClaimIds = [];
  const destroyedOccupationIds = [];
  const warIds = new Set();
  for (const claim of diplomacy.claims) {
    if (claim.status !== 'active' || claim.systemId !== systemId
      || (claim.galaxyId ?? state.activeGalaxyId) !== galaxyId) continue;
    claim.status = 'void';
    claim.voidedAt = now(state);
    claim.voidReason = 'system_destroyed';
    voidedClaimIds.push(claim.id);
  }
  for (const occupation of diplomacy.occupations) {
    if (occupation.status !== 'active' || occupation.systemId !== systemId
      || (occupation.galaxyId ?? state.activeGalaxyId) !== galaxyId) continue;
    occupation.status = 'destroyed';
    occupation.settledAt = now(state);
    occupation.destroyedBy = input.actor ?? PLAYER_ID;
    destroyedOccupationIds.push(occupation.id);
    if (occupation.warId) warIds.add(occupation.warId);
  }
  for (const warId of warIds) {
    recordWarEvent(state, warId, {
      type: 'strategic_asset_destroyed',
      actor: input.actor ?? PLAYER_ID,
      galaxyId,
      systemId,
    });
  }
  recordHistory(state, 'system_destroyed', {
    galaxyId, systemId, actor: input.actor ?? PLAYER_ID, voidedClaimIds, destroyedOccupationIds,
  });
  if (harmedActor && harmedActor !== input.actor && harmedActor !== 'neutral' && actorExists(state, harmedActor)) {
    addGrievance(state, {
      aggrieved: harmedActor,
      against: input.actor ?? PLAYER_ID,
      type: 'destroyed_system',
      label: 'Destroyed sovereign system',
      severity: 100,
      durationMs: null,
      stackKey: `destroyed_system:${galaxyId}:${systemId}`,
      details: { galaxyId, systemId },
    });
    adjustActorReputation(state, input.actor ?? PLAYER_ID, -30, 'destroyed_foreign_system');
  }
  return { ok: true, voidedClaimIds, destroyedOccupationIds, warIds: [...warIds] };
}

export function applyProposalTermsAtomic(state, proposalOrTerms, options = {}) {
  const proposal = Array.isArray(proposalOrTerms)
    ? normalizeProposalInput({ from: options.from ?? PLAYER_ID, to: options.to, terms: proposalOrTerms })
    : { ...normalizeProposalInput(proposalOrTerms), id: proposalOrTerms?.id ?? null };
  const errors = validateProposalTerms(state, proposal);
  if (errors.length) return { ok: false, reason: errors.join('; '), errors };
  const snapshot = snapshotAtomicState(state);
  try {
    const administrativeCost = options.skipAdministrativeCost
      ? { credits: 0, solarii: 0 }
      : proposalAdministrativeCost(state, proposal);
    const proposerWallet = walletForActor(state, proposal.from);
    if (!proposerWallet) throw new Error('Unknown proposal sponsor');
    if (finite(proposerWallet.credits) < administrativeCost.credits) throw new Error(`${proposal.from} lacks treaty Credits`);
    if (finite(proposerWallet.solarii) < administrativeCost.solarii) throw new Error(`${proposal.from} lacks treaty Solarii`);
    proposerWallet.credits = finite(proposerWallet.credits) - administrativeCost.credits;
    proposerWallet.solarii = finite(proposerWallet.solarii) - administrativeCost.solarii;
    // Peace terms settle occupations themselves; all other exchanges happen first.
    const orderedTerms = [...proposal.terms.filter((term) => term.type !== 'end_war'), ...proposal.terms.filter((term) => term.type === 'end_war')];
    for (const term of orderedTerms) applyProposalTerm(state, proposal, term);
    recordHistory(state, 'proposal_terms_applied', { proposalId: proposal.id, from: proposal.from, to: proposal.to, terms: proposal.terms });
    return { ok: true, terms: proposal.terms, administrativeCost };
  } catch (error) {
    restoreAtomicState(state, snapshot);
    return { ok: false, reason: error?.message ?? 'Proposal terms could not be applied atomically' };
  }
}

export function submitProposal(state, input, options = {}) {
  const normalized = normalizeProposalInput(input);
  const playerPair = normalized.from === PLAYER_ID || normalized.to === PLAYER_ID;
  const factionId = normalized.from === PLAYER_ID ? normalized.to : normalized.to === PLAYER_ID ? normalized.from : null;
  if (playerPair) {
    const contact = getContact(state, factionId);
    if (CONTACT_RANK[contact.stage] < CONTACT_RANK[CONTACT_CONTACTED] && !options.allowUnknownContact) {
      return { ok: false, reason: 'Open a diplomatic channel before sending a proposal' };
    }
  }
  const preview = previewProposal(state, normalized);
  if (!preview.ok) return { ok: false, reason: preview.errors.join('; '), preview };
  const pending = ensureDiplomacy(state).proposals.find((proposal) => (
    proposal.status === PROPOSAL_PENDING && pairKey(proposal.from, proposal.to) === pairKey(normalized.from, normalized.to)
  ));
  if (pending && !options.ignorePending) return { ok: false, reason: 'A proposal is already pending between these parties', proposal: pending };
  const proposal = {
    id: nextId(state, 'proposal'),
    from: normalized.from,
    to: normalized.to,
    terms: normalized.terms,
    message: normalized.message,
    status: PROPOSAL_PENDING,
    createdAt: now(state),
    expiresAt: now(state) + Math.max(1000, finite(options.lifetimeMs, PROPOSAL_LIFETIME_MS)),
    parentProposalId: options.parentProposalId ?? null,
    ultimatum: normalized.ultimatum,
    previewAtCreation: {
      score: preview.score,
      modifiers: preview.modifiers,
      leverage: preview.leverage,
    },
    administrativeCost: preview.administrativeCost,
  };
  ensureDiplomacy(state).proposals.push(proposal);
  if (proposal.from === PLAYER_ID) noteDiplomacyMissionObjective(state, 'diplomacy_intro', 'send_proposal', ['detect_faction', 'open_channel', 'send_proposal']);
  recordHistory(state, 'proposal_submitted', { proposal });
  if (proposal.to === PLAYER_ID || proposal.from === PLAYER_ID) {
    addTransmission(state, {
      from: proposal.from,
      to: proposal.to,
      kind: proposal.ultimatum ? 'ultimatum' : proposal.parentProposalId ? 'counter' : 'proposal',
      subject: proposal.message || (proposal.parentProposalId ? 'Diplomatic counteroffer' : 'Diplomatic proposal'),
      body: `A ${proposal.terms.map((term) => term.type === 'agreement' ? term.agreementType : term.type).join(' + ')} proposal awaits resolution.`,
      tone: actorPersonality(state, proposal.from),
      relatedId: proposal.id,
      actions: proposal.to === PLAYER_ID ? ['accept', 'reject', 'counter'] : [],
    });
  }
  if (options.autoResolve && proposal.to !== PLAYER_ID) {
    if (preview.acceptable) return respondToProposal(state, proposal.id, 'accept', { actor: proposal.to });
    if (preview.counterable) {
      const counter = buildSmallestCounterOffer(state, proposal, preview);
      if (counter.ok) return counterProposal(state, proposal.id, counter.terms, {
        actor: proposal.to,
        message: 'These are the minimum terms required for acceptance.',
      });
    }
    return respondToProposal(state, proposal.id, 'reject', {
      actor: proposal.to,
      reason: preview.reasons.map((reason) => reason.label).join('; ') || 'Terms are strategically unacceptable',
    });
  }
  return { ok: true, proposal, preview };
}

export function respondToProposal(state, proposalId, decision, options = {}) {
  let proposal = ensureDiplomacy(state).proposals.find((entry) => entry.id === proposalId);
  if (!proposal) return { ok: false, reason: 'Unknown proposal' };
  if (proposal.status !== PROPOSAL_PENDING) return { ok: false, reason: `Proposal is ${proposal.status}` };
  if (now(state) >= proposal.expiresAt) {
    proposal.status = PROPOSAL_EXPIRED;
    proposal.resolvedAt = now(state);
    return { ok: false, reason: 'Proposal expired', proposal };
  }
  const actor = options.actor ?? proposal.to;
  if (actor !== proposal.to) return { ok: false, reason: 'Only the recipient may answer this proposal' };
  if (decision === 'accept' || decision === PROPOSAL_ACCEPTED) {
    const preview = previewProposal(state, proposal, { perspective: proposal.to });
    if (!preview.ok) return { ok: false, reason: preview.errors.join('; '), preview };
    if (actor !== PLAYER_ID && !preview.acceptable) return { ok: false, reason: preview.hardBlock ?? 'Acceptance threshold not met', preview };
    const applied = applyProposalTermsAtomic(state, proposal);
    if (!applied.ok) return applied;
    proposal = ensureDiplomacy(state).proposals.find((entry) => entry.id === proposalId);
    proposal.status = PROPOSAL_ACCEPTED;
    proposal.resolvedAt = now(state);
    proposal.acceptedBy = actor;
    proposal.finalScore = preview.score;
    if ([proposal.from, proposal.to].includes(PLAYER_ID)) {
      const counterpart = proposal.from === PLAYER_ID ? proposal.to : proposal.from;
      addTransmission(state, {
        from: counterpart,
        to: PLAYER_ID,
        kind: 'proposal_accepted',
        subject: 'Agreement accepted',
        body: 'The negotiated package has been ratified and all enforceable terms are now active.',
        tone: 'formal',
        relatedId: proposal.id,
      });
    }
    recordHistory(state, 'proposal_accepted', { proposalId, actor, score: preview.score });
    return { ok: true, proposal, preview, applied };
  }
  if (decision === 'reject' || decision === PROPOSAL_REJECTED) {
    proposal.status = PROPOSAL_REJECTED;
    proposal.resolvedAt = now(state);
    proposal.rejectedBy = actor;
    proposal.reason = options.reason ?? null;
    if ([proposal.from, proposal.to].includes(PLAYER_ID)) {
      const counterpart = proposal.from === PLAYER_ID ? proposal.to : proposal.from;
      addTransmission(state, {
        from: counterpart,
        to: PLAYER_ID,
        kind: 'proposal_rejected',
        subject: 'Proposal rejected',
        body: proposal.reason || 'The terms conflict with our strategic interests.',
        tone: 'firm',
        relatedId: proposal.id,
      });
    }
    recordHistory(state, 'proposal_rejected', { proposalId, actor, reason: proposal.reason });
    return { ok: true, proposal };
  }
  if (decision === 'counter' || decision === PROPOSAL_COUNTERED) {
    return counterProposal(state, proposalId, options.terms ?? [], { actor, message: options.message });
  }
  return { ok: false, reason: 'Unknown proposal response' };
}

export function counterProposal(state, proposalId, terms, options = {}) {
  const proposal = ensureDiplomacy(state).proposals.find((entry) => entry.id === proposalId);
  if (!proposal || proposal.status !== PROPOSAL_PENDING) return { ok: false, reason: 'No pending proposal to counter' };
  const actor = options.actor ?? proposal.to;
  if (actor !== proposal.to) return { ok: false, reason: 'Only the recipient may counter' };
  proposal.status = PROPOSAL_COUNTERED;
  proposal.resolvedAt = now(state);
  const result = submitProposal(state, {
    from: proposal.to,
    to: proposal.from,
    terms,
    message: options.message ?? '',
  }, { ignorePending: true, parentProposalId: proposal.id });
  if (!result.ok) {
    proposal.status = PROPOSAL_PENDING;
    delete proposal.resolvedAt;
    return result;
  }
  proposal.counterProposalId = result.proposal.id;
  recordHistory(state, 'proposal_countered', { proposalId, counterProposalId: result.proposal.id, actor });
  return { ok: true, proposal, counterProposal: result.proposal, preview: result.preview };
}

export function proposeCouncilResolution(state, input = {}) {
  const proposer = input.proposer ?? PLAYER_ID;
  if (!actorExists(state, proposer)) return { ok: false, reason: 'Unknown proposer' };
  if (!VALID_RESOLUTION_TYPES.has(input.type)) return { ok: false, reason: 'Unknown council resolution type' };
  if (proposer === PLAYER_ID && !isTechUnlocked(state, 'dip_galactic_council')) {
    return { ok: false, reason: 'Research Galactic Council first' };
  }
  if (!actorExists(state, input.target)) return { ok: false, reason: 'Resolution requires a known target' };
  const resolution = {
    id: nextId(state, 'resolution'),
    type: input.type,
    target: input.target,
    proposer,
    status: 'voting',
    proposedAt: now(state),
    votingEndsAt: now(state) + Math.max(1000, finite(input.votingDurationMs, DIPLOMACY_CONFIG.councilVoteDurationMs)),
    durationMs: input.durationMs ?? DIPLOMACY_CONFIG.sanctionDurationMs,
    votes: { [proposer]: 'yes' },
    voteWeights: {},
    committed: { [proposer]: now(state) },
    reason: input.reason ?? null,
  };
  ensureDiplomacy(state).council.resolutions.push(resolution);
  addTransmission(state, {
    from: proposer,
    to: PLAYER_ID,
    kind: 'council_position',
    subject: `Council motion: ${input.type.replaceAll('_', ' ')}`,
    body: `${proposer} has opened a weighted vote concerning ${input.target}. Ballots close in ${Math.round((resolution.votingEndsAt - now(state)) / 1000)} seconds.`,
    tone: 'formal',
    relatedId: resolution.id,
  });
  recordHistory(state, 'council_resolution_proposed', { resolution });
  return { ok: true, resolution };
}

export function castCouncilVote(state, resolutionId, voterId, vote) {
  const resolution = ensureDiplomacy(state).council.resolutions.find((entry) => entry.id === resolutionId);
  if (!resolution || resolution.status !== 'voting') return { ok: false, reason: 'Resolution is not open for voting' };
  if (!actorExists(state, voterId)) return { ok: false, reason: 'Unknown voter' };
  if (!['yes', 'no', 'abstain'].includes(vote)) return { ok: false, reason: 'Unknown vote' };
  resolution.votes[voterId] = vote;
  resolution.committed ??= {};
  resolution.committed[voterId] = now(state);
  resolution.voteWeights ??= {};
  resolution.voteWeights[voterId] = councilAuthority(state, voterId);
  if (vote === 'yes' && voterId !== resolution.proposer) recordDiplomaticEvent(state, {
    type: 'council_support', actor: voterId, target: resolution.proposer,
    details: { resolutionId },
  });
  for (const promise of asArray(resolution.votePromises).filter((entry) => entry.promisor === voterId && entry.status === 'promised')) {
    promise.status = vote === promise.vote ? 'honored' : 'broken';
    promise.resolvedAt = now(state);
    if (promise.status === 'honored' && promise.favorId) consumeFavor(state, promise.favorId, { reason: `vote_promise:${resolution.id}` });
    if (promise.status === 'broken') addGrievance(state, {
      aggrieved: promise.beneficiary,
      against: voterId,
      type: 'broken_vote_promise',
      label: 'Broken council vote promise',
      severity: 45,
      durationMs: 600000,
      stackKey: `vote_promise:${resolution.id}:${voterId}:${promise.beneficiary}`,
    });
  }
  recordHistory(state, 'council_vote_cast', { resolutionId, voterId, vote, weight: resolution.voteWeights[voterId] });
  return { ok: true, resolution, voterId, vote };
}

export function promiseCouncilVote(state, input = {}) {
  const resolution = ensureDiplomacy(state).council.resolutions.find((entry) => entry.id === input.resolutionId);
  if (!resolution || resolution.status !== 'voting') return { ok: false, reason: 'Resolution is not open for campaigning' };
  const promisor = input.promisor;
  const beneficiary = input.beneficiary ?? resolution.proposer;
  if (!actorExists(state, promisor) || !actorExists(state, beneficiary) || promisor === beneficiary) {
    return { ok: false, reason: 'Vote promise requires two known actors' };
  }
  if (!['yes', 'no', 'abstain'].includes(input.vote)) return { ok: false, reason: 'Unknown promised vote' };
  resolution.votePromises ??= [];
  const promise = {
    id: `${resolution.id}:promise:${resolution.votePromises.length + 1}`,
    promisor, beneficiary, vote: input.vote, favorId: input.favorId ?? null,
    status: 'promised', createdAt: now(state),
  };
  resolution.votePromises.push(promise);
  recordHistory(state, 'council_vote_promised', { resolutionId: resolution.id, promise });
  return { ok: true, promise, resolution };
}

export function councilAuthority(state, actorId) {
  if (!actorExists(state, actorId)) return 0;
  const power = actorPower(state, actorId);
  let dysons = 0;
  for (const galaxy of Object.values(state.galaxies ?? {})) {
    const systems = Object.values(galaxy.systems ?? {}).length
      ? Object.values(galaxy.systems ?? {})
      : Object.values(galaxy.abstract?.systemOverlays ?? {});
    dysons += systems.filter((system) => actorForSystem(system, state) === actorId
      && (system.dyson?.complete || finite(system.dyson?.completedShells) >= 8)).length;
  }
  const reputation = actorReputation(state, actorId);
  const reputationBand = reputation >= 25 ? 1 : reputation <= -25 ? -1 : 0;
  let authority = 1 + Math.min(5, Math.floor(power.systems / 10)) + Math.min(3, dysons)
    + actorEmbassyCount(state, actorId) + reputationBand;
  authority = clamp(authority, 1, 12);
  if (isSanctioned(state, actorId)) authority *= DIPLOMACY_CONFIG.sanctionAuthorityMultiplier;
  return round2(authority);
}

function councilVoteUtility(state, resolution, voterId) {
  if (voterId === resolution.target) return -100;
  const profile = actorProfile(state, voterId);
  const relation = getActorRelation(state, voterId, resolution.target);
  let utility = -relation.opinion * 0.18 - relation.trust * 0.12;
  if (resolution.type === 'repeal_sanction') utility *= -1;
  if (['emergency_coalition', 'collective_defense', 'helioclast_inspection'].includes(resolution.type)) {
    utility += finite(ensureDiplomacy(state).helioclastCrisis?.severity) * 0.35;
  }
  if (resolution.type === 'trade_embargo' && profile.agenda.id === 'economic') utility -= 12;
  if (resolution.type === 'condemnation') utility += actorReputation(state, resolution.target) < -20 ? 15 : -5;
  if (activeAgreementRecords(state, AGREEMENT_ALLIANCE, [voterId, resolution.target]).length) utility -= 35;
  const favor = ensureDiplomacy(state).favors.find((entry) => entry.status === 'owed'
    && entry.debtor === voterId && entry.creditor === resolution.proposer
    && (!entry.purpose || entry.purpose === 'council_vote' || entry.purpose === resolution.id));
  if (favor) utility += Math.max(12, finite(favor.value) * 0.4);
  const seededNoise = (stableHash(`${state.campaignSeed ?? state.seed ?? 0}:${resolution.id}:${voterId}`) % 9) - 4;
  return round2(utility + seededNoise);
}

function commitAiCouncilVotes(state, resolution) {
  if (now(state) < resolution.votingEndsAt - DIPLOMACY_CONFIG.councilCommitLeadMs) return [];
  const committed = [];
  for (const actorId of actorIds(state).filter((id) => id !== PLAYER_ID).sort()) {
    if (resolution.votes[actorId]) continue;
    const utility = councilVoteUtility(state, resolution, actorId);
    const vote = utility >= 5 ? 'yes' : utility <= -5 ? 'no' : 'abstain';
    castCouncilVote(state, resolution.id, actorId, vote);
    if (vote === 'yes') {
      const favor = ensureDiplomacy(state).favors.find((entry) => entry.status === 'owed'
        && entry.debtor === actorId && entry.creditor === resolution.proposer
        && (!entry.purpose || entry.purpose === 'council_vote' || entry.purpose === resolution.id));
      if (favor) consumeFavor(state, favor.id, { reason: `vote:${resolution.id}` });
    }
    committed.push({ actorId, vote, utility });
  }
  return committed;
}

export function resolveCouncilResolution(state, resolutionId, options = {}) {
  const resolution = ensureDiplomacy(state).council.resolutions.find((entry) => entry.id === resolutionId);
  if (!resolution) return { ok: false, reason: 'Unknown resolution' };
  if (resolution.status !== 'voting') return { ok: true, resolution, alreadyResolved: true };
  if (!options.force && now(state) < resolution.votingEndsAt) return { ok: false, reason: 'Voting is still open' };
  resolution.voteWeights ??= {};
  for (const voterId of Object.keys(resolution.votes)) resolution.voteWeights[voterId] = councilAuthority(state, voterId);
  const weighted = Object.entries(resolution.votes).map(([voterId, vote]) => ({ voterId, vote, weight: resolution.voteWeights[voterId] }));
  resolution.tally = {
    yes: round2(weighted.filter((entry) => entry.vote === 'yes').reduce((sum, entry) => sum + entry.weight, 0)),
    no: round2(weighted.filter((entry) => entry.vote === 'no').reduce((sum, entry) => sum + entry.weight, 0)),
    abstain: round2(weighted.filter((entry) => entry.vote === 'abstain').reduce((sum, entry) => sum + entry.weight, 0)),
  };
  resolution.tally.totalAuthority = round2(actorIds(state).reduce((sum, actorId) => sum + councilAuthority(state, actorId), 0));
  resolution.passed = resolution.tally.yes > resolution.tally.no
    && resolution.tally.yes > resolution.tally.totalAuthority / 2;
  resolution.status = resolution.passed ? 'passed' : 'failed';
  resolution.resolvedAt = now(state);
  if (resolution.passed && resolution.type === 'sanction') {
    resolution.sanctionId = applySanction(state, resolution.target, {
      durationMs: resolution.durationMs,
      resolutionId: resolution.id,
      supporters: weighted.filter((entry) => entry.vote === 'yes').map((entry) => entry.voterId),
    }).id;
  }
  if (resolution.passed && resolution.type === 'trade_embargo') {
    resolution.sanctionId = applySanction(state, resolution.target, {
      durationMs: resolution.durationMs,
      resolutionId: resolution.id,
      type: 'trade_embargo',
      supporters: weighted.filter((entry) => entry.vote === 'yes').map((entry) => entry.voterId),
    }).id;
  }
  if (resolution.passed && resolution.type === 'repeal_sanction') {
    for (const sanction of ensureDiplomacy(state).council.sanctions) {
      if (sanction.status === 'active' && sanction.target === resolution.target) {
        sanction.status = 'repealed';
        sanction.endedAt = now(state);
      }
    }
  }
  if (resolution.passed && resolution.type === 'emergency_coalition') {
    resolution.coalitionMembers = Object.entries(resolution.votes)
      .filter(([, vote]) => vote === 'yes').map(([actorId]) => actorId);
  }
  if (resolution.passed && ['emergency_coalition', 'collective_defense'].includes(resolution.type)) {
    const members = Object.entries(resolution.votes).filter(([, vote]) => vote === 'yes').map(([actorId]) => actorId).sort();
    resolution.coalitionMembers = members;
    resolution.defenseAgreementIds = [];
    for (let left = 0; left < members.length; left++) {
      for (let right = left + 1; right < members.length; right++) {
        const agreement = createAgreement(state, {
          type: AGREEMENT_DEFENSE,
          parties: [members[left], members[right]],
          durationMs: resolution.durationMs,
          terms: { councilResolutionId: resolution.id, collectiveDefenseTarget: resolution.target },
        }, { bypassTech: true });
        if (agreement.ok) resolution.defenseAgreementIds.push(agreement.agreement.id);
      }
    }
  }
  if (resolution.passed && resolution.type === 'condemnation') adjustActorReputation(state, resolution.target, -15, 'council_condemnation');
  if (resolution.passed && resolution.type === 'helioclast_inspection') {
    const crisis = ensureDiplomacy(state).helioclastCrisis;
    crisis.inspectionDemandedAt = now(state);
    crisis.inspectionResolutionId = resolution.id;
  }
  addTransmission(state, {
    from: 'council',
    to: PLAYER_ID,
    kind: 'council_result',
    subject: `Council motion ${resolution.passed ? 'passed' : 'failed'}`,
    body: `${resolution.type.replaceAll('_', ' ')} concerning ${resolution.target}: ${resolution.tally.yes} authority for, ${resolution.tally.no} against.`,
    tone: 'formal',
    relatedId: resolution.id,
  });
  recordHistory(state, 'council_resolution_resolved', { resolution });
  return { ok: true, resolution };
}

export function isSanctioned(state, actorId) {
  return ensureDiplomacy(state).council.sanctions.some((sanction) => activeAt(sanction, now(state)) && sanction.target === actorId);
}

export function sanctionEffects(state, actorId, counterpart = null) {
  const active = ensureDiplomacy(state).council.sanctions.filter((sanction) => activeAt(sanction, now(state)) && sanction.target === actorId);
  const blockedBySupporter = counterpart != null && active.some((sanction) => sanction.supporters.includes(counterpart))
    && !activeAgreementRecords(state, AGREEMENT_ALLIANCE, [actorId, counterpart]).length;
  return {
    active: active.length > 0,
    tradeRevenueMultiplier: active.length ? DIPLOMACY_CONFIG.sanctionTradeMultiplier : 1,
    authorityMultiplier: active.length ? DIPLOMACY_CONFIG.sanctionAuthorityMultiplier : 1,
    acceptancePenalty: active.length ? DIPLOMACY_CONFIG.sanctionAcceptancePenalty : 0,
    blocksTradeOrAlliance: blockedBySupporter,
    sanctions: active,
  };
}

export function setRelation(state, factionId, status) {
  if (!VALID_RELATIONS.has(status)) return { ok: false, reason: 'Unknown relation status' };
  if (!isDiplomacyUnlocked(state) && status !== RELATION_WAR && status !== RELATION_NEUTRAL) {
    return { ok: false, reason: 'Diplomacy locked — complete a Dyson sphere first' };
  }
  const tech = treatyTechCheck(state, status);
  if (!tech.ok) return tech;
  if (!factionById(state, factionId)) return { ok: false, reason: 'Unknown faction' };
  establishContact(state, factionId, { stage: CONTACT_ESTABLISHED, trigger: 'legacy_relation' });
  if (status === RELATION_WAR) return declareWar(state, factionId, { force: true, goals: [{ type: 'border_security' }] });
  if (status === RELATION_NEUTRAL) {
    const war = getActiveWar(state, factionId);
    if (war) endWar(state, war.id, { reason: 'relation_reset', restoreOccupations: false });
    for (const agreement of listActiveAgreements(state, factionId)) endAgreement(state, agreement.id, { reason: 'relation_reset' });
    const relation = syncRelationStatus(state, factionId);
    return { ok: true, factionId, status: relation.status };
  }
  const type = status === RELATION_TRUCE ? AGREEMENT_TRUCE
    : status === RELATION_TRADE ? AGREEMENT_TRADE
      : AGREEMENT_ALLIANCE;
  const result = createAgreement(state, type, factionId, { bypassTech: false });
  if (!result.ok) return result;
  return { ok: true, factionId, status: syncRelationStatus(state, factionId).status, agreement: result.agreement };
}

export function offerTreaty(state, factionId, type) {
  if (!isDiplomacyUnlocked(state)) return { ok: false, reason: 'Diplomacy locked' };
  if (!factionById(state, factionId)) return { ok: false, reason: 'Unknown faction' };
  const tech = treatyTechCheck(state, type);
  if (!tech.ok) return tech;
  const relationStatus = type === AGREEMENT_TRUCE ? RELATION_TRUCE
    : type === AGREEMENT_TRADE ? RELATION_TRADE
      : type === AGREEMENT_ALLIANCE ? RELATION_ALLIANCE
        : null;
  if (!relationStatus) return { ok: false, reason: 'Unknown treaty type' };
  const existing = activeAgreementRecords(state, type, [PLAYER_ID, factionId])[0];
  if (existing) return { ok: true, factionId, status: syncRelationStatus(state, factionId).status, agreement: existing, existing: true };
  const creditCostMultiplier = empireStructureEffectValue(state, 'treatyCostMult', { base: 1, op: 'mult' });
  const baseCredits = type === AGREEMENT_TRUCE ? DIPLOMACY_TRUCE_COST
    : type === AGREEMENT_TRADE ? DIPLOMACY_TRADE_TREATY_COST
      : DIPLOMACY_ALLIANCE_COST;
  const credits = Math.ceil(baseCredits * creditCostMultiplier);
  const solarii = type === AGREEMENT_ALLIANCE
    ? Math.ceil(DIPLOMACY_ALLIANCE_SOLARII * creditCostMultiplier * 100) / 100
    : 0;
  if (finite(state.credits) < credits) return { ok: false, reason: `Need ${credits} credits` };
  if (finite(state.solarii) < solarii) return { ok: false, reason: `Need ${solarii} Solarii` };
  state.credits -= credits;
  state.solarii = finite(state.solarii) - solarii;
  const result = setRelation(state, factionId, relationStatus);
  if (!result.ok) {
    state.credits += credits;
    state.solarii += solarii;
    return result;
  }
  return { ...result, cost: { credits, solarii } };
}

export function diplomaticTradeBonus(state) {
  ensureDiplomacy(state);
  let bonus = 0;
  for (const faction of listAiFactionsFromState(state)) {
    if (hasAgreement(state, faction.id, AGREEMENT_TRADE)
        || hasAgreement(state, faction.id, AGREEMENT_ALLIANCE)
        || [RELATION_TRADE, RELATION_ALLIANCE].includes(getRelation(state, faction.id).status)) {
      bonus += DIPLOMACY_TRADE_INCOME_BONUS;
    }
  }
  if (isTechUnlocked(state, 'dip_embassy_network')) bonus += DIPLOMACY_TRADE_INCOME_BONUS;
  const structureTreatyMult = empireStructureEffectValue(state, 'treatyEffectMult', { base: 1, op: 'mult' });
  const techTreatyMult = techEffects(state).treatyEffectMult ?? 1;
  return 1 + bonus * structureTreatyMult * techTreatyMult;
}

export function settleDiplomaticTradeDelivery(state, input = {}) {
  const from = input.from ?? PLAYER_ID;
  const to = input.to;
  const baseValue = Math.max(0, finite(input.baseValue));
  if (!actorExists(state, from) || !actorExists(state, to) || from === to || baseValue <= 0) {
    return { ok: false, reason: 'Foreign trade delivery requires two actors and a positive base value', value: baseValue };
  }
  const agreement = activeAgreementRecords(state, null, [from, to]).find((entry) => (
    [AGREEMENT_TRADE, AGREEMENT_ALLIANCE].includes(entry.type)
  ));
  if (!agreement) return { ok: true, foreignTrade: false, baseValue, value: baseValue, partnerShare: 0 };
  const revenueMultiplier = DIPLOMACY_CONFIG.tradeDeliveryMultiplier
    * sanctionEffects(state, from, to).tradeRevenueMultiplier;
  const value = round2(baseValue * revenueMultiplier);
  const partnerShare = round2(baseValue * DIPLOMACY_CONFIG.tradePartnerShare);
  const partnerWallet = walletForActor(state, to);
  if (partnerWallet) partnerWallet.credits = finite(partnerWallet.credits) + partnerShare;
  recordDiplomaticEvent(state, { type: 'convoy_delivered', actor: from, target: to, severity: Math.max(0.5, baseValue / 500) });
  recordHistory(state, 'foreign_trade_delivered', { from, to, baseValue, value, partnerShare, agreementId: agreement.id });
  return { ok: true, foreignTrade: true, baseValue, value, partnerShare, agreementId: agreement.id };
}

export function escalateHelioclastCrisis(state, input = {}) {
  const diplomacy = ensureDiplomacy(state);
  const crisis = diplomacy.helioclastCrisis;
  const actor = input.actor ?? PLAYER_ID;
  const incidentLevel = input.destructive ? (input.foreignOrInhabited === false ? 3 : 4)
    : input.threatened ? 2
      : 1;
  const nextLevel = clamp(Math.max(crisis.level + 1, incidentLevel), 0, HELIOCLAST_CRISIS_STAGES.length - 1);
  crisis.level = nextLevel;
  crisis.stage = HELIOCLAST_CRISIS_STAGES[nextLevel];
  crisis.startedAt ??= now(state);
  crisis.lastEscalatedAt = now(state);
  crisis.severity = clamp(finite(crisis.severity) + (input.destructive ? 45 : input.threatened ? 20 : 10), 0, 100);
  crisis.actor = actor;
  crisis.incidents.push({
    at: now(state), actor, systemId: input.systemId ?? null, destructive: !!input.destructive,
    threatened: !!input.threatened, stage: crisis.stage,
  });
  for (const faction of factionList(state)) {
    if (faction.id === actor) continue;
    if (actor === PLAYER_ID && getContact(state, faction.id).stage === CONTACT_UNKNOWN) {
      detectContact(state, faction.id, { trigger: 'superweapon', intelligence: 35 });
    }
    addActorRelationshipModifier(state, faction.id, actor, {
      source: 'helioclast_crisis', label: input.destructive ? 'Destructive Helioclast use' : 'Helioclast alarm',
      opinion: input.destructive ? -45 : -10, trust: input.destructive ? -35 : -8,
      fear: input.destructive ? 35 : 12, respect: input.destructive ? 5 : 3,
      durationMs: input.destructive ? null : 600000,
      stackKey: `helioclast:${faction.id}:${actor}`,
    });
    if ([PLAYER_ID, faction.id].includes(actor) || actor === PLAYER_ID) addTransmission(state, {
      from: faction.id,
      to: actor,
      kind: 'helioclast_crisis',
      subject: input.destructive ? 'Containment response initiated' : 'Concern over Helioclast activity',
      body: input.destructive
        ? 'The destruction has forced the galactic powers toward sanctions and collective containment.'
        : 'We demand transparency. Continued escalation will trigger inspection and council action.',
      tone: input.destructive ? 'hostile' : 'concerned',
    });
  }
  if (nextLevel >= 2 && isTechUnlocked(state, 'dip_galactic_council')) {
    const types = nextLevel >= 4 ? ['sanction', 'emergency_coalition']
      : nextLevel >= 3 ? ['sanction'] : ['helioclast_inspection'];
    const proposer = factionList(state).map((faction) => faction.id).sort()[0] ?? PLAYER_ID;
    for (const type of types) if (!diplomacy.council.resolutions.some((entry) => (
      entry.status === 'voting' && entry.target === actor && entry.type === type
    ))) proposeCouncilResolution(state, { proposer, target: actor, type, reason: 'Helioclast crisis' });
  }
  if (nextLevel >= 5) {
    for (const faction of factionList(state)) {
      if (faction.id === actor || getActiveWar(state, [faction.id, actor])
          || activeAgreementRecords(state, AGREEMENT_ALLIANCE, [faction.id, actor]).length) continue;
      declareWar(state, { attacker: faction.id, defender: actor, force: true,
        goals: [{ type: 'superweapon_containment', systemIds: [] }], legitimacy: 100 });
    }
  }
  recordHistory(state, 'helioclast_crisis_escalated', { stage: crisis.stage, level: crisis.level, actor, systemId: input.systemId ?? null });
  return { ok: true, crisis: clone(crisis) };
}

export function triggerSuperweaponPanic(state) {
  const diplomacy = ensureDiplomacy(state);
  diplomacy.panicUntil = now(state) + 120000;
  const result = escalateHelioclastCrisis(state, { actor: PLAYER_ID, destructive: false });
  return { ...result, panicUntil: diplomacy.panicUntil,
    reactions: factionList(state).map((faction) => ({ factionId: faction.id, reaction: 'concern' })) };
}

export function isSuperweaponPanic(state) {
  return now(state) < (state.diplomacy?.panicUntil ?? 0);
}

function processTribute(state, agreement, elapsedMs) {
  const payer = agreement.terms?.payer;
  const payee = agreement.terms?.payee;
  const credits = finite(agreement.terms?.creditsPerMinute) * elapsedMs / 60000;
  const solarii = finite(agreement.terms?.solariiPerMinute) * elapsedMs / 60000;
  const wallet = walletForActor(state, payer);
  if (!wallet || finite(wallet.credits) + 1e-9 < credits || finite(wallet.solarii) + 1e-9 < solarii) {
    endAgreement(state, agreement.id, { reason: 'tribute_default', breachedBy: payer });
    return { type: 'tribute_default', agreementId: agreement.id, payer };
  }
  if (credits > 0) transferResources(state, payer, payee, 'credits', credits);
  if (solarii > 0) transferResources(state, payer, payee, 'solarii', solarii);
  agreement.lastPaidAt = now(state);
  if (now(state) - finite(agreement.lastComplianceAt) >= 60000) {
    agreement.lastComplianceAt = now(state);
    recordDiplomaticEvent(state, {
      type: 'promise_honored', actor: payer, target: payee, severity: 0.5,
      agreementId: agreement.id,
    });
  } else {
    touchDiplomacy(state);
  }
  return credits || solarii ? { type: 'tribute_paid', agreementId: agreement.id, credits, solarii } : null;
}

function deterministicAiTerms(state, from, to) {
  const profile = actorProfile(state, from);
  const relationship = getActorRelationshipBreakdown(state, from, to).metrics;
  const war = getActiveWar(state, [from, to]);
  if (war && (finite(war.exhaustion[from]) >= 40 - profile.planningHorizon * 5
      || peaceLeverage(state, war.id, to) >= 40 - profile.planningHorizon * 3)) {
    return [{ type: 'end_war', warId: war.id, cededSystemIds: [], truceMs: DEFAULT_PEACE_TRUCE_MS }];
  }
  if (war) return null;
  const commonThreat = actorIds(state).filter((actorId) => actorId !== from && actorId !== to)
    .find((actorId) => diplomaticLeverage(state, actorId, from).value >= 10
      && getActorRelationshipBreakdown(state, from, actorId).metrics.opinion <= -20
      && getActorRelationshipBreakdown(state, to, actorId).metrics.opinion <= -20);
  if (commonThreat && relationship.trust >= DIPLOMACY_CONFIG.defenseTrustGate
      && !activeAgreementRecords(state, AGREEMENT_DEFENSE, [from, to]).length) {
    return [{ type: 'agreement', agreementType: AGREEMENT_DEFENSE,
      terms: { strategicThreat: commonThreat } }];
  }
  if (profile.personality === 'economic' && !activeAgreementRecords(state, AGREEMENT_TRADE, [from, to]).length) {
    return [{ type: 'agreement', agreementType: AGREEMENT_TRADE }];
  }
  if (profile.personality === 'wormhole' && !activeAgreementRecords(state, AGREEMENT_OPEN_BORDERS, [from, to]).length) {
    return [{ type: 'agreement', agreementType: AGREEMENT_OPEN_BORDERS }];
  }
  if (profile.personality === 'megastructure' && relationship.trust >= DIPLOMACY_CONFIG.defenseTrustGate
      && !activeAgreementRecords(state, AGREEMENT_DEFENSE, [from, to]).length) {
    return [{ type: 'agreement', agreementType: AGREEMENT_DEFENSE }];
  }
  const targetWallet = walletForActor(state, to);
  if (profile.personality === 'expansionist' && finite(targetWallet?.credits) >= 100) {
    return [{ type: 'resource', resource: 'credits', amount: Math.min(300, Math.max(50, Math.floor(targetWallet.credits * 0.05))), from: to, to: from }];
  }
  if (!activeAgreementRecords(state, AGREEMENT_TRUCE, [from, to]).length) {
    return [{ type: 'agreement', agreementType: AGREEMENT_TRUCE, durationMs: 120000 }];
  }
  return null;
}

function controlledSystemRefs(state, actorId) {
  const refs = [];
  for (const [galaxyId, galaxy] of Object.entries(state.galaxies ?? {})) {
    const systems = Object.values(galaxy.systems ?? {}).length
      ? Object.values(galaxy.systems ?? {})
      : Object.values(galaxy.abstract?.systemOverlays ?? {});
    for (const system of systems) if (actorForSystem(system, state) === actorId) refs.push({ galaxyId, systemId: system.id });
  }
  if (!state.galaxies) for (const system of Object.values(state.systems ?? {})) {
    if (actorForSystem(system, state) === actorId) refs.push({ galaxyId: state.activeGalaxyId ?? null, systemId: system.id });
  }
  return refs.sort((left, right) => `${left.galaxyId}:${left.systemId}`.localeCompare(`${right.galaxyId}:${right.systemId}`));
}

function processAiCallsToArms(state, events) {
  const diplomacy = ensureDiplomacy(state);
  for (const call of diplomacy.callsToArms.filter((entry) => entry.status === 'pending')) {
    if (call.ally === PLAYER_ID) {
      if (now(state) >= call.expiresAt) {
        const response = respondToCallToArms(state, call.id, false, PLAYER_ID);
        events.push({ type: 'call_to_arms_refused', callId: call.id, reason: 'expired', ok: response.ok });
      }
      continue;
    }
    if (now(state) - call.createdAt < 1000) continue;
    const relation = getActorRelationshipBreakdown(state, call.ally, call.caller).metrics;
    const profile = actorProfile(state, call.ally);
    const threat = diplomaticLeverage(state, call.aggressor, call.ally).value;
    const utility = profile.reliability * 60 + profile.coordination * 15
      + relation.trust * 0.5 + relation.respect * 0.2 - Math.max(0, threat);
    const response = respondToCallToArms(state, call.id, utility >= 35, call.ally);
    events.push({ type: response.accepted ? 'call_to_arms_accepted' : 'call_to_arms_refused', callId: call.id, actor: call.ally });
  }
}

function processAiWarDecisions(state, events) {
  const actors = actorIds(state).filter((id) => id !== PLAYER_ID).sort();
  for (const attacker of actors) {
    const profile = actorProfile(state, attacker);
    if (profile.personality !== 'expansionist' || profile.riskTolerance < 0.55) continue;
    for (const defender of actorIds(state).filter((id) => id !== attacker).sort()) {
      if (defender === PLAYER_ID && getContact(state, attacker).stage !== CONTACT_ESTABLISHED) continue;
      if (getActiveWar(state, [attacker, defender]) || activeAgreementRecords(state, null, [attacker, defender])
        .some((agreement) => [AGREEMENT_TRUCE, AGREEMENT_DEFENSE, AGREEMENT_ALLIANCE, AGREEMENT_NON_AGGRESSION].includes(agreement.type))) continue;
      const relationship = getActorRelationshipBreakdown(state, attacker, defender);
      if (relationship.metrics.opinion > -55 && relationship.grievanceSeverity < 60) continue;
      if (diplomaticLeverage(state, attacker, defender).value < -10) continue;
      const target = controlledSystemRefs(state, defender)
        .map((entry) => ({ ...entry, value: systemNegotiationValue(state, entry) }))
        .sort((left, right) => right.value - left.value
          || `${left.galaxyId}:${left.systemId}`.localeCompare(`${right.galaxyId}:${right.systemId}`))[0];
      if (!target) continue;
      let claim = listClaims(state, { activeOnly: true, systemId: target.systemId })
        .find((entry) => entry.claimant === attacker && entry.target === defender);
      if (!claim) claim = createClaim(state, { claimant: attacker, target: defender, ...target, source: 'ai_strategy' }).claim;
      const ultimatumKey = pairKey(attacker, defender);
      const ultimatum = ensureDiplomacy(state).proposals
        .filter((proposal) => proposal.ultimatum && proposal.from === attacker && proposal.to === defender)
        .sort((left, right) => right.createdAt - left.createdAt)[0];
      if (!ultimatum) {
        const demand = submitProposal(state, {
          from: attacker,
          to: defender,
          ultimatum: true,
          message: `Ultimatum: recognize our claim on ${target.systemId} and pay tribute`,
          terms: [
            { type: 'claim', claimant: attacker, target: defender, systemId: target.systemId, galaxyId: target.galaxyId },
            { type: 'tribute', payer: defender, payee: attacker, creditsPerMinute: 25, durationMs: 180000 },
          ],
        }, { lifetimeMs: 20000 });
        ensureDiplomacy(state).ai.ultimatumAt[ultimatumKey] = now(state);
        if (demand.ok) events.push({ type: 'ai_ultimatum', attacker, defender, proposalId: demand.proposal.id });
        continue;
      }
      if ([PROPOSAL_PENDING, PROPOSAL_ACCEPTED].includes(ultimatum.status)) continue;
      if (ultimatum.status === PROPOSAL_COUNTERED) {
        const counter = ensureDiplomacy(state).proposals.find((proposal) => proposal.id === ultimatum.counterProposalId);
        if (counter && [PROPOSAL_PENDING, PROPOSAL_ACCEPTED].includes(counter.status)) continue;
      }
      const declaration = declareWar(state, { attacker, defender,
        goals: [{ type: 'claimed_conquest', systemIds: [target.systemId] }], ultimatum: true });
      if (declaration.ok) events.push({ type: 'ai_war_declared', attacker, defender, warId: declaration.war.id, claimId: claim?.id });
      break;
    }
  }
}

function processAiBreachDecisions(state, events) {
  const diplomacy = ensureDiplomacy(state);
  const strategicWindow = Math.floor(now(state) / Math.max(1, DIPLOMACY_CONFIG.strategicTickMs));
  for (const agreement of activeAgreementRecords(state).sort((a, b) => a.id.localeCompare(b.id))) {
    if ([AGREEMENT_CEASEFIRE, AGREEMENT_TRUCE].includes(agreement.type)) continue;
    for (const actor of [...agreement.parties].sort()) {
      if (actor === PLAYER_ID) continue;
      const counterpart = agreement.parties.find((party) => party !== actor);
      const profile = actorProfile(state, actor);
      const relationship = getActorRelationshipBreakdown(state, actor, counterpart);
      const pressure = Math.max(0, diplomaticLeverage(state, counterpart, actor).value)
        + relationship.grievanceSeverity * 0.35 + Math.max(0, -relationship.metrics.trust) * 0.2;
      const betrayalChance = clamp((1 - profile.reliability) * 18 + pressure - 25, 0, 45);
      const roll = stableHash(`${state.meta?.seed ?? 1}:${agreement.id}:${actor}:${strategicWindow}`) % 100;
      if (roll >= betrayalChance) continue;
      const ended = endAgreement(state, agreement.id, {
        reason: 'strategic_betrayal', breachedBy: actor,
        severity: [AGREEMENT_DEFENSE, AGREEMENT_ALLIANCE].includes(agreement.type) ? 2 : 1,
      });
      if (ended.ok) events.push({
        type: 'ai_treaty_betrayal', agreementId: agreement.id,
        actor, target: counterpart,
      });
      break;
    }
  }
}

function processAiProposals(state, events) {
  const diplomacy = ensureDiplomacy(state);
  for (const proposal of diplomacy.proposals.filter((entry) => (
    entry.status === PROPOSAL_PENDING && entry.to !== PLAYER_ID && now(state) - entry.createdAt >= 1000
  ))) {
    const preview = previewProposal(state, proposal, { perspective: proposal.to });
    if (preview.acceptable) {
      const response = respondToProposal(state, proposal.id, 'accept', { actor: proposal.to });
      events.push({ type: response.ok ? 'proposal_accepted' : 'proposal_failed', proposalId: proposal.id, factionId: proposal.to, reason: response.reason });
      continue;
    }
    if (preview.counterable) {
      const terms = buildSmallestCounterOffer(state, proposal, preview);
      if (terms.ok) {
        const counter = counterProposal(state, proposal.id, terms.terms, { actor: proposal.to, message: 'These are the minimum balancing terms.' });
        if (counter.ok) {
          events.push({ type: 'proposal_countered', proposalId: proposal.id, counterProposalId: counter.counterProposal.id, factionId: proposal.to });
          continue;
        }
      }
    }
    respondToProposal(state, proposal.id, 'reject', { actor: proposal.to,
      reason: preview.reasons.map((reason) => reason.label).join('; ') || 'Terms conflict with strategic interests' });
    events.push({ type: 'proposal_rejected', proposalId: proposal.id, factionId: proposal.to, score: preview.score });
  }

  for (const from of actorIds(state).filter((id) => id !== PLAYER_ID).sort()) {
    for (const to of actorIds(state).filter((id) => id !== from).sort()) {
    if (to === PLAYER_ID && getContact(state, from).stage !== CONTACT_ESTABLISHED) continue;
    if (diplomacy.proposals.some((proposal) => proposal.status === PROPOSAL_PENDING
        && pairKey(proposal.from, proposal.to) === pairKey(from, to))) continue;
    const cooldownKey = pairKey(from, to);
    const lastAt = finite(diplomacy.ai.lastProposalAt[cooldownKey]);
    if (now(state) - lastAt < AI_PROPOSAL_COOLDOWN_MS) continue;
    const terms = deterministicAiTerms(state, from, to);
    diplomacy.ai.lastProposalAt[cooldownKey] = now(state);
    if (!terms) continue;
    const result = submitProposal(state, { from, to, terms }, { allowUnknownContact: false });
    if (result.ok) events.push({ type: 'ai_proposal', from, to, proposalId: result.proposal.id });
    }
  }
}

export function tickDiplomacy(state) {
  if (state.paused) return [];
  const diplomacy = ensureDiplomacy(state);
  const at = now(state);
  if (at - diplomacy.lastTickAt < DIPLOMACY_TICK_INTERVAL_MS) return [];
  const elapsedMs = Math.max(DIPLOMACY_TICK_INTERVAL_MS, at - diplomacy.lastTickAt);
  diplomacy.lastTickAt = at;
  const events = [];
  let softMutation = false;
  for (const proposal of diplomacy.proposals) {
    if (proposal.status === PROPOSAL_PENDING && at >= proposal.expiresAt) {
      proposal.status = PROPOSAL_EXPIRED;
      proposal.resolvedAt = at;
      events.push({ type: 'proposal_expired', proposalId: proposal.id });
      recordHistory(state, 'proposal_expired', { proposalId: proposal.id, reason: 'deadline' });
    }
  }
  for (const agreement of diplomacy.agreements) {
    if (agreement.status === 'active' && agreement.expiresAt != null && at >= agreement.expiresAt) {
      endAgreement(state, agreement.id, { status: 'expired', reason: 'duration_complete' });
      events.push({ type: 'agreement_expired', agreementId: agreement.id });
    } else if (activeAt(agreement, at) && agreement.type === AGREEMENT_TRIBUTE) {
      const payment = processTribute(state, agreement, Math.max(0, at - finite(agreement.lastPaidAt, at - elapsedMs)));
      if (payment) events.push(payment);
    }
  }
  for (const sanction of diplomacy.council.sanctions) {
    if (sanction.status === 'active' && sanction.expiresAt != null && at >= sanction.expiresAt) {
      sanction.status = 'expired';
      sanction.endedAt = at;
      events.push({ type: 'sanction_expired', sanctionId: sanction.id });
      recordHistory(state, 'sanction_expired', { sanctionId: sanction.id, target: sanction.target });
    }
  }
  const decay = DIPLOMACY_CONFIG.temporaryMemoryDecayPerMinute * elapsedMs / 60000;
  for (const [key, records] of Object.entries(diplomacy.pairModifiers)) {
    for (const modifier of records) {
      if (modifier.permanent || modifier.expiresAt == null) continue;
      for (const metric of METRIC_KEYS) {
        const value = finite(modifier[metric]);
        const decayed = Math.sign(value) * Math.max(0, Math.abs(value) - decay);
        if (decayed !== value) softMutation = true;
        modifier[metric] = decayed;
      }
    }
    const activeRecords = records.filter((modifier) => modifier.expiresAt == null || at < modifier.expiresAt);
    if (activeRecords.length !== records.length) softMutation = true;
    diplomacy.pairModifiers[key] = activeRecords;
  }
  for (const faction of factionList(state)) {
    const key = pairKey(PLAYER_ID, faction.id);
    diplomacy.modifiers[faction.id] = diplomacy.pairModifiers[key] ?? [];
  }
  for (const grievance of diplomacy.grievances) {
    if (grievance.status === 'active' && grievance.expiresAt != null && at >= grievance.expiresAt) {
      grievance.status = 'faded';
      grievance.resolvedAt = at;
      events.push({ type: 'grievance_faded', grievanceId: grievance.id });
      recordHistory(state, 'grievance_faded', { grievanceId: grievance.id });
    }
  }
  for (const war of diplomacy.wars.filter((entry) => activeAt(entry, at))) {
    const elapsedMinutes = Math.max(0, at - finite(war.lastExhaustionAt, at)) / 60000;
    for (const actorId of war.parties) {
      const previous = finite(war.exhaustion[actorId]);
      const next = clamp(previous + elapsedMinutes * 2, 0, 100);
      if (next !== previous) softMutation = true;
      war.exhaustion[actorId] = next;
    }
    war.lastExhaustionAt = at;
  }
  for (const resolution of diplomacy.council.resolutions) {
    if (resolution.status === 'voting') {
      const commitments = commitAiCouncilVotes(state, resolution);
      if (commitments.length) events.push({ type: 'council_votes_committed', resolutionId: resolution.id, commitments });
    }
    if (resolution.status === 'voting' && at >= resolution.votingEndsAt) {
      const result = resolveCouncilResolution(state, resolution.id, { force: true });
      if (result.ok) events.push({ type: 'council_resolution_resolved', resolutionId: resolution.id, passed: result.resolution.passed });
    }
  }
  processAiCallsToArms(state, events);
  if (at - diplomacy.lastStrategicTickAt >= DIPLOMACY_CONFIG.strategicTickMs) {
    diplomacy.lastStrategicTickAt = at;
    processAiProposals(state, events);
    processAiBreachDecisions(state, events);
    processAiWarDecisions(state, events);
  }
  if (softMutation) touchDiplomacy(state, diplomacy);
  return events;
}

export function diplomacySummary(state) {
  const diplomacy = ensureDiplomacy(state);
  refreshMilestones(state);
  const factions = listAiFactionsFromState(state).map((faction) => {
    const relation = syncRelationStatus(state, faction.id);
    const relationship = getRelationshipBreakdown(state, faction.id);
    const war = getActiveWar(state, faction.id);
    return {
      id: faction.id,
      name: faction.name,
      personality: faction.personality,
      ...relation,
      contact: clone(getContact(state, faction.id)),
      relationship,
      agreements: listActiveAgreements(state, faction.id).map((agreement) => clone(agreement)),
      claims: listClaims(state, { factionId: faction.id, activeOnly: true }).map((claim) => clone(claim)),
      war: war ? clone(war) : null,
      sanctioned: isSanctioned(state, faction.id),
      pendingProposals: diplomacy.proposals.filter((proposal) => proposal.status === PROPOSAL_PENDING
        && (proposal.from === faction.id || proposal.to === faction.id)).map((proposal) => clone(proposal)),
    };
  });
  return {
    version: DIPLOMACY_SCHEMA_VERSION,
    schemaVersion: DIPLOMACY_SCHEMA_VERSION,
    unlocked: isDiplomacyUnlocked(state),
    panic: isSuperweaponPanic(state),
    panicUntil: diplomacy.panicUntil,
    factions,
    contacts: clone(diplomacy.contacts),
    proposals: diplomacy.proposals.map((proposal) => clone(proposal)),
    agreements: diplomacy.agreements.map((agreement) => clone(agreement)),
    claims: diplomacy.claims.map((claim) => clone(claim)),
    wars: diplomacy.wars.map((war) => clone(war)),
    occupations: diplomacy.occupations.map((occupation) => clone(occupation)),
    council: clone(diplomacy.council),
    profiles: clone(diplomacy.profiles),
    pairRelations: clone(diplomacy.pairRelations),
    grievances: diplomacy.grievances.filter((entry) => entry.status === 'active').map((entry) => clone(entry)),
    favors: diplomacy.favors.filter((entry) => entry.status === 'owed').map((entry) => clone(entry)),
    transmissions: diplomacy.transmissions.filter((entry) => entry.status === 'open').slice(-30).map((entry) => clone(entry)),
    callsToArms: diplomacy.callsToArms.filter((entry) => entry.status === 'pending').map((entry) => clone(entry)),
    helioclastCrisis: clone(diplomacy.helioclastCrisis),
    revision: diplomaticRevision(state),
    history: diplomacy.history.slice(-100).map((entry) => clone(entry)),
    tradeBonus: diplomaticTradeBonus(state),
  };
}

export function actionableDiplomacySummary(state) {
  const summary = diplomacySummary(state);
  return {
    version: summary.version,
    revision: summary.revision,
    unlocked: summary.unlocked,
    helioclastCrisis: summary.helioclastCrisis,
    factions: summary.factions.map((faction) => ({
      id: faction.id,
      name: faction.name,
      personality: faction.personality,
      agenda: summary.profiles[faction.id]?.priorities ?? [],
      reputation: actorReputation(state, faction.id),
      contact: faction.contact,
      stance: faction.status,
      relationship: faction.relationship.metrics,
      grievances: summary.grievances.filter((entry) => entry.aggrieved === faction.id && entry.against === PLAYER_ID),
      obligations: faction.agreements.map((agreement) => ({
        id: agreement.id, type: agreement.type, expiresAt: agreement.expiresAt, terms: agreement.terms,
      })),
      leverage: diplomaticLeverage(state, PLAYER_ID, faction.id).value,
      war: faction.war ? {
        id: faction.war.id, escalation: faction.war.escalation, score: faction.war.score,
        exhaustion: faction.war.exhaustion, goals: faction.war.goals,
        peaceLeverage: peaceLeverage(state, faction.war.id, PLAYER_ID),
      } : null,
      sanctioned: faction.sanctioned,
      pendingProposals: faction.pendingProposals.map((proposal) => {
        const preview = previewProposal(state, proposal);
        return {
          id: proposal.id, from: proposal.from, to: proposal.to, terms: proposal.terms,
          expiresAt: proposal.expiresAt, acceptanceRange: preview.scoreRange,
          threshold: preview.threshold, reasons: preview.reasons, hardBlock: preview.hardBlock,
        };
      }),
    })),
    callsToArms: summary.callsToArms,
    council: {
      authority: Object.fromEntries(actorIds(state).map((actorId) => [actorId, councilAuthority(state, actorId)])),
      voting: summary.council.resolutions.filter((entry) => entry.status === 'voting'),
      sanctions: summary.council.sanctions.filter((entry) => entry.status === 'active'),
    },
    transmissions: summary.transmissions.filter((entry) => !entry.read).slice(-10),
  };
}
