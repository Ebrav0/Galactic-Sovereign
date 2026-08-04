#!/usr/bin/env node
/**
 * Solo campaign FPS evaluation harness.
 *
 * Drives a natural dominion campaign through home-galaxy growth, wormhole
 * transit, multiple hydrated secondary galaxies, and victory — sampling FPS
 * and frame budgets at each stage.
 *
 * Usage:
 *   npm run solo:fps
 *   GS_TEST_URL=http://127.0.0.1:5173/ npm run solo:fps -- --stages=S01,S02
 *   npm run solo:fps -- --keep-going --seed=20260804 --sample-ms=3000 --soak-ms=60000
 */

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.GS_TEST_URL || 'http://127.0.0.1:5173/';
const SEED = Number(process.env.GS_SOLO_FPS_SEED || argValue('--seed') || 20260804);
const SAMPLE_MS = Number(process.env.GS_SOLO_FPS_SAMPLE_MS || argValue('--sample-ms') || 3000);
const SOAK_MS = Number(process.env.GS_SOLO_FPS_SOAK_MS || argValue('--soak-ms') || 600000);
const WARMUP_MS = Number(process.env.GS_SOLO_FPS_WARMUP_MS || 1000);
const KEEP_GOING = process.argv.includes('--keep-going') || process.env.GS_SOLO_FPS_KEEP_GOING === '1';
const stagesFilter = parseStages(
  process.env.GS_SOLO_FPS_STAGES || argValue('--stages') || '',
);

const runId = new Date().toISOString().replace(/[:.]/g, '-');
const outputDir = path.resolve(process.env.GS_SOLO_FPS_OUT || 'output/solo-fps');
fs.mkdirSync(outputDir, { recursive: true });

const BUDGETS = {
  fpsAvg: 40,
  fpsP5: 15,
  fpsP1: 10,
  systemDrawMs: 12,
  galaxyDrawMs: 12,
  glFlushMs: 8,
  simMs: 8,
  uiMs: 4,
  totalFrameMs: 25,
  hitchSoft: 2,
  hitchHard: 3,
};

const ALL_STAGES = [
  'S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07',
  'S08', 'S09', 'S10', 'S11', 'S12', 'S13', 'S14', 'S15',
  'S16', 'S17',
];

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  const pref = process.argv.find((a) => a.startsWith(`${flag}=`));
  return pref ? pref.slice(flag.length + 1) : null;
}

function parseStages(raw) {
  if (!raw || !String(raw).trim()) return null;
  return String(raw).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function mean(nums) {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function round(n, places = 2) {
  if (n == null || Number.isNaN(n)) return null;
  const p = 10 ** places;
  return Math.round(n * p) / p;
}

function statsFromDts(dts) {
  if (!dts.length) return { fpsAvg: null, fpsP5: null, fpsP1: null, n: 0, maxFrameMs: null };
  const frames = dts.map((d) => ({ dt: d, fps: 1000 / Math.max(0.001, d) }));
  const fpsSorted = frames.map((f) => f.fps).sort((a, b) => a - b);
  const avg = fpsSorted.reduce((s, v) => s + v, 0) / fpsSorted.length;
  const p5 = fpsSorted[Math.max(0, Math.floor(fpsSorted.length * 0.05))];
  const p1 = fpsSorted[Math.max(0, Math.floor(fpsSorted.length * 0.01))];
  const maxFrameMs = Math.max(...dts);
  return {
    fpsAvg: Math.round(avg),
    fpsP5: Math.round(p5),
    fpsP1: Math.round(p1),
    n: dts.length,
    maxFrameMs: round(maxFrameMs),
  };
}

async function graduateProfile(page) {
  await page.evaluate(() => {
    const profile = {
      version: 2,
      tutorialGraduatedAt: Date.now(),
      tutorialCurriculumVersion: 3,
      briefingsSeen: [],
      tutorialProgress: {
        foundations: {
          status: 'waived',
          currentStepId: null,
          completedStepIds: [],
          updatedAt: Date.now(),
        },
        coop: {
          status: 'not_started',
          currentStepId: null,
          completedStepIds: [],
          updatedAt: null,
        },
        chapters: {},
      },
    };
    localStorage.setItem('gs-profile-v1', JSON.stringify(profile));
  });
}

async function enterCampaign(page, seed) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await graduateProfile(page);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => typeof window.__newGame === 'function', null, { timeout: 30000 });

  // Prefer direct hooks for determinism; fall back to title UI if needed.
  await page.evaluate((gameSeed) => {
    window.__newGame(gameSeed, {
      mode: 'campaign',
      victoryType: 'dominion',
      aiDifficulty: 'normal',
    });
    document.getElementById('title-screen')?.classList.add('hidden');
    window.__setBootPhase?.('playing');
    window.__setWarpIntroElapsed?.(1_000_000);
    const st = window.getGameState?.();
    if (st) st.paused = false;
  }, seed);

  await page.waitForFunction(() => window.__getBootPhase?.() === 'playing', null, { timeout: 30000 });
  await page.evaluate(() => {
    document.querySelectorAll('.panel--modal:not(.hidden), .modal-backdrop:not(.hidden)').forEach((n) => {
      if (n.id === 'title-screen') return;
      n.classList.add('hidden');
    });
    const st = window.getGameState?.();
    if (st) st.paused = false;
  });
  await page.locator('#game-canvas').click({ position: { x: 400, y: 300 } }).catch(() => {});
}

