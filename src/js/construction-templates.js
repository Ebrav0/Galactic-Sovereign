// Deterministic, save-safe construction templates for strategic expansion.
// This module plans work only. Live construction remains owned by builder drones.

import {
  FOUNDRY_COST,
  LAUNCHER_COST,
  OUTPOST_COST,
  RESEARCH_STATION_COST,
  SHIPYARD_COST,
  TRADE_STATION_COST,
} from './constants.js';
import { BODY_STRUCTURE_DEFS } from './body-structures.js';
import { STRUCTURE_DEFS } from './strategic-structures.js';
import { systemById } from './state.js';
import { isTechUnlocked } from './tech-web.js';

export const CONSTRUCTION_TEMPLATE_VERSION = 1;

export const TEMPLATE_SELECTORS = Object.freeze([
  'best_habitable_planet',
  'best_resource_world',
  'best_surface_body',
  'best_valid_body',
  'each_eligible_planet',
  'system_node',
  'up_to_n_valid_bodies',
]);

export const TEMPLATE_UNAVAILABLE_POLICIES = Object.freeze(['wait', 'skip', 'fallback']);

const BASE_DEFS = Object.freeze({
  outpost: { label: 'Outpost', cost: OUTPOST_COST, placement: 'surface', bodyTypes: ['habitable'] },
  shipyard: { label: 'Shipyard', cost: SHIPYARD_COST, placement: 'surface', bodyTypes: ['habitable'] },
  research_station: {
    label: 'Research Station', cost: RESEARCH_STATION_COST, tech: 'res_station_protocol',
    placement: 'orbital', systemCap: 3, needsAnchorBody: true,
  },
  sail_foundry: {
    label: 'Sail Foundry', cost: FOUNDRY_COST, tech: 'mega_foundry_unlock',
    placement: 'orbital', bodyTypes: ['habitable', 'barren', 'gas'], systemCap: 1,
  },
  dyson_launcher: {
    label: 'Dyson Launcher', cost: LAUNCHER_COST, tech: 'mega_launcher_unlock',
    placement: 'orbital', bodyTypes: ['habitable', 'barren', 'gas', 'moon'], perBodyCap: 1,
    requiresFoundry: true,
  },
  export_depot: {
    label: 'Export Depot', cost: TRADE_STATION_COST, tech: 'eco_trade_hub',
    placement: 'system', bodyTypes: ['habitable'], systemCap: 1, requiresOutpost: true,
  },
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function step(id, structureType, selector, options = {}) {
  return { id, structureType, selector, required: false, onUnavailable: 'skip', ...options };
}

const PRESETS = [
  {
    id: 'frontier', name: 'Frontier', description: 'Claim, observe, and supply a frontier system.',
    steps: [
      step('foundation', 'outpost', 'best_habitable_planet', {
        required: true,
        onUnavailable: 'fallback',
        fallback: { structureType: 'forward_base', selector: 'system_node', allowSystemNode: true },
      }),
      step('listening', 'listening_post', 'best_habitable_planet'),
      step('supply', 'supply_cache', 'best_habitable_planet'),
    ],
  },
  {
    id: 'industrial', name: 'Industrial', description: 'Build a resource-processing and export center.',
    steps: [
      step('foundation', 'outpost', 'best_habitable_planet', { required: true, onUnavailable: 'wait' }),
      step('power', 'power_grid', 'best_resource_world'),
      step('mining', 'mining_complex', 'best_resource_world'),
      step('refinery', 'refinery', 'best_resource_world'),
      step('storage', 'storage_depot', 'best_resource_world'),
      step('export', 'export_depot', 'best_habitable_planet'),
    ],
  },
  {
    id: 'military', name: 'Military', description: 'Fortify a captured system and establish production.',
    steps: [
      step('foundation', 'outpost', 'best_habitable_planet', { required: true, onUnavailable: 'wait' }),
      step('shipyard', 'shipyard', 'best_habitable_planet'),
      step('defense', 'orbital_defense', 'best_valid_body'),
      step('missiles', 'missile_silo', 'best_surface_body'),
      step('command', 'command_post', 'system_node'),
      step('supply', 'supply_cache', 'best_habitable_planet'),
    ],
  },
  {
    id: 'research', name: 'Research', description: 'Develop a sensor and research enclave.',
    steps: [
      step('foundation', 'outpost', 'best_habitable_planet', { required: true, onUnavailable: 'wait' }),
      step('station', 'research_station', 'system_node'),
      step('sensors', 'sensor_array', 'best_valid_body'),
      step('archive', 'quantum_archive', 'best_surface_body'),
    ],
  },
  {
    id: 'trade', name: 'Trade', description: 'Create an export and logistics hub.',
    steps: [
      step('foundation', 'outpost', 'best_habitable_planet', { required: true, onUnavailable: 'wait' }),
      step('export', 'export_depot', 'best_habitable_planet'),
      step('logistics', 'logistics_hub', 'best_valid_body'),
      step('exchange', 'galactic_exchange', 'best_valid_body'),
    ],
  },
  {
    id: 'dyson', name: 'Dyson', description: 'Establish the industry for a new Dyson project.',
    steps: [
      step('foundation', 'outpost', 'best_habitable_planet', { required: true, onUnavailable: 'wait' }),
      step('foundry', 'sail_foundry', 'best_habitable_planet'),
      step('launchers', 'dyson_launcher', { kind: 'up_to_n_valid_bodies', limit: 3 }),
      step('collector', 'solar_collector', 'system_node'),
      step('nanoforge', 'nanoforge', 'best_surface_body'),
    ],
  },
].map((template) => ({ ...template, version: CONSTRUCTION_TEMPLATE_VERSION, preset: true }));

export const PRESET_CONSTRUCTION_TEMPLATES = deepFreeze(
  Object.fromEntries(PRESETS.map((template) => [template.id, template])),
);

function copy(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function stateTemplateStore(state) {
  state.strategicOrders ??= {};
  state.strategicOrders.templates ??= [];
  state.strategicOrders.nextTemplateId ??= 1;
  return state.strategicOrders;
}

function selectorKind(selector) {
  return typeof selector === 'string' ? selector : selector?.kind;
}

function normalizedSelector(selector) {
  if (typeof selector === 'string') return selector;
  if (!selector || typeof selector !== 'object') return null;
  const kind = selector.kind;
  if (kind !== 'up_to_n_valid_bodies') return { kind };
  return { kind, limit: Math.max(1, Math.min(32, Math.floor(Number(selector.limit) || 1))) };
}

function structureDef(type) {
  if (BASE_DEFS[type]) return { ...BASE_DEFS[type], type, source: 'base' };
  if (BODY_STRUCTURE_DEFS[type]) return { ...BODY_STRUCTURE_DEFS[type], type, source: 'body' };
  if (STRUCTURE_DEFS[type]) {
    const def = STRUCTURE_DEFS[type];
    return {
      ...def,
      type,
      source: 'strategic',
      label: type.split('_').map((part) => part[0].toUpperCase() + part.slice(1)).join(' '),
      placement: def.perBody ? 'surface' : 'system',
      bodyTypes: def.perBody ? ['habitable', 'barren', 'gas'] : null,
    };
  }
  return null;
}

export function constructionStructureDefinition(type) {
  return structureDef(type);
}

function normalizeFallback(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    structureType: String(raw.structureType ?? ''),
    selector: normalizedSelector(raw.selector),
    allowSystemNode: !!raw.allowSystemNode,
  };
}

function normalizeStep(raw, index) {
  const required = !!raw?.required;
  return {
    id: String(raw?.id ?? `step-${index + 1}`),
    structureType: String(raw?.structureType ?? ''),
    selector: normalizedSelector(raw?.selector),
    required,
    onUnavailable: raw?.onUnavailable ?? (required ? 'wait' : 'skip'),
    fallback: normalizeFallback(raw?.fallback),
    label: raw?.label == null ? null : String(raw.label),
  };
}

export function validateConstructionTemplate(template, options = {}) {
  const errors = [];
  if (!template || typeof template !== 'object') {
    return { ok: false, errors: ['Template must be an object'], template: null };
  }
  const normalized = {
    id: String(template.id ?? '').trim(),
    name: String(template.name ?? '').trim(),
    description: String(template.description ?? '').trim(),
    version: CONSTRUCTION_TEMPLATE_VERSION,
    preset: !!template.preset,
    steps: Array.isArray(template.steps) ? template.steps.map(normalizeStep) : [],
  };
  if (!normalized.name) errors.push('Template name is required');
  if (normalized.name.length > 80) errors.push('Template name cannot exceed 80 characters');
  if (normalized.steps.length === 0) errors.push('Template must contain at least one step');
  if (normalized.steps.length > (options.maxSteps ?? 64)) errors.push('Template has too many steps');
  const ids = new Set();
  for (const entry of normalized.steps) {
    if (!entry.id || ids.has(entry.id)) errors.push(`Step ids must be unique: ${entry.id || '(empty)'}`);
    ids.add(entry.id);
    if (!structureDef(entry.structureType)) errors.push(`Unknown structure type: ${entry.structureType}`);
    const kind = selectorKind(entry.selector);
    if (!TEMPLATE_SELECTORS.includes(kind)) errors.push(`Unknown selector on ${entry.id}: ${kind ?? '(missing)'}`);
    if (!TEMPLATE_UNAVAILABLE_POLICIES.includes(entry.onUnavailable)) {
      errors.push(`Unknown unavailable policy on ${entry.id}: ${entry.onUnavailable}`);
    }
    if (entry.required && entry.onUnavailable === 'skip') {
      errors.push(`Required step ${entry.id} cannot use skip`);
    }
    if (entry.onUnavailable === 'fallback') {
      if (!entry.fallback) errors.push(`Fallback step ${entry.id} requires a fallback definition`);
      else {
        if (!structureDef(entry.fallback.structureType)) {
          errors.push(`Unknown fallback structure type on ${entry.id}: ${entry.fallback.structureType}`);
        }
        const fallbackKind = selectorKind(entry.fallback.selector);
        if (!TEMPLATE_SELECTORS.includes(fallbackKind)) {
          errors.push(`Unknown fallback selector on ${entry.id}: ${fallbackKind ?? '(missing)'}`);
        }
      }
    }
  }
  return { ok: errors.length === 0, errors, template: normalized };
}

export function getConstructionTemplate(state, templateOrId) {
  if (templateOrId && typeof templateOrId === 'object') return copy(templateOrId);
  const id = String(templateOrId ?? 'frontier');
  const preset = PRESET_CONSTRUCTION_TEMPLATES[id];
  if (preset) return copy(preset);
  const saved = state?.strategicOrders?.templates?.find((template) => template.id === id);
  return saved ? copy(saved) : null;
}

export function listConstructionTemplates(state) {
  return [
    ...Object.values(PRESET_CONSTRUCTION_TEMPLATES).map(copy),
    ...(state?.strategicOrders?.templates ?? []).map(copy),
  ];
}

export function saveConstructionTemplate(state, template) {
  const store = stateTemplateStore(state);
  const candidate = copy(template ?? {});
  if (candidate.id && PRESET_CONSTRUCTION_TEMPLATES[candidate.id]) {
    return { ok: false, reason: 'Preset templates cannot be overwritten' };
  }
  const check = validateConstructionTemplate(candidate);
  if (!check.ok) return { ok: false, reason: check.errors[0], errors: check.errors };
  let id = check.template.id;
  if (!id) {
    do id = `template-${store.nextTemplateId++}`;
    while (store.templates.some((entry) => entry.id === id) || PRESET_CONSTRUCTION_TEMPLATES[id]);
  }
  const saved = {
    ...check.template,
    id,
    preset: false,
    updatedAt: Number(state.time) || 0,
  };
  const index = store.templates.findIndex((entry) => entry.id === id);
  if (index >= 0) store.templates[index] = saved;
  else store.templates.push(saved);
  return { ok: true, template: copy(saved), created: index < 0 };
}

export function cloneConstructionTemplate(state, templateId, overrides = {}) {
  const source = getConstructionTemplate(state, templateId);
  if (!source) return { ok: false, reason: 'No such construction template' };
  return saveConstructionTemplate(state, {
    ...source,
    ...copy(overrides),
    id: overrides.id ?? '',
    name: overrides.name ?? `${source.name} Copy`,
    preset: false,
  });
}

export function deleteConstructionTemplate(state, templateId) {
  if (PRESET_CONSTRUCTION_TEMPLATES[templateId]) {
    return { ok: false, reason: 'Preset templates cannot be deleted' };
  }
  const store = stateTemplateStore(state);
  const index = store.templates.findIndex((template) => template.id === templateId);
  if (index < 0) return { ok: false, reason: 'No such construction template' };
  const [removed] = store.templates.splice(index, 1);
  return { ok: true, template: copy(removed) };
}

function allBodies(system) {
  const out = [];
  for (const planet of system.bodies ?? []) {
    out.push({ body: planet, planet, kind: 'planet' });
    for (const moon of planet.moons ?? []) out.push({ body: moon, planet, kind: 'moon' });
  }
  return out;
}

function bodyType(candidate) {
  return candidate.kind === 'moon' ? 'moon' : candidate.body.type;
}

function resourceScore(candidate) {
  const body = candidate.body;
  const resources = body.resources;
  let score = Number(body.resourceScore ?? body.resourceValue ?? body.mineralRichness ?? 0) || 0;
  if (resources && typeof resources === 'object') {
    score += Object.values(resources).reduce((sum, value) => sum + (Number(value) || 0), 0);
  }
  if (body.type === 'barren') score += 2;
  if (body.type === 'habitable') score += 1;
  return score;
}

function stableBodies(system, mode = 'normal') {
  const rows = allBodies(system);
  return rows.sort((a, b) => {
    if (mode === 'resource') {
      const delta = resourceScore(b) - resourceScore(a);
      if (delta) return delta;
    }
    const typeOrder = { habitable: 0, barren: 1, gas: 2, moon: 3 };
    const typeDelta = (typeOrder[bodyType(a)] ?? 9) - (typeOrder[bodyType(b)] ?? 9);
    if (typeDelta) return typeDelta;
    const orbitDelta = (Number(a.body.orbitRadius) || 0) - (Number(b.body.orbitRadius) || 0);
    if (orbitDelta) return orbitDelta;
    return String(a.body.id).localeCompare(String(b.body.id));
  });
}

function hostPlanetId(system, bodyId) {
  for (const planet of system.bodies ?? []) {
    if (planet.id === bodyId) return planet.id;
    if ((planet.moons ?? []).some((moon) => moon.id === bodyId)) return planet.id;
  }
  return bodyId;
}

function hasProjected(structures, type, bodyId = undefined) {
  return structures.some((structure) => structure.type === type
    && (bodyId === undefined || structure.bodyId === bodyId));
}

function typeCount(structures, type, bodyId = undefined) {
  return structures.filter((structure) => structure.type === type
    && (bodyId === undefined || structure.bodyId === bodyId)).length;
}

function projectedCheck(state, system, structures, def, bodyId, options = {}) {
  if (!options.ignoreTechnology && def.tech && !isTechUnlocked(state, def.tech)) {
    return { ok: false, reason: `Technology not researched: ${def.tech}` };
  }
  if (options.requireOwned && system.owner !== 'player') {
    return { ok: false, reason: 'System not under player control' };
  }
  const bodies = allBodies(system);
  const candidate = bodyId == null ? null : bodies.find((entry) => entry.body.id === bodyId);
  const candidateType = candidate ? bodyType(candidate) : null;

  if (def.type === 'research_station') {
    if (system.bodies?.length === 0) return { ok: false, reason: 'No anchor body for research station' };
    if (typeCount(structures, def.type) >= def.systemCap) return { ok: false, reason: 'System cap reached' };
    return { ok: true, bodyId: null };
  }

  if (def.source === 'strategic' && !def.perBody) {
    if (typeCount(structures, def.type) >= def.cap) return { ok: false, reason: 'Already satisfied', satisfied: true };
    return { ok: true, bodyId: null };
  }

  if (def.source === 'body' && def.starNode) {
    if (def.blackHoleOnly && system.star?.kind !== 'blackhole') return { ok: false, reason: 'Requires a black hole' };
    if (def.deadStarOnly && (system.bodies ?? []).length > 0) return { ok: false, reason: 'Requires a dead-star system' };
    if (def.requiresDyson && !((system.dyson?.completedShells ?? 0) > 0
      || hasProjected(structures, 'sail_foundry') || hasProjected(structures, 'dyson_launcher'))) {
      return { ok: false, reason: 'An active Dyson project is required' };
    }
    const cap = def.capScope === 'system' ? def.cap : Number.POSITIVE_INFINITY;
    if (typeCount(structures, def.type) >= cap) return { ok: false, reason: 'Already satisfied', satisfied: true };
    return { ok: true, bodyId: null };
  }

  // The Frontier preset deliberately exposes this integration extension point.
  if (def.type === 'forward_base' && bodyId == null && options.allowSystemNode
      && (system.bodies ?? []).length === 0) {
    if (typeCount(structures, def.type) >= def.cap) return { ok: false, reason: 'System cap reached' };
    return { ok: true, bodyId: null, systemNodeFallback: true };
  }

  if (!candidate) return { ok: false, reason: 'No valid body' };
  if (def.source === 'strategic' && def.perBody && candidate.kind !== 'planet') {
    return { ok: false, reason: 'Strategic structure requires a planet' };
  }
  if (def.bodyTypes && !def.bodyTypes.includes(candidateType)) {
    return { ok: false, reason: `Cannot build on ${candidateType}` };
  }
  const planetId = hostPlanetId(system, bodyId);
  if (def.requiresOutpost && !hasProjected(structures, 'outpost', planetId)) {
    return { ok: false, reason: 'Outpost required' };
  }
  if (def.requiresFoundry && !hasProjected(structures, 'sail_foundry')) {
    return { ok: false, reason: 'Sail foundry required' };
  }
  if (def.source === 'strategic' && def.perBody && typeCount(structures, def.type, bodyId) >= def.cap) {
    return { ok: false, reason: 'Already satisfied', satisfied: true };
  }
  if (def.systemCap && typeCount(structures, def.type) >= def.systemCap) {
    return { ok: false, reason: 'Already satisfied', satisfied: true };
  }
  const cap = def.perBodyCap ?? (def.capScope === 'body' ? def.cap : null);
  if (cap != null && typeCount(structures, def.type, bodyId) >= cap) {
    return { ok: false, reason: 'Already satisfied', satisfied: true };
  }
  if (def.capScope === 'system' && typeCount(structures, def.type) >= def.cap) {
    return { ok: false, reason: 'Already satisfied', satisfied: true };
  }
  if (def.type === 'outpost' && hasProjected(structures, 'outpost', bodyId)) {
    return { ok: false, reason: 'Outpost already present', satisfied: true };
  }
  if (def.type === 'shipyard' && hasProjected(structures, 'shipyard', bodyId)) {
    return { ok: false, reason: 'Shipyard already present', satisfied: true };
  }
  if (def.type === 'sail_foundry' && hasProjected(structures, 'sail_foundry')) {
    return { ok: false, reason: 'Sail foundry already present', satisfied: true };
  }
  if (def.type === 'export_depot' && structures.some((entry) => (
    ['export_depot', 'trade_station', 'trade_nexus'].includes(entry.type)
  ))) {
    return { ok: false, reason: 'Export depot already present', satisfied: true };
  }
  return { ok: true, bodyId };
}

function candidatesForSelector(system, selector, def) {
  const kind = selectorKind(selector);
  if (kind === 'system_node') return [null];
  const stable = stableBodies(system, kind === 'best_resource_world' ? 'resource' : 'normal');
  let candidates = stable;
  if (kind === 'best_habitable_planet') {
    candidates = stable.filter((entry) => entry.kind === 'planet' && entry.body.type === 'habitable');
  } else if (kind === 'best_resource_world' || kind === 'best_surface_body') {
    candidates = stable.filter((entry) => ['habitable', 'barren'].includes(bodyType(entry)));
  } else if (kind === 'each_eligible_planet') {
    candidates = stable.filter((entry) => entry.kind === 'planet');
  }
  if (def.bodyTypes) candidates = candidates.filter((entry) => def.bodyTypes.includes(bodyType(entry)));
  return candidates.map((entry) => entry.body.id);
}

function structureCost(def, state, system, bodyId, options) {
  const override = options.costForStructure?.(state, {
    systemId: system.id,
    structureType: def.type,
    bodyId,
    definition: def,
  });
  const value = Number(override ?? def.cost ?? 0);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function materializeDefinition(state, system, structures, definition, selector, context) {
  const def = structureDef(definition.structureType);
  if (!def) return { ok: false, reason: `Unknown structure type: ${definition.structureType}`, jobs: [] };
  const candidates = candidatesForSelector(system, selector, def);
  // A system-node fallback may intentionally have no physical body.
  if (candidates.length === 0 && selectorKind(selector) === 'system_node') candidates.push(null);
  const jobs = [];
  const kind = selectorKind(selector);
  const maxJobs = kind === 'up_to_n_valid_bodies'
    ? Math.max(1, Number(selector.limit) || 1)
    : (kind === 'each_eligible_planet' ? Number.POSITIVE_INFINITY : 1);
  let lastReason = 'No valid placement';
  let satisfied = false;
  for (const requestedBodyId of candidates) {
    const check = projectedCheck(state, system, structures, def, requestedBodyId, {
      ...context.options,
      allowSystemNode: !!definition.allowSystemNode,
    });
    if (!check.ok) {
      lastReason = check.reason ?? lastReason;
      satisfied ||= !!check.satisfied;
      if (check.satisfied && maxJobs === 1) break;
      continue;
    }
    const bodyId = check.bodyId ?? null;
    const clientId = `${context.step.id}-${context.nextJobOrdinal()}`;
    const planetId = bodyId == null ? null : hostPlanetId(system, bodyId);
    const dependencies = context.jobs
      .filter((prior) => prior.structureType === 'outpost'
        ? prior.bodyId === planetId
        : ['sail_foundry'].includes(prior.structureType) && def.requiresFoundry)
      .map((prior) => prior.clientId);
    const job = {
      clientId,
      templateStepId: context.step.id,
      structureType: def.type,
      bodyId,
      selector: copy(selector),
      required: !!context.step.required,
      fallback: !!context.fallback,
      systemNodeFallback: !!check.systemNodeFallback,
      cost: structureCost(def, state, system, bodyId, context.options),
      dependsOnClientIds: [...new Set(dependencies)],
    };
    jobs.push(job);
    structures.push({
      id: `template-projected-${clientId}`,
      type: def.type,
      bodyId: def.type === 'export_depot' ? null : bodyId,
      sourceBodyId: def.type === 'export_depot' ? bodyId : undefined,
      projected: true,
    });
    // Remote outpost construction currently commissions one export depot.
    if (def.type === 'outpost' && !hasProjected(structures, 'export_depot')) {
      structures.push({ id: `template-implicit-export-${clientId}`, type: 'export_depot', bodyId: null, projected: true, implicit: true });
    }
    if (jobs.length >= maxJobs) break;
  }
  return {
    ok: jobs.length > 0 || satisfied,
    reason: jobs.length > 0 ? null : (satisfied ? 'Already satisfied' : lastReason),
    jobs,
    satisfied,
  };
}

export function materializeConstructionTemplate(state, systemId, templateOrId = 'frontier', options = {}) {
  const source = getConstructionTemplate(state, templateOrId);
  if (!source) return { ok: false, ready: false, errors: ['No such construction template'], jobs: [] };
  const validation = validateConstructionTemplate(source);
  if (!validation.ok) return { ok: false, ready: false, errors: validation.errors, jobs: [] };
  const system = options.system ?? systemById(state, systemId, options.galaxyId);
  if (!system) return { ok: false, ready: false, errors: ['No such system'], jobs: [] };

  const structures = (system.structures ?? []).map((entry) => ({ ...entry }));
  const jobs = [];
  const skipped = [];
  const waiting = [];
  const errors = [];
  let ordinal = 1;
  const nextJobOrdinal = () => ordinal++;

  for (const entry of validation.template.steps) {
    const primary = materializeDefinition(state, system, structures, entry, entry.selector, {
      step: entry, jobs, options, fallback: false, nextJobOrdinal,
    });
    if (primary.ok) {
      jobs.push(...primary.jobs);
      if (primary.satisfied && primary.jobs.length === 0) {
        skipped.push({ stepId: entry.id, structureType: entry.structureType, reason: primary.reason, satisfied: true });
      }
      continue;
    }

    if (entry.onUnavailable === 'fallback' && entry.fallback) {
      const fallback = materializeDefinition(state, system, structures, entry.fallback, entry.fallback.selector, {
        step: entry, jobs, options, fallback: true, nextJobOrdinal,
      });
      if (fallback.ok) {
        jobs.push(...fallback.jobs);
        if (fallback.satisfied && fallback.jobs.length === 0) {
          skipped.push({ stepId: entry.id, structureType: entry.fallback.structureType, reason: fallback.reason, satisfied: true, fallback: true });
        }
        continue;
      }
      const reason = `${primary.reason}; fallback unavailable: ${fallback.reason}`;
      if (entry.required) waiting.push({ stepId: entry.id, structureType: entry.structureType, reason, required: true });
      else skipped.push({ stepId: entry.id, structureType: entry.structureType, reason });
      continue;
    }

    if (entry.onUnavailable === 'wait') {
      waiting.push({ stepId: entry.id, structureType: entry.structureType, reason: primary.reason, required: entry.required });
    } else if (entry.onUnavailable === 'skip') {
      skipped.push({ stepId: entry.id, structureType: entry.structureType, reason: primary.reason });
    } else {
      errors.push(`Step ${entry.id} could not be materialized: ${primary.reason}`);
    }
  }

  const totalCost = jobs.reduce((sum, job) => sum + job.cost, 0);
  return {
    ok: errors.length === 0,
    ready: errors.length === 0 && waiting.length === 0,
    systemId,
    galaxyId: options.galaxyId ?? state.activeGalaxyId ?? null,
    template: validation.template,
    jobs,
    skipped,
    waiting,
    errors,
    totalCost,
    requiredJobCount: jobs.filter((job) => job.required).length,
  };
}

export function constructionTemplateCapacity(state, systemId, templateOrId = 'frontier', options = {}) {
  const plan = materializeConstructionTemplate(state, systemId, templateOrId, options);
  return {
    ok: plan.ok,
    ready: plan.ready,
    jobCount: plan.jobs?.length ?? 0,
    requiredJobCount: plan.requiredJobCount ?? 0,
    waitingCount: plan.waiting?.length ?? 0,
    totalCost: plan.totalCost ?? 0,
  };
}
