#!/usr/bin/env node

/**
 * Deterministic solo end-to-end progression and performance verifier.
 *
 * This harness intentionally progresses research and production through the
 * same public browser commands used by the game. It grants credits and advances
 * simulation time to remove waiting, but it does not bypass research
 * prerequisites or manufacture player fleet state.
 *
 * Examples:
 *   node scripts/verify-solo-ete-performance.mjs --mode quick
 *   node scripts/verify-solo-ete-performance.mjs --mode full --headed
 *   node scripts/verify-solo-ete-performance.mjs --mode full \
 *     --checkpoint-source output/solo-ete-performance/after-quick/results.json
 *   node scripts/verify-solo-ete-performance.mjs --url http://127.0.0.1:5174/
 */

import { createRequire } from 'node:module';
import { createWriteStream } from 'node:fs';
import {
  mkdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import {
  CAMERA_DEFAULT_ZOOM,
  HULL_STATS,
  SHIPYARD_COMBAT_HULLS,
  STAR_GL_QUALITY,
  STRUCTURE_BUILD_MS,
} from '../src/js/constants.js';
import { allTechNodes } from '../src/js/tech-web.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_URL = 'http://127.0.0.1:5173/';
// Seed 54 keeps the first pirate nests far enough from the Stronghold for the
// normal outpost -> shipyard -> first-fleet opening to complete deterministically.
const DEFAULT_SEED = 54;
const EXPECTED_TECH_COUNT = 136;
const PLAYER_FLEET_SIZE = 32;
const FLEET_CAPACITY = 8;
const REQUIRED_FLEETS = PLAYER_FLEET_SIZE / FLEET_CAPACITY;
const CREDIT_GRANT = 250_000_000;
const SAVE_SLOT = 'slot-1';
const REQUIRED_DYSON_SHELLS = 8;
const SIMULATION_CHUNK_MS = 5 * 60_000;
const CLAIM_TARGET_IDS = ['sys-103', 'sys-310'];

const CHECKPOINT_TECH_COUNTS = new Set([34, 68, 102]);
const REQUIRED_CHECKPOINT_IDS = [
  'new-game',
  'first-corvette',
  'first-eight-ship-fleet',
  'first-dyson',
  'tech-034',
  'tech-068',
  'tech-102',
  'third-dyson',
  'final',
];
const FLEET_HULLS = [...SHIPYARD_COMBAT_HULLS];
const FILLER_HULLS = [
  'corvette',
  'frigate',
  'destroyer',
  'cruiser',
  'battleship',
  'light_carrier',
  'command_cruiser',
];
const HELIOCLAST_PART_ORDER = [
  'frame',
  'power',
  'focus',
  'containment',
  'gate_cap',
  'create',
  'destroy',
  'jump',
  'sovereign_relay',
];

const MODE_DEFAULTS = Object.freeze({
  quick: {
    warmupMs: 500,
    sampleMs: 1_200,
    samples: 1,
    inputSamples: 5,
    simulationSteps: 24,
    cpuProfileMs: 1_000,
    captureProfiles: false,
  },
  full: {
    warmupMs: 5_000,
    sampleMs: 15_000,
    samples: 3,
    inputSamples: 20,
    simulationSteps: 120,
    cpuProfileMs: 5_000,
    captureProfiles: true,
  },
});

class CapabilityBlocked extends Error {
  constructor(message, detail = null) {
    super(message);
    this.name = 'CapabilityBlocked';
    this.detail = detail;
  }
}

function parseBoolean(value, fallback = false) {
  if (value == null) return fallback;
  if (typeof value === 'boolean') return value;
  return !['0', 'false', 'no', 'off'].includes(String(value).toLowerCase());
}

function parseArgs(argv) {
  const raw = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      if (!raw.url) raw.url = token;
      continue;
    }
    const [flag, inlineValue] = token.slice(2).split('=', 2);
    const next = inlineValue ?? (
      argv[index + 1] && !argv[index + 1].startsWith('--')
        ? argv[++index]
        : true
    );
    raw[flag] = next;
  }

  if (raw.help || raw.h) {
    console.log([
      'Solo ETE performance verifier',
      '',
      'Options:',
      '  --url <url>             Game URL (default http://127.0.0.1:5173/)',
      '  --mode <quick|full>      Sampling preset (default full)',
      '  --seed <integer>         Deterministic new-game seed',
      '  --headed                 Launch visible Chromium',
      '  --profiles <bool>        Capture CPU and heap profiles',
      '  --warmup-ms <integer>    Per-scene warm-up',
      '  --sample-ms <integer>    Per-sample frame window',
      '  --samples <integer>      Samples per scene',
      '  --input-samples <integer> Real input-to-paint samples per scene',
      '  --output-dir <path>      Artifact directory',
      '  --checkpoint-source <results.json>',
      '                           Re-profile validated legal checkpoint saves',
      '  --allow-partial          Exit successfully when a hook capability blocks',
    ].join('\n'));
    process.exit(0);
  }

  const mode = raw.mode === 'quick' ? 'quick' : 'full';
  const preset = MODE_DEFAULTS[mode];
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  return {
    url: String(raw.url ?? DEFAULT_URL),
    mode,
    seed: Number.isFinite(Number(raw.seed)) ? Number(raw.seed) : DEFAULT_SEED,
    headless: !parseBoolean(raw.headed, false),
    warmupMs: Math.max(0, Number(raw['warmup-ms'] ?? preset.warmupMs)),
    sampleMs: Math.max(250, Number(raw['sample-ms'] ?? preset.sampleMs)),
    samples: Math.max(1, Math.floor(Number(raw.samples ?? preset.samples))),
    inputSamples: Math.max(
      3,
      Math.floor(Number(raw['input-samples'] ?? preset.inputSamples)),
    ),
    simulationSteps: Math.max(1, Math.floor(Number(raw['simulation-steps'] ?? preset.simulationSteps))),
    cpuProfileMs: Math.max(250, Number(raw['cpu-profile-ms'] ?? preset.cpuProfileMs)),
    captureProfiles: parseBoolean(raw.profiles, preset.captureProfiles),
    allowPartial: parseBoolean(raw['allow-partial'], false),
    checkpointSource: raw['checkpoint-source']
      ? path.resolve(ROOT, String(raw['checkpoint-source']))
      : null,
    outputDir: path.resolve(
      ROOT,
      String(raw['output-dir'] ?? path.join('output', 'solo-ete-performance', stamp)),
    ),
  };
}

function loadChromium() {
  const projectRequire = createRequire(path.join(ROOT, 'package.json'));
  try {
    return projectRequire('playwright').chromium;
  } catch (projectError) {
    try {
      const skillRequire = createRequire(path.join(
        homedir(),
        '.codex/skills/develop-web-game/scripts/web_game_playwright_client.js',
      ));
      return skillRequire('playwright').chromium;
    } catch (skillError) {
      throw new Error(
        `Playwright is unavailable. Project: ${projectError.message}; skill fallback: ${skillError.message}`,
      );
    }
  }
}

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const power = 10 ** digits;
  return Math.round(value * power) / power;
}

function percentile(values, fraction) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

function median(values) {
  return percentile(values, 0.5);
}

function sanitizeName(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function stableTechOrder(nodes) {
  const remaining = new Map(nodes.map((node) => [node.id, node]));
  const ordered = [];
  const emitted = new Set();
  while (remaining.size > 0) {
    const ready = [...remaining.values()]
      .filter((node) => (node.prereqs ?? []).every((id) => emitted.has(id)))
      .sort((a, b) => (
        finite(a.spineIndex, -1) - finite(b.spineIndex, -1)
        || String(a.cluster).localeCompare(String(b.cluster))
        || String(a.id).localeCompare(String(b.id))
      ));
    if (ready.length === 0) {
      throw new Error(`Technology graph is cyclic or has missing prerequisites: ${[...remaining.keys()].join(', ')}`);
    }
    for (const node of ready) {
      remaining.delete(node.id);
      emitted.add(node.id);
      ordered.push(node);
    }
  }
  return ordered;
}

function techMetadata(node) {
  return {
    id: node.id,
    prereqs: [...(node.prereqs ?? [])],
    milestones: [...(node.milestones ?? [])],
    creditCost: finite(node.creditCost),
    solariiCost: finite(node.solariiCost),
    researchMs: finite(node.researchMs),
  };
}

const TECH_NODES = stableTechOrder(allTechNodes()).map(techMetadata);
const TECH_BY_ID = new Map(TECH_NODES.map((node) => [node.id, node]));

function createRunReport(config) {
  const renderAcceptanceProfile = config.headless
    ? 'headless-relative-regression'
    : 'headed-player-visible';
  return {
    schemaVersion: 2,
    createdAt: new Date().toISOString(),
    config: {
      ...config,
      outputDir: config.outputDir,
    },
    metadata: {
      expectedTechCount: EXPECTED_TECH_COUNT,
      discoveredTechCount: TECH_NODES.length,
      producibleHullCount: FLEET_HULLS.length + 1,
      playerFleetHullCount: FLEET_HULLS.length,
      requiredFleetShips: PLAYER_FLEET_SIZE,
      requiredFleets: REQUIRED_FLEETS,
      fleetCapacity: FLEET_CAPACITY,
    },
    capabilities: null,
    measurementEnvironment: {
      browserMode: config.headless ? 'headless' : 'headed',
      renderAcceptanceProfile,
      playerVisibleRequirementsEvaluated: !config.headless,
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      reducedMotion: 'no-preference',
      graphics: {
        starGlQuality: STAR_GL_QUALITY,
      },
      renderer: null,
      softwareRendererDetected: null,
      limitations: config.headless
        ? [
          'Headless rendering is used for deterministic relative regression coverage.',
          'Absolute input-to-paint and repeating-long-task requirements require the headed player-visible run.',
        ]
        : [],
    },
    checkpointReplay: null,
    checkpoints: [],
    researchSequence: [],
    progressionEvents: [],
    todo: [],
    errors: {
      console: [],
      page: [],
      requests: [],
      environment: [],
      fatal: null,
    },
    network: {
      requests: [],
      summary: null,
      backendCorrelation: null,
    },
    profiles: [],
    acceptance: {
      checks: [],
      passed: false,
      partial: false,
      renderAcceptanceProfile,
      playerVisibleRequirementsEvaluated: !config.headless,
    },
  };
}

function isOptionalLocalSessionUrl(value) {
  try {
    const url = new URL(value);
    return ['127.0.0.1', 'localhost'].includes(url.hostname)
      && url.pathname === '/api/v1/session';
  } catch {
    return false;
  }
}

function isBackendRuntimeRequest(entry) {
  if (!entry?.url || isOptionalLocalSessionUrl(entry.url)) return false;
  if (!['fetch', 'xhr', 'websocket', 'eventsource'].includes(entry.resourceType)) return false;
  try {
    const url = new URL(entry.url);
    return /^\/(?:api|events|coop|ws)(?:\/|$)/.test(url.pathname);
  } catch {
    return false;
  }
}

const harnessClosingPages = new WeakSet();
let activeCheckpointIdentity = null;

function attachDiagnostics(page, report, networkInflight) {
  const pageRequests = new Set();
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const location = message.location();
    const record = {
      at: new Date().toISOString(),
      url: page.url(),
      sourceUrl: location?.url ?? null,
      text: message.text(),
    };
    if (isOptionalLocalSessionUrl(record.sourceUrl)) report.errors.environment.push(record);
    else report.errors.console.push(record);
  });
  page.on('pageerror', (error) => {
    report.errors.page.push({
      at: new Date().toISOString(),
      url: page.url(),
      text: String(error?.stack ?? error),
    });
  });
  page.on('request', (request) => {
    pageRequests.add(request);
    networkInflight.set(request, {
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      startedAt: Date.now(),
    });
  });
  page.on('requestfinished', (request) => {
    pageRequests.delete(request);
    const entry = networkInflight.get(request);
    if (!entry) return;
    networkInflight.delete(request);
    report.network.requests.push({
      ...entry,
      finishedAt: Date.now(),
      durationMs: Date.now() - entry.startedAt,
      failed: false,
    });
  });
  page.on('requestfailed', (request) => {
    pageRequests.delete(request);
    const entry = networkInflight.get(request) ?? {
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      startedAt: Date.now(),
    };
    networkInflight.delete(request);
    const finishedAt = Date.now();
    const failure = request.failure()?.errorText ?? 'request failed';
    const record = {
      ...entry,
      finishedAt,
      durationMs: finishedAt - entry.startedAt,
      failed: true,
      failure,
    };
    report.network.requests.push(record);
    const harnessCloseAbort = harnessClosingPages.has(page)
      && failure === 'net::ERR_ABORTED';
    if (isOptionalLocalSessionUrl(record.url) || harnessCloseAbort) {
      report.errors.environment.push({
        ...record,
        classification: harnessCloseAbort
          ? 'harness-page-close'
          : 'optional-local-session',
      });
    }
    else report.errors.requests.push(record);
  });
  page.on('close', () => {
    // Media requests can remain pending until a short-lived checkpoint clone
    // closes. They cannot overlap later scenes, so do not leave them in the
    // shared in-flight map and fabricate multi-minute request durations.
    for (const request of pageRequests) networkInflight.delete(request);
    pageRequests.clear();
  });
}

async function browserCapabilities(page) {
  return page.evaluate(() => {
    const required = [
      '__newGame',
      '__grantCredits',
      '__devAction',
      '__startResearch',
      '__getTechWeb',
      '__buildShipyard',
      '__queueHull',
      '__enqueueHull',
      '__createBattleGroup',
      '__autoAssignShipsToFleets',
      '__setBattleGroupFlagshipAnchor',
      '__syncFlagshipAnchoredFleets',
      '__saveSlot',
      '__loadSlot',
      '__setView',
      '__viewSystem',
      '__orderTravel',
      '__orderBattleGroup',
      '__buildFoundry',
      '__buildLauncher',
      '__buildSuperweaponCradle',
      '__installSuperweaponPart',
      '__getGameState',
      'render_game_to_text',
      'advanceTime',
    ];
    const optional = [
      '__orderScout',
      '__selectScout',
      '__selectBattleGroup',
      '__deployBuilderDrone',
      '__canDeployBuilderDrone',
      '__spawnEnemyFleet',
      '__getBattleState',
      '__galaxyPerfSummary',
      '__fps',
    ];
    const typeByName = Object.fromEntries(
      [...required, ...optional].map((name) => [name, typeof window[name]]),
    );
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    const debugInfo = gl?.getExtension('WEBGL_debug_renderer_info') ?? null;
    const renderer = gl
      ? gl.getParameter(debugInfo?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER)
      : null;
    const vendor = gl
      ? gl.getParameter(debugInfo?.UNMASKED_VENDOR_WEBGL ?? gl.VENDOR)
      : null;
    const rendererSignature = `${vendor ?? ''} ${renderer ?? ''}`.trim();
    return {
      required,
      optional,
      typeByName,
      missingRequired: required.filter((name) => typeof window[name] !== 'function'),
      missingOptional: optional.filter((name) => typeof window[name] !== 'function'),
      environment: {
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        webdriver: navigator.webdriver,
        visibilityState: document.visibilityState,
        hardwareConcurrency: navigator.hardwareConcurrency ?? null,
        deviceMemoryGiB: navigator.deviceMemory ?? null,
        webgl: {
          available: !!gl,
          vendor,
          renderer,
        },
        softwareRendererDetected: /swiftshader|llvmpipe|software rasterizer/i.test(
          rendererSignature,
        ),
      },
    };
  });
}

async function textState(page) {
  const raw = await page.evaluate(() => window.render_game_to_text());
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new CapabilityBlocked('render_game_to_text returned invalid JSON', {
      error: String(error),
      prefix: String(raw).slice(0, 300),
    });
  }
}

