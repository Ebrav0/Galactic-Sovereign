// GPT-5.6 Sol commander contract.
//
// This module intentionally has no network, Electron, storage, or gameplay
// dependencies. Renderer code may build a redacted snapshot and validate model
// output here; Electron main owns API-key storage and requests; existing game
// commands remain the only authority allowed to mutate game state.

export const SOL_COMMANDER_SCHEMA_VERSION = 1;
export const SOL_SNAPSHOT_VERSION = 1;
export const SOL_MODEL_ID = 'gpt-5.6-sol';

export const SOL_FLEET_ORDERS = Object.freeze([
  'formation',
  'screen',
  'protect',
  'hold',
  'attack_target_class',
  'bombard',
  'escort_convoy',
  'rally',
  'emergency_retreat',
]);

export const SOL_FORMATIONS = Object.freeze(['line', 'wedge', 'screen', 'sphere', 'escort']);
export const SOL_TARGET_CLASSES = Object.freeze([
  'fighter', 'bomber', 'escort', 'capital', 'carrier', 'structure', 'convoy',
]);
export const SOL_CARGO_CLASSES = Object.freeze([
  'rawMaterials', 'fuel', 'manufacturedGoods',
]);
export const SOL_BUILD_TYPES = Object.freeze([
  'outpost', 'shipyard', 'trade_station', 'export_depot', 'research_station',
  'mining_complex', 'refinery', 'storage_depot', 'fighter_factory', 'drydock',
  'orbital_defense', 'planetary_shield', 'ion_battery', 'asteroid_harvester',
  'listening_post', 'lane_relay', 'blockade_fort', 'forward_base', 'supply_cache',
  'command_post', 'dyson_foundry', 'solar_sail_launcher', 'superweapon_cradle',
]);

export const SOL_INSPECTION_TOOLS = Object.freeze([
  'inspect_empire', 'inspect_system', 'inspect_logistics', 'explain_battle',
]);
export const SOL_COMMAND_TOOLS = Object.freeze([
  'propose_fleet_order', 'propose_route', 'propose_build',
]);
export const SOL_TOOL_NAMES = Object.freeze([
  ...SOL_INSPECTION_TOOLS,
  ...SOL_COMMAND_TOOLS,
]);

const idSchema = Object.freeze({ type: 'string', minLength: 1, maxLength: 80 });
const optionalIdSchema = Object.freeze({ ...idSchema });
const enumSchema = (values) => Object.freeze({ type: 'string', enum: Object.freeze([...values]) });

// JSON-schema-compatible contracts for use by the Electron request adapter.
// The adapter may translate these to the exact SDK wire shape it uses.
export const SOL_TOOL_SCHEMAS = deepFreeze({
  inspect_empire: {
    description: 'Inspect the redacted empire summary.',
    requiresConfirmation: false,
    parameters: { type: 'object', additionalProperties: false, properties: {}, required: [] },
  },
  inspect_system: {
    description: 'Inspect one known system from the redacted snapshot.',
    requiresConfirmation: false,
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { systemId: idSchema }, required: ['systemId'],
    },
  },
  inspect_logistics: {
    description: 'Inspect physical cargo, depots, convoys, routes, and losses.',
    requiresConfirmation: false,
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { galaxyId: optionalIdSchema }, required: [],
    },
  },
  propose_fleet_order: {
    description: 'Propose, but do not execute, one fleet-level tactical order.',
    requiresConfirmation: true,
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        fleetId: idSchema,
        order: enumSchema(SOL_FLEET_ORDERS),
        targetSystemId: optionalIdSchema,
        targetId: optionalIdSchema,
        targetClass: enumSchema(SOL_TARGET_CLASSES),
        formation: enumSchema(SOL_FORMATIONS),
      },
      required: ['fleetId', 'order'],
    },
  },
  propose_route: {
    description: 'Propose, but do not create, a cargo route to a Trade Nexus.',
    requiresConfirmation: true,
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        fromSystemId: idSchema,
        toSystemId: idSchema,
        cargoClass: enumSchema(SOL_CARGO_CLASSES),
      },
      required: ['fromSystemId', 'toSystemId'],
    },
  },
  propose_build: {
    description: 'Propose, but do not begin, a construction action.',
    requiresConfirmation: true,
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        systemId: idSchema,
        structureType: enumSchema(SOL_BUILD_TYPES),
        bodyId: optionalIdSchema,
      },
      required: ['systemId', 'structureType'],
    },
  },
  explain_battle: {
    description: 'Explain a battle from redacted tactical state and reports.',
    requiresConfirmation: false,
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { systemId: idSchema, battleId: optionalIdSchema },
      required: ['systemId'],
    },
  },
});

export const SOL_RESPONSE_JSON_SCHEMA = deepFreeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    schemaVersion: { type: 'integer', const: SOL_COMMANDER_SCHEMA_VERSION },
    summary: { type: 'string', minLength: 1, maxLength: 1200 },
    recommendations: {
      type: 'array', minItems: 1, maxItems: 12,
      items: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' },
          tool: { type: 'string', enum: SOL_TOOL_NAMES },
          title: { type: 'string', minLength: 1, maxLength: 120 },
          rationale: { type: 'string', minLength: 1, maxLength: 1000 },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          arguments: { type: 'object' },
        },
        required: ['id', 'tool', 'title', 'rationale', 'confidence', 'arguments'],
      },
    },
  },
  required: ['schemaVersion', 'summary', 'recommendations'],
});

