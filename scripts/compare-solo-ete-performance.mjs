#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCRIPT_NAME = path.basename(fileURLToPath(import.meta.url));
const DEFAULT_BASENAME = 'before-after-comparison';
const CONFIG_KEYS = [
  'url',
  'mode',
  'seed',
  'headless',
  'warmupMs',
  'sampleMs',
  'samples',
  'inputSamples',
  'simulationSteps',
  'cpuProfileMs',
  'captureProfiles',
  'checkpointSource',
];
const ENTITY_FIELDS = [
  ['techUnlocked', 'Technologies'],
  ['playerShips', 'Player ships'],
  ['livePlayerShips', 'Live player ships'],
  ['deadPlayerShips', 'Destroyed player ships'],
  ['scouts', 'Scouts'],
  ['aiShips', 'AI ships'],
  ['aiFactions', 'AI factions'],
  ['aiSystems', 'AI systems'],
  ['battleGroups', 'Fleets'],
  ['fleetShipSlots', 'Fleet ship slots'],
  ['uniqueFleetShips', 'Unique fleet ships'],
  ['duplicateFleetMemberships', 'Duplicate fleet memberships'],
  ['deadFleetMemberships', 'Destroyed fleet memberships'],
  ['unknownFleetMemberships', 'Unknown fleet memberships'],
  ['unassignedPlayerShips', 'Unassigned live player ships'],
  ['researchQueue', 'Research queue'],
  ['empireQueue', 'Empire production queue'],
  ['activeBuilds', 'Active shipyard builds'],
  ['convoys', 'Convoys'],
  ['depots', 'Depots'],
  ['structures', 'Structures'],
  ['structuresInView', 'Structures in view'],
  ['constructionJobs', 'Construction jobs'],
  ['pausedConstructionJobs', 'Paused construction jobs'],
  ['failedConstructionJobs', 'Failed construction jobs'],
  ['completedConstructionJobs', 'Completed construction history'],
  ['dysonSystems', 'Dyson systems'],
  ['playerCompletedDysons', 'Player-completed Dyson systems'],
  ['helioclastStage', 'Helioclast stage'],
  ['domNodes', 'DOM nodes'],
];
const SCENE_METRICS = [
  ['effectiveFps', 'Effective FPS', 'higher'],
  ['frameIntervalP95Ms', 'Frame p95', 'lower'],
  ['inputToPaintMs', 'Input-to-paint', 'lower'],
  ['droppedFrames', 'Dropped frames', 'lower'],
  ['longTasksOver50Ms', 'Long tasks >50 ms', 'lower'],
  ['longTaskP95Ms', 'Long-task p95', 'lower'],
  ['galaxyDrawP95Ms', 'Galaxy draw p95', 'lower'],
];

function usage() {
  return `Usage:
  node scripts/${SCRIPT_NAME} <before-results.json> <after-results.json> [options]

Options:
  --output-dir <path>   Output directory (default: the after result directory)
  --json-out <path>     Exact JSON output path
  --markdown-out <path> Exact Markdown output path
  --help                Show this help

The utility matches checkpoint ids and scene names. Checkpoints or scenes present
in only one input are reported as unmatched and are never treated as measurements
from the other run.`;
}

