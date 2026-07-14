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

export const DIPLOMACY_SCHEMA_VERSION = 2;

export const RELATION_WAR = 'war';
export const RELATION_NEUTRAL = 'neutral';
export const RELATION_TRUCE = 'truce';
export const RELATION_TRADE = 'trade';
export const RELATION_ALLIANCE = 'alliance';

export const CONTACT_UNKNOWN = 'unknown';
export const CONTACT_CONTACTED = 'contacted';
export const CONTACT_ESTABLISHED = 'established';

export const AGREEMENT_CEASEFIRE = 'ceasefire';
export const AGREEMENT_TRUCE = 'truce';
export const AGREEMENT_TRADE = 'trade';
export const AGREEMENT_OPEN_BORDERS = 'open_borders';
export const AGREEMENT_DEFENSE = 'defense';
export const AGREEMENT_ALLIANCE = 'alliance';
export const AGREEMENT_TRIBUTE = 'tribute';

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
]);

const PLAYER_ID = 'player';
const PROPOSAL_LIFETIME_MS = 120000;
const AI_PROPOSAL_COOLDOWN_MS = 60000;
const DIPLOMACY_TICK_INTERVAL_MS = 1000;
const DEFAULT_PEACE_TRUCE_MS = 120000;
const METRIC_KEYS = Object.freeze(['opinion', 'trust', 'fear', 'respect']);
const CONTACT_RANK = Object.freeze({ unknown: 0, contacted: 1, established: 2 });
const VALID_RELATIONS = new Set([
  RELATION_WAR,
  RELATION_NEUTRAL,
  RELATION_TRUCE,
  RELATION_TRADE,
  RELATION_ALLIANCE,
]);
const VALID_RESOLUTION_TYPES = new Set(['sanction', 'emergency_coalition', 'repeal_sanction']);
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
});
const PERSONALITY_METRICS = Object.freeze({
  expansionist: Object.freeze({ opinion: -5, trust: -5, fear: 0, respect: 5 }),
  economic: Object.freeze({ opinion: 5, trust: 5, fear: 0, respect: 0 }),
  megastructure: Object.freeze({ opinion: 0, trust: 2, fear: 0, respect: 5 }),
  wormhole: Object.freeze({ opinion: 2, trust: -2, fear: 0, respect: 3 }),
});
const normalizedDiplomacyObjects = new WeakSet();

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
  diplomacy.council = diplomacy.council && typeof diplomacy.council === 'object'
    ? diplomacy.council
    : {};
  diplomacy.council.resolutions = asArray(diplomacy.council.resolutions);
  diplomacy.council.sanctions = asArray(diplomacy.council.sanctions);
  diplomacy.lastTickAt = Math.max(0, finite(diplomacy.lastTickAt));
  diplomacy.panicUntil = Math.max(0, finite(diplomacy.panicUntil));

  normalizeRecordsInPlace(diplomacy.proposals, (entry) => ({
    ...entry,
    from: entry.from ?? PLAYER_ID,
    to: entry.to ?? entry.factionId ?? null,
    terms: asArray(entry.terms),
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
    }));
  normalizeRecordsInPlace(diplomacy.council.sanctions, (entry) => ({
      ...entry,
      status: entry.status ?? 'active',
      startedAt: Math.max(0, finite(entry.startedAt)),
      expiresAt: entry.expiresAt == null ? null : Math.max(0, finite(entry.expiresAt)),
    }));

  for (const kind of Object.keys(ID_PREFIX)) diplomacy.nextIds[kind] = normalizeCounter(diplomacy.nextIds[kind]);
  for (const [factionId, relation] of Object.entries(diplomacy.relations)) {
    diplomacy.relations[factionId] = normalizeRelation(relation);
  }
  for (const faction of factionList(state)) {
    const contact = diplomacy.contacts[faction.id];
    if (contact && typeof contact === 'object') {
      contact.factionId = faction.id;
      contact.stage = CONTACT_RANK[contact.stage] == null ? CONTACT_UNKNOWN : contact.stage;
    } else {
      diplomacy.contacts[faction.id] = {
        factionId: faction.id,
        stage: CONTACT_UNKNOWN,
        firstContactAt: null,
        establishedAt: null,
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
  return entry;
}

export function defaultRelation() {
  return normalizeRelation({ status: RELATION_NEUTRAL, treaties: [], lastChangedAt: 0 });
}

export function getRelation(state, factionId) {
  const diplomacy = ensureDiplomacy(state);
  if (!diplomacy.relations[factionId]) diplomacy.relations[factionId] = defaultRelation();
  return diplomacy.relations[factionId];
}

export function listAiFactionsFromState(state) {
  return factionList(state);
}

export function isDiplomacyUnlocked(state) {
  refreshMilestones(state);
  return !!state.milestones?.diplomacyUnlocked;
}

export function getContact(state, factionId) {
  const diplomacy = ensureDiplomacy(state);
  diplomacy.contacts[factionId] ??= {
    factionId,
    stage: CONTACT_UNKNOWN,
    firstContactAt: null,
    establishedAt: null,
  };
  return diplomacy.contacts[factionId];
}

export function establishContact(state, factionId, options = {}) {
  if (!factionById(state, factionId)) return { ok: false, reason: 'Unknown faction' };
  const requestedStage = options.stage ?? CONTACT_ESTABLISHED;
  if (CONTACT_RANK[requestedStage] == null) return { ok: false, reason: 'Unknown contact stage' };
  const contact = getContact(state, factionId);
  const previousStage = contact.stage;
  if (CONTACT_RANK[requestedStage] > CONTACT_RANK[contact.stage]) contact.stage = requestedStage;
  if (contact.stage !== CONTACT_UNKNOWN && contact.firstContactAt == null) contact.firstContactAt = now(state);
  if (contact.stage === CONTACT_ESTABLISHED && contact.establishedAt == null) contact.establishedAt = now(state);
  contact.trigger = options.trigger ?? contact.trigger ?? 'manual';
  if (contact.stage !== previousStage) {
    recordHistory(state, 'contact_stage_changed', { factionId, previousStage, stage: contact.stage, trigger: contact.trigger });
  }
  return { ok: true, factionId, previousStage, stage: contact.stage, contact };
}

function personalityMetricEntry(state, factionId) {
  const personality = factionById(state, factionId)?.personality ?? 'expansionist';
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

function dynamicMetricEntries(state, factionId, at) {
  const diplomacy = ensureDiplomacy(state);
  const entries = [];
  for (const agreement of diplomacy.agreements) {
    if (activeAt(agreement, at) && agreement.parties?.includes(PLAYER_ID) && agreement.parties.includes(factionId)) {
      entries.push(agreementMetricEntry(agreement, factionId));
    }
  }
  for (const claim of diplomacy.claims) {
    if (claim.status === 'active' && claim.target === factionId) {
      entries.push({
        id: `claim:${claim.id}`,
        source: 'claim',
        label: `Claim on ${claim.systemId}`,
        opinion: -12,
        trust: -8,
        fear: 1,
        respect: 1,
      });
    }
  }
  const war = getActiveWar(state, factionId);
  if (war) {
    entries.push({
      id: `war:${war.id}`,
      source: 'war',
      label: 'Active war',
      opinion: -40,
      trust: -35,
      fear: clamp(Math.abs(war.score) * 0.2, 0, 25),
      respect: clamp(war.score * 0.08, -10, 10),
    });
  }
  for (const sanction of diplomacy.council.sanctions) {
    if (activeAt(sanction, at) && (sanction.target === factionId || sanction.target === PLAYER_ID)) {
      const factionTargeted = sanction.target === factionId;
      entries.push({
        id: `sanction:${sanction.id}`,
        source: 'council_sanction',
        label: factionTargeted ? 'Council sanction against faction' : 'Council sanction against player',
        opinion: factionTargeted ? -10 : -20,
        trust: -15,
        fear: factionTargeted ? 4 : 8,
        respect: -3,
      });
    }
  }
  return entries;
}

export function addRelationshipModifier(state, factionId, modifier = {}) {
  if (!factionById(state, factionId)) return { ok: false, reason: 'Unknown faction' };
  const diplomacy = ensureDiplomacy(state);
  const records = diplomacy.modifiers[factionId] ?? (diplomacy.modifiers[factionId] = []);
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
  recordHistory(state, 'relationship_modifier_added', { factionId, modifier: record });
  return { ok: true, modifier: record };
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

export function getRelationshipBreakdown(state, factionId, options = {}) {
  const at = options.at ?? now(state);
  const relation = getRelation(state, factionId);
  const stored = asArray(ensureDiplomacy(state).modifiers[factionId]).filter((entry) => (
    entry.expiresAt == null || at < entry.expiresAt
  ));
  const modifiers = [
    {
      id: 'base', source: 'base', label: 'Base relationship',
      ...normalizeMetrics(relation.baseMetrics),
    },
    personalityMetricEntry(state, factionId),
    ...stored.map((entry) => ({ ...entry })),
    ...dynamicMetricEntries(state, factionId, at),
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
  relation.metrics = metrics;
  for (const key of METRIC_KEYS) relation[key] = metrics[key];
  return { factionId, metrics, rawTotals, modifiers };
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

function syncRelationStatus(state, factionId) {
  const relation = getRelation(state, factionId);
  let status = RELATION_NEUTRAL;
  if (getActiveWar(state, factionId)) status = RELATION_WAR;
  else if (hasAgreement(state, factionId, AGREEMENT_ALLIANCE)
      || hasAgreement(state, factionId, AGREEMENT_DEFENSE)) status = RELATION_ALLIANCE;
  else if (hasAgreement(state, factionId, AGREEMENT_TRADE)) status = RELATION_TRADE;
  else if (hasAgreement(state, factionId, AGREEMENT_TRUCE)
      || hasAgreement(state, factionId, AGREEMENT_CEASEFIRE)) status = RELATION_TRUCE;
  relation.status = status;
  relation.treaties = listActiveAgreements(state, factionId).map((agreement) => agreement.type);
  relation.lastChangedAt = now(state);
  return relation;
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
  const war = ensureDiplomacy(state).wars.find((candidate) => (
    activeAt(candidate, now(state)) && parties.every((actorId) => candidate.parties.includes(actorId))
  ));
  if (war && ![AGREEMENT_CEASEFIRE, AGREEMENT_TRUCE, AGREEMENT_TRIBUTE].includes(input.type)) {
    return { ok: false, reason: 'End the active war before forming this agreement' };
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

  if (validation.war && [AGREEMENT_CEASEFIRE, AGREEMENT_TRUCE].includes(input.type)) {
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
  const factionId = relationFactionFromParties(agreement.parties);
  if (factionId) {
    establishContact(state, factionId, { stage: CONTACT_ESTABLISHED, trigger: 'agreement' });
    syncRelationStatus(state, factionId);
  }
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
    if (agreement.breachedBy === PLAYER_ID) recordBrokenPromise(state, factionId, options.severity ?? 1);
    syncRelationStatus(state, factionId);
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
  ensureDiplomacy(state).claims.push(claim);
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
    return wars.find((war) => parties.every((actorId) => war.parties.includes(actorId))) ?? null;
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
    .find((agreement) => [AGREEMENT_CEASEFIRE, AGREEMENT_TRUCE].includes(agreement.type));
  if (blockingTruce && !input.force) return { ok: false, reason: 'An enforced ceasefire or truce is active' };

  for (const agreement of activeAgreementRecords(state, null, [attacker, defender])) {
    endAgreement(state, agreement.id, {
      reason: 'war_declared',
      breachedBy: attacker,
      severity: [AGREEMENT_ALLIANCE, AGREEMENT_DEFENSE].includes(agreement.type) ? 2 : 1,
    });
  }
  const parties = normalizeParties([attacker, defender]);
  const war = {
    id: nextId(state, 'war'),
    status: 'active',
    attackers: [attacker],
    defenders: [defender],
    parties,
    primaryAttacker: attacker,
    primaryDefender: defender,
    factionId: attacker === PLAYER_ID ? defender : attacker,
    goals: normalizeWarGoals(input.goals, input.systemIds),
    score: 0,
    scoreByActor: { [attacker]: 0, [defender]: 0 },
    exhaustion: { [attacker]: 0, [defender]: 0 },
    events: [],
    startedAt: now(state),
    lastExhaustionAt: now(state),
    authorizedByCampaignId: input.authorizedByCampaignId ?? null,
  };
  ensureDiplomacy(state).wars.push(war);
  const factionId = relationFactionFromParties(parties);
  if (factionId) {
    establishContact(state, factionId, { stage: CONTACT_ESTABLISHED, trigger: 'war' });
    syncRelationStatus(state, factionId);
    addRelationshipModifier(state, factionId, {
      source: 'war_declaration', label: 'Declaration of war', opinion: -15, trust: -20, fear: 5, respect: 2,
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
  const playerSign = actor === PLAYER_ID ? 1 : -1;
  war.score = clamp(war.score + actorDelta * playerSign, -100, 100);
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
  if (event.type?.startsWith('battle')) {
    const factionId = relationFactionFromParties(war.parties);
    if (factionId) recordBattleDiplomacy(state, factionId, actor === PLAYER_ID && actorDelta >= 0 ? 'victory' : 'defeat', Math.max(0.5, Math.abs(actorDelta) / 10));
  }
  recordHistory(state, 'war_event', { warId: war.id, event: entry });
  return { ok: true, war, event: entry };
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
  const factionId = relationFactionFromParties(war.parties);
  if (factionId) syncRelationStatus(state, factionId);
  recordHistory(state, 'war_ended', { warId: war.id, reason: war.endedReason, outcome: war.outcome });
  return { ok: true, war };
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
    const truce = createAgreement(state, {
      type: AGREEMENT_TRUCE,
      parties: war.parties,
      durationMs: terms.truceMs ?? DEFAULT_PEACE_TRUCE_MS,
      terms: { peaceWarId: war.id },
    }, { bypassTech: true });
    if (!truce.ok) throw new Error(truce.reason);
    let tribute = null;
    if (terms.tribute) {
      tribute = createAgreement(state, {
        type: AGREEMENT_TRIBUTE,
        parties: war.parties,
        durationMs: terms.tribute.durationMs ?? 300000,
        terms: terms.tribute,
      }, { bypassTech: true });
      if (!tribute.ok) throw new Error(tribute.reason);
    }
    recordHistory(state, 'peace_concluded', { warId: war.id, factionId, cededSystemIds, reparations, tributeId: tribute?.agreement?.id ?? null });
    return { ok: true, war: ended.war, truce: truce.agreement, tribute: tribute?.agreement ?? null };
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
  return source;
}

function normalizeProposalInput(input) {
  const proposal = {
    from: input?.from ?? PLAYER_ID,
    to: input?.to ?? input?.factionId,
    message: input?.message ?? '',
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
    } else if (term.type === 'claim') {
      if (!term.systemId || !actorExists(state, term.target ?? proposal.to)) errors.push(`${prefix}: invalid claim`);
    } else if (term.type === 'end_war') {
      if (!getActiveWar(state, term.warId ?? [proposal.from, proposal.to])) errors.push(`${prefix}: no active war`);
    } else if (term.type === 'join_war') {
      const war = warFromReference(state, term.warId);
      if (!war || war.status !== 'active' || !actorExists(state, term.actor ?? proposal.to)) errors.push(`${prefix}: invalid war participation`);
    } else if (term.type === 'sanction' || term.type === 'lift_sanction') {
      if (!actorExists(state, term.target)) errors.push(`${prefix}: unknown sanction target`);
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
  const warScore = war ? (from === PLAYER_ID ? war.score : -war.score) : 0;
  const value = round2(clamp((fromPower.total - toPower.total) / 500 + occupationBalance * 4 + warScore * 0.15, -30, 30));
  return { from, to, fromPower, toPower, occupationBalance, warScore, value };
}

function systemNegotiationValue(state, term) {
  const system = mutableSystemRecord(state, term.systemId, term.galaxyId)?.system;
  if (!system) return 0;
  return 15 + asArray(system.bodies).length * 2 + asArray(system.structures).length * 3
    + finite(system.dyson?.completedShells) * 5;
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
    return base + personalityBonus;
  }
  if (term.type === 'tribute') {
    const durationMinutes = Math.max(1, finite(term.durationMs, 300000) / 60000);
    const value = durationMinutes * (finite(term.creditsPerMinute) * 0.01 + finite(term.solariiPerMinute) * 4);
    return round2(value * (term.payee === recipient ? 1 : term.payer === recipient ? -1 : 0));
  }
  if (term.type === 'claim') return (term.claimant ?? proposal.from) === recipient ? 5 : -8;
  if (term.type === 'end_war') {
    const war = getActiveWar(state, term.warId ?? [proposal.from, proposal.to]);
    if (!war) return 0;
    const exhaustion = finite(war.exhaustion?.[recipient]);
    const scoreAgainst = recipient === PLAYER_ID ? -war.score : war.score;
    return round2(5 + exhaustion * 0.25 + scoreAgainst * 0.12);
  }
  if (term.type === 'join_war') return (term.actor ?? proposal.to) === recipient ? -8 : 5;
  if (term.type === 'sanction') return term.target === recipient ? -20 : 4;
  if (term.type === 'lift_sanction') return term.target === recipient ? 12 : -2;
  return 0;
}

export function previewProposal(state, input, options = {}) {
  const proposal = normalizeProposalInput(input);
  const errors = validateProposalTerms(state, proposal);
  const recipient = options.perspective ?? proposal.to;
  const factionId = recipient === PLAYER_ID ? proposal.from : recipient;
  const faction = factionById(state, factionId);
  const personality = faction?.personality ?? 'expansionist';
  const relationship = faction ? getRelationshipBreakdown(state, factionId) : {
    metrics: { opinion: 0, trust: 0, fear: 0, respect: 0 }, modifiers: [],
  };
  const modifiers = [
    { id: 'opinion', label: 'Opinion', value: round2(relationship.metrics.opinion * 0.12) },
    { id: 'trust', label: 'Trust', value: round2(relationship.metrics.trust * 0.2) },
    { id: 'fear', label: 'Fear', value: round2(relationship.metrics.fear * 0.04) },
    { id: 'respect', label: 'Respect', value: round2(relationship.metrics.respect * 0.08) },
  ];
  const leverage = diplomaticLeverage(state, proposal.from, proposal.to);
  modifiers.push({ id: 'leverage', label: 'Strategic leverage', value: recipient === proposal.to ? leverage.value : -leverage.value });
  proposal.terms.forEach((term, index) => {
    modifiers.push({
      id: `term:${index}`,
      label: term.type === 'agreement' ? `${term.agreementType?.replace(/_/g, ' ')} term` : `${term.type.replace(/_/g, ' ')} term`,
      value: termAcceptanceValue(state, term, recipient, personality, proposal),
    });
    if (term.type === 'agreement' && [AGREEMENT_DEFENSE, AGREEMENT_ALLIANCE].includes(term.agreementType)
        && relationship.metrics.trust < 40) {
      modifiers.push({ id: `trust_gate:${index}`, label: 'Insufficient alliance trust', value: round2((relationship.metrics.trust - 40) * 0.5) });
    }
  });
  if (isSanctioned(state, recipient)) modifiers.push({ id: 'sanctioned', label: 'Council isolation', value: -8 });
  const score = round2(modifiers.reduce((sum, modifier) => sum + modifier.value, 0));
  return {
    ok: errors.length === 0,
    errors,
    proposal,
    perspective: recipient,
    personality,
    relationship,
    leverage,
    modifiers,
    score,
    threshold: 0,
    acceptable: errors.length === 0 && score >= 0,
  };
}

export const evaluateProposal = previewProposal;

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
}

function applySanction(state, target, options = {}) {
  const diplomacy = ensureDiplomacy(state);
  const existing = diplomacy.council.sanctions.find((sanction) => activeAt(sanction, now(state)) && sanction.target === target);
  if (existing) return existing;
  const durationMs = options.durationMs == null ? 180000 : Math.max(0, finite(options.durationMs));
  const sanction = {
    id: nextId(state, 'sanction'),
    target,
    issuer: options.issuer ?? 'council',
    resolutionId: options.resolutionId ?? null,
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
    const factionId = term.from === PLAYER_ID ? term.to : term.from;
    if (term.to === factionId && factionById(state, factionId)) {
      addRelationshipModifier(state, factionId, {
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
    });
    if (!result.ok) throw new Error(result.reason);
    return;
  }
  if (term.type === 'join_war') {
    const war = warFromReference(state, term.warId);
    const actor = term.actor ?? proposal.to;
    const side = term.side === 'attacker' ? war.attackers : war.defenders;
    if (!side.includes(actor)) side.push(actor);
    if (!war.parties.includes(actor)) war.parties.push(actor);
    war.parties.sort();
    return;
  }
  if (term.type === 'sanction') {
    applySanction(state, term.target, { durationMs: term.durationMs, issuer: proposal.from });
    return;
  }
  if (term.type === 'lift_sanction') {
    for (const sanction of ensureDiplomacy(state).council.sanctions) {
      if (sanction.status === 'active' && sanction.target === term.target) {
        sanction.status = 'repealed';
        sanction.endedAt = now(state);
      }
    }
  }
}

/** Close diplomacy records before a star and its system record are removed. */
export function recordSystemDestroyed(state, input = {}) {
  const galaxyId = input.galaxyId ?? state.activeGalaxyId ?? null;
  const systemId = input.systemId;
  if (!systemId) return { ok: false, reason: 'System id is required' };
  const diplomacy = ensureDiplomacy(state);
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
    // Peace terms settle occupations themselves; all other exchanges happen first.
    const orderedTerms = [...proposal.terms.filter((term) => term.type !== 'end_war'), ...proposal.terms.filter((term) => term.type === 'end_war')];
    for (const term of orderedTerms) applyProposalTerm(state, proposal, term);
    recordHistory(state, 'proposal_terms_applied', { proposalId: proposal.id, from: proposal.from, to: proposal.to, terms: proposal.terms });
    return { ok: true, terms: proposal.terms };
  } catch (error) {
    restoreAtomicState(state, snapshot);
    return { ok: false, reason: error?.message ?? 'Proposal terms could not be applied atomically' };
  }
}

export function submitProposal(state, input, options = {}) {
  const normalized = normalizeProposalInput(input);
  if (normalized.from !== PLAYER_ID && normalized.to !== PLAYER_ID) {
    return { ok: false, reason: 'Faction-to-faction proposals are not yet represented in the player diplomacy ledger' };
  }
  const factionId = normalized.from === PLAYER_ID ? normalized.to : normalized.from;
  const contact = getContact(state, factionId);
  if (contact.stage === CONTACT_UNKNOWN && !options.allowUnknownContact) {
    return { ok: false, reason: 'Establish contact before sending a proposal' };
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
    previewAtCreation: {
      score: preview.score,
      modifiers: preview.modifiers,
      leverage: preview.leverage,
    },
  };
  ensureDiplomacy(state).proposals.push(proposal);
  recordHistory(state, 'proposal_submitted', { proposal });
  if (options.autoResolve && proposal.to !== PLAYER_ID) {
    return respondToProposal(state, proposal.id, preview.acceptable ? 'accept' : 'reject', { actor: proposal.to });
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
    const applied = applyProposalTermsAtomic(state, proposal);
    if (!applied.ok) return applied;
    proposal = ensureDiplomacy(state).proposals.find((entry) => entry.id === proposalId);
    proposal.status = PROPOSAL_ACCEPTED;
    proposal.resolvedAt = now(state);
    proposal.acceptedBy = actor;
    proposal.finalScore = preview.score;
    recordHistory(state, 'proposal_accepted', { proposalId, actor, score: preview.score });
    return { ok: true, proposal, preview, applied };
  }
  if (decision === 'reject' || decision === PROPOSAL_REJECTED) {
    proposal.status = PROPOSAL_REJECTED;
    proposal.resolvedAt = now(state);
    proposal.rejectedBy = actor;
    proposal.reason = options.reason ?? null;
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
    votingEndsAt: now(state) + Math.max(1000, finite(input.votingDurationMs, 30000)),
    durationMs: input.durationMs ?? 180000,
    votes: { [proposer]: 'yes' },
    reason: input.reason ?? null,
  };
  ensureDiplomacy(state).council.resolutions.push(resolution);
  recordHistory(state, 'council_resolution_proposed', { resolution });
  return { ok: true, resolution };
}

export function castCouncilVote(state, resolutionId, voterId, vote) {
  const resolution = ensureDiplomacy(state).council.resolutions.find((entry) => entry.id === resolutionId);
  if (!resolution || resolution.status !== 'voting') return { ok: false, reason: 'Resolution is not open for voting' };
  if (!actorExists(state, voterId)) return { ok: false, reason: 'Unknown voter' };
  if (!['yes', 'no', 'abstain'].includes(vote)) return { ok: false, reason: 'Unknown vote' };
  resolution.votes[voterId] = vote;
  return { ok: true, resolution, voterId, vote };
}

export function resolveCouncilResolution(state, resolutionId, options = {}) {
  const resolution = ensureDiplomacy(state).council.resolutions.find((entry) => entry.id === resolutionId);
  if (!resolution) return { ok: false, reason: 'Unknown resolution' };
  if (resolution.status !== 'voting') return { ok: true, resolution, alreadyResolved: true };
  if (!options.force && now(state) < resolution.votingEndsAt) return { ok: false, reason: 'Voting is still open' };
  const votes = Object.values(resolution.votes);
  resolution.tally = {
    yes: votes.filter((vote) => vote === 'yes').length,
    no: votes.filter((vote) => vote === 'no').length,
    abstain: votes.filter((vote) => vote === 'abstain').length,
  };
  resolution.passed = resolution.tally.yes > resolution.tally.no;
  resolution.status = resolution.passed ? 'passed' : 'failed';
  resolution.resolvedAt = now(state);
  if (resolution.passed && resolution.type === 'sanction') {
    resolution.sanctionId = applySanction(state, resolution.target, {
      durationMs: resolution.durationMs,
      resolutionId: resolution.id,
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
  recordHistory(state, 'council_resolution_resolved', { resolution });
  return { ok: true, resolution };
}

export function isSanctioned(state, actorId) {
  return ensureDiplomacy(state).council.sanctions.some((sanction) => activeAt(sanction, now(state)) && sanction.target === actorId);
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

export function triggerSuperweaponPanic(state) {
  const diplomacy = ensureDiplomacy(state);
  diplomacy.panicUntil = now(state) + 120000;
  const reactions = [];
  for (const faction of listAiFactionsFromState(state)) {
    if (isAllied(state, faction.id)) {
      reactions.push({ factionId: faction.id, reaction: 'allied_concern' });
      continue;
    }
    addRelationshipModifier(state, faction.id, {
      source: 'superweapon',
      label: 'Superweapon alarm',
      opinion: -35,
      trust: -25,
      fear: 30,
      respect: 5,
      durationMs: 600000,
      stackKey: `superweapon:${faction.id}`,
    });
    const relationship = getRelationshipBreakdown(state, faction.id).metrics;
    if (faction.personality === 'expansionist' && relationship.opinion <= -55 && !isAtWar(state, faction.id)) {
      const declaration = declareWar(state, faction.id, {
        force: true,
        goals: [{ type: 'superweapon_containment', systemIds: [] }],
      });
      reactions.push({ factionId: faction.id, reaction: declaration.ok ? 'war' : 'alarm' });
    } else {
      reactions.push({ factionId: faction.id, reaction: 'alarm' });
    }
  }
  recordHistory(state, 'superweapon_panic', { panicUntil: diplomacy.panicUntil, reactions });
  return { ok: true, panicUntil: diplomacy.panicUntil, reactions };
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
  return credits || solarii ? { type: 'tribute_paid', agreementId: agreement.id, credits, solarii } : null;
}

function deterministicAiTerms(state, faction) {
  const relationship = getRelationshipBreakdown(state, faction.id).metrics;
  const war = getActiveWar(state, faction.id);
  if (war && (finite(war.exhaustion[faction.id]) >= 25 || Math.abs(war.score) >= 30)) {
    return [{ type: 'end_war', warId: war.id, cededSystemIds: [], truceMs: DEFAULT_PEACE_TRUCE_MS }];
  }
  if (war) return null;
  if (faction.personality === 'economic' && isTechUnlocked(state, 'dip_trade_charter')
      && !hasAgreement(state, faction.id, AGREEMENT_TRADE)) {
    return [{ type: 'agreement', agreementType: AGREEMENT_TRADE }];
  }
  if (faction.personality === 'wormhole' && isTechUnlocked(state, 'dip_trade_charter')
      && !hasAgreement(state, faction.id, AGREEMENT_OPEN_BORDERS)) {
    return [{ type: 'agreement', agreementType: AGREEMENT_OPEN_BORDERS }];
  }
  if (faction.personality === 'megastructure' && relationship.trust >= 35
      && isTechUnlocked(state, 'dip_alliance_pact') && !hasAgreement(state, faction.id, AGREEMENT_DEFENSE)) {
    return [{ type: 'agreement', agreementType: AGREEMENT_DEFENSE }];
  }
  if (faction.personality === 'expansionist' && finite(state.credits) >= 100) {
    return [{ type: 'resource', resource: 'credits', amount: Math.min(300, Math.max(50, Math.floor(state.credits * 0.05))), from: PLAYER_ID, to: faction.id }];
  }
  if (isTechUnlocked(state, 'dip_truce_protocol') && !hasAgreement(state, faction.id, AGREEMENT_TRUCE)) {
    return [{ type: 'agreement', agreementType: AGREEMENT_TRUCE, durationMs: 120000 }];
  }
  return null;
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
    if (preview.ok && preview.score >= -15 && isTechUnlocked(state, 'dip_embassy_network')) {
      const amount = Math.ceil(Math.abs(preview.score) * 100);
      if (finite(state.credits) >= amount && amount > 0) {
        const counter = counterProposal(state, proposal.id, [
          ...proposal.terms,
          { type: 'resource', resource: 'credits', amount, from: PLAYER_ID, to: proposal.to },
        ], { actor: proposal.to, message: 'A balancing concession is required.' });
        if (counter.ok) {
          events.push({ type: 'proposal_countered', proposalId: proposal.id, counterProposalId: counter.counterProposal.id, factionId: proposal.to });
          continue;
        }
      }
    }
    respondToProposal(state, proposal.id, 'reject', { actor: proposal.to, reason: 'Acceptance score below zero' });
    events.push({ type: 'proposal_rejected', proposalId: proposal.id, factionId: proposal.to, score: preview.score });
  }

  for (const faction of [...factionList(state)].sort((a, b) => a.id.localeCompare(b.id))) {
    if (getContact(state, faction.id).stage !== CONTACT_ESTABLISHED) continue;
    if (diplomacy.proposals.some((proposal) => proposal.status === PROPOSAL_PENDING
        && pairKey(proposal.from, proposal.to) === pairKey(PLAYER_ID, faction.id))) continue;
    const lastAt = finite(diplomacy.ai.lastProposalAt[faction.id]);
    if (now(state) - lastAt < AI_PROPOSAL_COOLDOWN_MS) continue;
    const terms = deterministicAiTerms(state, faction);
    diplomacy.ai.lastProposalAt[faction.id] = now(state);
    if (!terms) continue;
    const result = submitProposal(state, { from: faction.id, to: PLAYER_ID, terms }, { allowUnknownContact: false });
    if (result.ok) events.push({ type: 'ai_proposal', factionId: faction.id, proposalId: result.proposal.id });
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
  for (const proposal of diplomacy.proposals) {
    if (proposal.status === PROPOSAL_PENDING && at >= proposal.expiresAt) {
      proposal.status = PROPOSAL_EXPIRED;
      proposal.resolvedAt = at;
      events.push({ type: 'proposal_expired', proposalId: proposal.id });
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
    }
  }
  for (const [factionId, records] of Object.entries(diplomacy.modifiers)) {
    diplomacy.modifiers[factionId] = records.filter((modifier) => modifier.expiresAt == null || at < modifier.expiresAt);
  }
  for (const war of diplomacy.wars.filter((entry) => activeAt(entry, at))) {
    const elapsedMinutes = Math.max(0, at - finite(war.lastExhaustionAt, at)) / 60000;
    for (const actorId of war.parties) war.exhaustion[actorId] = clamp(finite(war.exhaustion[actorId]) + elapsedMinutes * 2, 0, 100);
    war.lastExhaustionAt = at;
  }
  for (const resolution of diplomacy.council.resolutions) {
    if (resolution.status === 'voting' && at >= resolution.votingEndsAt) {
      const result = resolveCouncilResolution(state, resolution.id, { force: true });
      if (result.ok) events.push({ type: 'council_resolution_resolved', resolutionId: resolution.id, passed: result.resolution.passed });
    }
  }
  processAiProposals(state, events);
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
    history: diplomacy.history.slice(-100).map((entry) => clone(entry)),
    tradeBonus: diplomaticTradeBonus(state),
  };
}