export const DEFAULT_SOL_COMMANDER_SETTINGS = deepFreeze({
  enabled: false,
  providerMode: 'offline',
  model: SOL_MODEL_ID,
  confirmationRequired: true,
  previewData: true,
  requestLimitPerHour: 12,
  spendingCapUsd: 5,
});

const RESPONSE_ROOT_FIELDS = Object.freeze(['schemaVersion', 'summary', 'recommendations']);
const RECOMMENDATION_FIELDS = Object.freeze([
  'id', 'tool', 'title', 'rationale', 'confidence', 'arguments',
]);
const SETTINGS_FIELDS = Object.freeze(Object.keys(DEFAULT_SOL_COMMANDER_SETTINGS));
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_SNAPSHOT_SYSTEMS = 80;
const MAX_SNAPSHOT_FLEETS = 40;
const MAX_SNAPSHOT_ROUTES = 60;
const MAX_HISTORY_ENTRIES = 100;
const IDENTIFIER_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function nonnegative(value, fallback = 0) {
  return Math.max(0, finite(value, fallback));
}

function integer(value, fallback = 0) {
  return Math.trunc(finite(value, fallback));
}

function round(value, places = 2) {
  const factor = 10 ** places;
  return Math.round(finite(value) * factor) / factor;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function secretLike(value) {
  if (typeof value !== 'string') return false;
  return /^(?:sk|sess|Bearer)[-_ ]/i.test(value)
    || /(?:api[_-]?key|authorization|password|secret|access[_-]?token)/i.test(value);
}

function compactId(value, fallback = null) {
  if (typeof value !== 'string' || !IDENTIFIER_RE.test(value) || secretLike(value)) return fallback;
  return value;
}

function stableSortById(values) {
  return [...values].sort((a, b) => String(a?.id ?? a?.systemId ?? '')
    .localeCompare(String(b?.id ?? b?.systemId ?? '')));
}

function ownArray(value) {
  return Array.isArray(value) ? value : [];
}

function ownValues(value) {
  return isPlainObject(value) ? Object.values(value) : [];
}

function systemsForGalaxy(state, galaxyId) {
  return state?.galaxies?.[galaxyId]?.systems ?? (galaxyId === state?.activeGalaxyId ? state?.systems : null) ?? {};
}

function graphForGalaxy(state, galaxyId) {
  return state?.galaxies?.[galaxyId]?.graph ?? (galaxyId === state?.activeGalaxyId ? state?.galaxy : null) ?? null;
}

function allSystemEntries(state) {
  const entries = [];
  if (isPlainObject(state?.galaxies)) {
    for (const galaxyId of Object.keys(state.galaxies).sort()) {
      const systems = systemsForGalaxy(state, galaxyId);
      for (const systemId of Object.keys(systems).sort()) {
        entries.push({ galaxyId, systemId, system: systems[systemId] });
      }
    }
  } else {
    for (const systemId of Object.keys(state?.systems ?? {}).sort()) {
      entries.push({ galaxyId: state?.activeGalaxyId ?? 'gal-0', systemId, system: state.systems[systemId] });
    }
  }
  return entries;
}

function structureTypes(system) {
  return [...new Set(ownArray(system?.structures)
    .map((structure) => compactId(structure?.type))
    .filter(Boolean))].sort();
}

function isTradeNexusSystem(system) {
  return system?.isTradeNexus === true
    || system?.tradeNexus === true
    || system?.kind === 'trade_nexus'
    || system?.star?.kind === 'trade_nexus'
    || system?.star?.type === 'trade_nexus'
    || ownArray(system?.structures).some((structure) => structure?.type === 'trade_nexus');
}

function normalizeCargo(cargo) {
  const source = isPlainObject(cargo) ? cargo : {};
  return {
    rawMaterials: round(nonnegative(source.rawMaterials ?? source.raw_materials)),
    fuel: round(nonnegative(source.fuel)),
    manufacturedGoods: round(nonnegative(source.manufacturedGoods ?? source.manufactured_goods)),
  };
}

function cargoTotal(cargo) {
  return SOL_CARGO_CLASSES.reduce((sum, key) => sum + nonnegative(cargo?.[key]), 0);
}

function logisticsContainers(state) {
  const logistics = isPlainObject(state?.logistics) ? state.logistics : {};
  const depots = ownValues(logistics.depots).length
    ? ownValues(logistics.depots)
    : ownArray(logistics.depots).length ? logistics.depots : ownArray(state?.exportDepots);
  const convoys = ownArray(logistics.convoys).length ? logistics.convoys : ownArray(state?.convoys);
  const routes = ownArray(logistics.routes).length
    ? logistics.routes
    : ownArray(state?.logisticsRoutes);
  return { logistics, depots, convoys, routes };
}

function countBattleUnits(battle, side) {
  const listKeys = side === 'player'
    ? ['playerUnits', 'allies', 'playerShips']
    : ['enemyUnits', 'enemies', 'enemyShips'];
  for (const key of listKeys) {
    if (Array.isArray(battle?.[key])) return battle[key].length;
    if (Number.isFinite(battle?.[key])) return Math.max(0, Math.trunc(battle[key]));
  }
  return 0;
}

/**
 * Build a compact allowlisted snapshot. Unknown state fields, settings,
 * conversation text, wall-clock metadata, keys, tokens, and renderer globals
 * are never traversed into the result.
 */
export function buildRedactedSolSnapshot(state, options = {}) {
  if (!isPlainObject(state)) throw new TypeError('Game state must be a plain object');
  const activeGalaxyId = compactId(state.activeGalaxyId, 'gal-0');
  const entries = allSystemEntries(state);
  const activeEntries = entries.filter((entry) => entry.galaxyId === activeGalaxyId);
  const owned = entries.filter((entry) => entry.system?.owner === 'player');
  const { logistics, depots, convoys, routes } = logisticsContainers(state);
  const battleEntries = Object.entries(state.systemBattles ?? {})
    .filter(([, battle]) => battle?.active !== false)
    .sort(([a], [b]) => a.localeCompare(b));

  const shipById = new Map(ownArray(state.playerShips).map((ship) => [ship?.id, ship]));
  const fleets = stableSortById(ownArray(state.battleGroups)).slice(0, MAX_SNAPSHOT_FLEETS).map((fleet) => {
    const ships = ownArray(fleet.shipIds).map((id) => shipById.get(id)).filter(Boolean);
    const systems = [...new Set(ships.map((ship) => compactId(ship?.systemId)).filter(Boolean))].sort();
    return {
      id: compactId(fleet.id, 'fleet-redacted'),
      galaxyId: compactId(fleet.galaxyId, activeGalaxyId),
      shipCount: ships.length,
      readyShipCount: ships.filter((ship) => ship?.hp > 0 && !ship?.transit).length,
      systemIds: systems.slice(0, 6),
      currentOrder: compactId(state.tacticalOrders?.[fleet.id]?.order),
    };
  });

  const snapshotSystems = activeEntries.slice(0, MAX_SNAPSHOT_SYSTEMS).map(({ systemId, system }) => ({
    id: compactId(systemId, 'system-redacted'),
    owner: compactId(system?.owner, 'unknown'),
    kind: isTradeNexusSystem(system) ? 'trade_nexus' : compactId(system?.star?.kind ?? system?.star?.type, 'star'),
    bodyCount: ownArray(system?.bodies).length,
    structureTypes: structureTypes(system),
    battleActive: Boolean(state.systemBattles?.[systemId]?.active),
  }));

  const depotSummaries = stableSortById(depots).slice(0, MAX_SNAPSHOT_ROUTES).map((depot) => ({
    id: compactId(depot?.id, 'depot-redacted'),
    systemId: compactId(depot?.systemId, null),
    cargo: normalizeCargo(depot?.cargo ?? depot?.inventory ?? depot?.storage),
    capacity: round(nonnegative(depot?.capacity)),
  }));
  const convoySummaries = stableSortById(convoys).slice(0, MAX_SNAPSHOT_ROUTES).map((convoy) => ({
    id: compactId(convoy?.id, 'convoy-redacted'),
    routeId: compactId(convoy?.routeId, null),
    fromSystemId: compactId(convoy?.fromSystemId ?? convoy?.originSystemId, null),
    toSystemId: compactId(convoy?.toSystemId ?? convoy?.destinationSystemId, null),
    status: compactId(convoy?.status ?? convoy?.phase, 'unknown'),
    cargo: normalizeCargo(convoy?.cargo),
    escorted: Boolean(convoy?.escortFleetId ?? convoy?.escorted),
  }));
  const routeSummaries = stableSortById(routes).slice(0, MAX_SNAPSHOT_ROUTES).map((route) => ({
    id: compactId(route?.id, 'route-redacted'),
    fromSystemId: compactId(route?.fromSystemId ?? route?.originSystemId, null),
    toSystemId: compactId(route?.toSystemId ?? route?.destinationSystemId, null),
    cargoClass: SOL_CARGO_CLASSES.includes(route?.cargoClass) ? route.cargoClass : null,
    paused: Boolean(route?.paused || (finite(route?.pausedUntil) > finite(state.time))),
    danger: round(nonnegative(route?.danger ?? route?.risk)),
  }));

  const snapshot = {
    snapshotVersion: SOL_SNAPSHOT_VERSION,
    gameTimeMs: integer(state.time),
    paused: Boolean(state.paused),
    activeGalaxyId,
    empire: {
      credits: round(nonnegative(state.credits)),
      solarii: round(nonnegative(state.solarii)),
      ownedSystemCount: owned.length,
      shipCount: ownArray(state.playerShips).filter((ship) => ship?.hp > 0).length,
      fleetCount: fleets.length,
    },
    research: {
      activeNodeId: compactId(state.research?.activeNodeId),
      progress: round(Math.max(0, Math.min(1, finite(state.research?.progress))), 3),
      unlocked: ownArray(state.research?.unlocked).map((id) => compactId(id)).filter(Boolean).sort().slice(0, 120),
      queue: ownArray(state.research?.queue).map((id) => compactId(id)).filter(Boolean).slice(0, 20),
    },
    fleets,
    systems: snapshotSystems,
    logistics: {
      depots: depotSummaries,
      convoys: convoySummaries,
      routes: routeSummaries,
      tradeNexusSystemIds: activeEntries.filter(({ system }) => isTradeNexusSystem(system))
        .map(({ systemId }) => compactId(systemId)).filter(Boolean).sort().slice(0, 40),
      blockedLaneCount: Object.keys(logistics.blockedLanes ?? {}).length,
      stats: {
        deliveredCargo: round(nonnegative(logistics.stats?.deliveredCargo)),
        lostCargo: round(nonnegative(logistics.stats?.lostCargo)),
        creditsEarned: round(nonnegative(logistics.stats?.creditsEarned)),
      },
    },
    battles: battleEntries.slice(0, 24).map(([systemId, battle]) => ({
      systemId: compactId(systemId, 'system-redacted'),
      battleId: compactId(battle?.id),
      playerUnits: countBattleUnits(battle, 'player'),
      enemyUnits: countBattleUnits(battle, 'enemy'),
      objectiveCount: ownArray(battle?.objectives).length,
    })),
    truncation: {
      systemsOmitted: Math.max(0, activeEntries.length - MAX_SNAPSHOT_SYSTEMS),
      fleetsOmitted: Math.max(0, ownArray(state.battleGroups).length - MAX_SNAPSHOT_FLEETS),
      routesOmitted: Math.max(0, routes.length - MAX_SNAPSHOT_ROUTES),
    },
  };

  if (options.freeze !== false) return deepFreeze(snapshot);
  return snapshot;
}

export const buildSolGameSnapshot = buildRedactedSolSnapshot;

function error(path, code, message) {
  return { path, code, message };
}

function strictFields(value, allowed, path, errors) {
  if (!isPlainObject(value)) {
    errors.push(error(path, 'type', 'Expected an object'));
    return false;
  }
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) errors.push(error(`${path}.${key}`, 'forbidden_key', 'Forbidden object key'));
    else if (!allowed.includes(key)) errors.push(error(`${path}.${key}`, 'unknown_field', 'Unknown field'));
  }
  return true;
}