async function checkpointStateIdentity(page, { includeCanonical = false } = {}) {
  return page.evaluate((withCanonical) => {
    const state = window.__getGameState();
    const sortById = (values) => [...(values ?? [])]
      .sort((a, b) => String(a?.id ?? '').localeCompare(String(b?.id ?? '')));
    const transit = (value) => value ? {
      fromId: value.fromId ?? value.from ?? null,
      toId: value.toId ?? value.to ?? value.destId ?? null,
      startTime: value.startTime ?? value.startedAt ?? null,
      durationMs: value.durationMs ?? null,
    } : null;
    const ship = (value) => ({
      id: value.id,
      hull: value.hull,
      factionId: value.factionId ?? null,
      galaxyId: value.galaxyId ?? null,
      systemId: value.systemId ?? null,
      hp: value.hp ?? null,
      maxHp: value.maxHp ?? null,
      transit: transit(value.transit),
    });
    const systems = Object.entries(state.galaxies ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .flatMap(([galaxyId, galaxy]) => Object.values(galaxy?.systems ?? {})
        .sort((a, b) => String(a.id).localeCompare(String(b.id)))
        .map((system) => ({
          galaxyId,
          id: system.id,
          owner: system.owner ?? null,
          ownerFactionId: system.ownerFactionId ?? system.factionId ?? null,
          dyson: system.dyson ? {
            completedShells: system.dyson.completedShells ?? 0,
            shellSails: system.dyson.shellSails ?? 0,
          } : null,
          structures: sortById(system.structures).map((structure) => ({
            id: structure.id,
            type: structure.type,
            bodyId: structure.bodyId ?? null,
            hp: structure.hp ?? null,
            operational: structure.operational !== false && (structure.hp ?? 1) > 0,
            constructionJobId: structure.construction?.jobId ?? null,
            builds: (structure.builds ?? (structure.build ? [structure.build] : []))
              .map((build) => ({
                id: build.id ?? null,
                hull: build.hull ?? null,
                startedAt: build.startedAt ?? null,
                durationMs: build.durationMs ?? null,
                queueItemId: build.queueItemId ?? null,
              })),
          })),
        })));
    const convoys = sortById(state.logistics?.convoys).map((convoy) => ({
      id: convoy.id,
      ownerId: convoy.ownerId ?? null,
      status: convoy.status ?? null,
      fromSystemId: convoy.fromSystemId ?? null,
      destinationSystemId: convoy.destinationSystemId ?? null,
      path: [...(convoy.path ?? [])],
      creditLoad: convoy.creditLoad ?? 0,
      transit: transit(convoy.transit),
    }));
    const pirateFleets = sortById(state.pirates?.fleets).map((fleet) => ({
      id: fleet.id,
      galaxyId: fleet.galaxyId ?? null,
      systemId: fleet.systemId ?? null,
      transit: transit(fleet.transit),
      ships: sortById(fleet.ships).map(ship),
    }));
    const meaningful = {
      seed: state.meta?.seed ?? state.seed ?? null,
      time: state.time,
      paused: !!state.paused,
      activeGalaxyId: state.activeGalaxyId,
      stronghold: state.stronghold,
      credits: state.credits,
      solarii: state.solarii ?? 0,
      research: {
        unlocked: [...(state.research?.unlocked ?? [])].sort(),
        activeNodeId: state.research?.activeNodeId ?? null,
        queue: (state.research?.queue ?? []).map((entry) => entry.id ?? entry.nodeId ?? entry),
      },
      flagships: sortById(
        state.playerFlagships?.length ? state.playerFlagships : [state.flagship],
      ).map((flagship) => ({
        pilotId: flagship.pilotId ?? null,
        galaxyId: flagship.galaxyId ?? null,
        systemId: flagship.systemId ?? null,
        hp: flagship.hp ?? null,
        maxHp: flagship.maxHp ?? null,
        transit: transit(flagship.transit),
        wormholeTransit: transit(flagship.wormholeTransit),
      })),
      scouts: sortById(state.scouts).map(ship),
      playerShips: sortById(state.playerShips).map(ship),
      aiShips: sortById(state.aiShips).map(ship),
      battleGroups: sortById(state.battleGroups).map((group) => ({
        id: group.id,
        ordinal: group.ordinal ?? null,
        shipIds: [...(group.shipIds ?? [])].sort(),
        anchorFlagship: !!group.anchorFlagship,
        anchorHeroId: group.anchorHeroId ?? null,
      })),
      pirateFleets,
      pirateNests: sortById(state.pirates?.nests).map((nest) => ({
        id: nest.id,
        galaxyId: nest.galaxyId ?? null,
        systemId: nest.systemId ?? null,
        hp: nest.hp ?? null,
        maxHp: nest.maxHp ?? null,
        destroyed: !!nest.destroyed,
        lootVault: nest.lootVault ?? 0,
      })),
      systems,
      convoys,
      factions: state.factions ? {
        ...state.factions,
        list: (state.factions.list ?? []).map((faction) => ({
          ...faction,
          productionQueue: faction.productionQueue ?? [],
        })),
      } : null,
      diplomacy: state.diplomacy ? {
        ...state.diplomacy,
        sanctions: state.diplomacy.sanctions ?? [],
      } : null,
      strategicOrders: state.strategicOrders ?? null,
      bulkProduction: state.bulkProduction ?? null,
      milestones: state.milestones ?? null,
      constructionJobs: sortById(state.constructionJobs).map((job) => ({
        id: job.id,
        systemId: job.systemId ?? null,
        structureId: job.structureId ?? null,
        structureType: job.structureType ?? null,
        status: job.status ?? null,
        workDoneMs: job.workDoneMs ?? null,
        workRequiredMs: job.workRequiredMs ?? null,
      })),
      empireQueue: (state.empireQueue ?? []).map((entry) => ({
        id: entry.id,
        kind: entry.kind ?? null,
        productId: entry.productId ?? entry.hull ?? null,
        status: entry.status ?? null,
        shipyardId: entry.shipyardId ?? null,
      })),
      superweapon: state.superweapon ? {
        online: !!state.superweapon.online,
        liveFireComplete: !!state.superweapon.liveFireComplete,
        cradleSystemId: state.superweapon.cradleSystemId ?? null,
        installedParts: Object.entries(state.superweapon.installedParts ?? {})
          .sort(([a], [b]) => a.localeCompare(b)),
        buildJob: state.superweapon.buildJob ? {
          partId: state.superweapon.buildJob.partId ?? null,
          startedAt: state.superweapon.buildJob.startedAt ?? null,
          durationMs: state.superweapon.buildJob.durationMs ?? null,
        } : null,
        ship: state.superweapon.ship ? {
          id: state.superweapon.ship.id ?? null,
          hull: state.superweapon.ship.hull ?? null,
          galaxyId: state.superweapon.ship.galaxyId ?? null,
          systemId: state.superweapon.ship.systemId ?? null,
          hp: state.superweapon.ship.hp ?? null,
          maxHp: state.superweapon.ship.maxHp ?? null,
          fleetMode: state.superweapon.ship.fleetMode ?? null,
          battleGroupId: state.superweapon.ship.battleGroupId ?? null,
          transit: transit(state.superweapon.ship.transit),
        } : null,
      } : null,
    };
    const canonicalize = (value) => {
      if (Array.isArray(value)) return value.map(canonicalize);
      if (!value || typeof value !== 'object') return value;
      return Object.fromEntries(
        Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
      );
    };
    const serialized = JSON.stringify(canonicalize(meaningful));
    let fnv = 2166136261;
    let djb = 5381;
    for (let index = 0; index < serialized.length; index += 1) {
      const code = serialized.charCodeAt(index);
      fnv = Math.imul(fnv ^ code, 16777619);
      djb = Math.imul(djb, 33) ^ code;
    }
    return {
      schemaVersion: 1,
      hash: `${(fnv >>> 0).toString(16).padStart(8, '0')}-${(djb >>> 0).toString(16).padStart(8, '0')}`,
      serializedChars: serialized.length,
      time: state.time,
      paused: !!state.paused,
      techUnlocked: state.research?.unlocked?.length ?? 0,
      playerShips: state.playerShips?.length ?? 0,
      aiShips: state.aiShips?.length ?? 0,
      convoys: state.logistics?.convoys?.length ?? 0,
      systems: systems.length,
      ...(withCanonical ? { canonical: serialized } : {}),
    };
  }, includeCanonical);
}

function firstIdentityDifferences(expectedCanonical, actualCanonical, limit = 12) {
  const differences = [];
  const visit = (expected, actual, pathLabel) => {
    if (differences.length >= limit || Object.is(expected, actual)) return;
    if (expected == null || actual == null
        || typeof expected !== 'object' || typeof actual !== 'object') {
      differences.push({ path: pathLabel, expected, actual });
      return;
    }
    if (Array.isArray(expected) !== Array.isArray(actual)) {
      differences.push({ path: pathLabel, expectedType: typeof expected, actualType: typeof actual });
      return;
    }
    const keys = [...new Set([
      ...Object.keys(expected),
      ...Object.keys(actual),
    ])].sort();
    for (const key of keys) {
      visit(expected[key], actual[key], pathLabel ? `${pathLabel}.${key}` : key);
      if (differences.length >= limit) break;
    }
  };
  visit(JSON.parse(expectedCanonical), JSON.parse(actualCanonical), '');
  return differences;
}

async function grantCredits(page, amount = CREDIT_GRANT) {
  return page.evaluate((credits) => window.__grantCredits(credits), amount);
}

async function advanceTime(page, ms) {
  const startedAt = performance.now();
  const result = await page.evaluate((duration) => window.advanceTime(duration), ms);
  return {
    result,
    wallMs: performance.now() - startedAt,
    simulatedMs: ms,
  };
}

async function switchToSystem(page, systemId = null) {
  await page.evaluate((target) => {
    if (target) window.__viewSystem(target);
    else window.__setView('system');
  }, systemId);
  await page.waitForTimeout(100);
}

async function standardizeSystemScene(page, systemId = null) {
  const targetSystemId = await page.evaluate(({ target, zoom }) => {
    const state = window.__getGameState();
    const resolved = target ?? state.stronghold ?? state.flagship?.systemId ?? null;
    if (resolved) window.__viewSystem(resolved);
    else window.__setView('system');
    window.__snapCamera?.(0, 0, zoom);
    return resolved;
  }, { target: systemId, zoom: CAMERA_DEFAULT_ZOOM });
  await page.waitForTimeout(100);
  return targetSystemId;
}

async function setPausedThroughUi(page, desired) {
  const current = (await textState(page)).paused;
  if (current === desired) return { ok: true, paused: current, changed: false };
  const button = page.locator('#pause-btn');
  if (await button.count() === 0) {
    return { ok: false, reason: 'pause button unavailable', paused: current };
  }
  await button.click({ force: true });
  await page.waitForTimeout(20);
  let after = (await textState(page)).paused;
  if (after !== desired) {
    // Some optional presentation surfaces restore their captured pause state
    // after the click. Quiescence is a measurement concern, not progression;
    // use the existing development state interface only for that pause bit.
    after = await page.evaluate((paused) => {
      const state = window.__getGameState();
      state.paused = paused;
      return state.paused;
    }, desired);
    return {
      ok: after === desired,
      paused: after,
      changed: true,
      method: 'test-state-pause-fallback',
    };
  }
  return { ok: true, paused: after, changed: true, method: 'pause-button' };
}

async function openScene(page, scene) {
  return page.evaluate(async (sceneName) => {
    let available = true;
    let detail = null;
    if (sceneName === 'system') {
      const control = document.querySelector('#tab-system');
      if (control) control.click();
      else window.__setView('system');
    } else if (sceneName === 'galaxy') {
      const control = document.querySelector('#tab-galaxy');
      if (control) control.click();
      else window.__setView('galaxy');
    } else {
      const selector = {
        technology: '#tab-tech',
        fleet: '#tab-fleet',
        logistics: '#tab-logistics',
      }[sceneName];
      const control = selector ? document.querySelector(selector) : null;
      if (!control) {
        available = false;
        detail = selector ? `Missing ${selector}` : `Unknown scene ${sceneName}`;
      } else {
        control.click();
      }
    }
    await new Promise((resolve) => requestAnimationFrame(
      () => requestAnimationFrame(resolve),
    ));
    return {
      available,
      detail,
    };
  }, scene);
}

async function validateScenePresentation(page, scene) {
  return page.evaluate((sceneName) => {
    const panelId = {
      technology: 'tech-screen',
      fleet: 'fleet-panel',
      logistics: 'logistics-panel',
    }[sceneName];
    if (panelId) {
      const panel = document.getElementById(panelId);
      return panel && !panel.classList.contains('hidden')
        ? { ok: true, panelId }
        : { ok: false, reason: `${panelId} is not visible` };
    }
    const expectedView = sceneName === 'galaxy' ? 'galaxy' : 'system';
    const actualView = typeof window.__getView === 'function'
      ? window.__getView()
      : JSON.parse(window.render_game_to_text()).view;
    return actualView === expectedView
      ? { ok: true, view: actualView }
      : { ok: false, reason: `expected ${expectedView} view, found ${actualView}` };
  }, scene);
}

async function waitForScenePresentation(page, scene, timeoutMs = 2_000) {
  const startedAt = performance.now();
  let result = await validateScenePresentation(page, scene);
  while (!result?.ok && performance.now() - startedAt < timeoutMs) {
    await page.waitForTimeout(50);
    result = await validateScenePresentation(page, scene);
  }
  return result;
}

async function captureSceneIdentity(page, scene) {
  return page.evaluate((sceneName) => {
    let text = null;
    try {
      text = JSON.parse(window.render_game_to_text());
    } catch {
      text = null;
    }
    const panelId = {
      technology: 'tech-screen',
      fleet: 'fleet-panel',
      logistics: 'logistics-panel',
    }[sceneName] ?? null;
    const panel = panelId ? document.getElementById(panelId) : null;
    return {
      scene: sceneName,
      view: text?.view ?? window.__getView?.() ?? null,
      currentSystem: text?.currentSystem ?? null,
      panelId: panel && !panel.classList.contains('hidden') ? panelId : null,
      battleSystemId: text?.battle?.systemId ?? null,
      battleMode: text?.battle?.mode ?? null,
    };
  }, scene);
}

async function measurePointerToPaint(page, sampleCount, scene) {
  const startedPaused = await page.evaluate(() => !!window.__getGameState().paused);
  if (startedPaused) {
    return { ok: false, reason: `${scene} input sampling did not start on a live loop` };
  }
  const durations = [];
  for (let index = 0; index < sampleCount; index += 1) {
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      window.__etePointerToPaintSample = new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          window.removeEventListener('keyup', onKeyUp, true);
          resolve(value);
        };
        const onKeyUp = (event) => {
          if (event.code !== 'Space') return;
          const inputAt = performance.now();
          // rAF runs immediately before paint. Queue a task from that rAF so
          // the duration ends after the first frame containing the input's UI
          // change, rather than charging two complete frame intervals.
          requestAnimationFrame(() => {
            const channel = new MessageChannel();
            channel.port1.onmessage = () => {
              channel.port1.close();
              channel.port2.close();
              finish({
                ok: true,
                durationMs: performance.now() - inputAt,
              });
            };
            channel.port2.postMessage(null);
          });
        };
        const timeoutId = setTimeout(() => {
          finish({ ok: false, reason: 'Space keyup was not observed within 2 seconds' });
        }, 2_000);
        window.addEventListener('keyup', onKeyUp, true);
      });
    });
    // Space is the real player-facing pause shortcut on every surface,
    // including tactical combat. It remains available while the full-screen
    // pause overlay intentionally intercepts pointer input.
    await page.keyboard.press('Space');
    const result = await page.evaluate(async () => {
      const value = await window.__etePointerToPaintSample;
      delete window.__etePointerToPaintSample;
      return value;
    });
    if (!result?.ok) {
      return {
        ok: false,
        reason: result?.reason ?? 'input-to-paint sample failed',
        rawMs: durations,
      };
    }
    durations.push(result.durationMs);
    const pausedAfterSample = await page.evaluate(() => !!window.__getGameState().paused);
    if (!pausedAfterSample) {
      return {
        ok: false,
        reason: 'Pause input did not reach the game state',
        rawMs: durations,
      };
    }
    await page.keyboard.press('Space');
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(
      () => requestAnimationFrame(resolve),
    )));
    const resumed = await page.evaluate(() => !window.__getGameState().paused);
    if (!resumed) {
      return {
        ok: false,
        reason: 'Input sampler could not restore the live loop',
        rawMs: durations,
      };
    }
  }
  return {
    ok: true,
    samples: durations.length,
    interaction: `Space key: pause through first completed paint, then restore live loop on ${scene}`,
    medianMs: round(percentile(durations, 0.5)),
    p95Ms: round(percentile(durations, 0.95)),
    p99Ms: round(percentile(durations, 0.99)),
    maxMs: round(Math.max(...durations, 0)),
    rawMs: durations,
  };
}

async function sampleFrameWindow(page, durationMs, captureGalaxyDraw = false) {
  return page.evaluate(async ({ sampleDurationMs, captureGalaxyDraw }) => {
    const intervals = [];
    const longTasks = [];
    const galaxyDrawMs = [];
    const startedAt = performance.now();
    let lastFrameAt = null;
    let frames = 0;
    let observer = null;
    if (typeof PerformanceObserver === 'function') {
      try {
        observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            longTasks.push({
              startTime: entry.startTime,
              duration: entry.duration,
              wallStartedAt: performance.timeOrigin + entry.startTime,
            });
          }
        });
        observer.observe({ type: 'longtask', buffered: false });
      } catch {
        observer = null;
      }
    }

    await new Promise((resolve) => {
      const finishAt = startedAt + sampleDurationMs;
      const tick = (now) => {
        frames += 1;
        if (lastFrameAt != null) intervals.push(now - lastFrameAt);
        lastFrameAt = now;
        if (captureGalaxyDraw && typeof window.__galaxyPerfSummary === 'function') {
          const drawMs = Number(window.__galaxyPerfSummary()?.lastDrawMs);
          if (Number.isFinite(drawMs)) galaxyDrawMs.push(drawMs);
        }
        if (now >= finishAt) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    observer?.disconnect();

    const elapsedMs = Math.max(1, (lastFrameAt ?? performance.now()) - startedAt);
    const droppedFrames = intervals.reduce(
      (sum, gap) => sum + Math.max(0, Math.round(gap / (1000 / 60)) - 1),
      0,
    );
    return {
      frames,
      elapsedMs,
      effectiveFps: frames * 1000 / elapsedMs,
      intervals,
      droppedFrames,
      longTasks,
      galaxyDrawMs,
      gameFps: typeof window.__fps === 'function' ? window.__fps() : null,
      visibilityState: document.visibilityState,
    };
  }, { sampleDurationMs: durationMs, captureGalaxyDraw });
}

async function cdpMemoryMetrics(page) {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Performance.enable');
    const { metrics } = await session.send('Performance.getMetrics');
    const values = Object.fromEntries(metrics.map(({ name, value }) => [name, value]));
    const browserMemory = await page.evaluate(() => {
      const memory = performance.memory;
      return memory ? {
        jsHeapSizeLimit: memory.jsHeapSizeLimit,
        totalJSHeapSize: memory.totalJSHeapSize,
        usedJSHeapSize: memory.usedJSHeapSize,
      } : null;
    });
    return {
      jsHeapUsedBytes: values.JSHeapUsedSize ?? browserMemory?.usedJSHeapSize ?? null,
      jsHeapTotalBytes: values.JSHeapTotalSize ?? browserMemory?.totalJSHeapSize ?? null,
      documents: values.Documents ?? null,
      nodes: values.Nodes ?? null,
      layoutCount: values.LayoutCount ?? null,
      recalcStyleCount: values.RecalcStyleCount ?? null,
      taskDurationSeconds: values.TaskDuration ?? null,
      scriptDurationSeconds: values.ScriptDuration ?? null,
      layoutDurationSeconds: values.LayoutDuration ?? null,
    };
  } finally {
    await session.detach().catch(() => {});
  }
}

