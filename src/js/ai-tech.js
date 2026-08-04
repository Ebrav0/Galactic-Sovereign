// Deterministic, faction-scoped technology progression for v13 AI empires.
//
// This module deliberately operates on a faction's own research/resources rather
// than temporarily swapping player state. That keeps simultaneous AI factions
// isolated and makes the state safe to serialize.

import { TICK_MS } from './constants.js';
import { TECH_NODES, TECH_SPINE_IDS } from './tech-nodes.js';
import { techEffects } from './tech-web.js';

export const AI_DIFFICULTY_PROFILES = Object.freeze({
  easy: Object.freeze({ id: 'easy', incomeMult: 0.8, durationMult: 1.2 }),
  normal: Object.freeze({ id: 'normal', incomeMult: 1, durationMult: 1 }),
  hard: Object.freeze({ id: 'hard', incomeMult: 1.2, durationMult: 0.85 }),
  sovereign: Object.freeze({ id: 'sovereign', incomeMult: 1.4, durationMult: 0.7 }),
});

const CLUSTER_PRIORITIES = Object.freeze({
  expansionist: Object.freeze({
    military: 12, economy: 9, flagship: 8, research: 6, trade: 5,
    wormhole: 5, megastructure: 4, diplomacy: 3, superweapon: 2,
  }),
  economic: Object.freeze({
    economy: 12, trade: 11, research: 8, diplomacy: 7, megastructure: 6,
    wormhole: 4, military: 4, flagship: 3, superweapon: 2,
  }),
  megastructure: Object.freeze({
    megastructure: 12, research: 11, economy: 8, trade: 6, wormhole: 5,
    military: 4, diplomacy: 3, flagship: 3, superweapon: 2,
  }),
  wormhole: Object.freeze({
    wormhole: 12, research: 9, military: 8, economy: 6, trade: 5,
    flagship: 5, megastructure: 4, diplomacy: 3, superweapon: 2,
  }),
});

export const AI_PERSONALITY_PRIORITIES = Object.freeze({
  expansionist: Object.freeze({
    clusters: CLUSTER_PRIORITIES.expansionist,
    keywords: Object.freeze(['outpost', 'fleet', 'weapon', 'carrier', 'fortress', 'combat', 'command']),
  }),
  economic: Object.freeze({
    clusters: CLUSTER_PRIORITIES.economic,
    keywords: Object.freeze(['trade', 'cargo', 'credit', 'logistics', 'market', 'exchange', 'industry']),
  }),
  megastructure: Object.freeze({
    clusters: CLUSTER_PRIORITIES.megastructure,
    keywords: Object.freeze(['dyson', 'shell', 'foundry', 'launcher', 'solar', 'research', 'archive']),
  }),
  wormhole: Object.freeze({
    clusters: CLUSTER_PRIORITIES.wormhole,
    keywords: Object.freeze(['wormhole', 'sensor', 'intel', 'route', 'anchor', 'gate', 'jump']),
  }),
});

function finiteNonNegative(value, fallback = 0) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function nodePrereqs(node) {
  return Array.isArray(node?.prereqs) ? node.prereqs : [];
}

function nodeCost(node) {
  return {
    credits: finiteNonNegative(node?.creditCost),
    solarii: finiteNonNegative(node?.solariiCost),
  };
}

function nodeResearchMs(node) {
  return Math.max(1, finiteNonNegative(node?.researchMs, 45000));
}

function nodeSearchText(node) {
  const cached = nodeSearchTextCache.get(node);
  if (cached != null) return cached;
  const effects = Array.isArray(node?.effects) ? node.effects : [];
  const tags = Array.isArray(node?.tags) ? node.tags : [];
  const unlocks = Array.isArray(node?.unlocks) ? node.unlocks : [];
  const text = [
    node?.id,
    node?.name,
    node?.description,
    node?.effect,
    ...tags,
    ...unlocks,
    ...effects.map((effect) => {
      try { return JSON.stringify(effect); } catch { return String(effect); }
    }),
  ].filter(Boolean).join(' ').toLowerCase();
  if (node && typeof node === 'object') nodeSearchTextCache.set(node, text);
  return text;
}