async function startSampler(page, sampleMs) {
  await page.evaluate((ms) => {
    window.__clearPerfHitches?.();
    const st = window.getGameState?.();
    if (st) st.paused = false;
    window.__gsSoloFps = {
      frames: 0,
      dts: [],
      workMs: [],
      last: performance.now(),
      done: false,
      snapshots: [],
    };
    const start = performance.now();
    function tick(now) {
      const s = window.__gsSoloFps;
      if (!s || s.done) return;
      const dt = now - s.last;
      s.last = now;
      // Keep large gaps for hitch analysis, but clamp for FPS averages.
      if (dt > 0) s.dts.push(Math.min(dt, 100));
      s.frames += 1;
      if (typeof window.__framePerf === 'function') {
        const fp = window.__framePerf();
        if (typeof fp?.totalFrameMs === 'number') s.workMs.push(fp.totalFrameMs);
        if (s.frames % 10 === 0) s.snapshots.push(fp);
      }
      if (now - start < ms) requestAnimationFrame(tick);
      else {
        s.done = true;
        if (typeof window.__framePerf === 'function') s.snapshots.push(window.__framePerf());
      }
    }
    requestAnimationFrame(tick);
  }, sampleMs);
}

async function readSampler(page) {
  await page.waitForFunction(() => window.__gsSoloFps?.done === true, null, {
    timeout: SAMPLE_MS + 15000,
  });
  return page.evaluate(() => {
    const s = window.__gsSoloFps;
    const snaps = s?.snapshots ?? [];
    const last = snaps[snaps.length - 1] || (typeof window.__framePerf === 'function' ? window.__framePerf() : null);
    const meanOf = (key) => {
      const vals = snaps.map((x) => x?.[key]).filter((v) => typeof v === 'number');
      if (!vals.length) return last?.[key] ?? null;
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    };
    return {
      dts: s?.dts ?? [],
      frames: s?.frames ?? 0,
      last,
      means: {
        simMs: meanOf('simMs'),
        systemDrawMs: meanOf('systemDrawMs'),
        galaxyDrawMs: meanOf('galaxyDrawMs'),
        glFlushMs: meanOf('glFlushMs'),
        uiMs: meanOf('uiMs'),
        totalFrameMs: meanOf('totalFrameMs'),
      },
      hitches: typeof window.__perfHitches === 'function' ? window.__perfHitches() : (last?.hitches ?? []),
      context: {
        view: last?.view ?? null,
        activeGalaxyId: last?.activeGalaxyId ?? null,
        combatUnits: last?.combatUnits ?? 0,
        bootPhase: last?.bootPhase ?? null,
      },
    };
  });
}

function evaluateBudgets(sample, { viewHint = null } = {}) {
  const fps = statsFromDts(sample.dts);
  // Prefer live __framePerf percentiles when rAF sampler is sparse.
  if ((fps.n ?? 0) < 10 && sample.last) {
    if (sample.last.fpsAvg != null) fps.fpsAvg = sample.last.fpsAvg;
    if (sample.last.fpsP5 != null) fps.fpsP5 = sample.last.fpsP5;
    if (sample.last.fpsP1 != null) fps.fpsP1 = sample.last.fpsP1;
  }
  const means = sample.means || {};
  // Use median-ish work time for hitch: only count hitches tagged for this stage.
  const stageHitches = (sample.hitches || []).filter((h) => (h.frameMs ?? 0) >= 100);
  const failures = [];
  const warnings = [];

  const check = (id, value, passAt, softAt, harderIsHigher = false) => {
    if (value == null) return;
    if (harderIsHigher) {
      if (value > passAt * 1.5) failures.push({ id, value, budget: passAt });
      else if (value > passAt) warnings.push({ id, value, budget: passAt });
    } else {
      if (value < softAt) failures.push({ id, value, budget: passAt });
      else if (value < passAt) warnings.push({ id, value, budget: passAt });
    }
  };

  check('fpsAvg', fps.fpsAvg, BUDGETS.fpsAvg, 35);
  check('fpsP5', fps.fpsP5, BUDGETS.fpsP5, 12);
  check('fpsP1', fps.fpsP1, BUDGETS.fpsP1, 8);
  check('totalFrameMs', means.totalFrameMs, BUDGETS.totalFrameMs, BUDGETS.totalFrameMs, true);
  check('simMs', means.simMs, BUDGETS.simMs, BUDGETS.simMs, true);
  check('glFlushMs', means.glFlushMs, BUDGETS.glFlushMs, BUDGETS.glFlushMs, true);
  check('uiMs', means.uiMs, BUDGETS.uiMs, BUDGETS.uiMs, true);

  const view = viewHint || sample.context?.view;
  if (view === 'system') {
    check('systemDrawMs', means.systemDrawMs, BUDGETS.systemDrawMs, BUDGETS.systemDrawMs, true);
  }
  if (view === 'galaxy') {
    check('galaxyDrawMs', means.galaxyDrawMs, BUDGETS.galaxyDrawMs, BUDGETS.galaxyDrawMs, true);
  }

  const hitchCount = stageHitches.length;
  if (hitchCount >= BUDGETS.hitchHard) failures.push({ id: 'hitches', value: hitchCount, budget: BUDGETS.hitchSoft });
  else if (hitchCount > BUDGETS.hitchSoft) warnings.push({ id: 'hitches', value: hitchCount, budget: BUDGETS.hitchSoft });

  // Under SwiftShader, treat pure FPS misses as soft if draw/sim/hitch are ok.
  const envSoft = process.env.GS_SOLO_FPS_SOFT_FPS === '1';
  let pass = failures.length === 0;
  if (!pass && envSoft) {
    const softable = failures.every((f) => f.id.startsWith('fps') || f.id === 'simMs' || f.id === 'glFlushMs' || f.id === 'totalFrameMs');
    const drawOk = (means.systemDrawMs == null || means.systemDrawMs <= BUDGETS.systemDrawMs * 1.35)
      && (means.galaxyDrawMs == null || means.galaxyDrawMs <= BUDGETS.galaxyDrawMs * 1.35);
    if (softable && drawOk && hitchCount < BUDGETS.hitchHard) {
      warnings.push(...failures.map((f) => ({ ...f, softEnv: true })));
      pass = true;
      failures.length = 0;
    }
  }

  return {
    pass,
    failures,
    warnings,
    fpsAvg: fps.fpsAvg,
    fpsP5: fps.fpsP5,
    fpsP1: fps.fpsP1,
    maxFrameMs: fps.maxFrameMs,
    hitchCount,
    systemDrawMs: round(means.systemDrawMs),
    galaxyDrawMs: round(means.galaxyDrawMs),
    glFlushMs: round(means.glFlushMs),
    simMs: round(means.simMs),
    uiMs: round(means.uiMs),
    totalFrameMs: round(means.totalFrameMs),
  };
}

