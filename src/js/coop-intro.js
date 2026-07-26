// Multiplayer join cinematic — a distinct docking handshake for an existing world.

const TOTAL_MS = 6800;
const REDUCED_TOTAL_MS = 1900;
const SKIP_MIN_MS = 950;
const SKIP_FADE_MS = 520;

const PHASES = Object.freeze([
  { id: 'signal', label: 'RECEIVING WORLD HANDSHAKE', start: 0, end: 1500 },
  { id: 'corridor', label: 'OPENING DOCKING CORRIDOR', start: 1500, end: 3300 },
  { id: 'docking', label: 'PILOT SIGNATURE ACCEPTED', start: 3300, end: 5000 },
  { id: 'handoff', label: 'SHARED EMPIRE LINKED', start: 5000, end: TOTAL_MS },
]);

let active = false;
let startTime = 0;
let debugElapsed = null;
let reducedMotion = false;
let skipRequested = false;
let skipRequestedAt = 0;
let onComplete = null;
let drawGameFrame = null;
let context = {
  serverName: 'UNKNOWN RELAY',
  playerName: 'PILOT',
  playersOnline: 1,
  worldId: '',
};

function clamp01(value) { return Math.max(0, Math.min(1, value)); }
function smoothstep(value) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}
function between(value, start, end) {
  return smoothstep((value - start) / Math.max(1, end - start));
}
function elapsedNow(now = performance.now()) {
  return debugElapsed ?? Math.max(0, now - startTime);
}
function phaseFor(elapsed) {
  return PHASES.find((phase) => elapsed >= phase.start && elapsed < phase.end) ?? PHASES.at(-1);
}
function effectiveElapsed(now = performance.now()) {
  const raw = elapsedNow(now);
  return reducedMotion ? raw * (TOTAL_MS / REDUCED_TOTAL_MS) : raw;
}

function state(now = performance.now()) {
  const raw = elapsedNow(now);
  const elapsed = effectiveElapsed(now);
  const phase = phaseFor(elapsed);
  return {
    active,
    elapsedMs: Math.round(elapsed),
    progress: clamp01(elapsed / TOTAL_MS),
    phase: phase.id,
    phaseLabel: phase.label,
    skipReady: raw >= (reducedMotion ? 420 : SKIP_MIN_MS),
    skipRequested,
    reducedMotion,
    serverName: context.serverName,
    playerName: context.playerName,
    playersOnline: context.playersOnline,
    worldId: context.worldId,
  };
}

function drawBackground(ctx, canvas, elapsed) {
  const w = canvas.width;
  const h = canvas.height;
  const gradient = ctx.createLinearGradient(0, 0, w, h);
  gradient.addColorStop(0, '#070d1d');
  gradient.addColorStop(0.48, '#10152c');
  gradient.addColorStop(1, '#1c0e22');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 90; i++) {
    const seed = (i * 92821 + Math.floor(elapsed / 50) * 68917) >>> 0;
    const x = (seed % 1009) / 1009 * w;
    const y = ((seed * 37) % 1013) / 1013 * h;
    const twinkle = 0.25 + ((seed >>> 8) % 100) / 180;
    ctx.fillStyle = `rgba(147, 215, 255, ${twinkle})`;
    ctx.fillRect(x, y, 1.4, 1.4);
  }
  ctx.strokeStyle = 'rgba(91, 168, 230, 0.12)';
  ctx.lineWidth = 1;
  const sweep = (elapsed * 0.00016) % 1;
  for (let i = -6; i <= 6; i++) {
    ctx.beginPath();
    ctx.moveTo(w * 0.5, h * 0.54);
    ctx.lineTo(w * 0.5 + i * w * 0.16, h);
    ctx.stroke();
  }
  for (let i = 0; i < 10; i++) {
    const t = ((i / 10 + sweep) % 1) ** 2.4;
    const y = h * 0.54 + t * h * 0.46;
    ctx.globalAlpha = 0.15 + t * 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawRing(ctx, cx, cy, radius, rotation, alpha, dash = []) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation);
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = 'rgba(111, 214, 255, 0.95)';
  ctx.lineWidth = 1.5 + alpha * 2.5;
  ctx.setLineDash(dash);
  ctx.shadowColor = 'rgba(111, 214, 255, 0.9)';
  ctx.shadowBlur = 14 + alpha * 20;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawDockingGate(ctx, canvas, elapsed, progress) {
  const cx = canvas.width * 0.5;
  const cy = canvas.height * 0.54;
  const scale = Math.min(canvas.width, canvas.height);
  const corridor = between(elapsed, 650, 2750);
  const pulse = 0.6 + Math.sin(elapsed * 0.008) * 0.18;
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 3; i++) {
    drawRing(ctx, cx, cy, scale * (0.11 + i * 0.052) * (0.72 + corridor * 0.34), elapsed * (i % 2 ? -0.0013 : 0.0018) + i, (0.18 + corridor * 0.38) * (1 - i * 0.16), i === 1 ? [3, 8] : [10 + i * 4, 5]);
  }
  ctx.strokeStyle = `rgba(247, 190, 104, ${0.38 + corridor * 0.48})`;
  ctx.lineWidth = 2;
  ctx.shadowColor = 'rgba(247, 190, 104, 0.65)';
  ctx.shadowBlur = 18;
  for (let i = 0; i < 6; i++) {
    const angle = elapsed * 0.0014 + i * Math.PI / 3;
    const r = scale * (0.19 + corridor * 0.025);
    ctx.beginPath();
    ctx.arc(cx, cy, r, angle, angle + 0.21);
    ctx.stroke();
  }
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, scale * 0.13 * (0.3 + corridor * 0.7));
  core.addColorStop(0, `rgba(240, 250, 255, ${0.38 + progress * 0.4})`);
  core.addColorStop(0.22, `rgba(111, 214, 255, ${0.2 + pulse * 0.18})`);
  core.addColorStop(1, 'rgba(30, 50, 100, 0)');
  ctx.fillStyle = core;
  ctx.fillRect(cx - scale * 0.2, cy - scale * 0.2, scale * 0.4, scale * 0.4);
  ctx.restore();
}