function parseArguments(argv) {
  const options = {
    positional: [],
    outputDir: null,
    jsonOut: null,
    markdownOut: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      console.log(usage());
      process.exit(0);
    }
    if (argument === '--output-dir' || argument === '--json-out' || argument === '--markdown-out') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${argument} requires a path`);
      }
      index += 1;
      if (argument === '--output-dir') options.outputDir = value;
      if (argument === '--json-out') options.jsonOut = value;
      if (argument === '--markdown-out') options.markdownOut = value;
      continue;
    }
    if (argument.startsWith('--')) {
      throw new Error(`Unknown option: ${argument}`);
    }
    options.positional.push(argument);
  }

  if (options.positional.length !== 2) {
    throw new Error(`Expected before and after result paths.\n\n${usage()}`);
  }
  return options;
}

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function round(value, digits = 3) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[midpoint]
    : (sorted[midpoint - 1] + sorted[midpoint]) / 2;
}

function compareMetric(beforeValue, afterValue, preferredDirection = 'lower') {
  const before = finite(beforeValue);
  const after = finite(afterValue);
  if (before === null || after === null) {
    return {
      before,
      after,
      delta: null,
      percentChange: null,
      preferredDirection,
      outcome: 'not-comparable',
    };
  }

  const delta = after - before;
  const percentChange = before === 0
    ? (after === 0 ? 0 : null)
    : (delta / Math.abs(before)) * 100;
  let outcome = 'unchanged';
  if (Math.abs(delta) > 1e-9) {
    if (preferredDirection === 'neutral') {
      outcome = 'changed';
    } else {
      const improves = preferredDirection === 'higher' ? delta > 0 : delta < 0;
      outcome = improves ? 'improved' : 'regressed';
    }
  }

  return {
    before: round(before),
    after: round(after),
    delta: round(delta),
    percentChange: round(percentChange),
    preferredDirection,
    outcome,
  };
}

function countValue(value) {
  if (Array.isArray(value)) return value.length;
  return finite(value);
}

function extractEntities(state = {}) {
  const entities = {};
  for (const [field] of ENTITY_FIELDS) {
    if (field === 'fleetShipSlots') {
      entities[field] = Array.isArray(state.fleetSizes)
        ? state.fleetSizes.reduce((total, size) => total + (finite(size) ?? 0), 0)
        : null;
      continue;
    }
    entities[field] = countValue(state[field]);
  }
  return entities;
}

function extractSceneMetrics(scene = {}) {
  return {
    effectiveFps: finite(scene.effectiveFps),
    frameIntervalP95Ms: finite(scene.frameIntervalMs?.p95),
    inputToPaintMs: finite(scene.inputToPaintMs),
    droppedFrames: finite(scene.droppedFrames),
    longTasksOver50Ms: finite(scene.longTasks?.over50Ms),
    longTaskP95Ms: finite(scene.longTasks?.p95Ms),
    galaxyDrawP95Ms: finite(scene.galaxyDrawMs?.p95),
    longTaskMaxMs: finite(scene.longTasks?.maxMs),
    heapUsedBytes: finite(scene.memory?.jsHeapUsedBytes),
    domNodes: finite(scene.memory?.nodes),
  };
}

function extractSceneIdentity(scene = {}) {
  const explicit = scene.sceneIdentity ?? {};
  const fixture = scene.fixtureValidation?.before ?? {};
  const presentation = scene.presentationValidation?.before ?? {};
  return {
    fixture: scene.fixture ?? null,
    view: explicit.view ?? presentation.view ?? null,
    currentSystem: explicit.currentSystem ?? fixture.systemId ?? null,
    panelId: explicit.panelId ?? presentation.panelId ?? null,
    battleSystemId: explicit.battleSystemId ?? fixture.systemId ?? null,
    battleMode: explicit.battleMode ?? fixture.mode ?? null,
    playerUnits: fixture.playerUnits ?? null,
    enemyUnits: fixture.enemyUnits ?? null,
  };
}

function compareEntities(beforeState, afterState) {
  const before = extractEntities(beforeState);
  const after = extractEntities(afterState);
  return Object.fromEntries(ENTITY_FIELDS.map(([field]) => [
    field,
    compareMetric(before[field], after[field], 'neutral'),
  ]));
}

function compareScene(beforeScene, afterScene) {
  const beforeAvailable = beforeScene.available !== false;
  const afterAvailable = afterScene.available !== false;
  const beforeIdentity = extractSceneIdentity(beforeScene);
  const afterIdentity = extractSceneIdentity(afterScene);
  const identityMatch = JSON.stringify(beforeIdentity) === JSON.stringify(afterIdentity);
  const comparable = beforeAvailable && afterAvailable && identityMatch;
  const before = comparable ? extractSceneMetrics(beforeScene) : {};
  const after = comparable ? extractSceneMetrics(afterScene) : {};
  const metrics = Object.fromEntries(SCENE_METRICS.map(([field, , direction]) => [
    field,
    compareMetric(before[field], after[field], direction),
  ]));
  metrics.longTaskMaxMs = compareMetric(before.longTaskMaxMs, after.longTaskMaxMs, 'lower');
  metrics.heapUsedBytes = compareMetric(before.heapUsedBytes, after.heapUsedBytes, 'lower');
  metrics.domNodes = compareMetric(before.domNodes, after.domNodes, 'lower');
  return {
    scene: beforeScene.scene,
    available: {
      before: beforeAvailable,
      after: afterAvailable,
    },
    comparable,
    identity: {
      before: beforeIdentity,
      after: afterIdentity,
      match: identityMatch,
    },
    metrics,
  };
}

function saveLogicalBytes(save = {}) {
  return finite(save.uncompressedBytes) ?? finite(save.bytes);
}

function compareCheckpoint(beforeCheckpoint, afterCheckpoint) {
  const beforeScenes = new Map(
    (beforeCheckpoint.scenes ?? []).map((scene) => [scene.scene, scene]),
  );
  const afterScenes = new Map(
    (afterCheckpoint.scenes ?? []).map((scene) => [scene.scene, scene]),
  );
  const commonSceneNames = [...beforeScenes.keys()].filter((name) => afterScenes.has(name));
  const beforeOnlyScenes = [...beforeScenes.keys()].filter((name) => !afterScenes.has(name));
  const afterOnlyScenes = [...afterScenes.keys()].filter((name) => !beforeScenes.has(name));

  const beforeSave = beforeCheckpoint.save ?? {};
  const afterSave = afterCheckpoint.save ?? {};
  return {
    id: beforeCheckpoint.id,
    capturedAt: {
      before: beforeCheckpoint.capturedAt ?? null,
      after: afterCheckpoint.capturedAt ?? null,
    },
    state: {
      before: extractEntities(beforeCheckpoint.state),
      after: extractEntities(afterCheckpoint.state),
      comparison: compareEntities(beforeCheckpoint.state, afterCheckpoint.state),
    },
    simulation: {
      medianMs: compareMetric(
        beforeCheckpoint.simulation?.medianMs,
        afterCheckpoint.simulation?.medianMs,
        'lower',
      ),
      p95Ms: compareMetric(
        beforeCheckpoint.simulation?.p95Ms,
        afterCheckpoint.simulation?.p95Ms,
        'lower',
      ),
      p99Ms: compareMetric(
        beforeCheckpoint.simulation?.p99Ms,
        afterCheckpoint.simulation?.p99Ms,
        'lower',
      ),
      maxMs: compareMetric(
        beforeCheckpoint.simulation?.maxMs,
        afterCheckpoint.simulation?.maxMs,
        'lower',
      ),
    },
    galaxyDraw: {
      lastDrawMs: compareMetric(
        beforeCheckpoint.galaxyPerf?.lastDrawMs,
        afterCheckpoint.galaxyPerf?.lastDrawMs,
        'lower',
      ),
    },
    save: {
      ok: {
        before: beforeSave.ok === true,
        after: afterSave.ok === true,
        improved: beforeSave.ok !== true && afterSave.ok === true,
        regressed: beforeSave.ok === true && afterSave.ok !== true,
      },
      storageFormat: {
        before: beforeSave.storageFormat ?? 'json',
        after: afterSave.storageFormat ?? 'json',
      },
      elapsedMs: compareMetric(beforeSave.elapsedMs, afterSave.elapsedMs, 'lower'),
      storedBytes: compareMetric(beforeSave.bytes, afterSave.bytes, 'lower'),
      logicalBytes: compareMetric(
        saveLogicalBytes(beforeSave),
        saveLogicalBytes(afterSave),
        'lower',
      ),
      compressionRatio: {
        before: round(
          finite(beforeSave.bytes) && saveLogicalBytes(beforeSave)
            ? finite(beforeSave.bytes) / saveLogicalBytes(beforeSave)
            : null,
        ),
        after: round(
          finite(afterSave.bytes) && saveLogicalBytes(afterSave)
            ? finite(afterSave.bytes) / saveLogicalBytes(afterSave)
            : null,
        ),
      },
      errors: {
        before: beforeSave.error ?? null,
        after: afterSave.error ?? null,
      },
    },
    sceneCoverage: {
      common: commonSceneNames,
      beforeOnly: beforeOnlyScenes,
      afterOnly: afterOnlyScenes,
    },
    scenes: commonSceneNames.map((name) => compareScene(
      beforeScenes.get(name),
      afterScenes.get(name),
    )),
  };
}

function compareConfig(beforeConfig = {}, afterConfig = {}) {
  const fields = Object.fromEntries(CONFIG_KEYS.map((key) => {
    const before = beforeConfig[key] ?? null;
    const after = afterConfig[key] ?? null;
    return [key, {
      before,
      after,
      match: JSON.stringify(before) === JSON.stringify(after),
    }];
  }));
  return {
    match: Object.values(fields).every((field) => field.match),
    fields,
  };
}

function compareRunEnvironment(beforeResults, afterResults) {
  const config = compareConfig(beforeResults.config, afterResults.config);
  const beforeCapabilities = beforeResults.capabilities?.environment ?? {};
  const afterCapabilities = afterResults.capabilities?.environment ?? {};
  const beforeMeasurement = beforeResults.measurementEnvironment ?? {};
  const afterMeasurement = afterResults.measurementEnvironment ?? {};
  const extraValues = {
    viewport: [beforeMeasurement.viewport, afterMeasurement.viewport],
    deviceScaleFactor: [
      beforeMeasurement.deviceScaleFactor,
      afterMeasurement.deviceScaleFactor,
    ],
    reducedMotion: [
      beforeMeasurement.reducedMotion,
      afterMeasurement.reducedMotion,
    ],
    browserMode: [
      beforeMeasurement.browserMode,
      afterMeasurement.browserMode,
    ],
    renderer: [
      beforeMeasurement.renderer ?? beforeCapabilities.webgl?.renderer,
      afterMeasurement.renderer ?? afterCapabilities.webgl?.renderer,
    ],
    rendererVendor: [
      beforeCapabilities.webgl?.vendor,
      afterCapabilities.webgl?.vendor,
    ],
    softwareRendererDetected: [
      beforeMeasurement.softwareRendererDetected
        ?? beforeCapabilities.softwareRendererDetected,
      afterMeasurement.softwareRendererDetected
        ?? afterCapabilities.softwareRendererDetected,
    ],
    userAgent: [
      beforeCapabilities.userAgent,
      afterCapabilities.userAgent,
    ],
    platform: [
      beforeCapabilities.platform,
      afterCapabilities.platform,
    ],
    hardwareConcurrency: [
      beforeCapabilities.hardwareConcurrency,
      afterCapabilities.hardwareConcurrency,
    ],
    deviceMemoryGiB: [
      beforeCapabilities.deviceMemoryGiB,
      afterCapabilities.deviceMemoryGiB,
    ],
    checkpointReplayMode: [
      beforeResults.checkpointReplay?.mode ?? null,
      afterResults.checkpointReplay?.mode ?? null,
    ],
    checkpointReplaySourceSeed: [
      beforeResults.checkpointReplay?.sourceSeed ?? null,
      afterResults.checkpointReplay?.sourceSeed ?? null,
    ],
  };
  const extraFields = Object.fromEntries(
    Object.entries(extraValues).map(([key, [before, after]]) => [
      key,
      {
        before: before ?? null,
        after: after ?? null,
        match: JSON.stringify(before ?? null) === JSON.stringify(after ?? null),
      },
    ]),
  );
  const fields = { ...config.fields, ...extraFields };
  return {
    match: Object.values(fields).every((field) => field.match),
    fields,
  };
}

function aggregateMetrics(metricObjects) {
  const comparable = metricObjects.filter((metric) => (
    metric?.before !== null && metric?.after !== null
  ));
  return {
    comparisons: comparable.length,
    medianBefore: round(median(comparable.map((metric) => metric.before))),
    medianAfter: round(median(comparable.map((metric) => metric.after))),
    medianPercentChange: round(median(
      comparable.map((metric) => metric.percentChange).filter(Number.isFinite),
    )),
    improved: comparable.filter((metric) => metric.outcome === 'improved').length,
    regressed: comparable.filter((metric) => metric.outcome === 'regressed').length,
    unchanged: comparable.filter((metric) => metric.outcome === 'unchanged').length,
  };
}

function buildSummary(checkpoints, coverage) {
  const sceneComparisons = checkpoints.flatMap((checkpoint) => checkpoint.scenes);
  const lastCommon = checkpoints.at(-1) ?? null;
  const sceneMetrics = Object.fromEntries(SCENE_METRICS.map(([field]) => [
    field,
    aggregateMetrics(sceneComparisons.map((scene) => scene.metrics[field])),
  ]));

  return {
    checkpointCoverage: coverage,
    sharedScenePairs: sceneComparisons.length,
    matchedScenePairs: sceneComparisons.filter((scene) => scene.comparable).length,
    identityMismatchPairs: sceneComparisons.filter((scene) => !scene.identity.match).length,
    firstCommonCheckpoint: checkpoints[0]?.id ?? null,
    lastCommonCheckpoint: lastCommon?.id ?? null,
    lastCommonSimulationP95Ms: lastCommon?.simulation.p95Ms ?? null,
    lastCommonSave: lastCommon
      ? {
        ok: lastCommon.save.ok,
        storedBytes: lastCommon.save.storedBytes,
        logicalBytes: lastCommon.save.logicalBytes,
        storageFormat: lastCommon.save.storageFormat,
      }
      : null,
    sceneMetrics,
  };
}

function formatNumber(value, digits = 1) {
  if (!Number.isFinite(value)) return 'n/a';
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: digits,
  }).format(value);
}

function formatBytes(value) {
  if (!Number.isFinite(value)) return 'n/a';
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  let amount = value;
  let unit = units[0];
  for (let index = 1; index < units.length && Math.abs(amount) >= 1024; index += 1) {
    amount /= 1024;
    unit = units[index];
  }
  return `${formatNumber(amount, amount >= 100 ? 0 : 2)} ${unit}`;
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return 'n/a';
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatNumber(value, 1)}%`;
}