function stableHash(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

let initialUnlockedTechIdCache = null;
const nodeSearchTextCache = new WeakMap();
const factionTechContextCache = new WeakMap();
const normalizedAiResearchCache = new WeakMap();
const EMPTY_AI_MILESTONES = Object.freeze({});

function initialUnlockedTechIds() {
  if (initialUnlockedTechIdCache) return initialUnlockedTechIdCache;
  const roots = Object.values(TECH_NODES)
    .filter((node) => nodePrereqs(node).length === 0)
    .filter((node) => nodeCost(node).credits === 0 && nodeCost(node).solarii === 0)
    .map((node) => node.id)
    .sort();
  if (TECH_NODES.eco_baseline && !roots.includes('eco_baseline')) roots.unshift('eco_baseline');
  initialUnlockedTechIdCache = Object.freeze(roots.length ? roots : ['eco_baseline']);
  return initialUnlockedTechIdCache;
}

function arrayMatchesSnapshot(values, snapshot) {
  if (!Array.isArray(values) || values.length !== snapshot.length) return false;
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] !== snapshot[index]) return false;
  }
  return true;
}

function cachedTechIdView(ids, signature) {
  const view = [...ids];
  Object.defineProperty(view, 'join', {
    configurable: false,
    enumerable: false,
    writable: false,
    value(separator) {
      // techEffects() asks for exactly this signature on every lookup. The
      // source collection is fully normalized before this immutable-by-
      // convention view is published, so compute it only when research changes.
      if (separator === '\u0000') return signature;
      return Array.prototype.join.call(this, separator);
    },
  });
  return Object.freeze(view);
}

function normalizeAiResearchCollections(research, roots) {
  const cached = normalizedAiResearchCache.get(research);
  if (cached
    && cached.unlocked === research.unlocked
    && cached.queue === research.queue
    && cached.activeNodeId === research.activeNodeId
    && arrayMatchesSnapshot(research.unlocked, cached.unlockedSnapshot)
    && arrayMatchesSnapshot(research.queue, cached.queueSnapshot)) {
    return cached;
  }

  if (!Array.isArray(research.unlocked)) research.unlocked = [];
  if (!Array.isArray(research.queue)) research.queue = [];

  // Normalize in place so callers and the technology-effect cache retain stable
  // array identities once a faction has been migrated. Content snapshots make
  // legacy or externally replaced values re-run filtering and deduplication.
  const unlocked = research.unlocked;
  const unlockedIds = new Set();
  let unlockedWriteIndex = 0;
  for (let readIndex = 0; readIndex < unlocked.length; readIndex += 1) {
    const id = unlocked[readIndex];
    if (!TECH_NODES[id] || unlockedIds.has(id)) continue;
    unlockedIds.add(id);
    if (unlocked[unlockedWriteIndex] !== id) unlocked[unlockedWriteIndex] = id;
    unlockedWriteIndex += 1;
  }
  for (const root of roots) {
    if (unlockedIds.has(root)) continue;
    unlockedIds.add(root);
    unlocked[unlockedWriteIndex] = root;
    unlockedWriteIndex += 1;
  }
  if (unlocked.length !== unlockedWriteIndex) unlocked.length = unlockedWriteIndex;

  const queue = research.queue;
  const queuedIds = new Set();
  let queueWriteIndex = 0;
  for (let readIndex = 0; readIndex < queue.length; readIndex += 1) {
    const item = queue[readIndex];
    const id = typeof item === 'string' ? item : item?.nodeId;
    if (!TECH_NODES[id]
      || id === research.activeNodeId
      || unlockedIds.has(id)
      || queuedIds.has(id)) {
      continue;
    }
    queuedIds.add(id);
    if (queue[queueWriteIndex] !== id) queue[queueWriteIndex] = id;
    queueWriteIndex += 1;
  }
  if (queue.length !== queueWriteIndex) queue.length = queueWriteIndex;
  const record = {
    unlocked,
    queue,
    activeNodeId: research.activeNodeId,
    unlockedSnapshot: [...unlocked],
    queueSnapshot: [...queue],
    unlockedIds,
    unlockedSignature: unlocked.join('\u0000'),
  };
  normalizedAiResearchCache.set(research, record);
  return record;
}

export function normalizeAiDifficulty(valueOrState) {
  const raw = typeof valueOrState === 'string'
    ? valueOrState
    : valueOrState?.aiDifficulty
      ?? valueOrState?.settings?.aiDifficulty
      ?? valueOrState?.settings?.difficulty
      ?? valueOrState?.difficulty
      ?? 'normal';
  const normalized = String(raw).trim().toLowerCase();
  return AI_DIFFICULTY_PROFILES[normalized] ? normalized : 'normal';
}

export function aiDifficultyProfile(state, faction = null) {
  const id = normalizeAiDifficulty(faction?.difficulty ?? state);
  return AI_DIFFICULTY_PROFILES[id];
}