function drawShips(ctx, canvas, elapsed, progress) {
  const arrival = between(elapsed, 2300, 4200);
  const vanish = 1 - between(elapsed, 5100, TOTAL_MS);
  const alpha = arrival * vanish;
  if (alpha <= 0) return;
  const cx = canvas.width * 0.5;
  const cy = canvas.height * 0.54;
  const scale = Math.min(canvas.width, canvas.height) * 0.06;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 5; i++) {
    const offset = (i - 2) * scale * 0.9;
    const x = cx + offset + Math.sin(elapsed * 0.003 + i) * scale * 0.12;
    const y = cy + Math.cos(elapsed * 0.002 + i * 1.7) * scale * 0.2;
    ctx.globalAlpha = alpha * (i === 2 ? 0.95 : 0.48);
    ctx.strokeStyle = i === 2 ? 'rgba(247, 190, 104, 0.95)' : 'rgba(111, 214, 255, 0.85)';
    ctx.lineWidth = Math.max(1, scale * 0.035);
    ctx.beginPath();
    ctx.moveTo(x + scale * 0.72, y);
    ctx.lineTo(x - scale * 0.52, y - scale * 0.22);
    ctx.lineTo(x - scale * 0.22, y);
    ctx.lineTo(x - scale * 0.52, y + scale * 0.22);
    ctx.closePath();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(111, 214, 255, 0.28)';
    ctx.beginPath();
    ctx.moveTo(x - scale * 0.35, y);
    ctx.lineTo(x - scale * (1.4 + progress * 1.6), y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawHud(ctx, canvas, elapsed, phase, progress) {
  const scale = Math.max(0.72, Math.min(canvas.width / 1920, canvas.height / 1080));
  const margin = 48 * scale;
  const fade = 1 - between(elapsed, 5000, TOTAL_MS);
  ctx.save();
  ctx.globalAlpha = 0.72 + fade * 0.28;
  ctx.fillStyle = 'rgba(111, 214, 255, 0.95)';
  ctx.font = `600 ${Math.round(11 * scale)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.fillText(`CO-OP // ${phase.label}`, margin, margin + 10 * scale);
  ctx.fillStyle = 'rgba(147, 172, 208, 0.85)';
  ctx.font = `500 ${Math.round(9 * scale)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.fillText(`RELAY  ${context.serverName}`, margin, margin + 33 * scale);
  ctx.fillText(`PILOT  ${context.playerName}`, margin, margin + 51 * scale);
  ctx.textAlign = 'right';
  ctx.fillText(`${context.playersOnline} PILOT${context.playersOnline === 1 ? '' : 'S'} ONLINE`, canvas.width - margin, margin + 10 * scale);
  ctx.fillText('SHARED EMPIRE // AUTHORIZED', canvas.width - margin, margin + 29 * scale);
  const trackW = Math.min(canvas.width * 0.42, 600 * scale);
  const trackY = canvas.height - margin * 0.9;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(89, 116, 158, 0.34)';
  ctx.fillRect(canvas.width * 0.5 - trackW * 0.5, trackY, trackW, Math.max(1, 2 * scale));
  ctx.fillStyle = 'rgba(111, 214, 255, 0.9)';
  ctx.fillRect(canvas.width * 0.5 - trackW * 0.5, trackY, trackW * progress, Math.max(1.5, 2.5 * scale));
  if (progress > 0.13 && !skipRequested) {
    ctx.globalAlpha = 0.45 + Math.sin(elapsed * 0.005) * 0.12;
    ctx.fillStyle = 'rgba(190, 214, 240, 0.9)';
    ctx.fillText('CLICK / SPACE TO SKIP', canvas.width - margin, canvas.height - margin * 0.45);
  }
  ctx.restore();
}

function bindListeners() {
  if (bindListeners.bound) return;
  bindListeners.bound = true;
  document.addEventListener('keydown', (event) => {
    if (!active) return;
    if (event.code === 'Space' || event.code === 'Enter') {
      event.preventDefault();
      skipCoopIntro();
    }
  });
  document.getElementById('game-canvas')?.addEventListener('click', () => {
    if (active) skipCoopIntro();
  });
}
bindListeners.bound = false;

export function startCoopIntro(ctx2d, canvas, opts = {}) {
  active = true;
  startTime = performance.now();
  debugElapsed = null;
  reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  skipRequested = false;
  skipRequestedAt = 0;
  context = {
    serverName: String(opts.serverName ?? 'UNKNOWN RELAY').replaceAll('_', ' ').toUpperCase(),
    playerName: String(opts.playerName ?? 'PILOT').trim().slice(0, 32).toUpperCase() || 'PILOT',
    playersOnline: Math.max(1, Number(opts.playersOnline) || 1),
    worldId: String(opts.worldId ?? ''),
  };
  onComplete = opts.onComplete ?? null;
  drawGameFrame = opts.drawGameFrame ?? null;
  bindListeners();
}

export function isCoopIntroActive() { return active; }
export function skipCoopIntro() {
  if (!active) return false;
  const raw = elapsedNow();
  if (raw < (reducedMotion ? 420 : SKIP_MIN_MS)) return false;
  skipRequested = true;
  skipRequestedAt = raw;
  return true;
}
export function coopIntroState(now = performance.now()) {
  if (!active && debugElapsed == null) return { ...state(now), active: false, elapsedMs: 0, progress: 0, phase: null, phaseLabel: null, skipReady: false };
  return state(now);
}
export function setCoopIntroElapsedForTest(ms) {
  if (!active) return coopIntroState();
  debugElapsed = Math.max(0, Number(ms) || 0);
  return coopIntroState();
}

export function drawCoopIntro(ctx2d, canvas, now) {
  if (!active) return;
  const raw = elapsedNow(now);
  const normalEnd = reducedMotion ? REDUCED_TOTAL_MS : TOTAL_MS;
  const end = skipRequested ? skipRequestedAt + SKIP_FADE_MS : normalEnd;
  if (raw >= end) {
    active = false;
    onComplete?.();
    onComplete = null;
    drawGameFrame = null;
    debugElapsed = null;
    return;
  }
  const elapsed = effectiveElapsed(now);
  const skipProgress = skipRequested ? smoothstep((raw - skipRequestedAt) / SKIP_FADE_MS) : 0;
  const progress = clamp01(elapsed / TOTAL_MS);
  const reveal = skipRequested ? skipProgress : between(elapsed, 4250, 5550);
  const phase = phaseFor(elapsed);
  drawBackground(ctx2d, canvas, elapsed);
  ctx2d.save();
  ctx2d.globalAlpha = reveal;
  if (drawGameFrame) drawGameFrame(ctx2d, reveal, elapsed);
  ctx2d.restore();
  drawDockingGate(ctx2d, canvas, elapsed, progress);
  drawShips(ctx2d, canvas, elapsed, progress);
  const flash = between(elapsed, 3550, 4050) * 0.72 + between(elapsed, 4750, 5450) * 0.45;
  if (flash > 0) {
    const glow = ctx2d.createRadialGradient(canvas.width * 0.5, canvas.height * 0.54, 0, canvas.width * 0.5, canvas.height * 0.54, Math.max(canvas.width, canvas.height) * 0.32);
    glow.addColorStop(0, `rgba(238, 250, 255, ${flash})`);
    glow.addColorStop(0.23, `rgba(111, 214, 255, ${flash * 0.32})`);
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx2d.save();
    ctx2d.globalCompositeOperation = 'screen';
    ctx2d.fillStyle = glow;
    ctx2d.fillRect(0, 0, canvas.width, canvas.height);
    ctx2d.restore();
  }
  const vignette = ctx2d.createRadialGradient(canvas.width * 0.5, canvas.height * 0.54, Math.min(canvas.width, canvas.height) * 0.18, canvas.width * 0.5, canvas.height * 0.54, Math.max(canvas.width, canvas.height) * 0.72);
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(1, `rgba(0, 0, 0, ${0.66 - reveal * 0.3})`);
  ctx2d.fillStyle = vignette;
  ctx2d.fillRect(0, 0, canvas.width, canvas.height);
  drawHud(ctx2d, canvas, elapsed, phase, progress);
}