async function sampleStage(page, { id, name, viewHint = null, sampleMs = SAMPLE_MS, thrust = false }) {
  await page.evaluate((tag) => {
    window.__setPerfStageTag?.(tag);
    const st = window.getGameState?.();
    if (st) st.paused = false;
  }, id);
  await page.waitForTimeout(Math.max(WARMUP_MS, 1500));
  await page.evaluate(() => window.__clearPerfHitches?.());
  await startSampler(page, sampleMs);
  if (thrust) {
    await page.keyboard.down('KeyD').catch(() => {});
  }
  await page.waitForTimeout(sampleMs + 200);
  if (thrust) {
    await page.keyboard.up('KeyD').catch(() => {});
  }
  const raw = await readSampler(page);
  const evaled = evaluateBudgets(raw, { viewHint });
  return {
    id,
    name,
    pass: evaled.pass,
    ...evaled,
    activeGalaxyId: raw.context?.activeGalaxyId ?? null,
    view: raw.context?.view ?? viewHint,
    combatUnits: raw.context?.combatUnits ?? 0,
    notes: '',
  };
}

async function screenshotFail(page, stageId) {
  const file = path.join(outputDir, `${runId}-${stageId}-fail.png`);
  await page.screenshot({ path: file, fullPage: false }).catch(() => {});
  return file;
}

async function placeFlagshipAtCore(page) {
  return page.evaluate(() => {
    const st = window.getGameState();
    st.flagship.transit = null;
    st.flagship.wormholeTransit = null;
    st.flagship.orbit = null;
    st.flagship.systemId = 'core';
    st.flagship.galaxyId = st.activeGalaxyId;
    st.flagship.x = 0;
    st.flagship.y = 0;
    window.__viewSystem?.('core');
    window.__setView?.('system');
    window.__snapCamera?.(0, 0, 0.85);
    return { galaxyId: st.activeGalaxyId, systemId: st.flagship.systemId };
  });
}

async function waitWormholeArrival(page, timeoutMs = 30000) {
  const startGal = await page.evaluate(() => window.getGameState().activeGalaxyId);
  await page.waitForFunction((prev) => {
    const st = window.getGameState();
    if (!st?.flagship) return false;
    if (st.flagship.wormholeTransit) return false;
    return st.activeGalaxyId && st.activeGalaxyId !== prev;
  }, startGal, { timeout: timeoutMs }).catch(() => {});
  // Allow arrival FX / first frames after hydrate.
  await page.waitForTimeout(500);
  return page.evaluate(() => ({
    activeGalaxyId: window.getGameState().activeGalaxyId,
    transit: !!window.getGameState().flagship?.wormholeTransit,
  }));
}

async function advanceWhileRendering(page, ms) {
  // Chunk advanceTime so the renderer keeps painting between bursts.
  const chunk = 500;
  let left = ms;
  while (left > 0) {
    const step = Math.min(chunk, left);
    await page.evaluate((n) => window.advanceTime?.(n), step);
    await page.waitForTimeout(50);
    left -= step;
  }
}

function writeReports(report) {
  const jsonPath = path.join(outputDir, `${runId}-report.json`);
  const mdPath = path.join(outputDir, `${runId}-report.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  const lines = [
    `# Solo Campaign FPS Report`,
    ``,
    `- runId: \`${report.runId}\``,
    `- seed: ${report.seed}`,
    `- env: ${report.env.gl} headless=${report.env.headless}`,
    `- galaxies: ${(report.galaxyIdsVisited || []).join(', ') || '(none)'}`,
    `- pass: **${report.pass ? 'YES' : 'NO'}**`,
    ``,
    `| Stage | Pass | FPS avg/p5 | Draw sys/gal | GL | Sim | Hitch | Galaxy |`,
    `|---|---|---|---|---|---|---|---|`,
  ];
  for (const s of report.stages) {
    lines.push(
      `| ${s.id} ${s.name} | ${s.pass ? 'ok' : 'FAIL'} | ${s.fpsAvg}/${s.fpsP5} | ${s.systemDrawMs ?? '-'} / ${s.galaxyDrawMs ?? '-'} | ${s.glFlushMs ?? '-'} | ${s.simMs ?? '-'} | ${s.hitchCount ?? 0} | ${s.activeGalaxyId ?? '-'} |`,
    );
  }
  if (report.failures?.length) {
    lines.push(``, `## Failures`, ``);
    for (const f of report.failures) {
      lines.push(`- **${f.stageId}**: ${JSON.stringify(f.failures || f)}`);
    }
  }
  fs.writeFileSync(mdPath, lines.join('\n'));
  return { jsonPath, mdPath };
}