async function simulationBenchmark(page, steps) {
  return page.evaluate((stepCount) => {
    const durations = [];
    const state = window.__getGameState();
    const beforeTime = state.time;
    const beforePaused = state.paused;
    for (let index = 0; index < stepCount; index += 1) {
      const startedAt = performance.now();
      window.advanceTime(50);
      durations.push(performance.now() - startedAt);
    }
    return {
      durations,
      beforeTime,
      afterTime: state.time,
      advancedMs: state.time - beforeTime,
      beforePaused,
      afterPaused: state.paused,
    };
  }, steps);
}

function aggregateScene(scene, samples, inputToPaint, memory, extra = {}) {
  const intervals = samples.flatMap((sample) => sample.intervals);
  const longTasks = samples.flatMap((sample) => sample.longTasks);
  const galaxyDrawMs = samples.flatMap((sample) => sample.galaxyDrawMs ?? []);
  const elapsedMs = samples.reduce((sum, sample) => sum + sample.elapsedMs, 0);
  const frameCount = samples.reduce((sum, sample) => sum + sample.frames, 0);
  return {
    scene,
    available: true,
    inputToPaintMs: inputToPaint?.ok ? inputToPaint.p95Ms : null,
    inputToPaint,
    effectiveFps: round(frameCount * 1000 / Math.max(1, elapsedMs)),
    gameFps: round(median(samples.map((sample) => finite(sample.gameFps, NaN)))),
    frameIntervalMs: {
      median: round(percentile(intervals, 0.5)),
      p95: round(percentile(intervals, 0.95)),
      p99: round(percentile(intervals, 0.99)),
      max: round(Math.max(...intervals, 0)),
    },
    frames: frameCount,
    droppedFrames: samples.reduce((sum, sample) => sum + sample.droppedFrames, 0),
    longTasks: {
      count: longTasks.length,
      over50Ms: longTasks.filter((task) => task.duration > 50).length,
      p95Ms: round(percentile(longTasks.map((task) => task.duration), 0.95)),
      maxMs: round(Math.max(...longTasks.map((task) => task.duration), 0)),
      entries: longTasks,
    },
    galaxyDrawMs: galaxyDrawMs.length
      ? {
        samples: galaxyDrawMs.length,
        median: round(percentile(galaxyDrawMs, 0.5)),
        p95: round(percentile(galaxyDrawMs, 0.95)),
        p99: round(percentile(galaxyDrawMs, 0.99)),
        max: round(Math.max(...galaxyDrawMs, 0)),
        rawMs: galaxyDrawMs,
      }
      : null,
    visibilityStates: [...new Set(samples.map((sample) => sample.visibilityState))],
    memory,
    ...extra,
  };
}