function validateString(value, path, errors, { min = 1, max = 1000, pattern = null } = {}) {
  if (typeof value !== 'string') {
    errors.push(error(path, 'type', 'Expected a string'));
    return;
  }
  if (value.length < min || value.length > max) errors.push(error(path, 'length', `Expected ${min}-${max} characters`));
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) errors.push(error(path, 'control_character', 'Control characters are not allowed'));
  if (pattern && !pattern.test(value)) errors.push(error(path, 'format', 'Invalid identifier format'));
}

function validateArguments(tool, args, path, errors) {
  const schema = SOL_TOOL_SCHEMAS[tool]?.parameters;
  if (!schema) {
    errors.push(error(path, 'unknown_tool', 'Unknown commander tool'));
    return;
  }
  const allowed = Object.keys(schema.properties);
  if (!strictFields(args, allowed, path, errors)) return;
  for (const required of schema.required) {
    if (!Object.hasOwn(args, required)) errors.push(error(`${path}.${required}`, 'required', 'Missing required field'));
  }
  for (const [key, value] of Object.entries(args)) {
    const property = schema.properties[key];
    if (!property) continue;
    if (typeof value !== 'string') {
      errors.push(error(`${path}.${key}`, 'type', 'Expected a string'));
      continue;
    }
    if (value.length < (property.minLength ?? 1) || value.length > (property.maxLength ?? 80)) {
      errors.push(error(`${path}.${key}`, 'length', 'Identifier is outside allowed length'));
    }
    if (property.enum && !property.enum.includes(value)) {
      errors.push(error(`${path}.${key}`, 'enum', 'Value is not in the allowed set'));
    }
  }

  if (tool === 'propose_fleet_order' && isPlainObject(args)) {
    const needs = (condition, key, message) => {
      if (condition && !args[key]) errors.push(error(`${path}.${key}`, 'required_for_order', message));
    };
    needs(args.order === 'formation', 'formation', 'Formation order requires formation');
    needs(['screen', 'protect', 'escort_convoy'].includes(args.order), 'targetId', `${args.order} requires targetId`);
    needs(args.order === 'attack_target_class', 'targetClass', 'Attack order requires targetClass');
    needs(['bombard', 'rally'].includes(args.order), 'targetSystemId', `${args.order} requires targetSystemId`);
  }
}