export function ensureAiResearchState(faction) {
  const roots = initialUnlockedTechIds();
  if (!faction.research || typeof faction.research !== 'object') {
    faction.research = {
      activeNodeId: null,
      progress: 0,
      durationMs: null,
      unlocked: [...roots],
      queue: [],
    };
  }
  const research = faction.research;
  research.activeNodeId = TECH_NODES[research.activeNodeId] ? research.activeNodeId : null;
  research.progress = Math.max(0, Math.min(1, Number(research.progress) || 0));
  research.durationMs = Number.isFinite(research.durationMs) && research.durationMs > 0
    ? research.durationMs
    : null;
  normalizeAiResearchCollections(research, roots);
  research.infrastructureSpeedMult = Math.max(0.1, finiteNonNegative(research.infrastructureSpeedMult, 1));
  research.queueSlotBonus = Math.max(0, Math.floor(finiteNonNegative(research.queueSlotBonus)));
  return research;
}

export function factionTechContext(faction) {
  const research = ensureAiResearchState(faction);
  const normalized = normalizedAiResearchCache.get(research);
  const milestones = faction.milestones && typeof faction.milestones === 'object'
    ? faction.milestones
    : EMPTY_AI_MILESTONES;
  let cached = factionTechContextCache.get(faction);
  if (!cached) {
    const context = {
      research: {
        unlocked: cachedTechIdView(research.unlocked, normalized.unlockedSignature),
      },
      milestones,
      solariiUnlocked: !!faction.solariiUnlocked,
    };
    cached = {
      context,
      sourceResearch: research,
      unlockedSignature: normalized.unlockedSignature,
    };
    factionTechContextCache.set(faction, cached);
    return context;
  }
  const { context } = cached;
  if (cached.sourceResearch !== research
    || cached.unlockedSignature !== normalized.unlockedSignature) {
    context.research = {
      unlocked: cachedTechIdView(research.unlocked, normalized.unlockedSignature),
    };
    cached.sourceResearch = research;
    cached.unlockedSignature = normalized.unlockedSignature;
  }
  if (context.milestones !== milestones) context.milestones = milestones;
  context.solariiUnlocked = !!faction.solariiUnlocked;
  return context;
}

export function factionHasTech(faction, nodeId) {
  const research = ensureAiResearchState(faction);
  return normalizedAiResearchCache.get(research).unlockedIds.has(nodeId);
}

export function aiNodeMilestonesMet(faction, node) {
  if (!node) return false;
  const required = new Set(Array.isArray(node.milestones) ? node.milestones : []);
  if (node.requiresDiplomacy) required.add('diplomacy');
  if (node.requiresSuperweapon) required.add('superweapon');
  const milestones = faction.milestones ?? {};
  for (const milestone of required) {
    if (milestone === 'diplomacy' && !milestones.diplomacyUnlocked) return false;
    if (milestone === 'superweapon' && !milestones.superweaponUnlocked) return false;
    if (!['diplomacy', 'superweapon'].includes(milestone) && !milestones[milestone]) return false;
  }
  return true;
}

export function aiNodePrerequisitesMet(faction, nodeOrId) {
  const node = typeof nodeOrId === 'string' ? TECH_NODES[nodeOrId] : nodeOrId;
  if (!node || !aiNodeMilestonesMet(faction, node)) return false;
  const research = ensureAiResearchState(faction);
  const unlocked = normalizedAiResearchCache.get(research).unlockedIds;
  return nodePrereqs(node).every((id) => unlocked.has(id));
}