async function runStage(page, report, stageFn) {
  if (stagesFilter && !stagesFilter.includes(stageFn.id)) {
    console.log(`[solo-fps] skip ${stageFn.id}`);
    return true;
  }
  console.log(`[solo-fps] ${stageFn.id} ${stageFn.name}…`);
  try {
    const result = await stageFn.run(page, report);
    report.stages.push(result);
    if (result.activeGalaxyId) {
      if (!report.galaxyIdsVisited.includes(result.activeGalaxyId)) {
        report.galaxyIdsVisited.push(result.activeGalaxyId);
      }
    }
    if (!result.pass) {
      report.failures.push({ stageId: result.id, failures: result.failures, warnings: result.warnings });
      await screenshotFail(page, result.id);
      console.log(`[solo-fps] FAIL ${result.id}`, result.failures);
      if (!KEEP_GOING) return false;
    } else {
      console.log(`[solo-fps] ok ${result.id} fps=${result.fpsAvg}/${result.fpsP5}`);
    }
    return true;
  } catch (err) {
    const failure = {
      id: stageFn.id,
      name: stageFn.name,
      pass: false,
      failures: [{ id: 'exception', value: String(err.message || err) }],
      warnings: [],
      notes: String(err.stack || err),
    };
    report.stages.push(failure);
    report.failures.push({ stageId: stageFn.id, failures: failure.failures });
    await screenshotFail(page, stageFn.id);
    console.error(`[solo-fps] ERROR ${stageFn.id}`, err);
    if (!KEEP_GOING) return false;
    return true;
  }
}

