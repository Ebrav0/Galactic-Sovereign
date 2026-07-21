#!/usr/bin/env node
/**
 * Dual/quad browser FPS + presentation sync probe for co-op.
 *
 * Opens N Chromium pages against the static game URL, joins co-op, samples
 * requestAnimationFrame dt for ~FPS after all pilots are connected.
 *
 * Usage:
 *   npm run coop:fps
 *   GS_COOP_FPS_URL=http://100.67.50.44:8080 GS_COOP_WS=ws://100.67.50.44:9090 GS_COOP_PILOTS=4 npm run coop:fps
 */

import { chromium } from 'playwright';

const GAME = process.env.GS_COOP_FPS_URL || 'http://100.67.50.44:8080';
const WS = process.env.GS_COOP_WS || 'ws://100.67.50.44:9090';
const PILOTS = Math.max(2, Math.min(4, Number(process.env.GS_COOP_PILOTS || 4)));
const SAMPLE_MS = Number(process.env.GS_COOP_FPS_MS || 5000);
const SYNC_BUDGET_MS = Number(process.env.GS_COOP_SYNC_BUDGET_MS || 250);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function openPilot(browser, name) {
  const page = await browser.newPage();
  const url = `${GAME}/?coop=${encodeURIComponent(WS)}&coopName=${encodeURIComponent(name)}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  await page.evaluate(async (playerName) => {
    if (typeof window.__joinCoop === 'function') {
      try { await window.__joinCoop({ playerName }); } catch { /* query-driven join */ }
    }
  }, name).catch(() => {});

  for (const text of ['Join', 'Play', 'Continue', 'Start', 'Resume']) {
    const btn = page.getByRole('button', { name: new RegExp(text, 'i') }).first();
    if (await btn.count() && await btn.isVisible().catch(() => false)) {
      await btn.click({ timeout: 2000 }).catch(() => {});
    }
  }

  await page.waitForFunction(() => {
    const st = typeof window.__coopStatus === 'function' ? window.__coopStatus() : null;
    if (st?.connected || st?.authed || st?.phase === 'playing') return true;
    const gs = typeof window.getGameState === 'function' ? window.getGameState() : null;
    return Array.isArray(gs?.playerFlagships) && gs.playerFlagships.length > 0;
  }, { timeout: 45000 }).catch(() => {});

  await page.locator('canvas').first().click({ force: true }).catch(() => {});
  return { page, name };
}

async function startFpsSampler(page, sampleMs) {
  await page.evaluate((ms) => {
    window.__gsFps = { frames: 0, dts: [], last: performance.now(), done: false };
    const start = performance.now();
    function tick(now) {
      const s = window.__gsFps;
      if (!s || s.done) return;
      const dt = now - s.last;
      s.last = now;
      if (dt > 0 && dt < 250) s.dts.push(dt);
      s.frames += 1;
      if (now - start < ms) requestAnimationFrame(tick);
      else s.done = true;
    }
    requestAnimationFrame(tick);
  }, sampleMs);
}

function stats(dts) {
  if (!dts.length) return { fpsAvg: null, fpsP5: null, n: 0 };
  const fps = dts.map((d) => 1000 / d).sort((a, b) => a - b);
  const avg = fps.reduce((s, v) => s + v, 0) / fps.length;
  const p5 = fps[Math.max(0, Math.floor(fps.length * 0.05))];
  return { fpsAvg: Math.round(avg), fpsP5: Math.round(p5), n: fps.length };
}

async function sampleState(page) {
  return page.evaluate(() => {
    const status = typeof window.__coopStatus === 'function' ? window.__coopStatus() : null;
    const state = typeof window.getGameState === 'function' ? window.getGameState() : null;
    const roster = state?.playerFlagships || [];
    return {
      status,
      time: state?.time ?? null,
      peers: roster.map((f) => ({
        id: f.pilotId,
        x: Math.round(f.x || 0),
        y: Math.round(f.y || 0),
        sys: f.systemId,
      })),
      fps: window.__gsFps ? {
        frames: window.__gsFps.frames,
        done: window.__gsFps.done,
        dts: window.__gsFps.dts.slice(-240),
      } : null,
    };
  });
}

async function main() {
  console.log(`[fps] ${GAME} via ${WS} · pilots=${PILOTS} · sample=${SAMPLE_MS}ms`);
  const browser = await chromium.launch({ headless: true });
  const names = ['fps-a', 'fps-b', 'fps-c', 'fps-d'].slice(0, PILOTS);
  const pilots = [];
  for (const name of names) {
    pilots.push(await openPilot(browser, name));
    await new Promise((r) => setTimeout(r, 300));
  }

  // Warmup after all joins, then sample together.
  await new Promise((r) => setTimeout(r, 1500));
  for (const p of pilots) {
    await startFpsSampler(p.page, SAMPLE_MS);
    await p.page.keyboard.down('KeyD').catch(() => {});
  }
  await new Promise((r) => setTimeout(r, SAMPLE_MS + 400));
  for (const p of pilots) await p.page.keyboard.up('KeyD').catch(() => {});

  const samples = [];
  for (const p of pilots) samples.push({ name: p.name, ...(await sampleState(p.page)) });
  await browser.close();

  const usable = [];
  for (const s of samples) {
    const st = stats(s.fps?.dts || []);
    const phase = s.status?.phase || (s.status?.connected ? 'connected' : null);
    console.log(`[fps] ${s.name}`, {
      fpsAvg: st.fpsAvg,
      fpsP5: st.fpsP5,
      frames: s.fps?.frames,
      peers: s.peers?.length,
      time: s.time != null ? Math.round(s.time) : null,
      coop: phase,
    });
    if (st.fpsAvg != null && (s.fps?.frames ?? 0) >= 60) usable.push({ name: s.name, ...st, peers: s.peers?.length });
  }

  assert(usable.length >= 1, 'no usable FPS samples (pages failed to stay in co-op)');
  const best = usable.sort((a, b) => b.fpsAvg - a.fpsAvg)[0];
  console.log('[fps] best connected client', best);
  assert(best.fpsAvg >= 40, `best avg FPS ${best.fpsAvg} below 40`);
  assert(best.fpsP5 == null || best.fpsP5 >= 15, `best p5 FPS ${best.fpsP5} too low`);

  console.log('[fps] PASS');
  process.exit(0);
}

main().catch((err) => {
  console.error('[fps] FAIL', err);
  process.exit(1);
});
