// Persistent strategic expansion campaigns. This scheduler owns campaign state,
// while fleets, diplomacy, capture, production, and builders remain injectable.

import { captureProgressMs, captureRequirement, enemyCombatPresence } from './capture.js';
import {
  cloneConstructionTemplate,
  deleteConstructionTemplate,
  getConstructionTemplate,
  listConstructionTemplates,
  materializeConstructionTemplate,
  saveConstructionTemplate,
  validateConstructionTemplate,
} from './construction-templates.js';
import { BUILDER_DRONE_STARTER_COUNT } from './constants.js';
import { findPath, neighborsOf } from './galaxy.js';
import { getGalaxyIntel, getGraph, getSystems } from './galaxy-scope.js';
import { hasIntel } from './intel.js';
import { isTechUnlocked } from './tech-web.js';

export {
  cloneConstructionTemplate,
  deleteConstructionTemplate,
  listConstructionTemplates,
  saveConstructionTemplate,
};

export const STRATEGIC_ORDERS_VERSION = 2;
export const STRATEGIC_TICK_INTERVAL_MS = 500;

export const EXPANSION_TARGET_PHASES = Object.freeze([
  'planned',
  'recon',
  'staging',
  'traveling',
  'fighting',
  'capturing',
  'constructing',
  'securing',
  'complete',
]);

export const DEFAULT_EXPANSION_POLICY = Object.freeze({
  captureForceMultiplier: 1.2,
  combatPowerMultiplier: 1.35,
  concurrency: 3,
  retryLimit: 2,
  casualtyCap: 0.35,
  autoRequisition: true,
  autoResolveVictoryThreshold: 0.75,
  autoResolveLossThreshold: 0.2,
});

const TERMINAL_TARGET_PHASES = new Set(['complete', 'cancelled']);
const PENDING_CANCELLATION_PHASES = new Set(['planned', 'recon', 'staging']);