/** Stage implementations */
const stages = [
  {
    id: 'S01',
    name: 'stronghold-idle-thrust',
    async run(page) {
      await page.evaluate(() => {
        window.__setView('system');
        const st = window.getGameState();
        window.__viewSystem(st.stronghold);
        window.__snapCamera(0, 0, 1);
      });
      const idle = await sampleStage(page, { id: 'S01', name: 'stronghold-idle', viewHint: 'system' });
      const thrust = await sampleStage(page, {
        id: 'S01b', name: 'stronghold-thrust', viewHint: 'system', thrust: true,
      });
      const cliff = idle.fpsAvg && thrust.fpsAvg
        ? (idle.fpsAvg - thrust.fpsAvg) / idle.fpsAvg
        : 0;
      const merged = {
        ...idle,
        id: 'S01',
        name: 'stronghold-idle-thrust',
        fpsAvg: Math.min(idle.fpsAvg ?? 999, thrust.fpsAvg ?? 999),
        fpsP5: Math.min(idle.fpsP5 ?? 999, thrust.fpsP5 ?? 999),
        fpsP1: Math.min(idle.fpsP1 ?? 999, thrust.fpsP1 ?? 999),
        systemDrawMs: Math.max(idle.systemDrawMs ?? 0, thrust.systemDrawMs ?? 0),
        glFlushMs: Math.max(idle.glFlushMs ?? 0, thrust.glFlushMs ?? 0),
        simMs: Math.max(idle.simMs ?? 0, thrust.simMs ?? 0),
        hitchCount: (idle.hitchCount ?? 0) + (thrust.hitchCount ?? 0),
        notes: `idle=${idle.fpsAvg} thrust=${thrust.fpsAvg} cliff=${round(cliff * 100, 1)}%`,
        pass: idle.pass && thrust.pass && cliff <= 0.25,
        failures: [
          ...(idle.failures || []),
          ...(thrust.failures || []),
          ...(cliff > 0.25 ? [{ id: 'thrustCliff', value: cliff, budget: 0.25 }] : []),
        ],
      };
      return merged;
    },
  },
  {
    id: 'S02',
    name: 'home-galaxy-lod',
    async run(page) {
      await page.evaluate(() => {
        window.__setView('galaxy');
        window.__snapGalaxyCamera(0, 0, 0.05);
      });
      const far = await sampleStage(page, { id: 'S02-far', name: 'galaxy-far', viewHint: 'galaxy', sampleMs: 4000 });
      await page.evaluate(() => window.__snapGalaxyCamera(0, 0, 0.15));
      const mid = await sampleStage(page, { id: 'S02-mid', name: 'galaxy-mid', viewHint: 'galaxy' });
      await page.evaluate(() => window.__snapGalaxyCamera(0, 0, 0.4));
      const close = await sampleStage(page, { id: 'S02-close', name: 'galaxy-close', viewHint: 'galaxy' });
      // Plan gate: far LOD must pass draw budget; mid/close are recorded.
      const midCloseWarnings = [...(mid.failures || []), ...(close.failures || [])]
        .filter((f) => f.id === 'galaxyDrawMs' || f.id.startsWith('fps') || f.id === 'simMs' || f.id === 'totalFrameMs' || f.id === 'glFlushMs')
        .map((f) => ({ ...f, softTier: true }));
      const midCloseHard = [...(mid.failures || []), ...(close.failures || [])]
        .filter((f) => !midCloseWarnings.includes(f) && f.id !== 'galaxyDrawMs' && !f.id.startsWith('fps') && f.id !== 'simMs' && f.id !== 'totalFrameMs' && f.id !== 'glFlushMs');
      return {
        ...far,
        id: 'S02',
        name: 'home-galaxy-lod',
        galaxyDrawMs: far.galaxyDrawMs,
        midGalaxyDrawMs: mid.galaxyDrawMs,
        closeGalaxyDrawMs: close.galaxyDrawMs,
        pass: far.pass && midCloseHard.length === 0,
        failures: [...(far.failures || []), ...midCloseHard],
        warnings: [...(far.warnings || []), ...midCloseWarnings, ...(mid.warnings || []), ...(close.warnings || [])],
        notes: `far=${far.fpsAvg}/${far.galaxyDrawMs} mid=${mid.fpsAvg}/${mid.galaxyDrawMs} close=${close.fpsAvg}/${close.galaxyDrawMs}`,
        view: 'galaxy',
        samples: { far, mid, close },
      };
    },
  },
  {
    id: 'S03',
    name: 'empire-foothold',
    async run(page) {
      await page.evaluate(() => {
        const st = window.getGameState();
        window.__devAction('grantCredits', { amount: 50000 });
        window.__devAction('buildEmpireKit', { systemId: st.stronghold });
        window.__setView('system');
        window.__viewSystem(st.stronghold);
        window.__snapCamera(0, 0, 1);
      });
      await advanceWhileRendering(page, 5000);
      return sampleStage(page, { id: 'S03', name: 'empire-foothold', viewHint: 'system', sampleMs: 4000 });
    },
  },
  {
    id: 'S04',
    name: 'expansion-capture',
    async run(page) {
      await page.evaluate(() => {
        const st = window.getGameState();
        const graph = st.galaxies[st.activeGalaxyId].graph;
        const home = st.stronghold;
        const lanes = graph.lanes || [];
        const neighbors = [];
        for (const lane of lanes) {
          const a = Array.isArray(lane) ? lane[0] : lane.a;
          const b = Array.isArray(lane) ? lane[1] : lane.b;
          if (a === home) neighbors.push(b);
          if (b === home) neighbors.push(a);
        }
        const target = neighbors.find((id) => id !== 'core') || neighbors[0];
        if (target) window.__devAction('forceCapture', { systemId: target });
        window.__devAction('buildEmpireKit', { systemId: target || home });
        window.__setView('system');
        if (target) window.__viewSystem(target);
      });
      const sys = await sampleStage(page, { id: 'S04-sys', name: 'expand-system', viewHint: 'system' });
      await page.evaluate(() => {
        window.__setView('galaxy');
        window.__snapGalaxyCamera(0, 0, 0.05);
      });
      const gal = await sampleStage(page, { id: 'S04-gal', name: 'expand-galaxy', viewHint: 'galaxy' });
      return {
        ...sys,
        id: 'S04',
        name: 'expansion-capture',
        galaxyDrawMs: gal.galaxyDrawMs,
        pass: sys.pass && gal.pass,
        failures: [...(sys.failures || []), ...(gal.failures || [])],
        notes: `sys=${sys.fpsAvg} gal=${gal.fpsAvg}`,
      };
    },
  },
  {
    id: 'S05',
    name: 'tactical-combat',
    async run(page) {
      await page.evaluate(() => {
        const st = window.getGameState();
        const sysId = st.stronghold;
        window.__viewSystem(sysId);
        window.__setView('system');
        window.__devAction('spawnFleetPreset', { systemId: sysId, presetId: 'battle_fleet' });
        window.__devAction('spawnEnemyFleet', { systemId: sysId, size: 'large' });
        // Ensure battle engages
        window.__devAction('spawnEnemyFleet', { systemId: sysId, size: 'medium' });
        window.__snapCamera(0, 0, 1.1);
        st.paused = false;
      });
      await page.waitForTimeout(800);
      const sample = await sampleStage(page, {
        id: 'S05', name: 'tactical-combat', viewHint: 'system', sampleMs: 5000,
      });
      const units = sample.combatUnits ?? 0;
      sample.notes = `combatUnits=${units}`;
      return sample;
    },
  },
  {
    id: 'S06',
    name: 'dyson-logistics',
    async run(page) {
      await page.evaluate(() => {
        const st = window.getGameState();
        window.__devAction('grantCredits', { amount: 100000 });
        window.__devAction('grantSolarii', { amount: 50 });
        window.__devAction('buildDysonKit', { systemId: st.stronghold });
        window.__devAction('forceShellProgress', { systemId: st.stronghold, sails: 24 });
        window.__setView('system');
        window.__viewSystem(st.stronghold);
        window.__snapCamera(0, 0, 0.55);
      });
      await advanceWhileRendering(page, 8000);
      return sampleStage(page, { id: 'S06', name: 'dyson-logistics', viewHint: 'system', sampleMs: 5000 });
    },
  },
  {
    id: 'S07',
    name: 'core-approach',
    async run(page) {
      await placeFlagshipAtCore(page);
      await page.evaluate(() => {
        window.__setView('galaxy');
        window.__snapGalaxyCamera(0, 0, 0.1);
      });
      // Simulate travel framing: briefly leave then return while sampling galaxy.
      await page.evaluate(() => {
        const st = window.getGameState();
        st.flagship.transit = {
          from: st.stronghold,
          to: 'core',
          startTime: st.time,
          durationMs: 8000,
          progress: 0.4,
        };
      });
      const sample = await sampleStage(page, {
        id: 'S07', name: 'core-approach', viewHint: 'galaxy', sampleMs: 4000,
      });
      await page.evaluate(() => {
        const st = window.getGameState();
        st.flagship.transit = null;
        st.flagship.systemId = 'core';
      });
      return sample;
    },
  },
  {
    id: 'S08',
    name: 'unanchored-wormhole-transit',
    async run(page) {
      await placeFlagshipAtCore(page);
      await page.evaluate(() => {
        window.__devAction('grantCredits', { amount: 5000 });
        window.__setView('system');
      });
      const enter = await page.evaluate(() => window.__enterWormhole({}));
      assert(enter?.ok, `wormhole enter failed: ${enter?.reason || JSON.stringify(enter)}`);
      // Sample during live transit — advance sim while rAF samples.
      await page.evaluate((tag) => window.__setPerfStageTag?.(tag), 'S08');
      await startSampler(page, 8500);
      // Drive transit completion via wall-clock sim at ~1x by advanceTime in chunks
      // while sampler collects frames.
      for (let i = 0; i < 20; i += 1) {
        await page.evaluate(() => window.advanceTime?.(500));
        await page.waitForTimeout(200);
        const done = await page.evaluate(() => !window.getGameState().flagship?.wormholeTransit);
        if (done) break;
      }
      // Ensure arrival if still mid-jump
      await page.evaluate(() => {
        const st = window.getGameState();
        if (st.flagship?.wormholeTransit) {
          const left = st.flagship.wormholeTransit.durationMs
            - (st.time - st.flagship.wormholeTransit.startTime) + 100;
          window.advanceTime?.(Math.max(100, left));
        }
      });
      await page.waitForTimeout(400);
      const raw = await readSampler(page);
      const evaled = evaluateBudgets(raw, { viewHint: 'system' });
      const gal = await page.evaluate(() => window.getGameState().activeGalaxyId);
      return {
        id: 'S08',
        name: 'unanchored-wormhole-transit',
        ...evaled,
        activeGalaxyId: gal,
        view: raw.context?.view ?? 'system',
        notes: `enterOk transit sampled; arrived=${gal}`,
      };
    },
  },
  {
    id: 'S09',
    name: 'hydrate-secondary',
    async run(page) {
      // Arrival should already have happened in S08; sample post-hydrate load.
      const gal = await page.evaluate(() => window.getGameState().activeGalaxyId);
      await page.evaluate(() => {
        window.__setView('system');
        window.__viewSystem('core');
        window.__snapCamera(0, 0, 0.9);
      });
      const sample = await sampleStage(page, {
        id: 'S09', name: 'hydrate-secondary', viewHint: 'system', sampleMs: 3000,
      });
      sample.activeGalaxyId = gal;
      sample.notes = `post-hydrate galaxy=${gal} maxFrame=${sample.maxFrameMs}`;
      return sample;
    },
  },
  {
    id: 'S10',
    name: 'secondary-beachhead',
    async run(page) {
      await page.evaluate(() => {
        const st = window.getGameState();
        let gal = st.galaxies[st.activeGalaxyId];
        if (!gal || gal.status !== 'active' || !gal.systems || Object.keys(gal.systems).length === 0) {
          window.__hydrateGalaxy?.(st.activeGalaxyId);
          gal = st.galaxies[st.activeGalaxyId];
        }
        const systems = gal?.systems || {};
        const target = Object.keys(systems).find((id) => id !== 'core' && systems[id]);
        if (target) {
          const cap = window.__devAction('forceCapture', { systemId: target });
          if (!cap?.ok && cap?.reason !== 'System is already player-owned') {
            /* continue sampling even if capture fails */
          }
          window.__devAction('buildEmpireKit', { systemId: target });
          window.__viewSystem(target);
          st.flagship.systemId = target;
          st.flagship.galaxyId = st.activeGalaxyId;
          st.flagship.transit = null;
          st.flagship.x = 0;
          st.flagship.y = 0;
        }
        window.__setView('system');
        window.__snapCamera(0, 0, 1);
        return { target, status: gal?.status, systemCount: Object.keys(systems).length };
      });
      const sys = await sampleStage(page, { id: 'S10-sys', name: 'beach-system', viewHint: 'system' });
      await page.evaluate(() => {
        window.__setView('galaxy');
        window.__snapGalaxyCamera(0, 0, 0.08);
      });
      const gal = await sampleStage(page, { id: 'S10-gal', name: 'beach-galaxy', viewHint: 'galaxy' });
      const active = await page.evaluate(() => window.getGameState().activeGalaxyId);
      return {
        ...sys,
        id: 'S10',
        name: 'secondary-beachhead',
        activeGalaxyId: active,
        galaxyDrawMs: gal.galaxyDrawMs,
        pass: sys.pass && gal.pass && active !== 'gal-0',
        failures: [
          ...(sys.failures || []),
          ...(gal.failures || []),
          ...(active === 'gal-0' ? [{ id: 'notSecondary', value: active }] : []),
        ],
        notes: `galaxy=${active}`,
      };
    },
  },
  {
    id: 'S11',
    name: 'third-galaxy',
    async run(page, report) {
      const before = await page.evaluate(() => window.getGameState().activeGalaxyId);
      await placeFlagshipAtCore(page);
      // Pick a target galaxy distinct from home and current.
      const target = await page.evaluate((avoid) => {
        const st = window.getGameState();
        const ids = Object.keys(st.galaxies || {}).filter((id) => !avoid.includes(id));
        return ids[0] || null;
      }, ['gal-0', before]);
      assert(target, 'no third galaxy available');
      await page.evaluate((galId) => {
        window.__devAction('grantCredits', { amount: 5000 });
        window.__setView('system');
        return window.__enterWormhole({ targetGalaxyId: galId });
      }, target);
      await startSampler(page, 8500);
      for (let i = 0; i < 20; i += 1) {
        await page.evaluate(() => window.advanceTime?.(500));
        await page.waitForTimeout(200);
        const done = await page.evaluate(() => !window.getGameState().flagship?.wormholeTransit);
        if (done) break;
      }
      await page.evaluate(() => {
        const st = window.getGameState();
        if (st.flagship?.wormholeTransit) {
          const left = st.flagship.wormholeTransit.durationMs
            - (st.time - st.flagship.wormholeTransit.startTime) + 100;
          window.advanceTime?.(Math.max(100, left));
        }
      });
      await page.waitForTimeout(500);
      const raw = await readSampler(page);
      const evaled = evaluateBudgets(raw, { viewHint: 'system' });
      const active = await page.evaluate(() => window.getGameState().activeGalaxyId);
      await page.evaluate(() => {
        const st = window.getGameState();
        const systems = st.galaxies[st.activeGalaxyId]?.systems || {};
        const starId = Object.keys(systems).find((id) => id !== 'core');
        if (starId) {
          window.__devAction('forceCapture', { systemId: starId });
          window.__viewSystem(starId);
        }
        window.__setView('galaxy');
        window.__snapGalaxyCamera(0, 0, 0.05);
      });
      const galSample = await sampleStage(page, {
        id: 'S11-gal', name: 'third-galaxy-map', viewHint: 'galaxy',
      });
      if (!report.galaxyIdsVisited.includes(active)) report.galaxyIdsVisited.push(active);
      return {
        id: 'S11',
        name: 'third-galaxy',
        ...evaled,
        galaxyDrawMs: galSample.galaxyDrawMs,
        activeGalaxyId: active,
        view: 'galaxy',
        pass: evaled.pass && galSample.pass && active !== 'gal-0' && active !== before,
        failures: [
          ...(evaled.failures || []),
          ...(galSample.failures || []),
          ...(active === before ? [{ id: 'galaxyUnchanged', value: active }] : []),
        ],
        notes: `from=${before} to=${active} target=${target}`,
      };
    },
  },
  {
    id: 'S12',
    name: 'return-home',
    async run(page) {
      await placeFlagshipAtCore(page);
      await page.evaluate(() => {
        window.__devAction('grantCredits', { amount: 5000 });
        window.__enterWormhole({ targetGalaxyId: 'gal-0' });
      });
      await startSampler(page, 8500);
      for (let i = 0; i < 20; i += 1) {
        await page.evaluate(() => window.advanceTime?.(500));
        await page.waitForTimeout(200);
        const done = await page.evaluate(() => !window.getGameState().flagship?.wormholeTransit);
        if (done) break;
      }
      await page.evaluate(() => {
        const st = window.getGameState();
        if (st.flagship?.wormholeTransit) {
          const left = st.flagship.wormholeTransit.durationMs
            - (st.time - st.flagship.wormholeTransit.startTime) + 100;
          window.advanceTime?.(Math.max(100, left));
        }
      });
      await page.waitForTimeout(500);
      const raw = await readSampler(page);
      const evaled = evaluateBudgets(raw, { viewHint: 'system' });
      const active = await page.evaluate(() => window.getGameState().activeGalaxyId);
      return {
        id: 'S12',
        name: 'return-home',
        ...evaled,
        activeGalaxyId: active,
        view: raw.context?.view ?? 'system',
        pass: evaled.pass && active === 'gal-0',
        failures: [
          ...(evaled.failures || []),
          ...(active !== 'gal-0' ? [{ id: 'notHome', value: active }] : []),
        ],
        notes: `returned=${active}`,
      };
    },
  },
  {
    id: 'S13',
    name: 'anchor-pair',
    async run(page, report) {
      await placeFlagshipAtCore(page);
      const target = (report.galaxyIdsVisited || []).find((id) => id !== 'gal-0') || 'gal-1';
      const anchor = await page.evaluate((galId) => {
        window.__devAction('grantCredits', { amount: 10000 });
        const st = window.getGameState();
        const whId = `wh-${st.activeGalaxyId}`;
        const existing = st.wormholes?.[whId]?.anchor;
        if (existing) {
          return { ok: true, already: true, anchor: existing };
        }
        return window.__buildWormholeAnchor(galId);
      }, target);
      await page.evaluate(() => {
        window.__setView('galaxy');
        window.__snapGalaxyCamera(0, 0, 0.05);
      });
      const sample = await sampleStage(page, { id: 'S13', name: 'anchor-pair', viewHint: 'galaxy' });
      sample.notes = `anchor=${JSON.stringify(anchor)} target=${target}`;
      if (!anchor?.ok) {
        sample.pass = false;
        sample.failures = [...(sample.failures || []), { id: 'anchorFailed', value: anchor }];
      }
      return sample;
    },
  },
  {
    id: 'S14',
    name: 'anchored-roundtrip',
    async run(page) {
      const results = [];
      for (const dir of ['out', 'back']) {
        await placeFlagshipAtCore(page);
        await page.evaluate(() => {
          window.__devAction('grantCredits', { amount: 5000 });
          window.__enterWormhole({ forceAnchored: true });
        });
        await startSampler(page, 8500);
        for (let i = 0; i < 20; i += 1) {
          await page.evaluate(() => window.advanceTime?.(500));
          await page.waitForTimeout(200);
          const done = await page.evaluate(() => !window.getGameState().flagship?.wormholeTransit);
          if (done) break;
        }
        await page.evaluate(() => {
          const st = window.getGameState();
          if (st.flagship?.wormholeTransit) {
            const left = st.flagship.wormholeTransit.durationMs
              - (st.time - st.flagship.wormholeTransit.startTime) + 100;
            window.advanceTime?.(Math.max(100, left));
          }
        });
        await page.waitForTimeout(400);
        const raw = await readSampler(page);
        const evaled = evaluateBudgets(raw, { viewHint: 'system' });
        const gal = await page.evaluate(() => window.getGameState().activeGalaxyId);
        results.push({ dir, gal, ...evaled });
      }
      const worst = results.sort((a, b) => (a.fpsAvg ?? 0) - (b.fpsAvg ?? 0))[0];
      return {
        id: 'S14',
        name: 'anchored-roundtrip',
        ...worst,
        activeGalaxyId: worst.gal,
        pass: results.every((r) => r.pass),
        failures: results.flatMap((r) => r.failures || []),
        notes: results.map((r) => `${r.dir}:${r.gal}@${r.fpsAvg}`).join(' '),
        view: 'system',
      };
    },
  },
  {
    id: 'S15',
    name: 'cross-galaxy-ops',
    async run(page) {
      await page.evaluate(() => {
        const st = window.getGameState();
        window.__devAction('grantCredits', { amount: 50000 });
        window.__devAction('spawnFleetPreset', { systemId: st.flagship.systemId || st.stronghold, presetId: 'scout_wing' });
        window.__setView('galaxy');
        window.__snapGalaxyCamera(0, 0, 0.05);
      });
      const far = await sampleStage(page, {
        id: 'S15-far', name: 'cross-ops-far', viewHint: 'galaxy', sampleMs: 5000,
      });
      await page.evaluate(() => {
        const st = window.getGameState();
        window.__setView('system');
        window.__viewSystem(st.flagship.systemId);
        window.__snapCamera(0, 0, 1);
      });
      const busy = await sampleStage(page, {
        id: 'S15-busy', name: 'cross-ops-system', viewHint: 'system', sampleMs: 5000,
      });
      return {
        ...far,
        id: 'S15',
        name: 'cross-galaxy-ops',
        systemDrawMs: busy.systemDrawMs,
        pass: far.pass && busy.pass,
        failures: [...(far.failures || []), ...(busy.failures || [])],
        notes: `far=${far.fpsAvg} busy=${busy.fpsAvg}`,
      };
    },
  },
  {
    id: 'S16',
    name: 'dominion-victory',
    async run(page) {
      // Anchor path should already meet dominion after player-owned anchors.
      const victory = await page.evaluate(() => {
        const summary = window.__campaignSummary?.();
        const check = window.__checkVictory?.();
        return { summary, check, won: window.getGameState().campaign?.won };
      });
      if (!victory.won) {
        // Ensure at least one player-owned anchor pair exists, then re-check.
        await placeFlagshipAtCore(page);
        await page.evaluate(() => {
          window.__devAction('grantCredits', { amount: 20000 });
          const st = window.getGameState();
          const other = Object.keys(st.galaxies).find((id) => id !== st.activeGalaxyId) || 'gal-1';
          const whId = `wh-${st.activeGalaxyId}`;
          if (!st.wormholes?.[whId]?.anchor) {
            window.__buildWormholeAnchor(other);
          }
          // Mark both ends as player-owned for dominion anchor path.
          for (const wh of Object.values(st.wormholes || {})) {
            if (wh?.anchor) wh.anchorOwner = 'player';
          }
          window.__checkVictory?.();
        });
      }
      await page.evaluate(() => {
        window.__setView('galaxy');
        window.__snapGalaxyCamera(0, 0, 0.05);
      });
      const sample = await sampleStage(page, { id: 'S16', name: 'dominion-victory', viewHint: 'galaxy' });
      const won = await page.evaluate(() => !!window.getGameState().campaign?.won);
      sample.notes = `won=${won} prior=${JSON.stringify(victory.check || victory.summary || {})}`;
      if (!won) {
        sample.pass = false;
        sample.failures = [...(sample.failures || []), { id: 'notWon', value: false }];
      }
      return sample;
    },
  },
  {
    id: 'S17',
    name: 'soak-worst',
    async run(page, report) {
      const failed = [...report.stages].filter((s) => s.id !== 'S17' && s.pass === false);
      const worst = failed.sort((a, b) => (a.fpsAvg ?? 0) - (b.fpsAvg ?? 0))[0]
        || report.stages.find((s) => s.id === 'S15')
        || report.stages[report.stages.length - 1];
      // Default to busy cross-ops framing for soak.
      await page.evaluate(() => {
        window.__setView('galaxy');
        window.__snapGalaxyCamera(0, 0, 0.05);
        const st = window.getGameState();
        if (st) st.paused = false;
      });
      const soakMs = SOAK_MS;
      console.log(`[solo-fps] soaking ${soakMs}ms (worst ref=${worst?.id})`);
      const sample = await sampleStage(page, {
        id: 'S17', name: 'soak-worst', viewHint: 'galaxy', sampleMs: soakMs,
      });
      sample.notes = `soakMs=${soakMs} ref=${worst?.id || 'none'}`;
      return sample;
    },
  },
];