function validateRecommendation(recommendation, path, errors) {
  if (!strictFields(recommendation, RECOMMENDATION_FIELDS, path, errors)) return;
  for (const field of RECOMMENDATION_FIELDS) {
    if (!Object.hasOwn(recommendation, field)) errors.push(error(`${path}.${field}`, 'required', 'Missing required field'));
  }
  validateString(recommendation.id, `${path}.id`, errors, { max: 64, pattern: /^[A-Za-z0-9_-]+$/ });
  if (!SOL_TOOL_NAMES.includes(recommendation.tool)) {
    errors.push(error(`${path}.tool`, 'unknown_tool', 'Unknown or unsupported action'));
  }
  validateString(recommendation.title, `${path}.title`, errors, { max: 120 });
  validateString(recommendation.rationale, `${path}.rationale`, errors, { max: 1000 });
  if (typeof recommendation.confidence !== 'number' || !Number.isFinite(recommendation.confidence)
    || recommendation.confidence < 0 || recommendation.confidence > 1) {
    errors.push(error(`${path}.confidence`, 'range', 'Confidence must be a finite number from 0 to 1'));
  }
  validateArguments(recommendation.tool, recommendation.arguments, `${path}.arguments`, errors);
}

function safeCloneModelValue(value, path = '$', depth = 0) {
  if (depth > 16) throw new TypeError(`${path}: maximum nesting exceeded`);
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.map((item, index) => safeCloneModelValue(item, `${path}[${index}]`, depth + 1));
  if (!isPlainObject(value)) throw new TypeError(`${path}: non-plain object rejected`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const clone = {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (FORBIDDEN_KEYS.has(key)) throw new TypeError(`${path}.${key}: forbidden key`);
    if (!Object.hasOwn(descriptor, 'value')) throw new TypeError(`${path}.${key}: accessors rejected`);
    clone[key] = safeCloneModelValue(descriptor.value, `${path}.${key}`, depth + 1);
  }
  return clone;
}

export function validateSolCommanderResponse(candidate) {
  let value;
  try {
    value = safeCloneModelValue(candidate);
  } catch (cause) {
    return { ok: false, errors: [error('$', 'unsafe_object', cause.message)] };
  }
  const errors = [];
  if (!strictFields(value, RESPONSE_ROOT_FIELDS, '$', errors)) return { ok: false, errors };
  for (const field of RESPONSE_ROOT_FIELDS) {
    if (!Object.hasOwn(value, field)) errors.push(error(`$.${field}`, 'required', 'Missing required field'));
  }
  if (value.schemaVersion !== SOL_COMMANDER_SCHEMA_VERSION) {
    errors.push(error('$.schemaVersion', 'version', `Expected schema version ${SOL_COMMANDER_SCHEMA_VERSION}`));
  }
  validateString(value.summary, '$.summary', errors, { max: 1200 });
  if (!Array.isArray(value.recommendations) || value.recommendations.length < 1 || value.recommendations.length > 12) {
    errors.push(error('$.recommendations', 'length', 'Expected 1-12 recommendations'));
  } else {
    const ids = new Set();
    value.recommendations.forEach((recommendation, index) => {
      validateRecommendation(recommendation, `$.recommendations[${index}]`, errors);
      if (typeof recommendation?.id === 'string') {
        if (ids.has(recommendation.id)) errors.push(error(`$.recommendations[${index}].id`, 'duplicate', 'Recommendation id must be unique'));
        ids.add(recommendation.id);
      }
    });
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: deepFreeze(value) };
}

export function parseSolCommanderResponse(raw) {
  if (typeof raw !== 'string') return validateSolCommanderResponse(raw);
  if (new TextEncoder().encode(raw).length > MAX_RESPONSE_BYTES) {
    return { ok: false, errors: [error('$', 'too_large', 'Response exceeds 64 KiB')] };
  }
  let candidate;
  try {
    candidate = JSON.parse(raw);
  } catch {
    return { ok: false, errors: [error('$', 'invalid_json', 'Response must be one raw JSON object')] };
  }
  return validateSolCommanderResponse(candidate);
}

export function recommendationRequiresConfirmation(recommendation) {
  return SOL_COMMAND_TOOLS.includes(recommendation?.tool);
}

function findSystem(state, systemId) {
  return allSystemEntries(state).find((entry) => entry.systemId === systemId) ?? null;
}

function findFleet(state, fleetId) {
  return ownArray(state?.battleGroups).find((fleet) => fleet?.id === fleetId) ?? null;
}

function findConvoy(state, convoyId) {
  const { convoys } = logisticsContainers(state);
  return convoys.find((convoy) => convoy?.id === convoyId) ?? null;
}

function findProtectionTarget(state, targetId) {
  return ownArray(state?.playerShips).find((ship) => ship?.id === targetId)
    ?? findFleet(state, targetId)
    ?? findConvoy(state, targetId);
}

function relationAllowsTrade(state, owner) {
  if (!owner || owner === 'player' || owner === 'neutral') return true;
  const relation = state?.diplomacy?.relations?.[owner];
  const treaty = relation?.treaty ?? relation?.status;
  return ['trade', 'alliance', 'allied'].includes(treaty);
}

function routePath(state, galaxyId, fromSystemId, toSystemId) {
  const graph = graphForGalaxy(state, galaxyId);
  if (!graph || fromSystemId === toSystemId) return fromSystemId === toSystemId ? [fromSystemId] : null;
  const adjacency = new Map();
  for (const star of ownArray(graph.stars)) adjacency.set(star.id, []);
  for (const lane of ownArray(graph.lanes)) {
    const [a, b] = lane;
    if (!adjacency.has(a)) adjacency.set(a, []);
    if (!adjacency.has(b)) adjacency.set(b, []);
    adjacency.get(a).push(b);
    adjacency.get(b).push(a);
  }
  for (const neighbors of adjacency.values()) neighbors.sort();
  const queue = [fromSystemId];
  const previous = new Map([[fromSystemId, null]]);
  while (queue.length) {
    const current = queue.shift();
    if (current === toSystemId) break;
    for (const next of adjacency.get(current) ?? []) {
      const laneKey = [current, next].sort().join('::');
      if (state?.logistics?.blockedLanes?.[laneKey]) continue;
      if (previous.has(next)) continue;
      previous.set(next, current);
      queue.push(next);
    }
  }
  if (!previous.has(toSystemId)) return null;
  const path = [];
  for (let current = toSystemId; current != null; current = previous.get(current)) path.push(current);
  return path.reverse();
}

function commandFailure(code, reason, requiresConfirmation = false) {
  return { ok: false, code, reason, requiresConfirmation, executable: false };
}

/**
 * Second-stage, read-only validation against current game state. Call at
 * display time and again with stage:'execute' after explicit user confirmation.
 * A successful result is still only a command intent; this function never
 * applies it.
 */
export function validateSolCommand(state, recommendation, options = {}) {
  if (!isPlainObject(state)) return commandFailure('invalid_state', 'Game state is unavailable');
  const envelope = {
    schemaVersion: SOL_COMMANDER_SCHEMA_VERSION,
    summary: 'Validate one recommendation.',
    recommendations: [recommendation],
  };
  const checked = validateSolCommanderResponse(envelope);
  if (!checked.ok) return { ...commandFailure('invalid_recommendation', 'Recommendation failed schema validation'), errors: checked.errors };

  const clean = checked.value.recommendations[0];
  const args = clean.arguments;
  const requiresConfirmation = recommendationRequiresConfirmation(clean);
  const stage = options.stage ?? 'display';
  if (!['display', 'execute'].includes(stage)) return commandFailure('invalid_stage', 'Stage must be display or execute', requiresConfirmation);

  let validation = { ok: true };
  if (clean.tool === 'inspect_system' || clean.tool === 'explain_battle') {
    const entry = findSystem(state, args.systemId);
    if (!entry) validation = commandFailure('unknown_system', 'Target system does not exist');
    else if (clean.tool === 'explain_battle' && !state.systemBattles?.[args.systemId]
      && !ownArray(state.battleReports).some((report) => report?.systemId === args.systemId || report?.id === args.battleId)) {
      validation = commandFailure('unknown_battle', 'No live battle or report exists for this system');
    }
  } else if (clean.tool === 'inspect_logistics') {
    if (args.galaxyId && !state.galaxies?.[args.galaxyId] && args.galaxyId !== state.activeGalaxyId) {
      validation = commandFailure('unknown_galaxy', 'Requested galaxy does not exist');
    }
  } else if (clean.tool === 'propose_fleet_order') {
    const fleet = findFleet(state, args.fleetId);
    if (!fleet) validation = commandFailure('unknown_fleet', 'Fleet does not exist', true);
    else if (ownArray(fleet.shipIds).length === 0) validation = commandFailure('empty_fleet', 'Fleet has no assigned ships', true);
    else if (args.targetSystemId && !findSystem(state, args.targetSystemId)) validation = commandFailure('unknown_system', 'Target system does not exist', true);
    else if (args.order === 'escort_convoy' && !findConvoy(state, args.targetId)) validation = commandFailure('unknown_convoy', 'Convoy does not exist', true);
    else if (['screen', 'protect'].includes(args.order) && !findProtectionTarget(state, args.targetId)) {
      validation = commandFailure('unknown_target', 'Protection target does not exist', true);
    }
  } else if (clean.tool === 'propose_route') {
    const from = findSystem(state, args.fromSystemId);
    const to = findSystem(state, args.toSystemId);
    if (!from || !to) validation = commandFailure('unknown_system', 'Route endpoint does not exist', true);
    else if (from.system.owner !== 'player') validation = commandFailure('origin_not_owned', 'Route origin is not player-owned', true);
    else if (!isTradeNexusSystem(to.system)) validation = commandFailure('destination_not_nexus', 'Route destination is not a Trade Nexus', true);
    else if (!relationAllowsTrade(state, to.system.owner)) validation = commandFailure('destination_hostile', 'Trade Nexus is not allied or neutral', true);
    else if (from.galaxyId !== to.galaxyId) validation = commandFailure('cross_galaxy_route', 'Cargo routes must remain within one galaxy', true);
    else {
      const path = routePath(state, from.galaxyId, args.fromSystemId, args.toSystemId);
      if (!path || path.length < 2) validation = commandFailure('no_route', 'No unblocked lane route reaches the Trade Nexus', true);
      else validation.path = path;
    }
  } else if (clean.tool === 'propose_build') {
    const entry = findSystem(state, args.systemId);
    const policy = options.buildCatalog?.[args.structureType];
    if (!entry) validation = commandFailure('unknown_system', 'Build system does not exist', true);
    else if (entry.system.owner !== 'player') validation = commandFailure('system_not_owned', 'Build system is not player-owned', true);
    else if (!policy || !Number.isFinite(policy.cost) || policy.cost < 0) {
      validation = commandFailure('build_policy_required', 'Authoritative build policy is required', true);
    } else if (policy.tech && !ownArray(state.research?.unlocked).includes(policy.tech)) {
      validation = commandFailure('tech_locked', 'Required technology is not unlocked', true);
    } else if (state.credits < policy.cost) validation = commandFailure('insufficient_credits', 'Not enough credits for this build', true);
    else if (policy.requiresBody && !args.bodyId) validation = commandFailure('body_required', 'This structure requires a body target', true);
    else if (args.bodyId && !ownArray(entry.system.bodies).some((body) => body?.id === args.bodyId)) {
      validation = commandFailure('unknown_body', 'Build body does not exist', true);
    } else if (isTradeNexusSystem(entry.system) && policy.disallowOnTradeNexus) {
      validation = commandFailure('nexus_build_forbidden', 'This structure cannot be built at a Trade Nexus', true);
    } else validation.cost = policy.cost;
  }

  if (!validation.ok) return validation;
  if (stage === 'execute' && requiresConfirmation && options.confirmed !== true) {
    return commandFailure('confirmation_required', 'Explicit player confirmation is required', true);
  }

  return deepFreeze({
    ok: true,
    requiresConfirmation,
    executable: stage === 'execute',
    command: { tool: clean.tool, arguments: { ...args } },
    ...(validation.path ? { path: [...validation.path] } : {}),
    ...(Number.isFinite(validation.cost) ? { cost: validation.cost } : {}),
  });
}

export const validateSolRecommendationForState = validateSolCommand;

function makeRecommendation(index, tool, title, rationale, confidence, args) {
  return {
    id: `offline-${String(index).padStart(3, '0')}`,
    tool,
    title,
    rationale,
    confidence,
    arguments: args,
  };
}

/** Deterministic, network-free advisor using the same response contract as Sol. */
export function createOfflineSolAdvice(stateOrSnapshot, options = {}) {
  const snapshot = stateOrSnapshot?.snapshotVersion === SOL_SNAPSHOT_VERSION
    ? safeCloneModelValue(stateOrSnapshot)
    : buildRedactedSolSnapshot(stateOrSnapshot, { freeze: false });
  const maxRecommendations = Math.max(1, Math.min(12, integer(options.maxRecommendations, 6)));
  const recommendations = [];
  const add = (tool, title, rationale, confidence, args) => {
    if (recommendations.length >= maxRecommendations) return;
    recommendations.push(makeRecommendation(recommendations.length + 1, tool, title, rationale, confidence, args));
  };

  add(
    'inspect_empire',
    'Review empire readiness',
    `Compare ${snapshot.empire.ownedSystemCount} controlled systems, ${snapshot.empire.shipCount} ships, and current reserves before committing resources.`,
    1,
    {},
  );

  if (snapshot.logistics.routes.length > 0 || snapshot.logistics.depots.length > 0 || snapshot.logistics.tradeNexusSystemIds.length > 0) {
    add(
      'inspect_logistics',
      'Audit physical trade flow',
      `${snapshot.logistics.convoys.length} active or retained convoys and ${snapshot.logistics.routes.length} routes should be checked for pauses and cargo loss.`,
      0.98,
      { galaxyId: snapshot.activeGalaxyId },
    );
  }

  for (const battle of snapshot.battles) {
    add(
      'explain_battle',
      'Review the active engagement',
      `The engagement reports ${battle.playerUnits} friendly and ${battle.enemyUnits} hostile units; inspect objectives before issuing orders.`,
      0.96,
      { systemId: battle.systemId, ...(battle.battleId ? { battleId: battle.battleId } : {}) },
    );
    break;
  }

  const readyFleet = snapshot.fleets.find((fleet) => fleet.shipCount > 0 && fleet.readyShipCount > 0);
  if (readyFleet) {
    add(
      'propose_fleet_order',
      'Hold a ready reserve',
      'A ready fleet can protect logistics while preserving the player’s freedom to choose a target.',
      0.82,
      { fleetId: readyFleet.id, order: 'hold' },
    );
  }

  const activeSystemIds = new Set(snapshot.systems.map((system) => system.id));
  const routeOrigin = snapshot.logistics.depots.find((depot) => depot.systemId
    && activeSystemIds.has(depot.systemId) && cargoTotal(depot.cargo) > 0)?.systemId;
  const routeDestination = snapshot.logistics.tradeNexusSystemIds.find((id) => id !== routeOrigin);
  if (routeOrigin && routeDestination) {
    add(
      'propose_route',
      'Connect stored cargo to a Trade Nexus',
      'A depot holds cargo and a Trade Nexus is available; authoritative route validation must choose an unblocked shortest path.',
      0.88,
      { fromSystemId: routeOrigin, toSystemId: routeDestination },
    );
  }

  const undeveloped = snapshot.systems.find((system) => system.owner === 'player'
    && system.kind !== 'trade_nexus' && !system.structureTypes.includes('export_depot'));
  if (undeveloped) {
    add(
      'propose_build',
      'Evaluate an export depot',
      'This controlled stellar system has no export depot in the redacted snapshot; cost and placement still require authoritative game validation.',
      0.74,
      { systemId: undeveloped.id, structureType: 'export_depot' },
    );
  }

  const response = {
    schemaVersion: SOL_COMMANDER_SCHEMA_VERSION,
    summary: snapshot.battles.length
      ? 'Offline analysis prioritizes the live battle, logistics continuity, and a confirmed fleet posture.'
      : 'Offline analysis prioritizes empire readiness, logistics continuity, and reversible confirmed orders.',
    recommendations,
  };
  const checked = validateSolCommanderResponse(response);
  if (!checked.ok) throw new Error(`Offline advisor generated invalid output: ${checked.errors[0]?.message}`);
  return checked.value;
}

export const deterministicOfflineAdvisor = createOfflineSolAdvice;

function validateSettings(settings) {
  const errors = [];
  if (!strictFields(settings, SETTINGS_FIELDS, '$.settings', errors)) return errors;
  if (typeof settings.enabled !== 'boolean') errors.push(error('$.settings.enabled', 'type', 'Expected boolean'));
  if (!['offline', 'sol'].includes(settings.providerMode)) errors.push(error('$.settings.providerMode', 'enum', 'Expected offline or sol'));
  validateString(settings.model, '$.settings.model', errors, { max: 80 });
  if (typeof settings.confirmationRequired !== 'boolean') errors.push(error('$.settings.confirmationRequired', 'type', 'Expected boolean'));
  if (typeof settings.previewData !== 'boolean') errors.push(error('$.settings.previewData', 'type', 'Expected boolean'));
  if (!Number.isInteger(settings.requestLimitPerHour) || settings.requestLimitPerHour < 1 || settings.requestLimitPerHour > 120) {
    errors.push(error('$.settings.requestLimitPerHour', 'range', 'Expected an integer from 1 to 120'));
  }
  if (typeof settings.spendingCapUsd !== 'number' || !Number.isFinite(settings.spendingCapUsd)
    || settings.spendingCapUsd < 0 || settings.spendingCapUsd > 1000) {
    errors.push(error('$.settings.spendingCapUsd', 'range', 'Expected a value from 0 to 1000'));
  }
  return errors;
}

export function createSolCommanderState(settings = {}) {
  const merged = { ...DEFAULT_SOL_COMMANDER_SETTINGS, ...safeCloneModelValue(settings) };
  const errors = validateSettings(merged);
  if (errors.length) throw new TypeError(errors[0].message);
  return deepFreeze({ version: 1, settings: merged, history: [] });
}

export function updateSolCommanderSettings(commanderState, patch) {
  const current = isPlainObject(commanderState?.settings)
    ? commanderState.settings
    : DEFAULT_SOL_COMMANDER_SETTINGS;
  const nextPatch = safeCloneModelValue(patch);
  for (const key of Object.keys(nextPatch)) {
    if (!SETTINGS_FIELDS.includes(key)) throw new TypeError(`Unknown Sol setting: ${key}`);
  }
  const settings = { ...current, ...nextPatch };
  const errors = validateSettings(settings);
  if (errors.length) throw new TypeError(errors[0].message);
  return deepFreeze({
    version: 1,
    settings,
    history: ownArray(commanderState?.history).map((entry) => ({ ...entry })),
  });
}

export function appendSolConversationEntry(commanderState, entry) {
  const clean = safeCloneModelValue(entry);
  const allowed = ['id', 'role', 'text', 'gameTimeMs'];
  const errors = [];
  strictFields(clean, allowed, '$.entry', errors);
  for (const field of allowed) if (!Object.hasOwn(clean, field)) errors.push(error(`$.entry.${field}`, 'required', 'Missing field'));
  validateString(clean.id, '$.entry.id', errors, { max: 64, pattern: /^[A-Za-z0-9_-]+$/ });
  if (!['user', 'advisor'].includes(clean.role)) errors.push(error('$.entry.role', 'enum', 'Role must be user or advisor'));
  validateString(clean.text, '$.entry.text', errors, { max: 4000 });
  if (!Number.isFinite(clean.gameTimeMs) || clean.gameTimeMs < 0) errors.push(error('$.entry.gameTimeMs', 'range', 'Invalid game time'));
  if (errors.length) throw new TypeError(errors[0].message);
  const base = isPlainObject(commanderState) ? commanderState : createSolCommanderState();
  const history = [...ownArray(base.history), clean].slice(-MAX_HISTORY_ENTRIES);
  return deepFreeze({ version: 1, settings: { ...(base.settings ?? DEFAULT_SOL_COMMANDER_SETTINGS) }, history });
}

export function deleteSolConversationHistory(commanderState) {
  const base = isPlainObject(commanderState) ? commanderState : createSolCommanderState();
  return deepFreeze({ version: 1, settings: { ...(base.settings ?? DEFAULT_SOL_COMMANDER_SETTINGS) }, history: [] });
}

export const clearSolConversationHistory = deleteSolConversationHistory;

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Build correlation data for IPC without copying snapshot contents or secrets. */
export function buildSolRequestMetadata({ snapshot, requestId, mode = 'offline', model = SOL_MODEL_ID } = {}) {
  if (!isPlainObject(snapshot) || snapshot.snapshotVersion !== SOL_SNAPSHOT_VERSION) {
    throw new TypeError('A redacted Sol snapshot is required');
  }
  const serialized = stableStringify(snapshot);
  return deepFreeze({
    requestId: compactId(requestId, `sol-${fnv1a(serialized)}`),
    mode: mode === 'sol' ? 'sol' : 'offline',
    model: compactId(model, SOL_MODEL_ID),
    schemaVersion: SOL_COMMANDER_SCHEMA_VERSION,
    snapshotVersion: SOL_SNAPSHOT_VERSION,
    snapshotHash: fnv1a(serialized),
    snapshotBytes: new TextEncoder().encode(serialized).length,
    gameTimeMs: integer(snapshot.gameTimeMs),
  });
}