async function sampleScene(page, scene, checkpointDir, config, report, options = {}) {
  await page.bringToFront();
  const visibilityBefore = await page.evaluate(() => document.visibilityState);
  if (visibilityBefore !== 'visible') {
    return {
      scene,
      available: false,
      reason: `${scene} page was ${visibilityBefore} before sampling`,
    };
  }
  const open = options.prepared
    ? { available: true }
    : await openScene(page, scene);
  if (!open.available) {
    return {
      scene,
      available: false,
      reason: open.detail,
    };
  }

  const validityBefore = options.validate
    ? await options.validate(page, 'before')
    : { ok: true };
  if (!validityBefore?.ok) {
    return {
      scene,
      available: false,
      reason: validityBefore?.reason ?? `${scene} fixture was not active before sampling`,
    };
  }
  const presentationBefore = await waitForScenePresentation(page, scene);
  if (!presentationBefore?.ok) {
    return {
      scene,
      available: false,
      reason: presentationBefore?.reason ?? `${scene} presentation was not visible`,
    };
  }
  // Persist the exact measured surface. A shared scene name is not enough for
  // a fair comparison when (for example) tactical combat moved from the core
  // black hole to a normal star system between harness revisions.
  const sceneIdentity = await captureSceneIdentity(page, scene);
  await page.waitForTimeout(config.warmupMs);
  const inputToPaint = await measurePointerToPaint(page, config.inputSamples, scene);
  if (!inputToPaint.ok) {
    return {
      scene,
      available: false,
      reason: inputToPaint.reason,
    };
  }
  const presentationAfterInput = await waitForScenePresentation(page, scene);
  if (!presentationAfterInput?.ok) {
    return {
      scene,
      available: false,
      reason: presentationAfterInput?.reason ?? `${scene} input changed the measured surface`,
    };
  }
  const samples = [];
  for (let index = 0; index < config.samples; index += 1) {
    samples.push(await sampleFrameWindow(
      page,
      config.sampleMs,
      scene === 'galaxy',
    ));
  }
  const visibilityAfter = await page.evaluate(() => document.visibilityState);
  const hiddenSamples = samples.filter((sample) => sample.visibilityState !== 'visible');
  if (visibilityAfter !== 'visible' || hiddenSamples.length > 0) {
    return {
      scene,
      available: false,
      reason: `${scene} page lost foreground visibility during sampling`,
      visibility: {
        before: visibilityBefore,
        samples: samples.map((sample) => sample.visibilityState),
        after: visibilityAfter,
      },
    };
  }
  const validityAfter = options.validate
    ? await options.validate(page, 'after')
    : { ok: true };
  if (!validityAfter?.ok) {
    return {
      scene,
      available: false,
      reason: validityAfter?.reason ?? `${scene} fixture ended during sampling`,
    };
  }
  const memory = await cdpMemoryMetrics(page);
  const sceneIdentityAfter = await captureSceneIdentity(page, scene);
  const screenshotPath = path.join(checkpointDir, `${sanitizeName(scene)}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const allLongTasks = samples.flatMap((sample) => sample.longTasks);
  const currentRequests = [...(options.networkInflight?.values?.() ?? [])]
    .map((request) => ({
      ...request,
      finishedAt: Date.now(),
      durationMs: Date.now() - request.startedAt,
      inFlight: true,
    }));
  const overlappingRequests = [...report.network.requests, ...currentRequests]
    .filter((request) => (
    allLongTasks.some((task) => (
      request.startedAt <= task.wallStartedAt + task.duration
      && (request.finishedAt ?? Date.now()) >= task.wallStartedAt
    ))
    ));

  return aggregateScene(scene, samples, inputToPaint, memory, {
    screenshotPath,
    sceneIdentity,
    sceneIdentityAfter,
    fixtureValidation: {
      before: validityBefore,
      after: validityAfter,
    },
    presentationValidation: {
      before: presentationBefore,
      afterInput: presentationAfterInput,
    },
    visibility: {
      before: visibilityBefore,
      samples: samples.map((sample) => sample.visibilityState),
      after: visibilityAfter,
    },
    networkOverlap: {
      requestCount: overlappingRequests.length,
      backendRequestCount: overlappingRequests.filter(isBackendRuntimeRequest).length,
      slowestMs: round(Math.max(...overlappingRequests.map((entry) => entry.durationMs), 0)),
      urls: [...new Set(overlappingRequests.map((entry) => entry.url))].slice(0, 10),
    },
  });
}

async function captureCpuProfile(page, outputPath, durationMs) {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Profiler.enable');
    await session.send('Profiler.start');
    await page.waitForTimeout(durationMs);
    const { profile } = await session.send('Profiler.stop');
    await writeFile(outputPath, `${JSON.stringify(profile)}\n`);
    return { ok: true, path: outputPath };
  } catch (error) {
    return { ok: false, error: String(error?.stack ?? error) };
  } finally {
    await session.detach().catch(() => {});
  }
}

async function captureHeapSnapshot(page, outputPath) {
  const session = await page.context().newCDPSession(page);
  const stream = createWriteStream(outputPath, { encoding: 'utf8' });
  let streamError = null;
  stream.on('error', (error) => {
    streamError = error;
  });
  const onChunk = ({ chunk }) => stream.write(chunk);
  session.on('HeapProfiler.addHeapSnapshotChunk', onChunk);
  try {
    await session.send('HeapProfiler.enable');
    await session.send('HeapProfiler.takeHeapSnapshot', {
      reportProgress: false,
      captureNumericValue: true,
    });
    await new Promise((resolve, reject) => {
      stream.end(() => {
        if (streamError) reject(streamError);
        else resolve();
      });
    });
    return { ok: true, path: outputPath };
  } catch (error) {
    stream.destroy();
    return { ok: false, error: String(error?.stack ?? error) };
  } finally {
    session.off('HeapProfiler.addHeapSnapshotChunk', onChunk);
    await session.detach().catch(() => {});
  }
}

async function captureProfiles(
  page,
  checkpointId,
  checkpointDir,
  config,
  report,
  metadata = {},
) {
  await page.bringToFront();
  const visibilityBefore = await page.evaluate(() => document.visibilityState);
  if (visibilityBefore !== 'visible') {
    throw new CapabilityBlocked(
      `Cannot profile ${checkpointId} while the page is ${visibilityBefore}`,
    );
  }
  const cpuPath = path.join(checkpointDir, `${checkpointId}.cpuprofile`);
  const heapPath = path.join(checkpointDir, `${checkpointId}.heapsnapshot`);
  console.log(`PROFILE ${checkpointId}: CPU ${config.cpuProfileMs}ms + heap snapshot`);
  const cpu = await captureCpuProfile(page, cpuPath, config.cpuProfileMs);
  const heap = await captureHeapSnapshot(page, heapPath);
  const visibilityAfter = await page.evaluate(() => document.visibilityState);
  if (visibilityAfter !== 'visible') {
    throw new CapabilityBlocked(
      `Profile ${checkpointId} lost foreground visibility (${visibilityAfter})`,
    );
  }
  const result = {
    checkpointId,
    ...metadata,
    visibility: { before: visibilityBefore, after: visibilityAfter },
    cpu,
    heap,
  };
  report.profiles.push(result);
  return result;
}

async function captureCheckpointProfiles(
  context,
  checkpointId,
  checkpointDir,
  config,
  report,
  networkInflight,
  trigger = { category: 'final', scene: 'system' },
) {
  let page = null;
  try {
    page = await cloneFromCheckpoint(context, config, report, networkInflight);
    await page.bringToFront();
    const scene = trigger.scene ?? 'system';
    const prepared = scene === 'active-production'
      ? await prepareProductionClone(page)
      : scene === 'tactical-combat'
        ? await prepareTacticalClone(page)
        : await prepareLiveSceneClone(page);
    if (!prepared.ok) {
      throw new CapabilityBlocked(
        `Could not resume ${checkpointId} profile clone`,
        prepared,
      );
    }
    if (!['active-production', 'tactical-combat'].includes(scene)) {
      const opened = await openScene(page, scene);
      if (!opened.available) {
        throw new CapabilityBlocked(`Could not open ${scene} for ${checkpointId} profile`, opened);
      }
    }
    await page.waitForTimeout(Math.min(config.warmupMs, 2_000));
    return await captureProfiles(
      page,
      checkpointId,
      checkpointDir,
      config,
      report,
      { trigger },
    );
  } finally {
    if (page) harnessClosingPages.add(page);
    await page?.close().catch(() => {});
  }
}

function entityMetrics(state, documentMetrics = {}) {
  const playerShips = Array.isArray(state.playerShips) ? state.playerShips : [];
  const livePlayerShips = playerShips.filter((ship) => finite(ship.hp, 1) > 0);
  const battleGroups = Array.isArray(state.battleGroups) ? state.battleGroups : [];
  const fleetMemberships = battleGroups.flatMap((group) => group.shipIds ?? []);
  const uniqueFleetMemberships = new Set(fleetMemberships);
  const playerShipIds = new Set(playerShips.map((ship) => ship.id));
  const livePlayerShipIds = new Set(livePlayerShips.map((ship) => ship.id));
  const unknownFleetMemberships = [...uniqueFleetMemberships]
    .filter((shipId) => !playerShipIds.has(shipId));
  const deadFleetMemberships = [...uniqueFleetMemberships]
    .filter((shipId) => playerShipIds.has(shipId) && !livePlayerShipIds.has(shipId));
  const unassignedPlayerShips = [...livePlayerShipIds]
    .filter((shipId) => !uniqueFleetMemberships.has(shipId));
  const aiShips = Array.isArray(state.aiShips)
    ? state.aiShips.length
    : finite(state.aiShips?.shipCount ?? state.aiShips?.count, 0);
  return {
    gameTimeMs: finite(state.time),
    credits: round(finite(state.credits)),
    solarii: round(finite(state.solarii)),
    solariiPerSec: round(finite(state.solariiPerSec)),
    techUnlocked: state.research?.unlocked?.length ?? 0,
    activeResearch: state.research?.activeNodeId ?? null,
    scouts: state.scoutCount ?? state.scouts?.length ?? 0,
    playerShips: playerShips.length,
    livePlayerShips: livePlayerShips.length,
    deadPlayerShips: playerShips.length - livePlayerShips.length,
    playerHullCounts: Object.fromEntries(
      [...new Set(livePlayerShips.map((ship) => ship.hull))]
        .sort()
        .map((hull) => [hull, livePlayerShips.filter((ship) => ship.hull === hull).length]),
    ),
    battleGroups: battleGroups.length,
    fleetSizes: battleGroups.map((group) => (
      (group.shipIds ?? []).filter((shipId) => livePlayerShipIds.has(shipId)).length
    )),
    rosterFleetSizes: battleGroups.map((group) => group.shipIds?.length ?? 0),
    uniqueFleetShips: [...uniqueFleetMemberships]
      .filter((shipId) => livePlayerShipIds.has(shipId)).length,
    duplicateFleetMemberships: fleetMemberships.length - uniqueFleetMemberships.size,
    unknownFleetMemberships: unknownFleetMemberships.length,
    deadFleetMemberships: deadFleetMemberships.length,
    unassignedPlayerShips: unassignedPlayerShips.length,
    researchQueue: state.research?.queue?.length ?? 0,
    empireQueue: documentMetrics.globalEmpireQueue
      ?? state.empireQueue?.length ?? 0,
    activeBuilds: documentMetrics.globalActiveBuilds
      ?? finite(state.production?.activeBuilds),
    buildingScout: documentMetrics.globalBuildingScout
      ?? !!state.production?.buildingScout,
    aiActiveBuilds: documentMetrics.globalAiActiveBuilds ?? null,
    allActiveBuilds: documentMetrics.globalAllActiveBuilds ?? null,
    aiBuildingScout: documentMetrics.globalAiBuildingScout ?? null,
    aiShips,
    aiFactions: state.factions?.list?.length ?? 0,
    aiSystems: documentMetrics.aiSystems ?? null,
    convoys: documentMetrics.convoys ?? state.logistics?.convoyCount
      ?? state.logistics?.convoys?.length ?? 0,
    depots: documentMetrics.depots ?? state.logistics?.depots?.length ?? 0,
    structures: documentMetrics.structures ?? null,
    structuresInView: state.structures?.length ?? 0,
    constructionJobs: documentMetrics.globalConstructionJobs
      ?? state.constructionJobs?.length ?? 0,
    pausedConstructionJobs: documentMetrics.pausedConstructionJobs ?? null,
    failedConstructionJobs: documentMetrics.failedConstructionJobs ?? null,
    completedConstructionJobs: documentMetrics.completedConstructionJobs ?? null,
    galaxyStars: state.galaxy?.starCount ?? 0,
    galaxyLanes: state.galaxy?.laneCount ?? 0,
    dysonSystems: state.milestones?.completedDysonCount ?? 0,
    playerCompletedDysons: documentMetrics.playerCompletedDysons ?? [],
    helioclastStage: state.superweapon?.buildStage ?? 0,
    helioclastMobile: !!state.superweapon?.mobile,
    helioclastLiveFireComplete: !!state.superweapon?.liveFireComplete,
    helioclastBuildJob: state.superweapon?.buildJob ?? null,
    helioclastInstalledParts: Object.entries(state.superweapon?.installedParts ?? {})
      .filter(([, installed]) => !!installed)
      .map(([partId]) => partId)
      .sort(),
    helioclastShipHp: finite(state.superweapon?.ship?.hp),
    domNodes: documentMetrics.domNodes ?? null,
  };
}

function checkpointSemanticProblems(checkpointId, state) {
  const problems = [];
  const expectedTech = {
    'new-game': 1,
    'first-corvette': 1,
    'first-eight-ship-fleet': 1,
    'tech-034': 34,
    'tech-068': 68,
    'tech-102': 102,
    final: EXPECTED_TECH_COUNT,
  }[checkpointId];
  if (expectedTech != null && state.techUnlocked !== expectedTech) {
    problems.push(`technology count ${state.techUnlocked}, expected ${expectedTech}`);
  }
  if (checkpointId === 'new-game' && state.playerShips !== 0) {
    problems.push(`new game contains ${state.playerShips} player ships`);
  }
  if (checkpointId === 'first-corvette') {
    if (state.playerShips !== 1
        || state.livePlayerShips !== 1
        || state.deadPlayerShips !== 0
        || finite(state.playerHullCounts?.corvette) !== 1) {
      problems.push('first-corvette does not contain exactly one live corvette');
    }
  }
  if (checkpointId === 'first-eight-ship-fleet') {
    if (state.playerShips !== FLEET_CAPACITY
        || state.livePlayerShips !== FLEET_CAPACITY
        || state.deadPlayerShips !== 0
        || !state.fleetSizes?.some((size) => size === FLEET_CAPACITY)) {
      problems.push('first fleet checkpoint lacks eight live ships in one fleet');
    }
  }
  if (checkpointId === 'first-dyson'
      && state.playerCompletedDysons?.length !== 1) {
    problems.push(`first Dyson checkpoint has ${state.playerCompletedDysons?.length ?? 0} player Dysons`);
  }
  if (checkpointId === 'third-dyson'
      && state.playerCompletedDysons?.length !== 3) {
    problems.push(`third Dyson checkpoint has ${state.playerCompletedDysons?.length ?? 0} player Dysons`);
  }
  if (checkpointId === 'final') {
    if (state.livePlayerShips !== PLAYER_FLEET_SIZE || state.deadPlayerShips !== 0) {
      problems.push('final checkpoint does not contain exactly 32 live, undestroyed ships');
    }
    if (!state.helioclastMobile || !state.helioclastLiveFireComplete) {
      problems.push('final Helioclast is not mobile and live-fire complete');
    }
    if (state.helioclastBuildJob != null) {
      problems.push('final Helioclast still has an active berth job');
    }
    if (!HELIOCLAST_PART_ORDER.every((partId) => (
      state.helioclastInstalledParts?.includes(partId)
    ))) {
      problems.push('final Helioclast is missing one or more required installed parts');
    }
  }
  return problems;
}

async function diagnosticEntityCounts(page) {
  return page.evaluate(() => {
    const state = window.__getGameState();
    const activeGalaxy = state.galaxies?.[state.activeGalaxyId];
    const activeSystems = Object.values(activeGalaxy?.systems ?? {});
    const aiSystems = activeSystems.filter((system) => system.owner === 'ai').length;
    const playerCompletedDysons = Object.entries(state.galaxies ?? {})
      .flatMap(([galaxyId, galaxy]) => Object.values(galaxy?.systems ?? {})
        .filter((system) => (
          system.owner === 'player'
          && Number(system.dyson?.completedShells ?? 0) >= 8
        ))
        .map((system) => ({
          galaxyId,
          systemId: system.id,
          owner: system.owner,
          completedShells: system.dyson.completedShells,
        })));
    const constructionJobs = state.constructionJobs ?? [];
    const activeConstructionStatuses = new Set(['queued', 'active', 'paused']);
    const buildsForSystems = (predicate) => Object.values(state.galaxies ?? {}).reduce(
      (galaxySum, galaxy) => galaxySum + Object.values(galaxy?.systems ?? {})
        .filter(predicate)
        .reduce(
          (systemSum, system) => systemSum + (system.structures ?? []).reduce(
            (buildSum, structure) => buildSum
              + (structure.builds?.length ?? (structure.build ? 1 : 0)),
            0,
          ),
          0,
        ),
      0,
    );
    const buildingScoutForSystems = (predicate) => Object.values(state.galaxies ?? {}).some(
      (galaxy) => Object.values(galaxy?.systems ?? {})
        .filter(predicate)
        .some((system) => (
          (system.structures ?? []).some((structure) => (
            (structure.builds ?? (structure.build ? [structure.build] : []))
              .some((build) => build.hull === 'scout')
          ))
        )),
    );
    return {
      aiSystems,
      convoys: state.logistics?.convoys?.length ?? 0,
      depots: Object.keys(state.logistics?.depots ?? {}).length,
      structures: activeSystems.reduce(
        (sum, system) => sum + (system.structures?.length ?? 0),
        0,
      ),
      globalConstructionJobs: constructionJobs
        .filter((job) => activeConstructionStatuses.has(job.status)).length,
      pausedConstructionJobs: constructionJobs
        .filter((job) => job.status === 'paused').length,
      failedConstructionJobs: constructionJobs
        .filter((job) => job.status === 'failed').length,
      completedConstructionJobs: constructionJobs
        .filter((job) => job.status === 'complete').length,
      globalEmpireQueue: state.empireQueue?.length ?? 0,
      // AI shipyards intentionally keep producing forever. Quiescence and
      // progression integrity concern player commands, so report those
      // separately while retaining all/AI activity as diagnostic load.
      globalActiveBuilds: buildsForSystems((system) => system.owner === 'player'),
      globalAiActiveBuilds: buildsForSystems((system) => system.owner === 'ai'),
      globalAllActiveBuilds: buildsForSystems(() => true),
      globalBuildingScout: buildingScoutForSystems((system) => system.owner === 'player'),
      globalAiBuildingScout: buildingScoutForSystems((system) => system.owner === 'ai'),
      playerCompletedDysons,
    };
  });
}

async function saveCheckpointEnvelope(page, checkpointDir) {
  const save = await page.evaluate(async (slot) => {
    const longTasks = [];
    const probeGaps = [];
    let observer = null;
    if (typeof PerformanceObserver === 'function') {
      try {
        observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) longTasks.push(entry.duration);
        });
        observer.observe({ type: 'longtask', buffered: false });
      } catch {
        observer = null;
      }
    }
    let lastProbeAt = performance.now();
    const probe = setInterval(() => {
      const now = performance.now();
      probeGaps.push(now - lastProbeAt);
      lastProbeAt = now;
    }, 4);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const startedAt = performance.now();
    const result = await window.__saveSlot(slot);
    const elapsedMs = performance.now() - startedAt;
    await new Promise((resolve) => requestAnimationFrame(
      () => requestAnimationFrame(resolve),
    ));
    clearInterval(probe);
    observer?.disconnect();
    const entries = Object.entries(localStorage);
    const candidate = entries
      .filter(([, value]) => typeof value === 'string' && value.includes('"saveVersion"'))
      .sort((a, b) => b[1].length - a[1].length)
      .find(([key]) => key.includes(slot))
      ?? entries
        .filter(([, value]) => typeof value === 'string' && value.includes('"saveVersion"'))
        .sort((a, b) => b[1].length - a[1].length)[0]
      ?? null;
    return {
      result,
      elapsedMs,
      mainThreadLongestGapMs: Math.max(0, ...probeGaps),
      mainThreadProbeSamples: probeGaps.length,
      longTasks,
      key: candidate?.[0] ?? null,
      envelope: candidate?.[1] ?? null,
    };
  }, SAVE_SLOT);

  let envelopePath = null;
  if (save.envelope) {
    envelopePath = path.join(checkpointDir, 'save-envelope.json');
    await writeFile(envelopePath, `${save.envelope}\n`);
  }
  return {
    ok: !!save.result?.ok,
    error: save.result?.error ?? null,
    elapsedMs: round(save.elapsedMs),
    mainThreadLongestGapMs: round(save.mainThreadLongestGapMs),
    mainThreadProbeSamples: save.mainThreadProbeSamples,
    longTasks: {
      count: save.longTasks.length,
      over50Ms: save.longTasks.filter((duration) => duration > 50).length,
      p95Ms: round(percentile(save.longTasks, 0.95)),
      maxMs: round(Math.max(0, ...save.longTasks)),
      rawMs: save.longTasks,
    },
    autosaveEquivalentPath: true,
    bytes: save.envelope ? Buffer.byteLength(save.envelope) : null,
    uncompressedBytes: save.result?.uncompressedBytes ?? null,
    storageFormat: save.result?.storageFormat ?? 'json',
    localStorageKey: save.key,
    envelopePath,
  };
}

function sceneRegression(scene, baseline, { strictLongTasks = true } = {}) {
  if (!scene?.available || !baseline?.available) return null;
  const fpsRatio = scene.effectiveFps / Math.max(0.001, baseline.effectiveFps);
  const p95Limit = Math.max(
    finite(baseline.frameIntervalMs?.p95) * 1.25,
    finite(baseline.frameIntervalMs?.p95) + 8,
  );
  const observedRepeatingLongTask = finite(scene.longTasks?.over50Ms) >= 2;
  const baselineRepeatingLongTask = finite(baseline.longTasks?.over50Ms) >= 2;
  const longTaskP95Limit = Math.max(
    50,
    finite(baseline.longTasks?.p95Ms) * 1.25,
    finite(baseline.longTasks?.p95Ms) + 8,
  );
  // A software-rendered headless frame commonly appears as one generic browser
  // long task. More (shorter) tasks can therefore mean *more* frames, not a
  // slower game loop. Headed runs retain the strict absolute requirement.
  // Headless runs fail only when repeating long tasks are newly introduced or
  // their duration materially regresses from the scene-matched baseline.
  const longTaskRegression = observedRepeatingLongTask && (
    strictLongTasks
      || !baselineRepeatingLongTask
      || finite(scene.longTasks?.p95Ms, Infinity) > longTaskP95Limit
  );
  const fpsDegraded = fpsRatio < 0.8;
  const p95FrameExceeded = finite(scene.frameIntervalMs?.p95, Infinity) > p95Limit;
  const degradationReasons = [
    ...(fpsDegraded ? ['fps-ratio'] : []),
    ...(p95FrameExceeded ? ['p95-frame-interval'] : []),
    ...(longTaskRegression ? ['repeating-long-task'] : []),
  ];
  return {
    degraded: degradationReasons.length > 0,
    fpsRatio: round(fpsRatio, 3),
    p95LimitMs: round(p95Limit),
    fpsDegraded,
    p95FrameExceeded,
    repeatingLongTask: observedRepeatingLongTask,
    observedRepeatingLongTask,
    baselineRepeatingLongTask,
    longTaskRegression,
    longTaskP95LimitMs: round(longTaskP95Limit),
    longTaskPolicy: strictLongTasks
      ? 'strict-player-visible'
      : 'relative-headless-environment',
    degradationReasons,
  };
}

async function cloneFromCheckpoint(context, config, report, networkInflight) {
  const page = await context.newPage();
  attachDiagnostics(page, report, networkInflight);
  await page.goto(config.url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => (
    typeof window.__loadSlot === 'function'
    && typeof window.render_game_to_text === 'function'
  ));
  const loaded = await page.evaluate(async ({ slot, expectedPaused }) => {
    const result = await window.__loadSlot(slot);
    // The player-facing load path intentionally resumes a save. Test clones
    // must restore checkpoint quiescence in the same microtask as import so a
    // rAF tick cannot move time before identity validation.
    if (result?.ok && expectedPaused != null) {
      window.__getGameState().paused = expectedPaused;
    }
    return result;
  }, {
    slot: SAVE_SLOT,
    expectedPaused: activeCheckpointIdentity?.paused ?? true,
  });
  if (!loaded?.ok) {
    harnessClosingPages.add(page);
    await page.close();
    throw new CapabilityBlocked('Could not load checkpoint clone through the save system', loaded);
  }
  if (activeCheckpointIdentity) {
    const actualIdentity = await checkpointStateIdentity(page);
    if (actualIdentity.hash !== activeCheckpointIdentity.hash
      || actualIdentity.serializedChars !== activeCheckpointIdentity.serializedChars) {
      const actualWithCanonical = await checkpointStateIdentity(page, { includeCanonical: true });
      const differences = firstIdentityDifferences(
        activeCheckpointIdentity.canonical,
        actualWithCanonical.canonical,
      );
      harnessClosingPages.add(page);
      await page.close();
      throw new CapabilityBlocked(
        `Checkpoint clone identity diverged from ${activeCheckpointIdentity.checkpointId}`,
        {
          expected: { ...activeCheckpointIdentity, canonical: undefined },
          actual: actualIdentity,
          differences,
        },
      );
    }
  }
  return page;
}

async function prepareLiveSceneClone(page) {
  const resumed = await setPausedThroughUi(page, false);
  if (!resumed.ok) {
    return { ok: false, reason: 'Could not resume live scene clone' };
  }
  const systemId = await standardizeSystemScene(page);
  return {
    ok: true,
    prepared: false,
    fixture: 'checkpoint-live-loop',
    systemId,
  };
}

async function validateActiveProduction(page) {
  const state = await textState(page);
  const activeBuilds = finite(state.production?.activeBuilds);
  const queuedBuilds = (state.production?.combatQueues ?? [])
    .reduce((sum, queue) => sum + finite(queue.count, 1), 0);
  return activeBuilds > 0
    ? { ok: true, activeBuilds, queuedBuilds }
    : {
      ok: false,
      reason: 'No shipyard build remained active during the production sample',
      activeBuilds,
      queuedBuilds,
    };
}

async function prepareProductionClone(page) {
  const live = await setPausedThroughUi(page, false);
  if (!live.ok) return { ok: false, reason: 'Could not resume production fixture setup' };
  const state = await textState(page);
  const systemId = state.strongholdSystem ?? state.flagship?.systemId;
  if (!systemId) return { ok: false, reason: 'Flagship is not stationed in a system' };
  await standardizeSystemScene(page, systemId);
  await ensureShipyard(page);
  await grantCredits(page);
  const queued = [];
  for (let index = 0; index < 12; index += 1) {
    const result = await page.evaluate(() => window.__enqueueHull('corvette'));
    if (!result?.ok) {
      return {
        ok: false,
        reason: result?.reason ?? `Could not queue production fixture ${index + 1}/12`,
      };
    }
    queued.push(result);
  }
  await advanceTime(page, 50);
  const resumed = await setPausedThroughUi(page, false);
  if (!resumed.ok) return { ok: false, reason: 'Could not resume active production clone' };
  const active = await validateActiveProduction(page);
  if (!active.ok) return active;
  return {
    ok: true,
    prepared: true,
    fixture: 'twelve-normal-empire-corvette-orders',
    queued: queued.length,
    validate: validateActiveProduction,
  };
}

async function validateTacticalBattle(page) {
  const result = await page.evaluate(() => {
    const state = window.__getGameState();
    const systemId = window.__eteTacticalSystemId ?? state.flagship?.systemId ?? state.stronghold;
    const battle = typeof window.__getBattleState === 'function'
      ? window.__getBattleState(systemId)
      : null;
    const units = Array.isArray(battle?.units) ? battle.units : [];
    return {
      active: battle?.active === true,
      systemId,
      mode: battle?.mode ?? null,
      status: battle?.status ?? null,
      playerUnits: units.filter((unit) => (
        unit.side === 'player' && (Number.isFinite(unit.hp) ? unit.hp : 1) > 0
      )).length,
      enemyUnits: units.filter((unit) => (
        ['enemy', 'ai'].includes(unit.side)
        && (Number.isFinite(unit.hp) ? unit.hp : 1) > 0
      )).length,
    };
  });
  return result.active
      && result.mode === 'tactical'
      && result.playerUnits === 17
      && result.enemyUnits === 16
    ? { ok: true, ...result }
    : {
      ok: false,
      reason: 'Tactical battle was not active with forces on both sides',
      ...result,
    };
}

async function prepareTacticalClone(page) {
  const live = await setPausedThroughUi(page, false);
  if (!live.ok) return { ok: false, reason: 'Could not resume tactical fixture setup' };
  const result = await page.evaluate(() => {
    const state = window.__getGameState();
    const galaxy = state.galaxies?.[state.activeGalaxyId];
    const movingEntities = [
      state.flagship,
      ...(state.playerFlagships ?? []),
      ...(state.playerShips ?? []),
      ...(state.aiShips ?? []),
      ...(state.heroFlagships ?? []),
      ...(state.pirates?.fleets ?? []),
      ...(state.logistics?.convoys ?? []),
      state.superweapon?.ship,
    ].filter(Boolean);
    const occupied = new Set([
      ...movingEntities.flatMap((entity) => {
        const transit = entity.transit ?? {};
        const destination = entity.destination;
        const path = [
          ...(Array.isArray(entity.path) ? entity.path : []),
          ...(Array.isArray(entity.route) ? entity.route : []),
          ...(Array.isArray(transit.path) ? transit.path : []),
          ...(Array.isArray(transit.route) ? transit.route : []),
        ].map((entry) => (typeof entry === 'string' ? entry : entry?.id));
        return [
          entity.systemId,
          entity.currentNodeId,
          entity.fromSystemId,
          entity.toSystemId,
          entity.destinationSystemId,
          typeof destination === 'string' ? destination : destination?.id,
          entity.destinationId,
          entity.targetSystemId,
          transit.fromId,
          transit.from,
          transit.toId,
          transit.to,
          transit.destId,
          transit.destinationId,
          typeof transit.destination === 'string'
            ? transit.destination
            : transit.destination?.id,
          ...path,
        ];
      }),
      ...(state.pirates?.nests ?? [])
        .filter((nest) => !nest.destroyed && (nest.hp ?? 1) > 0)
        .map((nest) => nest.systemId),
    ].filter(Boolean));
    const target = Object.values(galaxy?.systems ?? {})
      .filter((system) => (
        system.id !== state.stronghold
        && system.id !== galaxy?.graph?.blackHole?.id
        && !['blackhole', 'black_hole'].includes(system.star?.kind)
        && !occupied.has(system.id)
        && !['player', 'ai'].includes(system.owner)
        && (system.structures?.length ?? 0) === 0
      ))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))[0];
    if (!target) return { ok: false, reason: 'No isolated tactical fixture system exists' };

    // This disposable clone keeps the full checkpoint simulation alive, but
    // moves only its solo flagship to a neutral, empty arena. Equal healer
    // formations cannot destroy each other, so every checkpoint receives the
    // same persistent battle instead of checkpoint-dependent native forces.
    const flagship = state.flagship;
    for (const group of state.battleGroups ?? []) group.anchorFlagship = false;
    if (state.superweapon?.ship) {
      // Keep the completed Helioclast at its checkpoint location instead of
      // allowing flagship-follow mode to pull it into this disposable arena.
      state.superweapon.ship.fleetMode = 'group';
      state.superweapon.ship.battleGroupId = null;
    }
    flagship.galaxyId = state.activeGalaxyId;
    flagship.systemId = target.id;
    flagship.transit = null;
    flagship.wormholeTransit = null;
    flagship.orbit = null;
    flagship.hp = flagship.maxHp;
    const sterileWing = () => ({
      capacity: 0,
      ready: 0,
      losses: 0,
      launched: 0,
      rearmUntil: Number.MAX_SAFE_INTEGER,
      hangar: 'stowed',
      hangarAnimStartedAt: 0,
      complement: {},
    });
    flagship.wing = sterileWing();
    const rosterFlagship = (state.playerFlagships ?? [])
      .find((entry) => entry.pilotId === flagship.pilotId);
    if (rosterFlagship && rosterFlagship !== flagship) {
      Object.assign(rosterFlagship, flagship);
      rosterFlagship.wing = sterileWing();
    }
    window.__viewSystem(target.id);
    const friendly = window.__devAction('spawnFriendly', {
      systemId: target.id,
      hull: 'healer',
      count: 16,
    });
    const enemy = window.__devAction('spawnEnemyFleet', {
      systemId: target.id,
      composition: [{ hull: 'healer', count: 16 }],
    });
    window.advanceTime(50);
    window.__eteTacticalSystemId = target.id;
    return {
      ok: friendly?.ok !== false && enemy?.ok !== false,
      reason: friendly?.reason ?? enemy?.reason ?? null,
      systemId: target.id,
      friendly,
      enemy,
      battle: typeof window.__getBattleState === 'function'
        ? window.__getBattleState(target.id)
        : null,
    };
  });
  if (!result.ok) {
    return { ok: false, reason: result.reason ?? 'Balanced tactical fixture failed' };
  }
  const resumed = await setPausedThroughUi(page, false);
  if (!resumed.ok) return { ok: false, reason: 'Could not resume tactical clone' };
  await standardizeSystemScene(page, result.systemId);
  const active = await validateTacticalBattle(page);
  if (!active.ok) return active;
  return {
    ok: true,
    prepared: true,
    fixture: 'isolated-balanced-16v16-healer-arena-plus-solo-flagship',
    validate: validateTacticalBattle,
  };
}

async function profileCloneScene(
  context,
  scene,
  checkpointDir,
  config,
  report,
  networkInflight,
  prepare,
) {
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let page = null;
    let result;
    try {
      page = await cloneFromCheckpoint(context, config, report, networkInflight);
      await page.bringToFront();
      const prepared = await prepare(page);
      if (!prepared.ok) {
        result = { scene, available: false, reason: prepared.reason };
      } else {
        result = await sampleScene(page, scene, checkpointDir, config, report, {
          prepared: prepared.prepared === true,
          validate: prepared.validate,
          networkInflight,
        });
        result.fixture = prepared.fixture ?? null;
      }
    } catch (error) {
      result = {
        scene,
        available: false,
        reason: error instanceof CapabilityBlocked
          ? error.message
          : String(error?.message ?? error),
      };
    } finally {
      if (page) harnessClosingPages.add(page);
      await page?.close().catch(() => {});
    }

    result.attempts = attempt;
    const transientNavigation = /execution context was destroyed|most likely because of a navigation|target page, context or browser has been closed/i
      .test(result.reason ?? '');
    if (result.available || !transientNavigation || attempt === maxAttempts) return result;
    console.log(`    retry ${scene}: transient page navigation (${attempt}/${maxAttempts})`);
    report.errors.environment.push({
      at: new Date().toISOString(),
      scene,
      attempt,
      classification: 'transient-scene-navigation-retry',
      text: result.reason,
    });
  }
  return { scene, available: false, reason: 'Scene retry loop exhausted' };
}

async function writeIncrementalReport(report, config) {
  await writeFile(
    path.join(config.outputDir, 'results.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}

function researchSequenceIsLegal(sequence, progressionEvents = []) {
  const unlocked = new Set(['eco_baseline']);
  const seen = new Set();
  const dysonEvents = progressionEvents
    .filter((entry) => entry.type === 'dyson-complete')
    .sort((a, b) => finite(a.gameTimeMs) - finite(b.gameTimeMs));
  for (const entry of sequence ?? []) {
    const node = TECH_BY_ID.get(entry.id);
    if (!node || seen.has(entry.id)) return false;
    if (!node.prereqs.every((id) => unlocked.has(id))) return false;
    const completedDysons = Number.isFinite(Number(entry.completedDysons))
      ? Number(entry.completedDysons)
      : dysonEvents.filter((event) => (
        finite(event.gameTimeMs, Infinity) <= finite(entry.gameTimeMs, -Infinity)
      )).length;
    if (node.milestones.includes('diplomacy') && completedDysons < 1) return false;
    if (node.milestones.includes('superweapon') && completedDysons < 3) return false;
    unlocked.add(entry.id);
    seen.add(entry.id);
  }
  return unlocked.size >= EXPECTED_TECH_COUNT;
}

function validateCheckpointSource(source, sourcePath, outputDir) {
  const problems = [];
  if (path.resolve(sourcePath) === path.resolve(path.join(outputDir, 'results.json'))) {
    problems.push('checkpoint source cannot be the output results file');
  }
  const byId = new Map((source.checkpoints ?? []).map((checkpoint) => [
    checkpoint.id,
    checkpoint,
  ]));
  for (const checkpointId of REQUIRED_CHECKPOINT_IDS) {
    const checkpoint = byId.get(checkpointId);
    if (!checkpoint) {
      problems.push(`missing checkpoint ${checkpointId}`);
      continue;
    }
    if (!checkpoint.save?.ok || !checkpoint.save?.localStorageKey) {
      problems.push(`checkpoint ${checkpointId} does not contain a reusable save`);
    }
    if (checkpoint.stateIdentity?.schemaVersion !== 1
        || typeof checkpoint.stateIdentity?.hash !== 'string') {
      problems.push(`checkpoint ${checkpointId} lacks the current round-trip identity schema`);
    }
    for (const problem of checkpointSemanticProblems(checkpointId, checkpoint.state ?? {})) {
      problems.push(`checkpoint ${checkpointId}: ${problem}`);
    }
  }
  const final = byId.get('final');
  if (finite(final?.state?.techUnlocked) !== EXPECTED_TECH_COUNT) {
    problems.push(`final technology count is ${finite(final?.state?.techUnlocked)}`);
  }
  if (finite(final?.state?.playerShips) !== PLAYER_FLEET_SIZE
      || finite(final?.state?.livePlayerShips) !== PLAYER_FLEET_SIZE
      || finite(final?.state?.deadPlayerShips) !== 0) {
    problems.push(
      `final player ship counts are total=${finite(final?.state?.playerShips)} live=${finite(final?.state?.livePlayerShips)} dead=${finite(final?.state?.deadPlayerShips)}`,
    );
  }
  const coveredHulls = new Set(Object.keys(final?.state?.playerHullCounts ?? {}));
  if (!FLEET_HULLS.every((hull) => coveredHulls.has(hull))) {
    problems.push('final fleet does not represent every producible fleet hull');
  }
  if (finite(final?.state?.scouts) < 1) {
    problems.push('final state does not contain a shipyard-produced scout');
  }
  if (finite(final?.state?.duplicateFleetMemberships) !== 0) {
    problems.push('final fleet membership contains duplicates');
  }
  if ((final?.state?.fleetSizes ?? []).length !== REQUIRED_FLEETS
      || !(final?.state?.fleetSizes ?? []).every((size) => size === FLEET_CAPACITY)
      || finite(final?.state?.uniqueFleetShips) !== PLAYER_FLEET_SIZE
      || finite(final?.state?.unknownFleetMemberships) !== 0
      || finite(final?.state?.deadFleetMemberships) !== 0
      || finite(final?.state?.unassignedPlayerShips) !== 0) {
    problems.push('final state does not contain four full eight-ship fleets');
  }
  if ((final?.state?.playerCompletedDysons ?? []).length !== 3
      || !(final?.state?.playerCompletedDysons ?? []).every((entry) => (
        entry.owner === 'player' && finite(entry.completedShells) >= 8
      ))) {
    problems.push('final state does not contain three player-owned completed Dyson systems');
  }
  if (!final?.state?.helioclastMobile
      || !final?.state?.helioclastLiveFireComplete
      || final?.state?.helioclastBuildJob != null
      || !HELIOCLAST_PART_ORDER.every((partId) => (
        final?.state?.helioclastInstalledParts?.includes(partId)
      ))) {
    problems.push('final Helioclast is not fully assembled, calibrated, idle, and mobile');
  }
  if (final?.state?.activeResearch != null
      || finite(final?.state?.researchQueue) !== 0
      || finite(final?.state?.empireQueue) !== 0
      || finite(final?.state?.activeBuilds) !== 0
      || finite(final?.state?.constructionJobs) !== 0
      || finite(final?.state?.failedConstructionJobs) !== 0
      || final?.state?.helioclastBuildJob != null
      || final?.state?.buildingScout) {
    problems.push('final progression queues are not quiescent');
  }
  if (!researchSequenceIsLegal(source.researchSequence, source.progressionEvents)) {
    problems.push('research sequence is missing, duplicated, or violates prerequisites');
  }
  if (source.errors?.fatal) problems.push('source run contains a fatal error');
  if ((source.errors?.console ?? []).length > 0) problems.push('source run contains console errors');
  if ((source.errors?.page ?? []).length > 0) problems.push('source run contains page errors');
  if ((source.todo ?? []).length > 0) problems.push('source run contains unresolved capability TODOs');
  return {
    ok: problems.length === 0,
    problems,
    checkpoints: REQUIRED_CHECKPOINT_IDS.map((id) => byId.get(id)).filter(Boolean),
  };
}

async function readSourceEnvelope(sourceResultsPath, checkpoint) {
  const sourceDir = path.dirname(sourceResultsPath);
  const candidates = [
    checkpoint.save?.envelopePath,
    path.join(sourceDir, 'checkpoints', checkpoint.id, 'save-envelope.json'),
  ].filter(Boolean).map((candidate) => (
    path.isAbsolute(candidate) ? candidate : path.resolve(sourceDir, candidate)
  ));
  let lastError = null;
  for (const candidate of [...new Set(candidates)]) {
    try {
      return {
        path: candidate,
        envelope: (await readFile(candidate, 'utf8')).trim(),
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw new CapabilityBlocked(`Checkpoint ${checkpoint.id} save envelope is unavailable`, {
    candidates,
    error: String(lastError?.message ?? lastError),
  });
}

async function replayCheckpointSource(
  page,
  sourceResultsPath,
  source,
  sourceValidation,
  profile,
  report,
) {
  report.researchSequence = structuredClone(source.researchSequence ?? []);
  report.progressionEvents = structuredClone(source.progressionEvents ?? []);
  report.checkpointReplay = {
    mode: 'real-save-system',
    sourceResultsPath,
    sourceCreatedAt: source.createdAt ?? null,
    sourceSeed: source.config?.seed ?? null,
    legalProgressionValidated: true,
    checkpoints: [],
  };

  for (const sourceCheckpoint of sourceValidation.checkpoints) {
    const sourceSave = await readSourceEnvelope(sourceResultsPath, sourceCheckpoint);
    const loaded = await page.evaluate(
      async ({ key, envelope, slot }) => {
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem(key, envelope);
        const result = await window.__loadSlot(slot);
        if (result?.ok) window.__getGameState().paused = true;
        return result;
      },
      {
        key: sourceCheckpoint.save.localStorageKey,
        envelope: sourceSave.envelope,
        slot: SAVE_SLOT,
      },
    );
    if (!loaded?.ok) {
      throw new CapabilityBlocked(
        `Checkpoint ${sourceCheckpoint.id} failed to load through the real save system`,
        loaded,
      );
    }
    await page.waitForTimeout(100);
    await switchToSystem(page);
    const loadedIdentity = await checkpointStateIdentity(page);
    const expectedIdentity = sourceCheckpoint.stateIdentity;
    if (expectedIdentity?.schemaVersion !== loadedIdentity.schemaVersion) {
      throw new CapabilityBlocked(
        `Checkpoint ${sourceCheckpoint.id} has no comparable round-trip identity`,
        { expected: expectedIdentity ?? null, actual: loadedIdentity },
      );
    }
    if (loadedIdentity.hash !== expectedIdentity.hash
        || loadedIdentity.serializedChars !== expectedIdentity.serializedChars) {
      throw new CapabilityBlocked(
        `Checkpoint ${sourceCheckpoint.id} round-trip identity does not match its source`,
        { expected: expectedIdentity, actual: loadedIdentity },
      );
    }
    const loadedState = await textState(page);
    const loadedTech = loadedState.research?.unlocked?.length ?? 0;
    if (loadedTech !== finite(sourceCheckpoint.state?.techUnlocked)) {
      throw new CapabilityBlocked(`Checkpoint ${sourceCheckpoint.id} load did not preserve technology`, {
        expected: sourceCheckpoint.state?.techUnlocked,
        actual: loadedTech,
      });
    }
    const loadedCounts = await diagnosticEntityCounts(page);
    const loadedMetrics = entityMetrics(loadedState, loadedCounts);
    const semanticProblems = checkpointSemanticProblems(sourceCheckpoint.id, loadedMetrics);
    if (semanticProblems.length) {
      throw new CapabilityBlocked(
        `Checkpoint ${sourceCheckpoint.id} failed semantic validation after round-trip load`,
        { problems: semanticProblems, state: loadedMetrics },
      );
    }
    report.checkpointReplay.checkpoints.push({
      id: sourceCheckpoint.id,
      sourceEnvelopePath: sourceSave.path,
      loadedThroughSaveSystem: true,
    });
    console.log(`REPLAY ${sourceCheckpoint.id}: loaded ${sourceSave.path}`);
    await profile(sourceCheckpoint.id);
  }
}

function addCheck(report, name, pass, detail = '', required = true) {
  const evaluated = pass !== null;
  report.acceptance.checks.push({
    name,
    pass: evaluated ? !!pass : null,
    detail,
    required,
    status: evaluated ? (pass ? 'pass' : 'fail') : 'unverified',
  });
}

async function profileCheckpoint(
  page,
  context,
  checkpointId,
  config,
  report,
  networkInflight,
  profileState,
) {
  if (profileState.completed.has(checkpointId)) return null;
  profileState.completed.add(checkpointId);
  const checkpointDir = path.join(config.outputDir, 'checkpoints', checkpointId);
  await mkdir(checkpointDir, { recursive: true });
  console.log(`\nCHECKPOINT ${checkpointId}`);

  await page.bringToFront();
  const mainVisibility = await page.evaluate(() => document.visibilityState);
  if (mainVisibility !== 'visible') {
    throw new CapabilityBlocked(
      `Checkpoint ${checkpointId} page was ${mainVisibility} before capture`,
    );
  }

  const stateBefore = await textState(page);
  const pauseResult = await setPausedThroughUi(page, true);
  if (!pauseResult.ok) {
    throw new CapabilityBlocked(`Could not pause the quiescent ${checkpointId} checkpoint`, pauseResult);
  }
  const rawText = await page.evaluate(() => window.render_game_to_text());
  const checkpointState = JSON.parse(rawText);
  const entityCounts = await diagnosticEntityCounts(page);
  const checkpointMetrics = entityMetrics(checkpointState, entityCounts);
  const semanticProblems = checkpointSemanticProblems(checkpointId, checkpointMetrics);
  if (semanticProblems.length) {
    throw new CapabilityBlocked(`Checkpoint ${checkpointId} failed its semantic identity`, {
      problems: semanticProblems,
      state: checkpointMetrics,
    });
  }
  const stateIdentityWithCanonical = await checkpointStateIdentity(page, { includeCanonical: true });
  const { canonical: identityCanonical, ...stateIdentity } = stateIdentityWithCanonical;
  activeCheckpointIdentity = {
    checkpointId,
    ...stateIdentity,
    canonical: identityCanonical,
  };
  await writeFile(path.join(checkpointDir, 'render-game-to-text.json'), `${rawText}\n`);
  const save = await saveCheckpointEnvelope(page, checkpointDir);
  const scenes = [];
  for (const scene of ['system', 'galaxy', 'technology', 'fleet', 'logistics']) {
    console.log(`  sample ${scene}`);
    scenes.push(await profileCloneScene(
      context,
      scene,
      checkpointDir,
      config,
      report,
      networkInflight,
      prepareLiveSceneClone,
    ));
  }
  console.log('  sample active-production clone');
  scenes.push(await profileCloneScene(
    context,
    'active-production',
    checkpointDir,
    config,
    report,
    networkInflight,
    prepareProductionClone,
  ));
  console.log('  sample tactical-combat clone');
  scenes.push(await profileCloneScene(
    context,
    'tactical-combat',
    checkpointDir,
    config,
    report,
    networkInflight,
    prepareTacticalClone,
  ));

  let simulationResult = null;
  let simulationPage = null;
  try {
    simulationPage = await cloneFromCheckpoint(context, config, report, networkInflight);
    await simulationPage.bringToFront();
    const prepared = await prepareLiveSceneClone(simulationPage);
    if (!prepared.ok) {
      throw new CapabilityBlocked(
        `Could not prepare the live ${checkpointId} simulation benchmark`,
        prepared,
      );
    }
    await switchToSystem(
      simulationPage,
      stateBefore.currentSystem ?? stateBefore.strongholdSystem,
    );
    simulationResult = await simulationBenchmark(simulationPage, config.simulationSteps);
    const minimumExpectedAdvance = config.simulationSteps * 50;
    if (simulationResult.beforePaused
      || simulationResult.afterPaused
      || simulationResult.advancedMs < minimumExpectedAdvance) {
      throw new CapabilityBlocked(
        `Simulation benchmark did not advance the live ${checkpointId} clone`,
        {
          ...simulationResult,
          durations: undefined,
          minimumExpectedAdvance,
        },
      );
    }
  } finally {
    if (simulationPage) harnessClosingPages.add(simulationPage);
    await simulationPage?.close().catch(() => {});
  }
  await page.bringToFront();
  if (!stateBefore.paused) {
    const resumeResult = await setPausedThroughUi(page, false);
    if (!resumeResult.ok) {
      throw new CapabilityBlocked(`Could not resume after profiling ${checkpointId}`, resumeResult);
    }
  }
  await switchToSystem(page, stateBefore.currentSystem ?? stateBefore.strongholdSystem);
  const memory = await cdpMemoryMetrics(page);
  const galaxyPerf = await page.evaluate(() => (
    typeof window.__galaxyPerfSummary === 'function'
      ? window.__galaxyPerfSummary()
      : null
  ));
  const checkpoint = {
    id: checkpointId,
    capturedAt: new Date().toISOString(),
    stateIdentity,
    state: { ...checkpointMetrics, domNodes: memory.nodes },
    save,
    simulation: {
      steps: simulationResult.durations.length,
      advancedMs: simulationResult.advancedMs,
      medianMs: round(percentile(simulationResult.durations, 0.5), 3),
      p95Ms: round(percentile(simulationResult.durations, 0.95), 3),
      p99Ms: round(percentile(simulationResult.durations, 0.99), 3),
      maxMs: round(Math.max(...simulationResult.durations, 0), 3),
      rawMs: simulationResult.durations,
    },
    galaxyPerf,
    scenes,
    regressions: [],
    materialDegradation: null,
  };

  if (report.checkpoints.length === 0) {
    profileState.baseline = checkpoint;
  } else if (profileState.baseline) {
    for (const scene of scenes) {
      const baselineScene = profileState.baseline.scenes.find((entry) => entry.scene === scene.scene);
      const regression = sceneRegression(scene, baselineScene, {
        strictLongTasks: !config.headless,
      });
      if (regression) checkpoint.regressions.push({ scene: scene.scene, ...regression });
    }
  }
  report.checkpoints.push(checkpoint);

  const degradedScene = checkpoint.regressions.find((entry) => entry.degraded);
  const headedInputScene = !config.headless
    ? scenes.find((scene) => (
      scene.available && finite(scene.inputToPaint?.p95Ms, Infinity) >= 100
    ))
    : null;
  const baselineSimulationP95 = finite(profileState.baseline?.simulation?.p95Ms);
  const simulationDegraded = report.checkpoints.length > 1
    && finite(checkpoint.simulation?.p95Ms, Infinity)
      > Math.max(0.001, baselineSimulationP95) * 3;
  checkpoint.materialDegradation = degradedScene
    ? {
      category: 'scene-regression',
      scene: degradedScene.scene,
      reasons: degradedScene.degradationReasons,
    }
    : headedInputScene
      ? {
        category: 'input-to-paint',
        scene: headedInputScene.scene,
        p95Ms: headedInputScene.inputToPaint.p95Ms,
      }
      : simulationDegraded
        ? {
          category: 'simulation-cost',
          scene: 'system',
          baselineP95Ms: baselineSimulationP95,
          observedP95Ms: checkpoint.simulation.p95Ms,
        }
        : !save.ok
          ? { category: 'save-failure', scene: 'system', error: save.error }
          : null;
  const firstDegradation = !profileState.firstDegradationCaptured
    && checkpoint.materialDegradation != null;
  if (config.captureProfiles && firstDegradation) {
    profileState.firstDegradationCaptured = true;
    await captureCheckpointProfiles(
      context,
      `${checkpointId}-first-degradation`,
      checkpointDir,
      config,
      report,
      networkInflight,
      checkpoint.materialDegradation,
    );
  }
  await writeIncrementalReport(report, config);
  return checkpoint;
}

async function ensureAtSystem(page, systemId) {
  const state = await textState(page);
  if (state.flagship?.systemId === systemId && !state.flagship?.inTransit) {
    await switchToSystem(page, systemId);
    return { ok: true, already: true };
  }
  const result = await page.evaluate((target) => window.__orderTravel(target), systemId);
  if (!result?.ok) {
    return { ok: false, reason: result?.reason ?? 'Flagship travel command failed' };
  }
  await advanceTime(page, finite(result.etaMs, 180_000) + 2_000);
  const after = await textState(page);
  if (after.flagship?.systemId !== systemId || after.flagship?.inTransit) {
    return { ok: false, reason: `Flagship did not arrive at ${systemId}` };
  }
  await switchToSystem(page, systemId);
  return { ok: true };
}

async function ensureShipyard(page) {
  const initial = await textState(page);
  const systemId = initial.strongholdSystem;
  const travel = await ensureAtSystem(page, systemId);
  if (!travel.ok) throw new CapabilityBlocked('Could not return flagship to Stronghold for production', travel);

  let state = await textState(page);
  let yard = state.structures?.find((structure) => (
    structure.type === 'shipyard'
      && !structure.underConstruction
      && structure.operational !== false
  ));
  if (yard) return yard;

  let outpostBody = state.bodies?.find((entry) => entry.hasOutpost);
  if (!outpostBody) {
    outpostBody = state.bodies?.find((entry) => entry.canBuildOutpost);
    if (!outpostBody) {
      throw new CapabilityBlocked('Stronghold has no body eligible for a normal outpost build');
    }
    await grantCredits(page);
    const outpost = await page.evaluate((bodyId) => window.__buildOutpost(bodyId), outpostBody.id);
    if (!outpost?.ok) {
      throw new CapabilityBlocked('Normal outpost construction command was rejected', outpost);
    }
    await advanceTime(page, STRUCTURE_BUILD_MS.outpost + 5_000);
    state = await textState(page);
    outpostBody = state.bodies?.find((entry) => entry.id === outpostBody.id);
    if (!outpostBody?.hasOutpost) {
      throw new CapabilityBlocked('Outpost job did not produce an operational outpost', outpost);
    }
  }

  const body = (outpostBody && !['gas', 'barren'].includes(outpostBody.type) ? outpostBody : null)
    ?? state.bodies?.find((entry) => entry.type === 'habitable')
    ?? state.bodies?.find((entry) => !['gas', 'barren'].includes(entry.type));
  if (!body) {
    throw new CapabilityBlocked('Stronghold has no body eligible for a normal shipyard build');
  }
  await grantCredits(page);
  const result = await page.evaluate((bodyId) => window.__buildShipyard(bodyId), body.id);
  if (!result?.ok) {
    throw new CapabilityBlocked('Normal shipyard construction command was rejected', result);
  }
  await advanceTime(page, STRUCTURE_BUILD_MS.shipyard + 5_000);
  state = await textState(page);
  yard = state.structures?.find((structure) => (
    structure.type === 'shipyard'
      && !structure.underConstruction
      && structure.operational !== false
  ));
  if (!yard) {
    throw new CapabilityBlocked('Shipyard job did not produce an operational shipyard', result);
  }
  return yard;
}

async function queueAndCompleteHull(page, hull) {
  const yard = await ensureShipyard(page);
  await grantCredits(page);
  const before = await textState(page);
  const beforeIds = new Set((hull === 'scout' ? before.scouts : before.playerShips)
    ?.map((ship) => ship.id) ?? []);
  const result = await page.evaluate(
    ({ shipyardId, hullId }) => window.__queueHull(shipyardId, hullId),
    { shipyardId: yard.id, hullId: hull },
  );
  if (!result?.ok) {
    throw new CapabilityBlocked(`Normal shipyard queue rejected ${hull}`, result);
  }
  const buildMs = finite(HULL_STATS[hull]?.buildMs, 90_000);
  let after = before;
  let completedShip = null;
  for (let attempt = 0; attempt < 8 && !completedShip; attempt += 1) {
    await advanceTime(page, buildMs + 3_000);
    after = await textState(page);
    const destroyed = (after.playerShips ?? []).filter((ship) => finite(ship.hp, 1) <= 0);
    if (destroyed.length) {
      throw new CapabilityBlocked('A player ship was destroyed during deterministic progression', {
        requestedHull: hull,
        destroyed: destroyed.map((ship) => ({ id: ship.id, hull: ship.hull })),
      });
    }
    completedShip = (hull === 'scout' ? after.scouts : after.playerShips)?.find((ship) => (
      (hull === 'scout' || ship.hull === hull)
      && !beforeIds.has(ship.id)
      && (hull === 'scout' || finite(ship.hp, 1) > 0)
    )) ?? null;
  }
  if (!completedShip) {
    throw new CapabilityBlocked(`${hull} did not complete through the shipyard queue`, {
      beforeIds: [...beforeIds],
      afterIds: (hull === 'scout' ? after.scouts : after.playerShips)?.map((ship) => ship.id),
      production: after.production,
    });
  }
  return after;
}

async function drainFinalQueues(page) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const state = await textState(page);
    const globalCounts = await diagnosticEntityCounts(page);
    if (globalCounts.failedConstructionJobs > 0) {
      throw new CapabilityBlocked('A construction job failed during deterministic progression', {
        globalCounts,
      });
    }
    const idle = state.research?.activeNodeId == null
      && (state.research?.queue?.length ?? 0) === 0
      && globalCounts.globalEmpireQueue === 0
      && globalCounts.globalActiveBuilds === 0
      && globalCounts.globalConstructionJobs === 0
      && !globalCounts.globalBuildingScout
      && state.superweapon?.buildJob == null;
    if (idle) return state;
    await advanceTime(page, 60_000);
  }
  const state = await textState(page);
  throw new CapabilityBlocked('Final progression queues did not become quiescent', {
    state: {
      time: state.time,
      research: state.research,
      production: state.production,
      superweapon: state.superweapon,
    },
    globalCounts: await diagnosticEntityCounts(page),
  });
}

async function produceFirstCorvette(page) {
  const state = await textState(page);
  const existing = state.playerShips?.find((ship) => (
    ship.hull === 'corvette' && finite(ship.hp, 1) > 0
  ));
  if (existing) return existing;
  const after = await queueAndCompleteHull(page, 'corvette');
  return after.playerShips.find((ship) => (
    ship.hull === 'corvette' && finite(ship.hp, 1) > 0
  ));
}

async function ensureScout(page) {
  const state = await textState(page);
  if ((state.scoutCount ?? 0) > 0) return state.scouts?.[0] ?? { id: null };
  const after = await queueAndCompleteHull(page, 'scout');
  return after.scouts?.[0] ?? { id: null };
}

async function produceFirstFleet(page) {
  let state = await textState(page);
  while ((state.playerShips?.filter((ship) => finite(ship.hp, 1) > 0).length ?? 0)
      < FLEET_CAPACITY) {
    state = await queueAndCompleteHull(page, 'corvette');
  }
  const assignment = await page.evaluate(
    (maxShipsPerFleet) => window.__autoAssignShipsToFleets({ maxShipsPerFleet }),
    FLEET_CAPACITY,
  );
  if (!assignment?.ok) {
    throw new CapabilityBlocked('Normal fleet auto-assignment failed', assignment);
  }
  state = await textState(page);
  const full = state.battleGroups?.find((group) => group.shipIds?.length === FLEET_CAPACITY);
  if (!full) {
    throw new CapabilityBlocked('Eight completed ships did not form an eight-ship fleet', {
      assignment,
      battleGroups: state.battleGroups,
    });
  }
  const anchored = await page.evaluate(
    (groupId) => window.__setBattleGroupFlagshipAnchor(groupId, true),
    full.id,
  );
  if (!anchored?.ok) {
    throw new CapabilityBlocked('The first eight-ship fleet could not anchor to the flagship', {
      groupId: full.id,
      anchored,
    });
  }
  return full;
}

async function advanceUntilSolarii(page, requiredAmount, ensureDysons) {
  let state = await textState(page);
  if (finite(state.solarii) >= requiredAmount) return state;
  if (!state.solariiUnlocked) {
    await ensureDysons(1);
    state = await textState(page);
  }
  if (state.solariiUnlocked && finite(state.solarii) < requiredAmount) {
    const amount = requiredAmount - finite(state.solarii) + 5;
    const granted = await page.evaluate(
      (grantAmount) => window.__devAction('grantSolarii', { amount: grantAmount }),
      amount,
    );
    if (!granted?.ok) {
      throw new CapabilityBlocked('Permitted post-Shell-1 Solarii grant failed', granted);
    }
    state = await textState(page);
    if (finite(state.solarii) >= requiredAmount) return state;
  }
  for (let attempt = 0; attempt < 40 && finite(state.solarii) < requiredAmount; attempt += 1) {
    await grantCredits(page, 25_000_000);
    const grossRate = Math.max(0.01, finite(state.solariiPerSec, 0.01));
    const missing = requiredAmount - finite(state.solarii);
    const waitMs = Math.min(
      10 * 60_000,
      Math.max(60_000, Math.ceil((missing + 5) / grossRate) * 1_000),
    );
    await advanceTime(page, waitMs);
    state = await textState(page);
  }
  if (finite(state.solarii) < requiredAmount) {
    throw new CapabilityBlocked(`Natural Dyson production did not reach ${requiredAmount} Solarii`, {
      current: state.solarii,
      rate: state.solariiPerSec,
      dysons: state.milestones,
    });
  }
  return state;
}

async function selectClaimTarget(page, preferredId = null) {
  return page.evaluate((preferred) => {
    const state = window.__getGameState();
    const galaxy = state.galaxies?.[state.activeGalaxyId];
    const systems = galaxy?.systems ?? {};
    const current = state.flagship?.systemId ?? state.stronghold;
    const edges = (galaxy?.graph?.lanes ?? [])
      .map((lane) => (
        Array.isArray(lane)
          ? [lane[0], lane[1]]
          : [lane.from ?? lane.a, lane.to ?? lane.b]
      ))
      .filter(([a, b]) => a && b);
    const neighbors = edges
      .filter(([a, b]) => a === current || b === current)
      .map(([a, b]) => (a === current ? b : a));
    const strongholdNeighbors = edges
      .filter(([a, b]) => a === state.stronghold || b === state.stronghold)
      .map(([a, b]) => (a === state.stronghold ? b : a));
    const eligible = (systemId) => {
      const system = systems[systemId];
      return system
        && systemId !== 'core'
        && systemId !== state.stronghold
        && system.owner === 'neutral'
        && system.star?.kind !== 'trade_nexus';
    };
    const target = (preferred && eligible(preferred) ? preferred : null)
      ?? strongholdNeighbors.find(eligible)
      ?? neighbors.find(eligible)
      ?? Object.keys(systems).find(eligible)
      ?? null;
    return target ? {
      id: target,
      current,
      owner: systems[target]?.owner ?? null,
      name: systems[target]?.name ?? target,
    } : null;
  }, preferredId);
}

async function scoutTarget(page, targetSystemId) {
  const state = await textState(page);
  const scout = state.scouts?.find((entry) => !entry.inTransit);
  if (!scout?.id) return { ok: false, reason: 'No idle scout available' };
  const result = await page.evaluate(
    ({ scoutId, target }) => {
      window.__selectScout(scoutId);
      return window.__orderScout(scoutId, target);
    },
    { scoutId: scout.id, target: targetSystemId },
  );
  if (result?.ok) await advanceTime(page, finite(result.etaMs, 180_000) + 1_000);
  return result;
}

async function claimSystem(page, target) {
  await ensureScout(page);
  await scoutTarget(page, target.id);
  const travel = await page.evaluate((systemId) => window.__orderTravel(systemId), target.id);
  if (!travel?.ok) {
    throw new CapabilityBlocked(`Flagship could not set a normal course to ${target.name}`, {
      target,
      travel,
    });
  }

  // Arrival and the uncontested hold must be separate simulation calls.
  // checkFlagshipArrival gathers intel only after advanceTime returns.
  await advanceTime(page, finite(travel.etaMs, 300_000) + 2_000);
  await page.waitForTimeout(50);
  const arrival = await page.evaluate((systemId) => {
    const state = window.__getGameState();
    const anchoredIds = new Set(
      (state.battleGroups ?? [])
        .filter((group) => group.anchorFlagship)
        .flatMap((group) => group.shipIds ?? []),
    );
    const anchoredShips = (state.playerShips ?? []).filter((ship) => anchoredIds.has(ship.id));
    return {
      flagshipSystemId: state.flagship?.systemId ?? null,
      flagshipInTransit: !!state.flagship?.transit,
      anchoredShipCount: anchoredShips.length,
      anchoredShipsPresent: anchoredShips.filter((ship) => (
        ship.systemId === systemId && !ship.transit && ship.hp > 0
      )).length,
    };
  }, target.id);
  if (arrival.flagshipSystemId !== target.id
      || arrival.flagshipInTransit
      || arrival.anchoredShipsPresent < FLEET_CAPACITY) {
    throw new CapabilityBlocked(`Flagship fleet did not arrive intact at ${target.name}`, arrival);
  }
  await advanceTime(page, 20_500);

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const status = await page.evaluate((systemId) => {
      const state = window.__getGameState();
      const system = state.galaxies?.[state.activeGalaxyId]?.systems?.[systemId];
      return {
        owner: system?.owner ?? null,
        flagshipSystemId: state.flagship?.systemId ?? null,
        flagshipHp: state.flagship?.hp ?? 0,
        activeBattle: !!state.systemBattles?.[systemId]?.active,
      };
    }, target.id);
    if (status.owner === 'player') {
      await switchToSystem(page, target.id);
      return status;
    }
    if (status.flagshipHp <= 0) {
      throw new CapabilityBlocked(`Flagship was destroyed while claiming ${target.name}`, status);
    }
    await grantCredits(page, 10_000_000);
    await advanceTime(page, 30_000);
  }
  throw new CapabilityBlocked(`Normal travel and fleet presence did not capture ${target.name}`, {
    target,
  });
}

async function ensureBuilderDroneAt(page, systemId) {
  const capability = await page.evaluate((target) => {
    if (typeof window.__canDeployBuilderDrone !== 'function'
        || typeof window.__deployBuilderDrone !== 'function') {
      return { ok: false, unavailable: true, reason: 'Builder-drone commands unavailable' };
    }
    return window.__canDeployBuilderDrone(target);
  }, systemId);
  if (capability?.ok) {
    const deployed = await page.evaluate((target) => window.__deployBuilderDrone(target), systemId);
    if (deployed?.ok) {
      await advanceTime(page, finite(deployed.etaMs, 120_000) + 10_000);
      return deployed;
    }
    return deployed;
  }
  return capability;
}

async function buildFoundryNormally(page, systemId, bodyId) {
  await grantCredits(page, 25_000_000);
  let result = await page.evaluate(
    ({ target, body }) => {
      window.__viewSystem(target);
      return window.__buildFoundry(body);
    },
    { target: systemId, body: bodyId },
  );
  if (!result?.ok && /drone/i.test(result?.reason ?? '')) {
    await ensureBuilderDroneAt(page, systemId);
    result = await page.evaluate((body) => window.__buildFoundry(body), bodyId);
  }
  if (!result?.ok && !/already/i.test(result?.reason ?? '')) {
    throw new CapabilityBlocked(`Normal Sail Foundry construction failed in ${systemId}`, result);
  }
  await advanceTime(page, STRUCTURE_BUILD_MS.sail_foundry + 8_000);
}

async function buildLaunchersNormally(page, systemId, bodyIds) {
  const targetLauncherCount = bodyIds.length * 3;
  let state = await textState(page);
  await grantCredits(page, 5_000_000);
  let submitted = 0;

  // The launcher's normal pending-count guard intentionally admits one
  // command per body at a time. Submit a complete per-body wave, let the
  // ordinary drone queue finish it, then submit the next wave.
  for (let wave = 1; wave <= 3; wave += 1) {
    state = await textState(page);
    for (const bodyId of bodyIds) {
      const existing = (state.structures ?? []).filter((structure) => (
        structure.type === 'dyson_launcher'
          && structure.bodyId === bodyId
          && !structure.underConstruction
          && structure.operational !== false
      )).length;
      if (existing >= wave) continue;
      const result = await page.evaluate((body) => window.__buildLauncher(body), bodyId);
      if (!result?.ok) {
        throw new CapabilityBlocked(`Normal Dyson launcher construction failed on ${bodyId}`, {
          systemId,
          bodyId,
          wave,
          result,
        });
      }
      submitted += 1;
    }

    const waveTarget = bodyIds.length * wave;
    let waveCount = 0;
    for (let poll = 0; poll < 120; poll += 1) {
      state = await textState(page);
      waveCount = state.structures?.filter((structure) => (
        structure.type === 'dyson_launcher'
          && !structure.underConstruction
          && structure.operational !== false
      )).length ?? 0;
      if (waveCount >= waveTarget) break;
      if (poll % 8 === 0) {
        console.log(`  Dyson ${systemId}: ${waveCount}/${targetLauncherCount} launchers operational`);
      }
      await advanceTime(page, 15_000);
    }
    if (waveCount < waveTarget) {
      throw new CapabilityBlocked(`Dyson launcher wave ${wave} stalled in ${systemId}`, {
        target: waveTarget,
        actual: waveCount,
        submitted,
      });
    }
  }

  state = await textState(page);
  const count = state.structures?.filter((structure) => (
    structure.type === 'dyson_launcher'
      && !structure.underConstruction
      && structure.operational !== false
  )).length ?? 0;
  console.log(`  Dyson ${systemId}: ${count}/${targetLauncherCount} launchers operational`);
  return count;
}

async function finishDysonNormally(page, systemId) {
  await switchToSystem(page, systemId);
  let state = await textState(page);
  const existingShells = finite(state.dyson?.completedShells);
  if (existingShells >= REQUIRED_DYSON_SHELLS) return state;
  const bodyIds = (state.bodies ?? [])
    .flatMap((body) => [
      body.id,
      ...(body.moons ?? []).map((moon) => moon.id),
    ])
    .filter(Boolean);
  if (bodyIds.length === 0) {
    throw new CapabilityBlocked(`System ${systemId} has no bodies for Dyson infrastructure`);
  }
  if (!state.structures?.some((structure) => (
    structure.type === 'sail_foundry'
      && !structure.underConstruction
      && structure.operational !== false
  ))) {
    await buildFoundryNormally(page, systemId, bodyIds[0]);
  }
  await buildLaunchersNormally(page, systemId, bodyIds);

  for (let attempt = 0; attempt < 36; attempt += 1) {
    state = await textState(page);
    if (finite(state.dyson?.completedShells) >= REQUIRED_DYSON_SHELLS) return state;
    await grantCredits(page, 20_000_000);
    await advanceTime(page, SIMULATION_CHUNK_MS);
  }
  state = await textState(page);
  throw new CapabilityBlocked(`Dyson in ${systemId} did not finish through sail production`, {
    completedShells: state.dyson?.completedShells,
    dyson: state.dyson,
    structures: state.structures?.filter((entry) => (
      entry.type === 'sail_foundry' || entry.type === 'dyson_launcher'
    )),
  });
}

async function produceFinalFleet(page) {
  const returnTrip = await ensureAtSystem(page, (await textState(page)).strongholdSystem);
  if (!returnTrip.ok) {
    throw new CapabilityBlocked('Could not return to Stronghold to build the final fleet', returnTrip);
  }
  let state = await textState(page);
  const counts = new Map();
  for (const ship of (state.playerShips ?? []).filter((entry) => finite(entry.hp, 1) > 0)) {
    counts.set(ship.hull, (counts.get(ship.hull) ?? 0) + 1);
  }
  for (const hull of FLEET_HULLS) {
    if ((counts.get(hull) ?? 0) > 0) continue;
    state = await queueAndCompleteHull(page, hull);
    counts.set(hull, (counts.get(hull) ?? 0) + 1);
  }
  let fillerIndex = 0;
  while ((state.playerShips?.filter((ship) => finite(ship.hp, 1) > 0).length ?? 0)
      < PLAYER_FLEET_SIZE) {
    const hull = FILLER_HULLS[fillerIndex % FILLER_HULLS.length];
    fillerIndex += 1;
    state = await queueAndCompleteHull(page, hull);
  }
  const assignment = await page.evaluate(
    (maxShipsPerFleet) => window.__autoAssignShipsToFleets({ maxShipsPerFleet }),
    FLEET_CAPACITY,
  );
  if (!assignment?.ok) {
    throw new CapabilityBlocked('Final fleet auto-assignment failed', assignment);
  }
  state = await textState(page);
  return state;
}

async function assembleHelioclast(page, ensureSolarii) {
  const state = await textState(page);
  const stronghold = state.strongholdSystem;
  const travel = await ensureAtSystem(page, stronghold);
  if (!travel.ok) {
    throw new CapabilityBlocked('Could not return to Stronghold for Helioclast assembly', travel);
  }
  await grantCredits(page, CREDIT_GRANT);
  await ensureSolarii(120);
  let current = await textState(page);
  if (!current.superweapon?.cradleSystemId) {
    const cradle = await page.evaluate(() => window.__buildSuperweaponCradle());
    if (!cradle?.ok && !/already/i.test(cradle?.reason ?? '')) {
      throw new CapabilityBlocked('Normal Helioclast shipyard construction failed', cradle);
    }
    await advanceTime(page, STRUCTURE_BUILD_MS.helioclast_shipyard + 8_000);
  }

  for (const partId of HELIOCLAST_PART_ORDER) {
    current = await textState(page);
    if (current.superweapon?.installedParts?.[partId]) continue;
    await ensureSolarii(30);
    await grantCredits(page, 10_000_000);
    const install = await page.evaluate((part) => window.__installSuperweaponPart(part), partId);
    if (!install?.ok) {
      throw new CapabilityBlocked(`Normal Helioclast assembly rejected ${partId}`, install);
    }
    await advanceTime(page, finite(install.buildJob?.durationMs, 30_000) + 2_000);
  }

  current = await textState(page);
  if (!current.superweapon?.liveFireComplete) {
    await page.evaluate(() => document.querySelector('#tab-fleet')?.click());
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const helioclastTab = [...document.querySelectorAll('.fleet-subtabs button')]
        .find((entry) => entry.textContent?.trim() === 'Helioclast');
      helioclastTab?.click();
    });
    await page.waitForTimeout(300);
    const calibration = await page.evaluate(() => {
      const button = [...document.querySelectorAll('button')]
        .find((entry) => /run live-fire test/i.test(entry.textContent ?? ''));
      if (!button || button.disabled) {
        return {
          ok: false,
          reason: button ? 'Live-fire calibration is disabled' : 'Live-fire calibration control unavailable',
        };
      }
      button.click();
      return { ok: true };
    });
    if (!calibration.ok) {
      throw new CapabilityBlocked('Could not complete Helioclast live-fire through its normal UI control', calibration);
    }
    await advanceTime(page, 2_000);
  }

  current = await textState(page);
  const missingParts = HELIOCLAST_PART_ORDER.filter((partId) => (
    !current.superweapon?.installedParts?.[partId]
  ));
  if (!current.superweapon?.mobile
      || !current.superweapon?.liveFireComplete
      || current.superweapon?.buildJob != null
      || missingParts.length > 0
      || finite(current.superweapon?.ship?.hp) <= 0) {
    throw new CapabilityBlocked('Helioclast assembly did not complete every required system', {
      missingParts,
      superweapon: current.superweapon,
    });
  }
  return current;
}

function markdownReport(report) {
  const lines = [
    '# Solo End-to-End Performance Report',
    '',
    `- Created: ${report.createdAt}`,
    `- URL: ${report.config.url}`,
    `- Mode: ${report.config.mode}`,
    `- Seed: ${report.config.seed}`,
    `- Browser: ${report.measurementEnvironment.browserMode}`,
    `- Render acceptance: ${report.measurementEnvironment.renderAcceptanceProfile}`,
    `- Renderer: ${report.measurementEnvironment.renderer ?? 'unavailable'}`,
    `- Technology nodes: ${report.metadata.discoveredTechCount}/${report.metadata.expectedTechCount}`,
    ...(report.checkpointReplay
      ? [`- Checkpoint replay source: ${report.checkpointReplay.sourceResultsPath}`]
      : []),
    '',
    '## Checkpoints',
    '',
    '| Checkpoint | Tech | Ships | Fleets | Player Dysons | Helioclast | Sim p95 (ms) |',
    '|---|---:|---:|---:|---:|---:|---:|',
  ];
  for (const checkpoint of report.checkpoints) {
    lines.push([
      `| ${checkpoint.id}`,
      checkpoint.state.techUnlocked,
      checkpoint.state.playerShips,
      checkpoint.state.battleGroups,
      checkpoint.state.playerCompletedDysons?.length ?? 0,
      checkpoint.state.helioclastStage,
      checkpoint.simulation.p95Ms ?? 'n/a',
      '|',
    ].join(' | '));
  }

  lines.push(
    '',
    '## Scene FPS',
    '',
    '| Checkpoint | Scene | FPS | p95 frame (ms) | p99 frame (ms) | Input p95 (ms) | Galaxy draw p95 (ms) | Long tasks >50 ms | Heap (MB) |',
    '|---|---|---:|---:|---:|---:|---:|---:|---:|',
  );
  for (const checkpoint of report.checkpoints) {
    for (const scene of checkpoint.scenes) {
      if (!scene.available) {
        lines.push(`| ${checkpoint.id} | ${scene.scene} | unavailable |  |  |  |  |  |  |`);
        continue;
      }
      lines.push([
        `| ${checkpoint.id}`,
        scene.scene,
        scene.effectiveFps ?? 'n/a',
        scene.frameIntervalMs?.p95 ?? 'n/a',
        scene.frameIntervalMs?.p99 ?? 'n/a',
        scene.inputToPaint?.p95Ms ?? 'n/a',
        scene.galaxyDrawMs?.p95 ?? 'n/a',
        scene.longTasks?.over50Ms ?? 0,
        scene.memory?.jsHeapUsedBytes == null
          ? 'n/a'
          : round(scene.memory.jsHeapUsedBytes / (1024 * 1024), 1),
        '|',
      ].join(' | '));
    }
  }

  lines.push('', '## Acceptance', '');
  for (const check of report.acceptance.checks) {
    const label = check.status === 'unverified'
      ? 'UNVERIFIED'
      : check.pass
        ? 'PASS'
        : 'FAIL';
    lines.push(`- ${label} — ${check.name}${check.detail ? `: ${check.detail}` : ''}`);
  }
  if (report.todo.length > 0) {
    lines.push('', '## Capability TODOs', '');
    for (const item of report.todo) {
      lines.push(`- ${item.message}${item.detail ? ` — ${JSON.stringify(item.detail)}` : ''}`);
    }
  }
  if (report.network.backendCorrelation) {
    lines.push(
      '',
      '## Backend correlation',
      '',
      `- ${report.network.backendCorrelation.conclusion}`,
      `- Slow requests: ${report.network.backendCorrelation.slowRequestCount}`,
      `- Long-task overlaps: ${report.network.backendCorrelation.overlapCount}`,
    );
  }
  return `${lines.join('\n')}\n`;
}

function finalizeNetwork(report) {
  const requests = report.network.requests;
  const backendRequests = requests.filter(isBackendRuntimeRequest);
  const slow = backendRequests.filter((entry) => entry.durationMs >= 200);
  const overlaps = report.checkpoints.flatMap((checkpoint) => checkpoint.scenes)
    .filter((scene) => scene.available)
    .reduce((sum, scene) => sum + finite(scene.networkOverlap?.backendRequestCount), 0);
  report.network.summary = {
    requestCount: requests.length,
    failedCount: requests.filter((entry) => entry.failed).length,
    backendRequestCount: backendRequests.length,
    failedBackendRequestCount: backendRequests.filter((entry) => entry.failed).length,
    slowRequestCount: slow.length,
    p95DurationMs: round(percentile(backendRequests.map((entry) => entry.durationMs), 0.95)),
    maxDurationMs: round(Math.max(...backendRequests.map((entry) => entry.durationMs), 0)),
  };
  const likelyBackend = slow.length > 0 && overlaps >= 2;
  report.network.backendCorrelation = {
    likelyBackend,
    slowRequestCount: slow.length,
    overlapCount: overlaps,
    conclusion: likelyBackend
      ? 'Slow network activity repeatedly overlaps main-thread stalls; collect CT host telemetry before sizing or migrating hosting.'
      : 'The browser run does not show repeated network/main-thread overlap; additional CT headroom or cloud hosting is not supported by this run.',
  };
}

function finalizeAcceptance(report) {
  const baseline = report.checkpoints[0];
  const final = report.checkpoints.find((entry) => entry.id === 'final')
    ?? report.checkpoints.at(-1);
  const requiredScenes = [
    'system',
    'galaxy',
    'technology',
    'fleet',
    'logistics',
    'active-production',
    'tactical-combat',
  ];
  if (!baseline || !final) {
    addCheck(report, 'Baseline and final checkpoints captured', false);
  } else {
    for (const checkpoint of report.checkpoints.slice(1)) {
      for (const regression of checkpoint.regressions) {
        const scene = checkpoint.scenes.find((entry) => entry.scene === regression.scene);
        addCheck(
          report,
          `${checkpoint.id}/${regression.scene} remains within frame budget`,
          !regression.degraded,
          [
            `fpsRatio=${regression.fpsRatio}`,
            `p95=${scene?.frameIntervalMs?.p95 ?? 'n/a'}ms/${regression.p95LimitMs}ms`,
            `longTasks>50=${scene?.longTasks?.over50Ms ?? 0}`,
            `longTaskP95=${scene?.longTasks?.p95Ms ?? 0}ms/${regression.longTaskP95LimitMs}ms`,
            `policy=${regression.longTaskPolicy}`,
            `reasons=${regression.degradationReasons.join(',') || 'none'}`,
          ].join(', '),
        );
      }
    }
    for (const checkpoint of report.checkpoints) {
      const sceneByName = new Map(
        checkpoint.scenes.map((scene) => [scene.scene, scene]),
      );
      const unavailable = requiredScenes.filter(
        (sceneName) => !sceneByName.get(sceneName)?.available,
      );
      addCheck(
        report,
        `${checkpoint.id} exposes all ${requiredScenes.length} required live scenes`,
        unavailable.length === 0,
        unavailable.length
          ? `unavailable=${unavailable.join(',')}`
          : 'all scenes live',
      );
      for (const scene of checkpoint.scenes.filter((entry) => entry.available)) {
        if (report.config.headless) {
          addCheck(
            report,
            `${checkpoint.id}/${scene.scene} player-visible input-to-paint below 100ms`,
            null,
            `observed=${scene.inputToPaintMs}ms; strict evaluation is reserved for the headed run`,
            false,
          );
        } else {
          addCheck(
            report,
            `${checkpoint.id}/${scene.scene} input-to-paint below 100ms`,
            finite(scene.inputToPaint?.p95Ms, Infinity) < 100
              && finite(scene.inputToPaint?.samples) >= 3,
            `p95=${scene.inputToPaint?.p95Ms ?? 'n/a'}ms samples=${scene.inputToPaint?.samples ?? 0}`,
          );
          addCheck(
            report,
            `${checkpoint.id}/${scene.scene} has no repeating game-loop task over 50ms`,
            finite(scene.longTasks?.over50Ms) < 2,
            `tasksOver50Ms=${scene.longTasks?.over50Ms ?? 0} max=${scene.longTasks?.maxMs ?? 0}ms`,
          );
        }
      }
    }
    if (report.config.headless) {
      const repeatingSceneCount = report.checkpoints
        .flatMap((checkpoint) => checkpoint.scenes)
        .filter((scene) => scene.available && finite(scene.longTasks?.over50Ms) >= 2)
        .length;
      addCheck(
        report,
        'No repeating player-visible game-loop long task exceeds 50ms',
        null,
        `strict evaluation is reserved for the headed run; ${repeatingSceneCount} headless scene samples contained generic repeating browser long tasks`,
        false,
      );
    }

    addCheck(
      report,
      'Final simulation cost remains below three times baseline',
      finite(final.simulation?.p95Ms, Infinity)
        <= Math.max(0.001, finite(baseline.simulation?.p95Ms)) * 3,
      `baseline=${baseline.simulation?.p95Ms}ms final=${final.simulation?.p95Ms}ms`,
    );
    addCheck(
      report,
      `All ${EXPECTED_TECH_COUNT} technologies completed`,
      final.state.techUnlocked === EXPECTED_TECH_COUNT,
      `${final.state.techUnlocked}/${EXPECTED_TECH_COUNT}`,
    );
    addCheck(
      report,
      `Exactly ${PLAYER_FLEET_SIZE} live ships completed through shipyards`,
      final.state.playerShips === PLAYER_FLEET_SIZE
        && final.state.livePlayerShips === PLAYER_FLEET_SIZE
        && final.state.deadPlayerShips === 0,
      `total=${final.state.playerShips} live=${final.state.livePlayerShips} dead=${final.state.deadPlayerShips}`,
    );
    const covered = new Set(Object.keys(final.state.playerHullCounts ?? {}));
    addCheck(
      report,
      `Every one of the ${FLEET_HULLS.length} fleet hulls is represented`,
      FLEET_HULLS.every((hull) => covered.has(hull)),
      `covered=${covered.size}/${FLEET_HULLS.length}`,
    );
    addCheck(
      report,
      'The scout product completed through a shipyard',
      final.state.scouts >= 1,
      `scouts=${final.state.scouts}`,
    );
    addCheck(
      report,
      `Exactly ${REQUIRED_FLEETS} fleets contain ${FLEET_CAPACITY} live unique ships each`,
      final.state.battleGroups === REQUIRED_FLEETS
        && final.state.fleetSizes.length === REQUIRED_FLEETS
        && final.state.fleetSizes.every((size) => size === FLEET_CAPACITY)
        && final.state.uniqueFleetShips === PLAYER_FLEET_SIZE
        && final.state.duplicateFleetMemberships === 0
        && final.state.unknownFleetMemberships === 0
        && final.state.deadFleetMemberships === 0
        && final.state.unassignedPlayerShips === 0,
      [
        `sizes=${final.state.fleetSizes.join(',')}`,
        `unique=${final.state.uniqueFleetShips}`,
        `duplicates=${final.state.duplicateFleetMemberships}`,
        `unknown=${final.state.unknownFleetMemberships}`,
        `dead=${final.state.deadFleetMemberships}`,
        `unassigned=${final.state.unassignedPlayerShips}`,
      ].join(' '),
    );
    addCheck(
      report,
      'Final research, production, and construction queues are quiescent',
      final.state.activeResearch == null
        && final.state.researchQueue === 0
        && final.state.empireQueue === 0
        && final.state.activeBuilds === 0
        && final.state.constructionJobs === 0
        && final.state.failedConstructionJobs === 0
        && final.state.helioclastBuildJob == null
        && !final.state.buildingScout,
      [
        `research=${final.state.activeResearch ?? 'idle'}`,
        `researchQueue=${final.state.researchQueue}`,
        `empireQueue=${final.state.empireQueue}`,
        `activeBuilds=${final.state.activeBuilds}`,
        `constructionJobs=${final.state.constructionJobs}`,
        `pausedConstructionJobs=${final.state.pausedConstructionJobs}`,
        `failedConstructionJobs=${final.state.failedConstructionJobs}`,
        `completedConstructionHistory=${final.state.completedConstructionJobs}`,
        `helioclastBuildJob=${final.state.helioclastBuildJob?.partId ?? 'idle'}`,
        `buildingScout=${final.state.buildingScout}`,
      ].join(' '),
    );
    addCheck(
      report,
      'Three distinct player-owned eight-shell Dyson systems completed naturally',
      final.state.playerCompletedDysons.length === 3
        && final.state.playerCompletedDysons.every((entry) => (
          entry.owner === 'player' && finite(entry.completedShells) >= 8
        ))
        && new Set(
          report.progressionEvents
            .filter((entry) => entry.type === 'dyson-complete')
            .map((entry) => entry.systemId),
        ).size === 3,
      [
        `playerDysons=${final.state.playerCompletedDysons.length}`,
        `globalDysons=${final.state.dysonSystems}`,
        `events=${report.progressionEvents.filter((entry) => entry.type === 'dyson-complete').length}`,
      ].join(' '),
    );
    addCheck(
      report,
      'Helioclast completed every required part, live-fire, and mobility step',
      final.state.helioclastMobile
        && final.state.helioclastLiveFireComplete
        && final.state.helioclastBuildJob == null
        && HELIOCLAST_PART_ORDER.every((partId) => (
          final.state.helioclastInstalledParts?.includes(partId)
        )),
      `stage=${final.state.helioclastStage} parts=${final.state.helioclastInstalledParts?.length ?? 0}/${HELIOCLAST_PART_ORDER.length} liveFire=${final.state.helioclastLiveFireComplete} buildJob=${final.state.helioclastBuildJob?.partId ?? 'idle'}`,
    );
    addCheck(
      report,
      'Final reusable save serialized successfully',
      final.save?.ok && finite(final.save?.bytes) > 0,
      `ok=${!!final.save?.ok} bytes=${final.save?.bytes ?? 0}`,
    );
  }
  const legalResearchSequence = researchSequenceIsLegal(
    report.researchSequence,
    report.progressionEvents,
  );
  const invalidCheckpointSaves = report.checkpoints.filter((checkpoint) => (
    !checkpoint.save?.ok
    || !checkpoint.save?.localStorageKey
    || finite(checkpoint.save?.bytes) <= 0
  ));
  addCheck(
    report,
    'Every checkpoint produced a reusable save envelope',
    report.checkpoints.length === REQUIRED_CHECKPOINT_IDS.length
      && invalidCheckpointSaves.length === 0,
    invalidCheckpointSaves.length
      ? `invalid=${invalidCheckpointSaves.map((entry) => entry.id).join(',')}`
      : `${report.checkpoints.length}/${REQUIRED_CHECKPOINT_IDS.length} reusable saves`,
  );
  addCheck(
    report,
    'Research sequence obeyed every declared prerequisite',
    legalResearchSequence,
    `${report.researchSequence.length} researched nodes plus baseline`,
  );
  addCheck(
    report,
    'Harness completed without a fatal error',
    report.errors.fatal == null,
    report.errors.fatal ?? 'none',
  );
  addCheck(
    report,
    'Full runs capture required CPU profiles and heap snapshots',
    report.config.mode !== 'full' || report.config.captureProfiles,
    report.config.captureProfiles ? 'profile capture enabled' : 'full mode was run with --profiles=false',
  );
  addCheck(
    report,
    'Full runs enforce the 5s warm-up and three 15s scene samples',
    report.config.mode !== 'full' || (
      finite(report.config.warmupMs) >= 5_000
      && finite(report.config.sampleMs) >= 15_000
      && finite(report.config.samples) >= 3
    ),
    `warmup=${report.config.warmupMs}ms sample=${report.config.sampleMs}ms count=${report.config.samples}`,
  );
  if (report.config.captureProfiles) {
    const finalProfile = report.profiles.find((entry) => entry.checkpointId === 'final');
    const degradedCheckpointExists = report.checkpoints.some((checkpoint) => (
      checkpoint.materialDegradation != null
    ));
    const degradationProfile = report.profiles.find((entry) => (
      entry.checkpointId.endsWith('-first-degradation')
    ));
    addCheck(
      report,
      'Final live-loop CPU profile and heap snapshot captured',
      !!finalProfile?.cpu?.ok && !!finalProfile?.heap?.ok,
      finalProfile
        ? `cpu=${!!finalProfile.cpu?.ok} heap=${!!finalProfile.heap?.ok}`
        : 'missing final profile',
    );
    addCheck(
      report,
      'First materially degraded checkpoint was profiled when present',
      !degradedCheckpointExists
        || (!!degradationProfile?.cpu?.ok && !!degradationProfile?.heap?.ok),
      degradedCheckpointExists
        ? degradationProfile
          ? `checkpoint=${degradationProfile.checkpointId} cpu=${!!degradationProfile.cpu?.ok} heap=${!!degradationProfile.heap?.ok}`
          : 'degradation present but profile missing'
        : 'no materially degraded checkpoint in this run',
    );
  }
  addCheck(
    report,
    'No browser console errors',
    report.errors.console.length === 0,
    `${report.errors.console.length} errors`,
  );
  addCheck(
    report,
    'No browser page errors',
    report.errors.page.length === 0,
    `${report.errors.page.length} errors`,
  );
  addCheck(
    report,
    'No failed network requests',
    report.errors.requests.length === 0,
    `${report.errors.requests.length} failures`,
    false,
  );
  report.acceptance.partial = report.todo.length > 0;
  report.acceptance.passed = report.acceptance.checks
    .filter((check) => check.required)
    .every((check) => check.pass)
    && !report.acceptance.partial;
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  await mkdir(config.outputDir, { recursive: true });
  const report = createRunReport(config);
  const chromium = loadChromium();
  const browser = await chromium.launch({ headless: config.headless });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  const networkInflight = new Map();
  attachDiagnostics(page, report, networkInflight);
  const profileState = {
    completed: new Set(),
    baseline: null,
    firstDegradationCaptured: false,
  };

  const profile = (id) => profileCheckpoint(
    page,
    context,
    id,
    config,
    report,
    networkInflight,
    profileState,
  );

  let ensuringDysons = false;
  const ensureDysons = async (targetCount) => {
    if (ensuringDysons) {
      throw new CapabilityBlocked('Dyson progression re-entered while resolving a prerequisite');
    }
    ensuringDysons = true;
    try {
      let state = await textState(page);
      let playerDysons = (await diagnosticEntityCounts(page)).playerCompletedDysons;
      while (playerDysons.length < targetCount) {
        const completed = playerDysons.length;
        let systemId;
        if (completed === 0) {
          systemId = state.strongholdSystem;
          const atStronghold = await ensureAtSystem(page, systemId);
          if (!atStronghold.ok) {
            throw new CapabilityBlocked('Could not reach Stronghold for first Dyson', atStronghold);
          }
        } else {
          const target = await selectClaimTarget(page, CLAIM_TARGET_IDS[completed - 1] ?? null);
          if (!target) {
            throw new CapabilityBlocked('No neutral non-Nexus system is available for the next Dyson');
          }
          await claimSystem(page, target);
          systemId = target.id;
        }
        await finishDysonNormally(page, systemId);
        state = await textState(page);
        playerDysons = (await diagnosticEntityCounts(page)).playerCompletedDysons;
        const completedRecord = playerDysons.find((entry) => entry.systemId === systemId);
        const nowCompleted = playerDysons.length;
        if (completedRecord?.owner !== 'player'
          || finite(completedRecord?.completedShells) < 8) {
          throw new CapabilityBlocked(
            'Dyson completion did not remain an eight-shell player-owned system',
            { systemId, completedRecord, playerDysons },
          );
        }
        report.progressionEvents.push({
          type: 'dyson-complete',
          systemId,
          completedDysons: nowCompleted,
          globalCompletedDysons: finite(state.milestones?.completedDysonCount),
          owner: completedRecord.owner,
          completedShells: completedRecord.completedShells,
          gameTimeMs: state.time,
        });
        if (nowCompleted === 1) await profile('first-dyson');
        if (nowCompleted === 3) await profile('third-dyson');
        if (nowCompleted <= completed) {
          throw new CapabilityBlocked('Completed Dyson did not advance empire milestones', {
            before: completed,
            after: nowCompleted,
            systemId,
          });
        }
      }
      return state;
    } finally {
      ensuringDysons = false;
    }
  };

  const ensureSolarii = async (amount) => advanceUntilSolarii(page, amount, ensureDysons);

  try {
    console.log(`Solo ETE performance run: ${config.mode} at ${config.url}`);
    await page.goto(config.url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof window.render_game_to_text === 'function');
    report.capabilities = await browserCapabilities(page);
    report.measurementEnvironment.renderer = [
      report.capabilities.environment?.webgl?.vendor,
      report.capabilities.environment?.webgl?.renderer,
    ].filter(Boolean).join(' / ') || null;
    report.measurementEnvironment.softwareRendererDetected = !!(
      report.capabilities.environment?.softwareRendererDetected
    );
    if (report.measurementEnvironment.softwareRendererDetected) {
      report.measurementEnvironment.limitations.push(
        'The browser reported a software WebGL renderer; absolute render timings may not represent the player GPU.',
      );
    }
    if (report.capabilities.missingRequired.length > 0) {
      throw new CapabilityBlocked('Required browser commands are missing', {
        missing: report.capabilities.missingRequired,
      });
    }
    if (TECH_NODES.length !== EXPECTED_TECH_COUNT) {
      throw new CapabilityBlocked('Technology count changed; update checkpoint expectations', {
        expected: EXPECTED_TECH_COUNT,
        actual: TECH_NODES.length,
      });
    }

    if (config.checkpointSource) {
      const source = JSON.parse(await readFile(config.checkpointSource, 'utf8'));
      const sourceValidation = validateCheckpointSource(
        source,
        config.checkpointSource,
        config.outputDir,
      );
      if (!sourceValidation.ok) {
        throw new CapabilityBlocked('Checkpoint source did not complete legal progression', {
          source: config.checkpointSource,
          problems: sourceValidation.problems,
        });
      }
      console.log(`Checkpoint replay source: ${config.checkpointSource}`);
      await replayCheckpointSource(
        page,
        config.checkpointSource,
        source,
        sourceValidation,
        profile,
        report,
      );
    } else {
      await page.evaluate(({ seed }) => {
        localStorage.clear();
        sessionStorage.clear();
        window.__newGame(seed, {
          mode: 'sandbox',
          victoryType: 'sandbox',
          aiDifficulty: 'normal',
        });
      }, { seed: config.seed });
      await grantCredits(page);
      await switchToSystem(page);
      await profile('new-game');

      await produceFirstCorvette(page);
      report.progressionEvents.push({ type: 'first-corvette', at: (await textState(page)).time });
      await profile('first-corvette');

      await produceFirstFleet(page);
      report.progressionEvents.push({
        type: 'first-eight-ship-fleet',
        at: (await textState(page)).time,
      });
      await profile('first-eight-ship-fleet');

      const alreadyUnlocked = new Set((await textState(page)).research?.unlocked ?? []);
      const recorded = new Set(alreadyUnlocked);

      while (alreadyUnlocked.size < TECH_NODES.length) {
        const techWeb = await page.evaluate(() => window.__getTechWeb());
        for (const entry of techWeb) {
          if (entry.unlocked) alreadyUnlocked.add(entry.id);
        }
        const ready = TECH_NODES.filter((node) => (
          !alreadyUnlocked.has(node.id)
          && node.prereqs.every((id) => alreadyUnlocked.has(id))
        ));
        const availableIds = new Set(
          techWeb.filter((entry) => entry.available).map((entry) => entry.id),
        );
        // Prefer a currently milestone-legal branch. This exhausts ordinary
        // research before forcing the first/third Dyson milestone.
        const candidate = ready.find((node) => availableIds.has(node.id)) ?? ready[0];
        if (!candidate) {
          throw new CapabilityBlocked('Technology progression has no legal next node', {
            unlocked: alreadyUnlocked.size,
            remaining: TECH_NODES.filter((node) => !alreadyUnlocked.has(node.id)).map((node) => node.id),
          });
        }

        const liveEntry = techWeb.find((entry) => entry.id === candidate.id);
        if (!liveEntry?.available) {
          if (candidate.milestones.includes('superweapon')) await ensureDysons(3);
          else if (candidate.milestones.includes('diplomacy')) await ensureDysons(1);
          else {
            throw new CapabilityBlocked(`Technology ${candidate.id} is topologically ready but unavailable`, {
              candidate,
              liveEntry,
              milestones: (await textState(page)).milestones,
            });
          }
        }

        await grantCredits(page, 5_000_000);
        if (candidate.solariiCost > 0) {
          await ensureSolarii(candidate.solariiCost + 2);
        }
        let started = await page.evaluate((nodeId) => window.__startResearch(nodeId), candidate.id);
        if (!started?.ok && /solarii/i.test(started?.reason ?? '')) {
          await ensureSolarii(candidate.solariiCost + 10);
          started = await page.evaluate((nodeId) => window.__startResearch(nodeId), candidate.id);
        }
        if (!started?.ok) {
          throw new CapabilityBlocked(`Normal research command rejected ${candidate.id}`, {
            candidate,
            result: started,
          });
        }
        await advanceTime(page, finite(started.durationMs, candidate.researchMs) + 2_000);
        const after = await textState(page);
        const unlockedAfter = new Set(after.research?.unlocked ?? []);
        if (!unlockedAfter.has(candidate.id)) {
          throw new CapabilityBlocked(`Research ${candidate.id} did not complete after its duration`, {
            started,
            research: after.research,
          });
        }
        alreadyUnlocked.clear();
        for (const id of unlockedAfter) alreadyUnlocked.add(id);
        if (!recorded.has(candidate.id)) {
          const completedDysons = (await diagnosticEntityCounts(page))
            .playerCompletedDysons.length;
          report.researchSequence.push({
            id: candidate.id,
            unlockedCount: alreadyUnlocked.size,
            gameTimeMs: after.time,
            prereqs: candidate.prereqs,
            milestones: candidate.milestones,
            completedDysons,
          });
          recorded.add(candidate.id);
          if (alreadyUnlocked.size % 10 === 0) {
            console.log(`  research ${alreadyUnlocked.size}/${TECH_NODES.length}: ${candidate.id}`);
          }
        }

        if (CHECKPOINT_TECH_COUNTS.has(alreadyUnlocked.size)) {
          await profile(`tech-${String(alreadyUnlocked.size).padStart(3, '0')}`);
        }
      }

      await ensureDysons(3);
      await ensureScout(page);
      await produceFinalFleet(page);
      await assembleHelioclast(page, ensureSolarii);
      await drainFinalQueues(page);
      await profile('final');
    }

    if (config.captureProfiles) {
      const finalDir = path.join(config.outputDir, 'checkpoints', 'final');
      await captureCheckpointProfiles(
        context,
        'final',
        finalDir,
        config,
        report,
        networkInflight,
      );
    }
  } catch (error) {
    if (error instanceof CapabilityBlocked) {
      const todo = {
        message: error.message,
        detail: error.detail,
      };
      report.todo.push(todo);
      console.error(`CAPABILITY BLOCKED: ${error.message}`);
      if (error.detail) console.error(JSON.stringify(error.detail, null, 2));
    } else {
      report.errors.fatal = String(error?.stack ?? error);
      console.error(report.errors.fatal);
    }
  } finally {
    finalizeNetwork(report);
    finalizeAcceptance(report);
    await writeIncrementalReport(report, config);
    await writeFile(path.join(config.outputDir, 'report.md'), markdownReport(report));
    await browser.close().catch(() => {});
  }

  console.log(`\nArtifacts: ${config.outputDir}`);
  console.log(`Acceptance: ${report.acceptance.passed ? 'PASS' : report.acceptance.partial ? 'PARTIAL' : 'FAIL'}`);
  if (report.acceptance.passed) return;
  if (report.acceptance.partial && config.allowPartial) return;
  process.exitCode = report.acceptance.partial ? 2 : 1;
}

await main();