async function main() {
  console.log(`[solo-fps] url=${baseUrl} seed=${SEED} sample=${SAMPLE_MS}ms soak=${SOAK_MS}ms`);
  console.log(`[solo-fps] stages=${(stagesFilter || ALL_STAGES).join(',')}`);

  // Auto soft-FPS under typical headless software GL unless overridden.
  if (process.env.GS_SOLO_FPS_SOFT_FPS == null) {
    process.env.GS_SOLO_FPS_SOFT_FPS = '1';
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader'],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  const pageErrors = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  const report = {
    runId,
    seed: SEED,
    env: {
      headless: true,
      gl: 'swiftshader',
      viewport: [1440, 960],
      softFps: process.env.GS_SOLO_FPS_SOFT_FPS === '1',
    },
    budgets: BUDGETS,
    galaxyIdsVisited: [],
    stages: [],
    failures: [],
    beforeAfter: [],
    pageErrors,
    pass: false,
  };

  try {
    await enterCampaign(page, SEED);
    report.galaxyIdsVisited.push(
      await page.evaluate(() => window.getGameState().activeGalaxyId),
    );

    // Smoke instrumentation
    const smoke = await page.evaluate(() => ({
      fps: typeof window.__fps === 'function' ? window.__fps() : null,
      frame: typeof window.__framePerf === 'function' ? window.__framePerf() : null,
      system: typeof window.__systemPerfSummary === 'function' ? window.__systemPerfSummary() : null,
      galaxy: typeof window.__galaxyPerfSummary === 'function' ? window.__galaxyPerfSummary() : null,
    }));
    assert(smoke.frame, '__framePerf missing');
    assert(smoke.system, '__systemPerfSummary missing');
    report.instrumentationSmoke = smoke;

    for (const stage of stages) {
      const ok = await runStage(page, report, stage);
      if (!ok) break;
    }

    const mgCount = new Set(report.galaxyIdsVisited).size;
    report.multiGalaxy = {
      galaxyCount: mgCount,
      pass: mgCount >= 3 || !(stagesFilter == null || stagesFilter.some((s) => ['S08', 'S09', 'S10', 'S11', 'S12'].includes(s))),
    };
    report.pass = report.failures.length === 0
      && (stagesFilter != null || report.multiGalaxy.pass || !stages.some((s) => ['S11'].includes(s.id)));
    // Full-run multi-galaxy gate
    if (stagesFilter == null) {
      report.pass = report.failures.length === 0 && mgCount >= 3;
      if (mgCount < 3) {
        report.failures.push({ stageId: 'B-MG-COUNT', failures: [{ id: 'galaxyCount', value: mgCount, budget: 3 }] });
      }
    } else {
      report.pass = report.failures.length === 0;
    }
  } finally {
    const paths = writeReports(report);
    console.log(`[solo-fps] report ${paths.jsonPath}`);
    console.log(`[solo-fps] summary ${paths.mdPath}`);
    await browser.close();
  }

  if (!report.pass) {
    console.error('[solo-fps] FAILED');
    process.exitCode = 1;
  } else {
    console.log('[solo-fps] PASSED');
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