function transition(metric, formatter = (value) => formatNumber(value)) {
  if (!metric || metric.before === null || metric.after === null) return 'n/a';
  return `${formatter(metric.before)} → ${formatter(metric.after)} (${formatPercent(metric.percentChange)})`;
}

function escapeCell(value) {
  return String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function table(headers, rows) {
  const header = `| ${headers.map(escapeCell).join(' | ')} |`;
  const separator = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.map(escapeCell).join(' | ')} |`);
  return [header, separator, ...body].join('\n');
}

function renderMarkdown(comparison) {
  const { sources, comparability, coverage, checkpoints, summary } = comparison;
  const lines = [
    '# Solo ETE Performance Comparison',
    '',
    `Generated: ${comparison.createdAt}`,
    '',
    `- Before: \`${sources.before}\``,
    `- After: \`${sources.after}\``,
    `- Configuration match: **${comparability.match ? 'yes' : 'no'}**`,
    `- Shared checkpoints: **${coverage.common.length}**`,
    `- Comparable scene pairs: **${summary.matchedScenePairs}/${summary.sharedScenePairs}**`,
    `- Before-only checkpoints: ${coverage.beforeOnly.length ? coverage.beforeOnly.join(', ') : 'none'}`,
    `- After-only checkpoints: ${coverage.afterOnly.length ? coverage.afterOnly.join(', ') : 'none'}`,
    '',
  ];

  const mismatches = Object.entries(comparability.fields).filter(([, value]) => !value.match);
  if (mismatches.length) {
    lines.push(
      '## Comparability warnings',
      '',
      ...mismatches.map(([key, value]) => (
        `- ${key}: before \`${JSON.stringify(value.before)}\`, after \`${JSON.stringify(value.after)}\``
      )),
      '',
    );
  }

  const identityMismatches = checkpoints.flatMap((checkpoint) => (
    checkpoint.scenes
      .filter((scene) => !scene.identity.match)
      .map((scene) => ({ checkpoint: checkpoint.id, scene }))
  ));
  if (identityMismatches.length) {
    lines.push(
      '## Scene identity warnings',
      '',
      ...identityMismatches.map(({ checkpoint, scene }) => (
        `- ${checkpoint}/${scene.scene}: before \`${JSON.stringify(scene.identity.before)}\`, after \`${JSON.stringify(scene.identity.after)}\`; metrics excluded.`
      )),
      '',
    );
  }

  lines.push(
    '## Checkpoint summary',
    '',
    table(
      [
        'Checkpoint',
        'Tech (B→A)',
        'AI ships (B→A)',
        'Simulation p95',
        'Save result (B→A)',
        'Stored save size',
        'Logical save size',
      ],
      checkpoints.map((checkpoint) => [
        checkpoint.id,
        `${formatNumber(checkpoint.state.before.techUnlocked, 0)} → ${formatNumber(checkpoint.state.after.techUnlocked, 0)}`,
        `${formatNumber(checkpoint.state.before.aiShips, 0)} → ${formatNumber(checkpoint.state.after.aiShips, 0)}`,
        transition(checkpoint.simulation.p95Ms, (value) => `${formatNumber(value)} ms`),
        `${checkpoint.save.ok.before ? 'pass' : 'FAIL'} → ${checkpoint.save.ok.after ? 'pass' : 'FAIL'}`,
        transition(checkpoint.save.storedBytes, formatBytes),
        transition(checkpoint.save.logicalBytes, formatBytes),
      ]),
    ),
    '',
    'Stored size reflects what local storage receives. Logical size compares the uncompressed save payload; this prevents a storage-format change from being mistaken for a smaller game state.',
    '',
    '## Entity counts',
    '',
    table(
      ['Checkpoint', ...ENTITY_FIELDS.map(([, label]) => label)],
      checkpoints.map((checkpoint) => [
        checkpoint.id,
        ...ENTITY_FIELDS.map(([field]) => {
          const metric = checkpoint.state.comparison[field];
          return `${formatNumber(metric.before, 0)} → ${formatNumber(metric.after, 0)}`;
        }),
      ]),
    ),
    '',
    '## Matched scene measurements',
    '',
    table(
      [
        'Checkpoint',
        'Scene',
        'Available (B→A)',
        'Comparable',
        'Effective FPS',
        'Frame p95',
        'Input-to-paint',
        'Dropped frames',
        'Long tasks >50 ms',
        'Long-task p95',
        'Galaxy draw p95',
      ],
      checkpoints.flatMap((checkpoint) => checkpoint.scenes.map((scene) => [
        checkpoint.id,
        scene.scene,
        `${scene.available.before ? 'yes' : 'no'} → ${scene.available.after ? 'yes' : 'no'}`,
        scene.comparable ? 'yes' : 'no',
        transition(scene.metrics.effectiveFps),
        transition(scene.metrics.frameIntervalP95Ms, (value) => `${formatNumber(value)} ms`),
        transition(scene.metrics.inputToPaintMs, (value) => `${formatNumber(value)} ms`),
        transition(scene.metrics.droppedFrames, (value) => formatNumber(value, 0)),
        transition(scene.metrics.longTasksOver50Ms, (value) => formatNumber(value, 0)),
        transition(scene.metrics.longTaskP95Ms, (value) => `${formatNumber(value)} ms`),
        transition(scene.metrics.galaxyDrawP95Ms, (value) => `${formatNumber(value)} ms`),
      ])),
    ),
    '',
    '## Aggregate matched-scene changes',
    '',
    table(
      ['Metric', 'Pairs', 'Median before', 'Median after', 'Median change', 'Improved', 'Regressed'],
      SCENE_METRICS.map(([field, label]) => {
        const aggregate = summary.sceneMetrics[field];
        return [
          label,
          aggregate.comparisons,
          formatNumber(aggregate.medianBefore),
          formatNumber(aggregate.medianAfter),
          formatPercent(aggregate.medianPercentChange),
          aggregate.improved,
          aggregate.regressed,
        ];
      }),
    ),
    '',
    '## Notes',
    '',
    '- Percent change is `(after - before) / abs(before)`; negative is better for frame time, input latency, dropped frames, long tasks, simulation cost, and byte size.',
    '- Effective FPS uses the opposite direction: positive change is better.',
    '- Missing checkpoints, scenes, or metrics remain `n/a`; the utility does not synthesize values.',
    '- Entity counts are included beside performance metrics so differences in progression state and AI population remain visible.',
    '',
  );
  return `${lines.join('\n')}\n`;
}