export function legalAiTechNodes(state, faction, opts = {}) {
  const research = ensureAiResearchState(faction);
  const unlocked = normalizedAiResearchCache.get(research).unlockedIds;
  const excluded = new Set([
    ...research.unlocked,
    research.activeNodeId,
    ...research.queue,
  ].filter(Boolean));
  const affordable = opts.affordable !== false;
  return Object.values(TECH_NODES)
    .filter((node) => !excluded.has(node.id))
    .filter((node) => aiNodeMilestonesMet(faction, node)
      && nodePrereqs(node).every((id) => unlocked.has(id)))
    .filter((node) => {
      if (!affordable) return true;
      const cost = nodeCost(node);
      return finiteNonNegative(faction.credits) >= cost.credits
        && finiteNonNegative(faction.solarii) >= cost.solarii;
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

function scoreAiTechNodeWithUnlockedCount(faction, node, tickIndex, unlockedCount) {
  const personality = AI_PERSONALITY_PRIORITIES[faction.personality]
    ?? AI_PERSONALITY_PRIORITIES.expansionist;
  const clusterScore = personality.clusters[node.cluster] ?? 1;
  const haystack = nodeSearchText(node);
  const keywordHits = personality.keywords.reduce(
    (count, keyword) => count + (haystack.includes(keyword) ? 1 : 0),
    0,
  );
  // Personality is a preference, never an exclusion. The small completion
  // pressure means every reachable cross-link is eventually selected.
  const completionPressure = Math.min(8, Math.floor(unlockedCount / 12));
  const cost = nodeCost(node);
  const affordabilityBias = cost.solarii === 0 ? 1 : 0;
  const spineBias = TECH_SPINE_IDS.includes(node.id) || node.tags?.includes('spine') ? 48 : 0;
  const tie = stableHash(`${faction.id}:${node.id}:${Math.floor(tickIndex / 20)}`) / 0xffffffff;
  return clusterScore * 100 + keywordHits * 24 + completionPressure + affordabilityBias + spineBias + tie;
}

export function scoreAiTechNode(faction, node, tickIndex = 0) {
  const unlockedCount = ensureAiResearchState(faction).unlocked.length;
  return scoreAiTechNodeWithUnlockedCount(faction, node, tickIndex, unlockedCount);
}

export function selectAiTechNode(state, faction, tickIndex = 0, opts = {}) {
  const candidates = legalAiTechNodes(state, faction, opts);
  const unlockedCount = faction.research.unlocked.length;
  candidates.sort((a, b) => {
    const score = scoreAiTechNodeWithUnlockedCount(faction, b, tickIndex, unlockedCount)
      - scoreAiTechNodeWithUnlockedCount(faction, a, tickIndex, unlockedCount);
    return score || a.id.localeCompare(b.id);
  });
  return candidates[0] ?? null;
}

function researchSpeedMultiplier(faction) {
  const context = factionTechContext(faction);
  const research = faction.research;
  const technologyMultiplier = techEffects(context).researchSpeedMult ?? 1;
  return Math.max(0.1, (research.infrastructureSpeedMult ?? 1) * technologyMultiplier);
}

export function aiResearchQueueDepth(faction) {
  const context = factionTechContext(faction);
  const research = faction.research;
  const depth = techEffects(context).researchQueueDepth ?? 1;
  return Math.max(1, Math.floor(depth + (research.queueSlotBonus ?? 0)));
}

export function aiResearchDurationMs(state, faction, nodeOrId) {
  const node = typeof nodeOrId === 'string' ? TECH_NODES[nodeOrId] : nodeOrId;
  if (!node) return null;
  const difficulty = aiDifficultyProfile(state, faction);
  return Math.max(1, Math.round(
    nodeResearchMs(node) * difficulty.durationMult / researchSpeedMultiplier(faction),
  ));
}

export function canStartAiResearch(state, faction, nodeId, opts = {}) {
  const research = ensureAiResearchState(faction);
  const node = TECH_NODES[nodeId];
  if (!node) return { ok: false, reason: 'Unknown tech node' };
  if (research.unlocked.includes(nodeId)) return { ok: false, reason: 'Already researched' };
  if (research.activeNodeId === nodeId || research.queue.includes(nodeId)) {
    return { ok: false, reason: 'Already active or queued' };
  }
  if (!aiNodePrerequisitesMet(faction, node)) return { ok: false, reason: 'Prerequisites or milestone not met' };
  const queueing = !!research.activeNodeId;
  if (queueing && !opts.allowQueue) return { ok: false, reason: 'Research already active' };
  if (queueing && research.queue.length >= aiResearchQueueDepth(faction) - 1) {
    return { ok: false, reason: 'Research queue full' };
  }
  const cost = nodeCost(node);
  if (finiteNonNegative(faction.credits) < cost.credits) {
    return { ok: false, reason: `Need ${cost.credits} credits` };
  }
  if (finiteNonNegative(faction.solarii) < cost.solarii) {
    return { ok: false, reason: `Need ${cost.solarii} Solarii` };
  }
  return { ok: true, cost, durationMs: aiResearchDurationMs(state, faction, node), queued: queueing };
}

export function startAiResearch(state, faction, nodeId, opts = {}) {
  const check = canStartAiResearch(state, faction, nodeId, opts);
  if (!check.ok) return check;
  const research = ensureAiResearchState(faction);
  faction.credits = finiteNonNegative(faction.credits) - check.cost.credits;
  faction.solarii = finiteNonNegative(faction.solarii) - check.cost.solarii;
  if (check.queued) {
    research.queue.push(nodeId);
    return { ok: true, queued: true, nodeId, cost: check.cost };
  }
  research.activeNodeId = nodeId;
  research.progress = 0;
  research.durationMs = check.durationMs;
  research.startedAt = state.time ?? 0;
  return { ok: true, queued: false, nodeId, cost: check.cost, durationMs: check.durationMs };
}

function promoteQueuedResearch(state, faction) {
  const research = ensureAiResearchState(faction);
  const nodeId = research.queue.shift();
  if (!nodeId || !TECH_NODES[nodeId]) return null;
  // Queued nodes were paid for when queued. Do not charge a second time.
  research.activeNodeId = nodeId;
  research.progress = 0;
  research.durationMs = aiResearchDurationMs(state, faction, nodeId);
  research.startedAt = state.time ?? 0;
  return nodeId;
}

export function tickAiResearch(state, faction, deltaMs = TICK_MS) {
  if (state.paused) return [];
  const research = ensureAiResearchState(faction);
  if (!research.activeNodeId) return [];
  const durationMs = research.durationMs
    ?? aiResearchDurationMs(state, faction, research.activeNodeId)
    ?? 1;
  research.durationMs = durationMs;
  research.progress += Math.max(0, deltaMs) / durationMs;
  if (research.progress < 1) return [];

  const nodeId = research.activeNodeId;
  if (!research.unlocked.includes(nodeId)) research.unlocked.push(nodeId);
  research.activeNodeId = null;
  research.progress = 0;
  research.durationMs = null;
  research.startedAt = null;
  const events = [{ type: 'ai_research_complete', factionId: faction.id, nodeId }];
  const next = promoteQueuedResearch(state, faction);
  if (next) events.push({ type: 'ai_research_started', factionId: faction.id, nodeId: next, queued: true });
  return events;
}

export function fillAiResearchQueue(state, faction, tickIndex = 0) {
  const research = ensureAiResearchState(faction);
  const results = [];
  if (!research.activeNodeId) {
    const next = selectAiTechNode(state, faction, tickIndex);
    if (next) results.push(startAiResearch(state, faction, next.id));
  }
  while (research.activeNodeId && research.queue.length < aiResearchQueueDepth(faction) - 1) {
    const next = selectAiTechNode(state, faction, tickIndex + results.length + 1);
    if (!next) break;
    const result = startAiResearch(state, faction, next.id, { allowQueue: true });
    if (!result.ok) break;
    results.push(result);
  }
  return results.filter((result) => result?.ok);
}

/**
 * Deterministic migration helper for legacy saves. It recreates the amount of
 * legal research an AI could have completed in elapsed campaign time without
 * retroactively changing its wallet. Save migration may call this directly;
 * ensureFactions also invokes it once when it finds a legacy faction.
 */
export function backfillAiResearch(state, faction, elapsedMs = state.meta?.playTimeMs ?? state.time ?? 0) {
  const research = ensureAiResearchState(faction);
  if (research.backfilledAtTime != null || elapsedMs <= 0) return [];
  let budget = Math.max(0, elapsedMs);
  const unlocked = [];
  const originalCredits = faction.credits;
  const originalSolarii = faction.solarii;
  // Migration selection ignores wallet affordability but still honors graph and
  // milestone legality. Solarii nodes remain unavailable until a legacy faction
  // actually has Solarii or completed Dyson shells.
  while (budget > 0) {
    const candidates = legalAiTechNodes(state, faction, { affordable: false })
      .filter((node) => nodeCost(node).solarii <= finiteNonNegative(faction.solarii));
    const unlockedCount = research.unlocked.length;
    candidates.sort((a, b) => {
      const score = scoreAiTechNodeWithUnlockedCount(faction, b, unlocked.length, unlockedCount)
        - scoreAiTechNodeWithUnlockedCount(faction, a, unlocked.length, unlockedCount);
      return score || a.id.localeCompare(b.id);
    });
    const next = candidates[0];
    if (!next) break;
    const duration = aiResearchDurationMs(state, faction, next);
    if (duration > budget) break;
    research.unlocked.push(next.id);
    unlocked.push(next.id);
    budget -= duration;
  }
  faction.credits = originalCredits;
  faction.solarii = originalSolarii;
  research.backfilledAtTime = Math.max(0, elapsedMs);
  return unlocked;
}