function copy(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function normalizePolicy(policy = {}) {
  return {
    captureForceMultiplier: clamp(
      policy.captureForceMultiplier,
      1,
      5,
      DEFAULT_EXPANSION_POLICY.captureForceMultiplier,
    ),
    combatPowerMultiplier: clamp(
      policy.combatPowerMultiplier,
      1,
      5,
      DEFAULT_EXPANSION_POLICY.combatPowerMultiplier,
    ),
    concurrency: Math.floor(clamp(policy.concurrency, 1, 8, DEFAULT_EXPANSION_POLICY.concurrency)),
    retryLimit: Math.floor(clamp(policy.retryLimit, 1, 10, DEFAULT_EXPANSION_POLICY.retryLimit)),
    casualtyCap: clamp(policy.casualtyCap, 0, 1, DEFAULT_EXPANSION_POLICY.casualtyCap),
    autoRequisition: policy.autoRequisition ?? DEFAULT_EXPANSION_POLICY.autoRequisition,
    autoResolveVictoryThreshold: clamp(
      policy.autoResolveVictoryThreshold,
      0.5,
      1,
      DEFAULT_EXPANSION_POLICY.autoResolveVictoryThreshold,
    ),
    autoResolveLossThreshold: clamp(
      policy.autoResolveLossThreshold,
      0,
      1,
      DEFAULT_EXPANSION_POLICY.autoResolveLossThreshold,
    ),
  };
}

function rebuildNextId(items, prefix, minimum = 1) {
  let next = minimum;
  for (const item of items ?? []) {
    const match = String(item?.id ?? '').match(new RegExp(`^${prefix}-(\\d+)$`));
    if (match) next = Math.max(next, Number(match[1]) + 1);
  }
  return next;
}

function normalizeSavedTarget(target, index) {
  target.id ??= `target-${index + 1}`;
  target.galaxyId ??= null;
  target.phase = EXPANSION_TARGET_PHASES.includes(target.phase) || target.phase === 'cancelled'
    ? target.phase
    : 'planned';
  target.attempts = Math.max(0, Math.floor(Number(target.attempts) || 0));
  target.blockers ??= [];
  target.events ??= [];
  target.scout ??= null;
  target.requisition ??= null;
  target.dispatch ??= null;
  target.combat ??= null;
  target.capture ??= null;
  target.construction ??= null;
  target.security ??= null;
  target.droneTeam ??= { droneIds: [], required: 0, status: 'unassigned' };
  target.executionVersion ??= STRATEGIC_ORDERS_VERSION;
  target.force ??= { capturePower: 0, combatPower: 0 };
  target.requirements ??= { captureForce: 0, combatPower: 0, hostileCombatPower: 0 };
  target.route ??= null;
  target.startedAt ??= null;
  target.completedAt ??= null;
  target.cancelledAt ??= null;
  return target;
}

export function ensureStrategicOrdersState(state) {
  state.strategicOrders ??= {};
  const orders = state.strategicOrders;
  orders.version = STRATEGIC_ORDERS_VERSION;
  orders.campaigns ??= [];
  orders.templates ??= [];
  orders.templates = orders.templates.map((template) => {
    const migrated = validateConstructionTemplate(template);
    return migrated.ok
      ? { ...template, ...migrated.template, preset: false }
      : template;
  });
  orders.routeRevision = Math.max(0, Math.floor(Number(orders.routeRevision) || 0));
  orders.diplomacyRevision = Math.max(0, Math.floor(Number(orders.diplomacyRevision) || 0));
  orders.threatRevision = Math.max(0, Math.floor(Number(orders.threatRevision) || 0));
  orders.lastTickAt = Number.isFinite(Number(orders.lastTickAt)) ? Number(orders.lastTickAt) : null;
  orders.nextCampaignId = Math.max(
    Math.floor(Number(orders.nextCampaignId) || 1),
    rebuildNextId(orders.campaigns, 'expansion'),
  );
  orders.nextTemplateId = Math.max(
    Math.floor(Number(orders.nextTemplateId) || 1),
    rebuildNextId(orders.templates, 'template'),
  );
  for (const campaign of orders.campaigns) {
    campaign.version ??= STRATEGIC_ORDERS_VERSION;
    campaign.status ??= 'paused';
    campaign.targets ??= [];
    campaign.policy = normalizePolicy(campaign.policy);
    campaign.operationDoctrine = campaign.operationDoctrine
      ?? campaign.templateSnapshot?.doctrine
      ?? getConstructionTemplate(state, campaign.templateId)?.doctrine
      ?? getConstructionTemplate(state, 'frontier')?.doctrine;
    campaign.blockers ??= [];
    campaign.metrics ??= {};
    campaign.metrics.spent = Number(campaign.metrics.spent) || 0;
    campaign.metrics.casualtiesPower = Number(campaign.metrics.casualtiesPower) || 0;
    campaign.metrics.committedPower = Number(campaign.metrics.committedPower) || 0;
    campaign.metrics.requisitionedPower = Number(campaign.metrics.requisitionedPower) || 0;
    campaign.linkedBulkOrderIds ??= [];
    campaign.reserveDroneIds ??= [];
    campaign.reserveDroneRequested ??= campaign.reserveDroneIds.length > 0;
    campaign.reserveDroneOrderId ??= null;
    campaign.budget ??= { limit: null, reserve: 0, spent: campaign.metrics.spent };
    campaign.budget.limit = finiteOrNull(campaign.budget.limit);
    campaign.budget.reserve = Math.max(0, Number(campaign.budget.reserve) || 0);
    campaign.budget.spent = Math.max(0, Number(campaign.budget.spent) || 0);
    campaign.targets.forEach((target, index) => {
      target.galaxyId ??= campaign.source?.galaxyId ?? state.activeGalaxyId ?? null;
      normalizeSavedTarget(target, index);
    });
  }
  return orders;
}

function normalizeTargetRef(value, defaultGalaxyId) {
  if (typeof value === 'string') return { systemId: value, galaxyId: defaultGalaxyId };
  if (!value || typeof value !== 'object') return null;
  const systemId = value.systemId ?? value.id;
  if (!systemId) return null;
  return { systemId: String(systemId), galaxyId: value.galaxyId ?? defaultGalaxyId };
}

function targetKey(target) {
  return `${target.galaxyId}:${target.systemId}`;
}

function systemFor(state, target) {
  return getSystems(state, target.galaxyId)[target.systemId] ?? null;
}

function defaultIntel(state, target) {
  if (target.galaxyId === state.activeGalaxyId) return hasIntel(state, target.systemId);
  if (target.galaxyId === state.homeGalaxyId && target.systemId === state.stronghold) return true;
  return !!getGalaxyIntel(state, target.galaxyId)[target.systemId];
}

function authorizationMap(raw = []) {
  const map = {};
  const entries = Array.isArray(raw) ? raw : Object.entries(raw).map(([factionId, value]) => (
    typeof value === 'string' ? { factionId, warGoal: value } : { factionId, ...value }
  ));
  for (const entry of entries) {
    const factionId = typeof entry === 'string' ? entry : entry?.factionId;
    if (!factionId) continue;
    map[factionId] = {
      factionId,
      warGoal: typeof entry === 'string' ? 'claimed_conquest' : (entry.warGoal ?? 'claimed_conquest'),
      authorized: typeof entry === 'string' ? true : entry.authorized !== false,
    };
  }
  return map;
}

function targetFaction(system) {
  if (!system || system.owner === 'neutral' || system.owner === 'player') return null;
  return system.factionId ?? (system.owner === 'ai' ? 'ai-0' : system.owner);
}

function distanceMap(graph, startId) {
  const distances = new Map([[startId, 0]]);
  const queue = [startId];
  while (queue.length) {
    const current = queue.shift();
    for (const neighbor of neighborsOf(graph, current)) {
      if (distances.has(neighbor)) continue;
      distances.set(neighbor, distances.get(current) + 1);
      queue.push(neighbor);
    }
  }
  return distances;
}

function matchesOwner(system, rule) {
  if (!rule || rule === 'not_player') return system.owner !== 'player';
  if (rule === 'any') return true;
  if (Array.isArray(rule)) return rule.includes(system.owner);
  return system.owner === rule;
}

function resourceTags(system) {
  const tags = new Set(system.resourceTags ?? []);
  for (const body of system.bodies ?? []) {
    for (const tag of body.resourceTags ?? []) tags.add(tag);
    if (body.resources && typeof body.resources === 'object') {
      for (const [key, value] of Object.entries(body.resources)) if (Number(value) > 0) tags.add(key);
    }
  }
  return tags;
}

function eligibleBuildBodies(system) {
  return (system.bodies ?? []).filter((body) => ['habitable', 'barren'].includes(body.type)).length;
}

function matchesFilters(state, target, system, filters, context) {
  if (!matchesOwner(system, filters.owner ?? filters.ownership)) return false;
  const faction = targetFaction(system);
  const factions = filters.factionIds ?? (filters.factionId ? [filters.factionId] : null);
  if (factions && !factions.includes(faction)) return false;
  const planetTypes = filters.planetTypes ?? (filters.planetType ? [filters.planetType] : null);
  if (planetTypes && !(system.bodies ?? []).some((body) => planetTypes.includes(body.type))) return false;
  if (filters.requireIntel && !context.hasIntel(target)) return false;
  if (Number.isFinite(Number(filters.maxDistance))
      && (context.distances.get(target.systemId) ?? Number.POSITIVE_INFINITY) > Number(filters.maxDistance)) return false;
  if (Number.isFinite(Number(filters.minimumBuildCapacity))
      && eligibleBuildBodies(system) < Number(filters.minimumBuildCapacity)) return false;
  if (filters.dysonSuitable) {
    if (target.systemId === context.graph?.blackHole?.id || system.star?.kind === 'trade_nexus'
        || system.dyson?.disabled || (system.bodies ?? []).length === 0) return false;
  }
  const requiredTags = filters.resourceTags ?? filters.resources;
  if (Array.isArray(requiredTags) && requiredTags.length) {
    const tags = resourceTags(system);
    if (!requiredTags.every((tag) => tags.has(tag))) return false;
  }
  const threat = context.threatFor(target, system);
  if (Number.isFinite(Number(filters.maxThreat)) && threat > Number(filters.maxThreat)) return false;
  const requiredStructure = filters.requiredStructureType ?? context.requiredStructureType;
  if (requiredStructure === 'outpost'
      && !(system.bodies ?? []).some((body) => body.type === 'habitable')) return false;
  return true;
}

function routeBetween(state, from, to, hooks = {}, extra = {}) {
  if (from.galaxyId !== to.galaxyId) {
    const result = hooks.resolveAnchoredRoute?.(state, { from, to, ...extra });
    if (!result?.ok || result.deterministic !== true || result.anchored !== true
        || !Array.isArray(result.path) || result.path.length < 2) {
      return {
        ok: false,
        reason: result?.reason ?? 'Cross-galaxy campaigns require a deterministic anchored wormhole route',
        code: 'anchored_route_required',
      };
    }
    return { ok: true, path: copy(result.path), crossGalaxy: true, anchored: true };
  }
  const graph = getGraph(state, from.galaxyId);
  if (!graph) return { ok: false, reason: 'Galaxy route graph is unavailable', code: 'graph_unavailable' };
  const path = findPath(graph, from.systemId, to.systemId, {
    canEnter: (systemId, currentSystemId) => {
      const legality = hooks.canEnterSystem?.(state, {
        from,
        to,
        systemId,
        currentSystemId,
        ...extra,
      });
      return legality?.ok !== false;
    },
  });
  if (!path) return { ok: false, reason: 'No lane route to target system', code: 'route_unavailable' };
  const legality = hooks.previewRoute?.(state, { from, to, path, ...extra });
  if (legality && legality.ok === false) {
    return { ok: false, reason: legality.reason ?? 'Route is diplomatically blocked', code: legality.code ?? 'route_illegal' };
  }
  return { ok: true, path, crossGalaxy: false, anchored: false };
}

function corridorTargets(state, spec, galaxyId) {
  if (Array.isArray(spec.corridor)) return spec.corridor.map((value) => normalizeTargetRef(value, galaxyId)).filter(Boolean);
  if (!spec.corridor || typeof spec.corridor !== 'object') return [];
  const from = normalizeTargetRef(spec.corridor.from ?? spec.sourceSystemId, galaxyId);
  const to = normalizeTargetRef(spec.corridor.to, galaxyId);
  if (!from || !to || from.galaxyId !== to.galaxyId) return [];
  const graph = getGraph(state, from.galaxyId);
  const path = graph ? findPath(graph, from.systemId, to.systemId) : null;
  return (path ?? []).map((systemId) => ({ systemId, galaxyId: from.galaxyId }));
}

function previewRequirements(state, target, system, policy, hooks) {
  const context = { target, system, policy, preview: true };
  const override = hooks.previewTarget?.(state, context) ?? {};
  let baseCapture = Number(override.baseCaptureRequirement);
  if (!Number.isFinite(baseCapture)) {
    if (target.galaxyId === state.activeGalaxyId) baseCapture = captureRequirement(state, target.systemId);
    else {
      const moonCount = (system.bodies ?? []).reduce((sum, body) => sum + (body.moons?.length ?? 0), 0);
      baseCapture = 10 + (system.bodies?.length ?? 0) * 2 + moonCount + (system.structures?.length ?? 0);
    }
  }
  let hostile = Number(override.hostileCombatPower);
  if (!Number.isFinite(hostile)) {
    hostile = target.galaxyId === state.activeGalaxyId
      ? enemyCombatPresence(state, target.systemId)
      : Number(system.threat ?? system.combatPower ?? 0) || 0;
  }
  return {
    baseCaptureRequirement: Math.max(0, baseCapture),
    hostileCombatPower: Math.max(0, hostile),
    captureForce: Math.ceil(Math.max(0, baseCapture) * policy.captureForceMultiplier),
    combatPower: Math.ceil(Math.max(0, hostile) * policy.combatPowerMultiplier),
  };
}

function selectionMode(spec) {
  if ((spec.targets ?? spec.targetSystemIds)?.length) return 'explicit';
  if (spec.route?.length) return 'route';
  if (spec.corridor) return 'corridor';
  if (Number(spec.count ?? spec.objective?.count) > 0) return 'count';
  return 'none';
}

function uniqueTargets(targets) {
  const seen = new Set();
  return targets.filter((target) => {
    const key = targetKey(target);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function previewExpansionCampaign(state, spec = {}, options = {}) {
  ensureStrategicOrdersState(state);
  const hooks = options.hooks ?? {};
  const galaxyId = spec.galaxyId ?? state.activeGalaxyId;
  const source = normalizeTargetRef(
    spec.source ?? spec.sourceSystemId ?? state.flagship?.systemId ?? state.stronghold,
    spec.sourceGalaxyId ?? galaxyId,
  );
  const mode = selectionMode(spec);
  const template = getConstructionTemplate(state, spec.template ?? spec.templateId ?? 'frontier');
  const doctrine = copy(template?.doctrine ?? {});
  const policy = normalizePolicy({
    captureForceMultiplier: doctrine.captureForceMultiplier,
    combatPowerMultiplier: doctrine.combatPowerMultiplier,
    ...spec.policy,
    concurrency: spec.concurrency ?? spec.policy?.concurrency,
  });
  const blockers = [];
  const warnings = [];
  if (!isTechUnlocked(state, 'eco_construction_drones')) {
    blockers.push({
      code: 'construction_drones_required',
      message: 'Construction Drones technology is required for automated expansion',
      hard: true,
    });
  }
  if (!isTechUnlocked(state, 'eco_sector_capitals')) {
    blockers.push({
      code: 'sector_capitals_required',
      message: 'Sector Capitals technology is required for strategic expansion campaigns',
      hard: true,
    });
  }
  if (!source || !systemFor(state, source)) blockers.push({ code: 'invalid_source', message: 'Select a valid source system', hard: true });
  if (!template) blockers.push({ code: 'invalid_template', message: 'Select a valid construction template', hard: true });
  if (mode === 'none') blockers.push({ code: 'missing_targets', message: 'Select explicit, route, corridor, or count targets', hard: true });
  if (blockers.length) return { ok: false, kind: 'expansion-preview', mode, blockers, warnings, targets: [] };

  const graph = getGraph(state, galaxyId);
  const systems = getSystems(state, galaxyId);
  const distances = source.galaxyId === galaxyId && graph ? distanceMap(graph, source.systemId) : new Map();
  const hasIntelFor = (target) => hooks.hasIntel?.(state, { target, preview: true }) ?? defaultIntel(state, target);
  const threatFor = (target, system) => Number(
    hooks.threatForSystem?.(state, { target, system, preview: true }) ?? system.threat ?? system.combatPower ?? 0,
  ) || 0;
  const requiredStructureType = spec.requiredStructureType ?? spec.objective?.structureType ?? null;
  let selected = [];
  if (mode === 'explicit') {
    selected = (spec.targets ?? spec.targetSystemIds).map((value) => normalizeTargetRef(value, galaxyId)).filter(Boolean);
  } else if (mode === 'route') {
    selected = spec.route.map((value) => normalizeTargetRef(value, galaxyId)).filter(Boolean);
  } else if (mode === 'corridor') {
    selected = corridorTargets(state, spec, galaxyId);
  } else {
    const filters = spec.filters ?? {};
    selected = Object.entries(systems)
      .map(([systemId]) => ({ systemId, galaxyId }))
      .filter((target) => target.systemId !== graph?.blackHole?.id)
      .filter((target) => {
        const system = systemFor(state, target);
        return system && matchesFilters(state, target, system, filters, {
          graph,
          distances,
          hasIntel: hasIntelFor,
          threatFor,
          requiredStructureType,
        });
      })
      .sort((a, b) => (distances.get(a.systemId) ?? Number.POSITIVE_INFINITY)
        - (distances.get(b.systemId) ?? Number.POSITIVE_INFINITY)
        || a.systemId.localeCompare(b.systemId))
      .slice(0, Math.max(0, Math.floor(Number(spec.count ?? spec.objective?.count) || 0)));
  }
  selected = uniqueTargets(selected).filter((target) => targetKey(target) !== targetKey(source));

  const authorizations = authorizationMap(spec.warAuthorizations ?? spec.authorizedWars ?? []);
  const previews = [];
  let previous = source;
  for (let index = 0; index < selected.length; index++) {
    const target = selected[index];
    const system = systemFor(state, target);
    if (!system) {
      blockers.push({ code: 'invalid_target', message: `No such target: ${target.systemId}`, target: copy(target), hard: true });
      continue;
    }
    const routeSource = mode === 'route' || mode === 'corridor' ? previous : source;
    const route = routeBetween(state, routeSource, target, hooks, { preview: true, spec });
    if (!route.ok) {
      blockers.push({ code: route.code, message: `${system.name ?? target.systemId}: ${route.reason}`, target: copy(target), hard: true });
      previous = target;
      continue;
    }
    const factionId = targetFaction(system);
    const authorization = factionId ? authorizations[factionId] : null;
    if (factionId && !authorization?.authorized) {
      blockers.push({
        code: 'war_authorization_required',
        message: `${system.name ?? target.systemId} requires named authorization against ${factionId}`,
        target: copy(target),
        factionId,
        hard: true,
      });
    }
    const buildPlan = materializeConstructionTemplate(state, target.systemId, template, {
      galaxyId: target.galaxyId,
      system,
      ignoreTechnology: !!spec.ignoreTechnologyInPreview,
      costForStructure: options.costForStructure,
    });
    if (!buildPlan.ok) {
      blockers.push({ code: 'template_invalid', message: `${system.name ?? target.systemId}: ${buildPlan.errors[0]}`, target: copy(target), hard: true });
    }
    if (buildPlan.waiting.length) {
      warnings.push({
        code: 'template_waiting',
        message: `${system.name ?? target.systemId}: ${buildPlan.waiting.map((entry) => entry.reason).join(', ')}`,
        target: copy(target),
      });
    }
    const requirements = previewRequirements(state, target, system, policy, hooks);
    const operationPackage = hooks.previewOperationPackage?.(state, {
      target,
      system,
      requirements,
      doctrine,
      source,
      spec,
      targetIndex: previews.length,
      preview: true,
    }) ?? {
      manifest: [],
      roleSubstitutions: [],
      requiredDrones: doctrine.dronePayload ?? 2,
      existingDrones: 0,
      droneShortfall: doctrine.dronePayload ?? 2,
      productionCost: 0,
    };
    previews.push({
      id: `target-${previews.length + 1}`,
      orderIndex: previews.length,
      galaxyId: target.galaxyId,
      systemId: target.systemId,
      systemName: system.name ?? target.systemId,
      owner: system.owner ?? 'neutral',
      factionId,
      requiresWar: !!factionId,
      warAuthorization: authorization ? copy(authorization) : null,
      intelKnown: !!hasIntelFor(target),
      requiresRecon: !hasIntelFor(target),
      route: route.path,
      crossGalaxy: route.crossGalaxy,
      anchoredRoute: route.anchored,
      requirements,
      projectedBuild: {
        ready: buildPlan.ready,
        jobCount: buildPlan.jobs.length,
        requiredJobCount: buildPlan.requiredJobCount,
        totalCost: buildPlan.totalCost,
        waiting: copy(buildPlan.waiting),
        skipped: copy(buildPlan.skipped),
      },
      projectedOperation: copy(operationPackage),
    });
    previous = target;
  }

  const requestedCount = mode === 'count'
    ? Math.max(0, Math.floor(Number(spec.count ?? spec.objective?.count) || 0))
    : selected.length;
  const shortfall = Math.max(0, requestedCount - previews.length);
  if (shortfall) warnings.push({ code: 'target_shortfall', message: `${shortfall} requested targets could not be planned`, shortfall });
  const concurrentPackages = [...previews]
    .sort((a, b) => (
      (b.projectedOperation?.productionCost ?? 0) - (a.projectedOperation?.productionCost ?? 0)
        || a.systemId.localeCompare(b.systemId)
    ))
    .slice(0, Math.min(policy.concurrency, previews.length));
  const aggregateManifest = new Map();
  for (const target of concurrentPackages) {
    for (const line of target.projectedOperation?.manifest ?? []) {
      if (line.kind === 'builder_drone') continue;
      const key = `${line.kind ?? 'hull'}:${line.productId ?? line.hull}`;
      const aggregate = aggregateManifest.get(key) ?? { ...copy(line), quantity: 0 };
      aggregate.quantity += Math.max(0, Number(line.quantity) || 0);
      aggregateManifest.set(key, aggregate);
    }
  }
  const concurrentTargetCount = Math.min(policy.concurrency, previews.length);
  const requiredDrones = concurrentTargetCount * (doctrine.dronePayload ?? 2)
    + (doctrine.campaignReserveDrones ?? 1);
  const initializedDrones = (state.builderDrones ?? []).filter((drone) => (
    drone.galaxyId === source.galaxyId
      && drone.status === 'idle'
      && drone.systemId === source.systemId
      && !drone.strategicCampaignId
  )).length;
  const pendingStarterDrones = state.builderDroneStarterGranted !== true
    && isTechUnlocked(state, 'eco_construction_drones')
    ? BUILDER_DRONE_STARTER_COUNT
    : 0;
  const existingDrones = initializedDrones + pendingStarterDrones;
  const droneShortfall = Math.max(0, requiredDrones - existingDrones);
  if (droneShortfall > 0) {
    const sample = previews.flatMap((target) => target.projectedOperation?.manifest ?? [])
      .find((line) => line.kind === 'builder_drone');
    aggregateManifest.set('builder_drone:builder_drone', {
      kind: 'builder_drone',
      productId: 'builder_drone',
      hull: null,
      quantity: droneShortfall,
      unitCost: sample?.unitCost ?? 120,
    });
  }
  const projectedManifest = [...aggregateManifest.values()];
  const projectedProductionCost = projectedManifest.reduce((sum, line) => (
    sum + (Number(line.unitCost) || 0) * line.quantity
  ), 0);
  const totalCost = previews.reduce((sum, target) => sum + target.projectedBuild.totalCost, 0)
    + projectedProductionCost;
  const reserve = Math.max(0, Number(spec.reserve ?? spec.budget?.reserve) || 0);
  const limit = finiteOrNull(spec.budgetLimit ?? spec.budget?.limit);
  const spendableCredits = Math.max(0, (Number(state.credits) || 0) - reserve);
  const permitted = Math.min(spendableCredits, limit ?? Number.POSITIVE_INFINITY);
  const projectedShortfall = Math.max(0, totalCost - permitted);
  if (projectedShortfall > 0) warnings.push({ code: 'budget_shortfall', message: `Projected construction is ${projectedShortfall} credits over current limits`, shortfall: projectedShortfall });

  const hardBlockers = blockers.filter((blocker) => blocker.hard);
  const allowPartial = !!spec.allowPartial;
  return {
    ok: previews.length > 0 && hardBlockers.length === 0 && (shortfall === 0 || allowPartial),
    kind: 'expansion-preview',
    mode,
    source,
    requestedCount,
    selectedCount: previews.length,
    shortfall,
    policy,
    doctrine,
    template: copy(template),
    warAuthorizations: authorizations,
    targets: previews,
    projectedOperation: {
      manifest: projectedManifest,
      productionCost: projectedProductionCost,
      concurrentPackageCount: concurrentPackages.length,
      requiredDrones,
      existingDrones,
      droneShortfall,
    },
    budget: {
      limit,
      reserve,
      totalProjectedCost: totalCost,
      spendableCredits,
      projectedShortfall,
    },
    blockers,
    warnings,
  };
}

export function createExpansionCampaign(state, spec = {}, options = {}) {
  const orders = ensureStrategicOrdersState(state);
  const preview = spec.kind === 'expansion-preview' ? copy(spec) : previewExpansionCampaign(state, spec, options);
  if (!preview.ok) {
    return { ok: false, reason: preview.blockers?.[0]?.message ?? 'Campaign preview is not valid', preview };
  }
  const id = `expansion-${orders.nextCampaignId++}`;
  const campaign = {
    id,
    version: STRATEGIC_ORDERS_VERSION,
    type: 'expansion',
    name: spec.name ?? `Expansion Campaign ${orders.nextCampaignId - 1}`,
    status: spec.startPaused ? 'paused' : 'active',
    pauseReason: spec.startPaused ? 'Created paused' : null,
    createdAt: Number(state.time) || 0,
    updatedAt: Number(state.time) || 0,
    completedAt: null,
    cancelledAt: null,
    mode: preview.mode,
    source: copy(preview.source),
    selection: {
      requestedCount: preview.requestedCount,
      selectedCount: preview.selectedCount,
      shortfall: preview.shortfall,
      filters: copy(spec.filters ?? {}),
    },
    templateId: preview.template.id,
    templateSnapshot: copy(preview.template),
    operationDoctrine: copy(preview.doctrine),
    policy: normalizePolicy(preview.policy),
    warAuthorizations: copy(preview.warAuthorizations),
    budget: {
      limit: finiteOrNull(preview.budget.limit),
      reserve: preview.budget.reserve,
      spent: 0,
      projected: preview.budget.totalProjectedCost,
    },
    linkedBulkOrderIds: [],
    reserveDroneIds: [],
    reserveDroneRequested: false,
    reserveDroneOrderId: null,
    blockers: [],
    metrics: {
      spent: 0,
      casualtiesPower: 0,
      committedPower: 0,
      requisitionedPower: 0,
      completedTargets: 0,
    },
    cancellationMode: null,
    targets: preview.targets.map((target, index) => normalizeSavedTarget({
      ...copy(target),
      id: `target-${index + 1}`,
      phase: 'planned',
      executionVersion: STRATEGIC_ORDERS_VERSION,
      attempts: 0,
      blockers: [],
      events: [],
      scout: null,
      requisition: null,
      dispatch: null,
      combat: null,
      capture: null,
      construction: null,
      security: null,
      droneTeam: {
        droneIds: [],
        required: preview.doctrine?.dronePayload ?? 2,
        status: 'unassigned',
      },
      force: { capturePower: 0, combatPower: 0 },
      startedAt: null,
      completedAt: null,
      cancelledAt: null,
    }, index)),
  };
  orders.campaigns.push(campaign);
  return { ok: true, campaign: copy(campaign), preview };
}

function campaignById(state, campaignId) {
  return ensureStrategicOrdersState(state).campaigns.find((campaign) => campaign.id === campaignId) ?? null;
}

export function pauseExpansionCampaign(state, campaignId, reason = 'Paused by player') {
  const campaign = campaignById(state, campaignId);
  if (!campaign) return { ok: false, reason: 'No such expansion campaign' };
  if (['complete', 'cancelled'].includes(campaign.status)) return { ok: false, reason: `Campaign is already ${campaign.status}` };
  campaign.status = 'paused';
  campaign.pauseReason = reason;
  campaign.updatedAt = Number(state.time) || 0;
  return { ok: true, campaign: copy(campaign) };
}

export function resumeExpansionCampaign(state, campaignId) {
  const campaign = campaignById(state, campaignId);
  if (!campaign) return { ok: false, reason: 'No such expansion campaign' };
  if (['complete', 'cancelled'].includes(campaign.status)) return { ok: false, reason: `Campaign is already ${campaign.status}` };
  campaign.status = campaign.cancellationMode === 'pending' ? 'cancelling' : 'active';
  campaign.pauseReason = null;
  campaign.blockers = campaign.blockers.filter((blocker) => blocker.code === 'waiting_builder');
  campaign.updatedAt = Number(state.time) || 0;
  return { ok: true, campaign: copy(campaign) };
}

function normalizeCancelMode(mode) {
  if (['return', 'cancel_and_return'].includes(mode)) return 'return';
  if (['pending', 'pending_only', 'cancel_pending_only'].includes(mode)) return 'pending';
  return 'hold';
}

export function cancelExpansionCampaign(state, campaignId, mode = 'hold', options = {}) {
  const campaign = campaignById(state, campaignId);
  if (!campaign) return { ok: false, reason: 'No such expansion campaign' };
  if (['complete', 'cancelled'].includes(campaign.status)) return { ok: false, reason: `Campaign is already ${campaign.status}` };
  const cancelMode = normalizeCancelMode(mode);
  const now = Number(state.time) || 0;
  campaign.cancellationMode = cancelMode;
  const affected = [];
  for (const target of campaign.targets) {
    if (TERMINAL_TARGET_PHASES.has(target.phase)) continue;
    if (cancelMode === 'pending' && !PENDING_CANCELLATION_PHASES.has(target.phase)) continue;
    target.phase = 'cancelled';
    target.cancelledAt = now;
    target.blockers = [];
    affected.push(target.id);
    options.hooks?.cancelTarget?.(state, { campaign, target, mode: cancelMode });
  }
  if (cancelMode === 'return') options.hooks?.returnAssets?.(state, { campaign, targetIds: affected });
  if (cancelMode === 'hold' || campaign.targets.every((target) => TERMINAL_TARGET_PHASES.has(target.phase))) {
    campaign.status = 'cancelled';
    campaign.cancelledAt = now;
  } else {
    campaign.status = 'cancelling';
  }
  campaign.pauseReason = null;
  campaign.updatedAt = now;
  return { ok: true, mode: cancelMode, affectedTargetIds: affected, campaign: copy(campaign) };
}

function blocker(target, code, message, state, options = {}) {
  const existing = target.blockers.find((entry) => entry.code === code);
  if (existing) {
    existing.message = message;
    existing.at = Number(state.time) || 0;
    existing.hard ||= !!options.hard;
    return existing;
  }
  const entry = { code, message, at: Number(state.time) || 0, hard: !!options.hard };
  target.blockers.push(entry);
  return entry;
}

function clearBlocker(target, ...codes) {
  const set = new Set(codes);
  target.blockers = target.blockers.filter((entry) => !set.has(entry.code));
}

function transition(state, campaign, target, phase, events, detail = {}) {
  const from = target.phase;
  target.phase = phase;
  target.lastPhaseAt = Number(state.time) || 0;
  if (target.startedAt == null && phase !== 'planned') target.startedAt = Number(state.time) || 0;
  if (phase === 'complete') {
    target.completedAt = Number(state.time) || 0;
    target.blockers = [];
  }
  const event = { type: 'phase', campaignId: campaign.id, targetId: target.id, from, phase, ...detail };
  target.events.push({ ...event, at: Number(state.time) || 0 });
  if (target.events.length > 24) target.events.splice(0, target.events.length - 24);
  events.push(event);
}

function hookResult(hooks, name, state, context, fallback = null) {
  const fn = hooks?.[name];
  if (typeof fn !== 'function') return fallback;
  try {
    return fn(state, context);
  } catch (error) {
    return { ok: false, hookError: true, reason: `${name}: ${error?.message ?? String(error)}` };
  }
}

function refreshCampaignBlockers(campaign) {
  campaign.blockers = campaign.targets.flatMap((target) => target.blockers.map((entry) => ({
    ...entry,
    targetId: target.id,
    systemId: target.systemId,
  })));
}

function pauseForBlocker(state, campaign, target, code, message) {
  blocker(target, code, message, state, { hard: true });
  campaign.status = 'paused';
  campaign.pauseReason = message;
}

function currentAssessment(state, campaign, target, hooks) {
  const system = systemFor(state, target);
  const result = hookResult(hooks, 'assessTarget', state, { campaign, target, system }, null) ?? {};
  const requiredCapture = Math.max(0, Number(result.requiredCaptureForce ?? target.requirements.captureForce) || 0);
  const requiredCombat = Math.max(0, Number(result.requiredCombatPower ?? target.requirements.combatPower) || 0);
  const hostile = Math.max(0, Number(result.hostileCombatPower ?? target.requirements.hostileCombatPower) || 0);
  const availableCapture = Math.max(0, Number(result.availableCaptureForce ?? target.force?.capturePower) || 0);
  const availableCombat = Math.max(0, Number(result.availableCombatPower ?? target.force?.combatPower) || 0);
  const requiredDrones = Math.max(0, Math.floor(Number(
    result.requiredDrones ?? campaign.operationDoctrine?.dronePayload ?? target.droneTeam?.required ?? 0,
  ) || 0));
  const availableDrones = Math.max(0, Math.floor(Number(result.availableDrones) || 0));
  const reportsDroneReadiness = result.availableDrones != null || result.droneReady != null;
  return {
    ok: result.ok !== false,
    reason: result.reason ?? null,
    requiredCaptureForce: requiredCapture,
    requiredCombatPower: requiredCombat,
    hostileCombatPower: hostile,
    availableCaptureForce: availableCapture,
    availableCombatPower: availableCombat,
    requiredDrones,
    availableDrones,
    droneReady: result.droneReady ?? (!reportsDroneReadiness || availableDrones >= requiredDrones),
    roleReady: result.roleReady ?? true,
    manifest: copy(result.manifest ?? []),
    roleSubstitutions: copy(result.roleSubstitutions ?? []),
  };
}

function recordRequisitionCompletion(campaign, target, result) {
  const capturePower = Math.max(0, Number(result.capturePower ?? result.availableCaptureForce) || 0);
  const combatPower = Math.max(0, Number(result.combatPower ?? result.availableCombatPower) || 0);
  target.force.capturePower = Math.max(target.force.capturePower ?? 0, capturePower);
  target.force.combatPower = Math.max(target.force.combatPower ?? 0, combatPower);
  const power = Math.max(combatPower, Number(result.requisitionedPower) || 0);
  campaign.metrics.requisitionedPower += power;
  campaign.metrics.committedPower = Math.max(campaign.metrics.committedPower, target.force.combatPower);
  for (const id of result.bulkOrderIds ?? (result.bulkOrderId ? [result.bulkOrderId] : [])) {
    if (!campaign.linkedBulkOrderIds.includes(id)) campaign.linkedBulkOrderIds.push(id);
  }
}

function casualtyRatio(campaign) {
  const targetCommitment = campaign.targets.reduce(
    (sum, target) => sum + Math.max(0, Number(target.commitmentPower) || 0),
    0,
  );
  const denominator = Math.max(1, targetCommitment, campaign.metrics.committedPower, campaign.metrics.requisitionedPower);
  return campaign.metrics.casualtiesPower / denominator;
}

function targetFailure(state, campaign, target, events, result, code) {
  const casualties = Math.max(0, Number(result?.casualtiesPower) || 0);
  campaign.metrics.casualtiesPower += casualties;
  target.casualtiesPower = (Number(target.casualtiesPower) || 0) + casualties;
  if (casualtyRatio(campaign) > campaign.policy.casualtyCap) {
    pauseForBlocker(state, campaign, target, 'casualty_cap', 'Campaign casualty cap exceeded');
    events.push({ type: 'blocked', campaignId: campaign.id, targetId: target.id, code: 'casualty_cap' });
    return;
  }
  if (target.attempts >= campaign.policy.retryLimit) {
    pauseForBlocker(state, campaign, target, 'retry_limit', `Retry limit reached for ${target.systemName ?? target.systemId}`);
    events.push({ type: 'blocked', campaignId: campaign.id, targetId: target.id, code: 'retry_limit' });
    return;
  }
  blocker(target, code, result?.reason ?? 'Operation failed; staging a retry', state);
  target.dispatch = null;
  target.combat = null;
  target.capture = null;
  target.requisition = null;
  transition(state, campaign, target, 'staging', events, { retry: true });
}

function defaultDiplomacyCheck(campaign, target, system) {
  const factionId = targetFaction(system);
  if (!factionId) return { ok: true, canTravel: true, atWar: false };
  const authorization = campaign.warAuthorizations?.[factionId];
  if (!authorization?.authorized) {
    return { ok: false, canTravel: false, factionId, reason: `War against ${factionId} is not authorized` };
  }
  if (target.warDeclared) return { ok: true, canTravel: true, atWar: true, factionId };
  return { ok: true, canTravel: false, requiresWar: true, factionId };
}

function advanceRecon(state, campaign, target, hooks, events) {
  const known = hookResult(hooks, 'hasIntel', state, { campaign, target }, defaultIntel(state, target));
  if (known) {
    clearBlocker(target, 'scout_unavailable', 'scout_failed');
    transition(state, campaign, target, 'staging', events);
    return;
  }
  if (!target.scout) {
    const result = hookResult(hooks, 'requestScout', state, { campaign, target }, null);
    if (!result) {
      blocker(target, 'scout_unavailable', 'No scout dispatch hook is available', state);
      return;
    }
    if (result.ok === false) {
      blocker(target, result.code ?? 'scout_unavailable', result.reason ?? 'No scout is available', state);
      return;
    }
    target.scout = {
      id: result.scoutId ?? result.id ?? null,
      status: result.status ?? (result.complete ? 'complete' : 'dispatched'),
      requestedAt: Number(state.time) || 0,
    };
    clearBlocker(target, 'scout_unavailable', 'scout_failed');
    if (result.complete || result.status === 'complete') transition(state, campaign, target, 'staging', events);
    return;
  }
  const status = hookResult(hooks, 'scoutStatus', state, { campaign, target, scout: target.scout }, target.scout);
  if (status?.complete || status?.status === 'complete') {
    target.scout.status = 'complete';
    clearBlocker(target, 'scout_unavailable', 'scout_failed');
    transition(state, campaign, target, 'staging', events);
  } else if (status?.ok === false || status?.status === 'failed') {
    blocker(target, 'scout_failed', status.reason ?? 'Scout mission failed', state);
  }
}

function advanceStaging(state, campaign, target, hooks, events) {
  const system = systemFor(state, target);
  if (system?.owner === 'player') {
    transition(state, campaign, target, 'constructing', events);
    return;
  }
  const assessment = currentAssessment(state, campaign, target, hooks);
  target.assessment = assessment;
  campaign.metrics.committedPower = Math.max(campaign.metrics.committedPower, assessment.availableCombatPower);
  if (!assessment.ok) {
    blocker(target, 'assessment_failed', assessment.reason ?? 'Target assessment failed', state);
    return;
  }
  const ready = assessment.availableCaptureForce >= assessment.requiredCaptureForce
    && assessment.availableCombatPower >= assessment.requiredCombatPower
    && assessment.droneReady
    && assessment.roleReady;
  if (ready) {
    clearBlocker(
      target,
      'assessment_failed',
      'requisition_required',
      'requisition_failed',
      'combat_defeat',
      'fleet_lost',
      'capture_failed',
      'ownership_lost',
    );
    transition(state, campaign, target, 'traveling', events);
    return;
  }
  if (!campaign.policy.autoRequisition) {
    blocker(target, 'force_shortfall', 'Assigned forces do not meet campaign thresholds', state);
    return;
  }
  if (target.requisition) {
    const result = hookResult(hooks, 'requisitionStatus', state, {
      campaign, target, requisition: target.requisition, assessment,
    }, target.requisition);
    if (result?.complete || result?.status === 'complete') {
      recordRequisitionCompletion(campaign, target, result);
      target.requisition = null;
      clearBlocker(target, 'requisition_required', 'requisition_failed');
    } else if (result?.ok === false || result?.status === 'failed') {
      blocker(target, 'requisition_failed', result.reason ?? 'Fleet requisition failed', state);
    }
    return;
  }
  const result = hookResult(hooks, 'requestRequisition', state, {
    campaign,
    target,
    assessment,
    captureForceShortfall: Math.max(0, assessment.requiredCaptureForce - assessment.availableCaptureForce),
    combatPowerShortfall: Math.max(0, assessment.requiredCombatPower - assessment.availableCombatPower),
  }, null);
  if (!result) {
    blocker(target, 'requisition_required', 'No fleet can satisfy the target and no requisition hook is available', state);
    return;
  }
  if (result.ok === false) {
    blocker(target, result.code ?? 'requisition_failed', result.reason ?? 'Fleet requisition failed', state);
    return;
  }
  target.requisition = {
    id: result.requisitionId ?? result.bulkOrderId ?? result.id ?? null,
    status: result.status ?? (result.complete ? 'complete' : 'pending'),
    requestedAt: Number(state.time) || 0,
    capturePower: result.capturePower ?? 0,
    combatPower: result.combatPower ?? 0,
    bulkOrderIds: result.bulkOrderIds ?? (result.bulkOrderId ? [result.bulkOrderId] : []),
    manifest: copy(result.manifest ?? []),
    requiredDrones: result.requiredDrones ?? assessment.requiredDrones,
  };
  if (result.complete || result.status === 'complete') {
    recordRequisitionCompletion(campaign, target, result);
    target.requisition = null;
  }
  clearBlocker(target, 'requisition_required', 'requisition_failed');
}

function markArrived(state, campaign, target, events) {
  const hostile = target.assessment?.hostileCombatPower ?? target.requirements.hostileCombatPower ?? 0;
  transition(state, campaign, target, hostile > 0 ? 'fighting' : 'capturing', events);
}

function advanceTraveling(state, campaign, target, hooks, events) {
  const system = systemFor(state, target);
  if (!system) {
    pauseForBlocker(state, campaign, target, 'target_missing', 'Target system is unavailable');
    return;
  }
  if (system.owner === 'player') {
    transition(state, campaign, target, 'constructing', events);
    return;
  }
  const diplomacy = hookResult(
    hooks,
    'diplomacyCheck',
    state,
    { campaign, target, system, route: target.route },
    defaultDiplomacyCheck(campaign, target, system),
  );
  if (diplomacy?.hookError) {
    pauseForBlocker(state, campaign, target, 'diplomacy_error', diplomacy.reason);
    return;
  }
  const requiredWars = diplomacy?.requiresWars
    ?? (diplomacy?.requiresWar ? [{ factionId: diplomacy.factionId ?? target.factionId }] : []);
  if (requiredWars.length > 0) {
    target.warIds ??= {};
    for (const requirement of requiredWars) {
      const factionId = requirement.factionId;
      const authorization = campaign.warAuthorizations?.[factionId];
      if (!authorization?.authorized) {
        pauseForBlocker(state, campaign, target, 'war_authorization_required', `War against ${factionId} is not authorized`);
        return;
      }
      const declaration = hookResult(hooks, 'declareWar', state, {
        campaign,
        target,
        system,
        factionId,
        warGoal: requirement.warGoal ?? authorization.warGoal,
        warTargetSystemId: requirement.systemId ?? target.systemId,
      }, null);
      if (!declaration) {
        pauseForBlocker(state, campaign, target, 'declaration_hook_required', 'Authorized war requires a diplomacy declaration hook');
        return;
      }
      if (declaration.ok === false) {
        pauseForBlocker(state, campaign, target, declaration.code ?? 'declaration_failed', declaration.reason ?? 'War declaration failed');
        return;
      }
      target.warIds[factionId] = declaration.warId ?? null;
      if (factionId === (diplomacy.factionId ?? target.factionId)) {
        target.warDeclared = true;
        target.warId = declaration.warId ?? null;
      }
    }
    // Re-run the route gate on the next strategic tick after all declarations
    // have atomically changed transit legality.
    return;
  } else if (diplomacy?.ok === false || diplomacy?.canTravel === false) {
    pauseForBlocker(state, campaign, target, diplomacy?.code ?? 'route_illegal', diplomacy?.reason ?? 'Route is diplomatically illegal');
    return;
  }
  clearBlocker(target, 'war_authorization_required', 'route_illegal', 'declaration_failed');

  if (!target.dispatch) {
    const result = hookResult(hooks, 'dispatchFleet', state, {
      campaign, target, route: target.route, assessment: target.assessment,
    }, null);
    if (!result) {
      blocker(target, 'dispatch_required', 'No fleet dispatch hook is available', state);
      return;
    }
    if (result.ok === false) {
      blocker(target, result.code ?? 'dispatch_failed', result.reason ?? 'Fleet dispatch failed', state);
      return;
    }
    target.attempts += 1;
    target.dispatch = {
      id: result.dispatchId ?? result.id ?? null,
      fleetIds: copy(result.fleetIds ?? []),
      status: result.status ?? (result.arrived ? 'arrived' : 'traveling'),
      dispatchedAt: Number(state.time) || 0,
    };
    target.force.capturePower = Math.max(target.force.capturePower ?? 0, Number(result.capturePower) || 0);
    target.force.combatPower = Math.max(target.force.combatPower ?? 0, Number(result.combatPower) || 0);
    target.commitmentPower = Math.max(
      Number(target.commitmentPower) || 0,
      target.force.combatPower,
      Number(target.assessment?.availableCombatPower) || 0,
    );
    campaign.metrics.committedPower = Math.max(campaign.metrics.committedPower, target.force.combatPower);
    clearBlocker(target, 'dispatch_required', 'dispatch_failed');
    if (result.arrived || result.status === 'arrived') markArrived(state, campaign, target, events);
    return;
  }
  const status = hookResult(hooks, 'fleetStatus', state, { campaign, target, dispatch: target.dispatch }, target.dispatch);
  if (status?.arrived || status?.status === 'arrived') {
    target.dispatch.status = 'arrived';
    markArrived(state, campaign, target, events);
  } else if (status?.ok === false || ['failed', 'lost'].includes(status?.status)) {
    targetFailure(state, campaign, target, events, status, 'fleet_lost');
  } else if (status?.status === 'blocked') {
    blocker(target, status.code ?? 'transit_blocked', status.reason ?? 'Fleet transit is blocked', state);
  }
}

function advanceFighting(state, campaign, target, hooks, events) {
  if (!target.combat) {
    const begun = hookResult(hooks, 'beginCombat', state, { campaign, target, dispatch: target.dispatch }, { ok: true, status: 'engaged' });
    if (begun?.ok === false) {
      blocker(target, begun.code ?? 'combat_blocked', begun.reason ?? 'Combat could not begin', state);
      return;
    }
    target.combat = { id: begun?.combatId ?? begun?.id ?? null, status: begun?.status ?? 'engaged' };
  }
  const result = hookResult(hooks, 'combatStatus', state, { campaign, target, combat: target.combat }, null);
  if (!result) {
    blocker(target, 'combat_status_required', 'Combat requires a status hook', state);
    return;
  }
  if (['victory', 'clear', 'complete'].includes(result.status) || result.victory) {
    target.combat.status = 'victory';
    clearBlocker(target, 'combat_status_required', 'combat_blocked', 'tactical_intervention');
    transition(state, campaign, target, 'capturing', events);
  } else if (['defeat', 'failed', 'lost'].includes(result.status) || result.defeat) {
    targetFailure(state, campaign, target, events, result, 'combat_defeat');
  } else if (['needs_player', 'tactical_required'].includes(result.status)) {
    pauseForBlocker(state, campaign, target, 'tactical_intervention', result.reason ?? 'Tactical intervention is required');
  }
}

function advanceCapturing(state, campaign, target, hooks, events) {
  const system = systemFor(state, target);
  if (system?.owner === 'player') {
    clearBlocker(target, 'capture_blocked');
    transition(state, campaign, target, 'constructing', events);
    return;
  }
  if (!target.capture) {
    const begun = hookResult(hooks, 'beginCapture', state, { campaign, target, dispatch: target.dispatch }, { ok: true, status: 'active' });
    if (begun?.ok === false) {
      blocker(target, begun.code ?? 'capture_blocked', begun.reason ?? 'Capture could not begin', state);
      return;
    }
    target.capture = { id: begun?.captureId ?? begun?.id ?? null, status: begun?.status ?? 'active', startedAt: Number(state.time) || 0 };
  }
  const fallback = {
    ok: true,
    status: system?.owner === 'player' ? 'complete' : 'active',
    progressMs: target.galaxyId === state.activeGalaxyId ? captureProgressMs(state, target.systemId) : 0,
  };
  const result = hookResult(hooks, 'captureStatus', state, { campaign, target, capture: target.capture }, fallback);
  target.capture.progressMs = Number(result?.progressMs) || 0;
  if (result?.complete || result?.status === 'complete' || systemFor(state, target)?.owner === 'player') {
    target.capture.status = 'complete';
    clearBlocker(target, 'capture_blocked');
    transition(state, campaign, target, 'constructing', events);
  } else if (['failed', 'lost', 'recaptured'].includes(result?.status) || result?.ok === false) {
    targetFailure(state, campaign, target, events, result, 'capture_failed');
  } else if (result?.status === 'contested') {
    transition(state, campaign, target, 'fighting', events, { contested: true });
  }
}

function canSpendOnBuild(state, campaign, cost) {
  const remainingBudget = campaign.budget.limit == null
    ? Number.POSITIVE_INFINITY
    : Math.max(0, campaign.budget.limit - campaign.budget.spent);
  const availableCredits = Math.max(0, (Number(state.credits) || 0) - campaign.budget.reserve);
  if (cost > remainingBudget) return { ok: false, reason: 'Campaign construction budget exceeded', code: 'budget_limit' };
  if (cost > availableCredits) return { ok: false, reason: 'Protected credit reserve would be crossed', code: 'protected_reserve' };
  return { ok: true };
}

function recordBuildSpend(campaign, construction, amount) {
  if (construction.spendRecorded) return;
  const spent = Math.max(0, Number(amount) || 0);
  campaign.budget.spent += spent;
  campaign.metrics.spent += spent;
  construction.spendRecorded = true;
  construction.spent = spent;
}

function advanceConstructing(state, campaign, target, hooks, events) {
  const system = systemFor(state, target);
  if (!system || system.owner !== 'player') {
    targetFailure(state, campaign, target, events, { reason: 'Target was recaptured before construction' }, 'ownership_lost');
    return;
  }
  if (!target.construction) {
    const plan = materializeConstructionTemplate(state, target.systemId, campaign.templateSnapshot, {
      galaxyId: target.galaxyId,
      system,
      requireOwned: true,
      costForStructure: hooks.costForStructure,
    });
    target.actualBuildPlan = {
      ready: plan.ready,
      totalCost: plan.totalCost ?? 0,
      jobs: copy(plan.jobs ?? []),
      waiting: copy(plan.waiting ?? []),
      skipped: copy(plan.skipped ?? []),
    };
    if (!plan.ok) {
      pauseForBlocker(state, campaign, target, 'template_invalid', plan.errors?.[0] ?? 'Construction template is invalid');
      return;
    }
    if (!plan.ready) {
      blocker(target, 'template_waiting', plan.waiting.map((entry) => entry.reason).join(', '), state);
      return;
    }
    if (plan.jobs.length === 0) {
      transition(state, campaign, target, 'securing', events, { noConstructionRequired: true });
      return;
    }
    const budget = canSpendOnBuild(state, campaign, plan.totalCost);
    if (!budget.ok) {
      pauseForBlocker(state, campaign, target, budget.code, budget.reason);
      return;
    }
    const result = hookResult(hooks, 'dispatchBuild', state, { campaign, target, plan }, null);
    if (!result) {
      blocker(target, 'waiting_builder', 'No builder dispatch hook is available', state);
      return;
    }
    if (result.ok === false || result.status === 'waiting_builder') {
      blocker(target, result.code ?? 'waiting_builder', result.reason ?? 'No builder drone is available', state);
      return;
    }
    target.construction = {
      id: result.constructionId ?? result.orderGroupId ?? result.id ?? null,
      orderIds: copy(result.orderIds ?? []),
      status: result.status ?? (result.complete ? 'complete' : 'active'),
      requestedAt: Number(state.time) || 0,
      spendRecorded: false,
      spent: 0,
      plannedCost: plan.totalCost,
    };
    recordBuildSpend(campaign, target.construction, result.spent ?? result.costReserved ?? plan.totalCost);
    clearBlocker(target, 'waiting_builder', 'template_waiting');
    if (result.complete || result.status === 'complete') transition(state, campaign, target, 'securing', events);
    return;
  }
  const result = hookResult(hooks, 'buildStatus', state, { campaign, target, construction: target.construction }, target.construction);
  if (result?.complete || result?.status === 'complete') {
    target.construction.status = 'complete';
    clearBlocker(target, 'waiting_builder', 'build_failed');
    transition(state, campaign, target, 'securing', events);
  } else if (result?.status === 'waiting_builder') {
    blocker(target, 'waiting_builder', result.reason ?? 'Waiting for a builder drone', state);
  } else if (result?.ok === false || result?.status === 'failed') {
    if (systemFor(state, target)?.owner !== 'player') {
      targetFailure(state, campaign, target, events, result, 'ownership_lost');
    } else {
      pauseForBlocker(state, campaign, target, result.code ?? 'build_failed', result.reason ?? 'Construction failed');
    }
  }
}

function advanceSecuring(state, campaign, target, hooks, events) {
  if (!target.security) {
    const result = hookResult(hooks, 'secureTarget', state, { campaign, target }, { ok: true, complete: true, status: 'complete' });
    if (result?.ok === false) {
      blocker(target, result.code ?? 'security_blocked', result.reason ?? 'Target cannot be secured', state);
      return;
    }
    target.security = { id: result.id ?? null, status: result.status ?? (result.complete ? 'complete' : 'active') };
    if (result.complete || result.status === 'complete') transition(state, campaign, target, 'complete', events);
    return;
  }
  const result = hookResult(hooks, 'securityStatus', state, { campaign, target, security: target.security }, target.security);
  if (result?.complete || result?.status === 'complete') transition(state, campaign, target, 'complete', events);
  else if (result?.ok === false || result?.status === 'failed') blocker(target, 'security_blocked', result.reason ?? 'Target cannot be secured', state);
}

function advanceTarget(state, campaign, target, hooks, events) {
  if (target.phase === 'recon') advanceRecon(state, campaign, target, hooks, events);
  else if (target.phase === 'staging') advanceStaging(state, campaign, target, hooks, events);
  else if (target.phase === 'traveling') advanceTraveling(state, campaign, target, hooks, events);
  else if (target.phase === 'fighting') advanceFighting(state, campaign, target, hooks, events);
  else if (target.phase === 'capturing') advanceCapturing(state, campaign, target, hooks, events);
  else if (target.phase === 'constructing') advanceConstructing(state, campaign, target, hooks, events);
  else if (target.phase === 'securing') advanceSecuring(state, campaign, target, hooks, events);
}

function activeTargetCount(campaign) {
  return campaign.targets.filter((target) => !TERMINAL_TARGET_PHASES.has(target.phase) && target.phase !== 'planned').length;
}

function startPlannedTargets(state, campaign, hooks, events) {
  let available = Math.max(0, campaign.policy.concurrency - activeTargetCount(campaign));
  for (const target of campaign.targets) {
    if (available <= 0) break;
    if (target.phase !== 'planned') continue;
    const system = systemFor(state, target);
    if (!system) {
      pauseForBlocker(state, campaign, target, 'target_missing', 'Target system is unavailable');
      break;
    }
    const known = hookResult(hooks, 'hasIntel', state, { campaign, target }, defaultIntel(state, target));
    transition(state, campaign, target, system.owner === 'player' ? 'constructing' : (known ? 'staging' : 'recon'), events);
    available -= 1;
  }
}

export function tickStrategicOperations(state, options = {}) {
  const orders = ensureStrategicOrdersState(state);
  const now = Number(state.time) || 0;
  const intervalMs = Math.max(0, Number(options.intervalMs ?? STRATEGIC_TICK_INTERVAL_MS) || 0);
  if (!options.force && orders.lastTickAt != null && now - orders.lastTickAt < intervalMs) {
    return { ticked: false, events: [], campaigns: strategicOrdersSummary(state).campaigns };
  }
  orders.lastTickAt = now;
  const hooks = options.hooks ?? {};
  const events = [];
  for (const campaign of orders.campaigns) {
    if (!['active', 'cancelling'].includes(campaign.status)) continue;
    startPlannedTargets(state, campaign, hooks, events);
    if (campaign.status === 'paused') {
      refreshCampaignBlockers(campaign);
      continue;
    }
    const candidates = campaign.targets.filter((target) => !TERMINAL_TARGET_PHASES.has(target.phase) && target.phase !== 'planned');
    for (const target of candidates) {
      if (campaign.status === 'paused') break;
      advanceTarget(state, campaign, target, hooks, events);
    }
    campaign.metrics.completedTargets = campaign.targets.filter((target) => target.phase === 'complete').length;
    if (campaign.targets.every((target) => TERMINAL_TARGET_PHASES.has(target.phase))) {
      if (campaign.cancellationMode) {
        campaign.status = 'cancelled';
        campaign.cancelledAt = now;
        events.push({ type: 'campaign_cancelled', campaignId: campaign.id });
      } else {
        campaign.status = 'complete';
        campaign.completedAt = now;
        events.push({ type: 'campaign_complete', campaignId: campaign.id });
      }
    }
    campaign.updatedAt = now;
    refreshCampaignBlockers(campaign);
  }
  return { ticked: true, events, campaigns: strategicOrdersSummary(state).campaigns };
}

function targetSummary(target) {
  return {
    id: target.id,
    galaxyId: target.galaxyId,
    systemId: target.systemId,
    systemName: target.systemName,
    phase: target.phase,
    attempts: target.attempts,
    blockers: copy(target.blockers),
    requirements: copy(target.requirements),
    route: copy(target.route),
    scoutId: target.scout?.id ?? null,
    fleetIds: copy(target.dispatch?.fleetIds ?? []),
    requisitionId: target.requisition?.id ?? null,
    constructionId: target.construction?.id ?? null,
    droneTeam: copy(target.droneTeam ?? { droneIds: [], required: 0, status: 'unassigned' }),
    projectedOperation: copy(target.projectedOperation ?? null),
    actualManifest: copy(target.requisition?.manifest ?? target.assessment?.manifest ?? []),
    roleSubstitutions: copy(target.assessment?.roleSubstitutions ?? []),
    progressMs: target.capture?.progressMs ?? 0,
  };
}

export function strategicOrdersSummary(state, options = {}) {
  const orders = ensureStrategicOrdersState(state);
  const includeTargets = options.includeTargets !== false;
  return {
    version: orders.version,
    counts: {
      active: orders.campaigns.filter((campaign) => campaign.status === 'active').length,
      paused: orders.campaigns.filter((campaign) => campaign.status === 'paused').length,
      complete: orders.campaigns.filter((campaign) => campaign.status === 'complete').length,
      cancelled: orders.campaigns.filter((campaign) => campaign.status === 'cancelled').length,
    },
    templates: listConstructionTemplates(state).map((template) => ({
      id: template.id,
      name: template.name,
      preset: !!template.preset,
      stepCount: template.steps.length,
      doctrine: copy(template.doctrine),
    })),
    campaigns: orders.campaigns.map((campaign) => {
      const phases = {};
      for (const target of campaign.targets) phases[target.phase] = (phases[target.phase] ?? 0) + 1;
      const assignedFleetIds = [...new Set(campaign.targets.flatMap((target) => target.dispatch?.fleetIds ?? []))];
      const assignedDroneIds = [...new Set(campaign.targets.flatMap((target) => target.droneTeam?.droneIds ?? []))];
      const constructionQueue = campaign.targets.reduce((totals, target) => {
        const planned = target.actualBuildPlan?.jobs?.length ?? target.projectedBuild?.jobCount ?? 0;
        const completed = target.construction?.status === 'complete' ? planned : 0;
        return { planned: totals.planned + planned, completed: totals.completed + completed };
      }, { planned: 0, completed: 0 });
      return {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        pauseReason: campaign.pauseReason,
        templateId: campaign.templateId,
        operationDoctrine: copy(campaign.operationDoctrine),
        source: copy(campaign.source),
        progress: {
          complete: phases.complete ?? 0,
          total: campaign.targets.length,
          phases,
        },
        budget: copy(campaign.budget),
        policy: copy(campaign.policy),
        blockers: copy(campaign.blockers),
        linkedBulkOrderIds: copy(campaign.linkedBulkOrderIds),
        operationStatus: {
          assignedFleetIds,
          assignedDroneIds,
          reserveDroneIds: copy(campaign.reserveDroneIds ?? []),
          requiredDronePayload: campaign.operationDoctrine?.dronePayload ?? 0,
          replacementPending: campaign.targets.some((target) => (
            target.phase === 'staging' && (target.assessment?.droneReady === false || target.requisition)
          )),
          constructionQueue,
        },
        metrics: copy(campaign.metrics),
        targets: includeTargets ? campaign.targets.map(targetSummary) : undefined,
      };
    }),
  };
}