async function readResults(filePath, label) {
  let source;
  try {
    source = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Unable to read ${label} results at ${filePath}: ${error.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`Invalid JSON in ${label} results at ${filePath}: ${error.message}`);
  }
  if (!Array.isArray(parsed.checkpoints)) {
    throw new Error(`${label} results do not contain a checkpoints array: ${filePath}`);
  }
  return parsed;
}

async function writeFileAtomic(filePath, contents) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, contents);
  await fs.rename(temporaryPath, filePath);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const beforePath = path.resolve(options.positional[0]);
  const afterPath = path.resolve(options.positional[1]);
  const outputDir = path.resolve(options.outputDir ?? path.dirname(afterPath));
  const jsonOut = path.resolve(options.jsonOut ?? path.join(outputDir, `${DEFAULT_BASENAME}.json`));
  const markdownOut = path.resolve(
    options.markdownOut ?? path.join(outputDir, `${DEFAULT_BASENAME}.md`),
  );
  if (jsonOut === markdownOut) {
    throw new Error('JSON and Markdown output paths must be different');
  }

  const [beforeResults, afterResults] = await Promise.all([
    readResults(beforePath, 'before'),
    readResults(afterPath, 'after'),
  ]);
  const beforeCheckpoints = new Map(
    beforeResults.checkpoints.map((checkpoint) => [checkpoint.id, checkpoint]),
  );
  const afterCheckpoints = new Map(
    afterResults.checkpoints.map((checkpoint) => [checkpoint.id, checkpoint]),
  );
  const coverage = {
    common: [...beforeCheckpoints.keys()].filter((id) => afterCheckpoints.has(id)),
    beforeOnly: [...beforeCheckpoints.keys()].filter((id) => !afterCheckpoints.has(id)),
    afterOnly: [...afterCheckpoints.keys()].filter((id) => !beforeCheckpoints.has(id)),
  };
  if (!coverage.common.length) {
    throw new Error('The result files contain no matching checkpoint ids');
  }

  const checkpoints = coverage.common.map((id) => compareCheckpoint(
    beforeCheckpoints.get(id),
    afterCheckpoints.get(id),
  ));
  const comparison = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    sources: {
      before: beforePath,
      after: afterPath,
      beforeCreatedAt: beforeResults.createdAt ?? null,
      afterCreatedAt: afterResults.createdAt ?? null,
    },
    comparability: compareRunEnvironment(beforeResults, afterResults),
    coverage,
    summary: buildSummary(checkpoints, coverage),
    checkpoints,
  };

  await Promise.all([
    writeFileAtomic(jsonOut, `${JSON.stringify(comparison, null, 2)}\n`),
    writeFileAtomic(markdownOut, renderMarkdown(comparison)),
  ]);

  const lastCommon = checkpoints.at(-1);
  console.log(`Compared ${checkpoints.length} checkpoints and ${comparison.summary.matchedScenePairs} scene pairs.`);
  console.log(`Last common checkpoint: ${lastCommon.id}`);
  console.log(`Simulation p95: ${transition(lastCommon.simulation.p95Ms, (value) => `${formatNumber(value)} ms`)}`);
  console.log(`Stored save size: ${transition(lastCommon.save.storedBytes, formatBytes)}`);
  console.log(`Save result: ${lastCommon.save.ok.before ? 'pass' : 'FAIL'} → ${lastCommon.save.ok.after ? 'pass' : 'FAIL'}`);
  console.log(`JSON: ${jsonOut}`);
  console.log(`Markdown: ${markdownOut}`);
}

main().catch((error) => {
  console.error(`${SCRIPT_NAME}: ${error.message}`);
  process.exitCode = 1;
});
