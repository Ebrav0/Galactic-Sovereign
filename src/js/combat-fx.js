// Ship-to-ship combat FX: event bus helpers + Canvas draw styles.
// Render-only; combat emits events, this module owns lifetimes and drawing.

import {
  BATTLE_FX_DRAW_LIMIT,
  BATTLE_FX_DURATIONS,
  BATTLE_FX_EVENT_CAP,
  BATTLE_FX_HIT_FEEDBACK_MS,
  BATTLE_FX_KILL_MS,
  BATTLE_FX_ROLE_KILL_MS,
  BATTLE_FX_JUMP_IN_MS,
  BATTLE_FX_SWARM_DRAW_LIMIT,
  BATTLE_RENDER_LOD_UNITS,
  BATTLE_RENDER_SWARM_UNITS,
  TACTICAL_WEAPON_COOLDOWN_MS,
} from './constants.js';
import { THEME } from './theme.js';
import { weaponProfile } from './hull.js';

const PROFILE_COLORS = {
  kinetic: () => THEME.battle.kinetic,
  point_defense: () => THEME.battle.pointDefense,
  torpedo: () => THEME.battle.torpedo,
  beam_lance: () => THEME.battle.beamLance,
  ion: () => THEME.battle.ion,
  repair: () => THEME.battle.repair,
};

function profileColor(profile, side) {
  if (PROFILE_COLORS[profile]) return PROFILE_COLORS[profile]();
  if (side === 'enemy') return THEME.battle.tracerEnemy;
  return THEME.battle.tracerPlayer;
}

function hashId(id) {
  const s = String(id ?? '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function withAlpha(rgba, alpha) {
  if (typeof rgba !== 'string') return `rgba(255,255,255,${alpha})`;
  if (rgba.startsWith('rgba(')) {
    return rgba.replace(/[\d.]+\)$/, `${alpha})`);
  }
  if (rgba.startsWith('rgb(')) {
    return rgba.replace('rgb(', 'rgba(').replace(')', `,${alpha})`);
  }
  return rgba;
}

/** Ring-buffer push; keeps newest events. */
export function pushFxEvent(battle, event) {
  if (!battle || !event) return null;
  if (!Array.isArray(battle.fxEvents)) battle.fxEvents = [];
  battle.fxEvents.push(event);
  if (battle.fxEvents.length > BATTLE_FX_EVENT_CAP) {
    battle.fxEvents.splice(0, battle.fxEvents.length - BATTLE_FX_EVENT_CAP);
  }
  return event;
}

function baseShotEvent(state, attacker, target, hit, profileId) {
  const profile = profileId ?? attacker?.weaponProfile ?? 'kinetic';
  const cooldown = weaponProfile(profile).cooldownMs ?? TACTICAL_WEAPON_COOLDOWN_MS;
  return {
    kind: 'shot',
    t: state.time,
    profile,
    side: attacker.side ?? 'player',
    attackerId: attacker.id,
    targetId: target.id,
    ax: attacker.x,
    ay: attacker.y,
    tx: target.x,
    ty: target.y,
    facing: hit?.facing ?? null,
    shieldAbsorbed: hit?.shieldAbsorbed ?? 0,
    hullDamage: hit?.hullDamage ?? 0,
    destroyed: hit?.damageState === 'destroyed',
    cooldownMs: cooldown,
    volleyCount: profile === 'point_defense' ? 4 : (profile === 'kinetic' ? 2 : 1),
  };
}

/** Emit aimed shot FX (+ kill bloom when destroyed). */
export function emitShotFx(battle, { state, attacker, target, hit, profile } = {}) {
  if (!battle || !state || !attacker || !target) return null;
  battle.shotsFired = (battle.shotsFired ?? 0) + 1;
  battle.shotsFiredBySide = battle.shotsFiredBySide ?? {};
  battle.shotsFiredBySide[attacker.side ?? 'player'] = (battle.shotsFiredBySide[attacker.side ?? 'player'] ?? 0) + 1;
  battle.shotsFiredByActor = battle.shotsFiredByActor ?? {};
  battle.shotsFiredByActor[attacker.id] = (battle.shotsFiredByActor[attacker.id] ?? 0) + 1;
  const event = pushFxEvent(battle, baseShotEvent(state, attacker, target, hit, profile));
  const targetIsCapital = target.isCapital || [
    'cruiser', 'battleship', 'dreadnought', 'light_carrier', 'fleet_carrier',
    'super_carrier', 'hero_flagship', 'flagship', 'command_cruiser', 'helioclast',
  ].includes(target.hull);
  const heavyDamage = (hit?.hullDamage ?? 0) >= Math.max(18, (target.maxHp ?? target.hp ?? 1) * 0.035);
  if (targetIsCapital && (heavyDamage || profile === 'torpedo' || profile === 'beam_lance')) {
    pushFxEvent(battle, {
      ...baseShotEvent(state, attacker, target, hit, profile),
      kind: 'heavy_impact',
      priority: target.hull === 'helioclast' ? 5 : 3,
    });
  }
  if (hit?.damageState === 'destroyed') {
    const roleKill = target.hull === 'bomber' || target.isCapital
      || ['cruiser', 'battleship', 'dreadnought', 'light_carrier', 'fleet_carrier', 'super_carrier',
        'hero_flagship', 'flagship', 'command_cruiser'].includes(target.hull)
      ? (target.hull === 'bomber' ? 'bomber' : 'capital')
      : null;
    pushFxEvent(battle, {
      kind: 'kill',
      t: state.time,
      profile: 'kill',
      side: attacker.side ?? 'player',
      attackerId: attacker.id,
      targetId: target.id,
      ax: target.x,
      ay: target.y,
      tx: target.x,
      ty: target.y,
      facing: hit.facing ?? null,
      shieldAbsorbed: hit.shieldAbsorbed ?? 0,
      hullDamage: hit.hullDamage ?? 0,
      destroyed: true,
      roleKill,
    });
  }
  return event;
}

/** Emit one cinematic cue when a wing crosses into a new attack-pass phase. */
export function emitWingFlybyFx(battle, { state, unit, target, phase = 'strafe' } = {}) {
  if (!battle || !state || !unit || !target) return null;
  return pushFxEvent(battle, {
    kind: 'wing_flyby',
    t: state.time,
    profile: unit.weaponProfile ?? 'kinetic',
    side: unit.side ?? 'player',
    attackerId: unit.id,
    targetId: target.id,
    ax: unit.x,
    ay: unit.y,
    tx: target.x,
    ty: target.y,
    phase,
    priority: unit.hull === 'bomber' ? 4 : 2,
  });
}

/** Emit a withdrawal vector cue; simulation remains owned by combat.js. */
export function emitWithdrawalFx(battle, { state, unit, point } = {}) {
  if (!battle || !state || !unit || !point) return null;
  return pushFxEvent(battle, {
    kind: 'withdrawal',
    t: state.time,
    profile: 'withdrawal',
    side: unit.side ?? 'player',
    attackerId: unit.id,
    targetId: null,
    ax: unit.x,
    ay: unit.y,
    tx: point.x,
    ty: point.y,
    priority: 1,
  });
}

/** Emit a single repair ribbon to the primary heal target. */
export function emitHealFx(battle, { state, healer, ally } = {}) {
  if (!battle || !state || !healer || !ally) return null;
  return pushFxEvent(battle, {
    kind: 'shot',
    t: state.time,
    profile: 'repair',
    side: healer.side ?? 'player',
    attackerId: healer.id,
    targetId: ally.id,
    ax: healer.x,
    ay: healer.y,
    tx: ally.x,
    ty: ally.y,
    facing: null,
    shieldAbsorbed: 0,
    hullDamage: 0,
    destroyed: false,
    cooldownMs: BATTLE_FX_DURATIONS.repair,
    volleyCount: 1,
  });
}

/**
 * Sparse synthetic fire cues for pooled large battles.
 * Picks a few live attackers per side and aims toward the opposing centroid.
 */
export function emitSparseLodFx(battle, { state, friendlies, enemies } = {}) {
  if (!battle || !state) return;
  const tick = battle.largeTickIndex ?? 0;
  if (tick % 2 !== 0) return;

  const emitSide = (attackers, targets, budget) => {
    if (!attackers?.length || !targets?.length || budget <= 0) return;
    let cx = 0;
    let cy = 0;
    let n = 0;
    for (const u of targets) {
      if (u.hp <= 0) continue;
      cx += u.x;
      cy += u.y;
      n++;
    }
    if (!n) return;
    cx /= n;
    cy /= n;
    let emitted = 0;
    for (let i = 0; i < attackers.length && emitted < budget; i++) {
      const unit = attackers[(tick + i * 7) % attackers.length];
      if (!unit || unit.hp <= 0 || !(unit.dps > 0 || effectiveDpsHint(unit))) continue;
      if ((hashId(unit.id) + tick) % 5 !== 0) continue;
      pushFxEvent(battle, {
        kind: 'lod_pulse',
        t: state.time,
        profile: unit.weaponProfile ?? 'kinetic',
        side: unit.side ?? 'player',
        attackerId: unit.id,
        targetId: null,
        ax: unit.x,
        ay: unit.y,
        tx: cx,
        ty: cy,
        facing: null,
        shieldAbsorbed: 0,
        hullDamage: 0,
        destroyed: false,
        cooldownMs: BATTLE_FX_DURATIONS.lod_pulse,
        volleyCount: 1,
      });
      emitted++;
    }
  };

  emitSide(friendlies, enemies, 4);
  emitSide(enemies, friendlies, 4);
}

function effectiveDpsHint(unit) {
  return (unit?.weaponProfile && unit.weaponProfile !== 'repair') || (unit?.hull && unit.hull !== 'healer');
}

export function fxDurationMs(event) {
  if (!event) return 160;
  if (event.kind === 'wing_launch' || event.kind === 'wing_recover') {
    return event.stream ? 1100 : 760;
  }
  if (event.kind === 'jump_in') return BATTLE_FX_JUMP_IN_MS;
  if (event.kind === 'wing_flyby') return BATTLE_FX_DURATIONS.wing_flyby;
  if (event.kind === 'heavy_impact') return BATTLE_FX_DURATIONS.heavy_impact;
  if (event.kind === 'withdrawal') return BATTLE_FX_DURATIONS.withdrawal;
  if (event.kind === 'kill') {
    if (event.roleKill === 'capital' || event.roleKill === 'bomber') return BATTLE_FX_ROLE_KILL_MS;
    return BATTLE_FX_KILL_MS;
  }
  if (event.kind === 'lod_pulse') return BATTLE_FX_DURATIONS.lod_pulse;
  if (event.profile === 'beam_lance') {
    const hold = Math.min(BATTLE_FX_DURATIONS.beam_lance, (event.cooldownMs ?? TACTICAL_WEAPON_COOLDOWN_MS) * 0.35);
    return Math.max(120, hold);
  }
  return BATTLE_FX_DURATIONS[event.profile] ?? 160;
}

/** Highest-priority active cue for the optional tactical camera director. */
export function cinematicCueForBattle(battle, time) {
  const candidates = activeFxEvents(battle, time)
    .filter((event) => event.kind === 'wing_flyby'
      || event.kind === 'heavy_impact'
      || event.kind === 'kill')
    .map((event) => ({
      event,
      priority: event.priority ?? (event.kind === 'kill' ? 4 : event.kind === 'heavy_impact' ? 3 : 2),
    }))
    .sort((a, b) => b.priority - a.priority || b.event.t - a.event.t
      || String(a.event.attackerId).localeCompare(String(b.event.attackerId)));
  const picked = candidates[0]?.event;
  if (!picked) return null;
  return {
    key: `${picked.kind}:${picked.t}:${picked.attackerId ?? ''}:${picked.targetId ?? ''}`,
    kind: picked.kind,
    priority: candidates[0].priority,
    x: (picked.ax + picked.tx) * 0.5,
    y: (picked.ay + picked.ty) * 0.5,
    attackerId: picked.attackerId ?? null,
    targetId: picked.targetId ?? null,
    at: picked.t,
  };
}

export function activeFxEvents(battle, time) {
  const list = battle?.fxEvents;
  if (!Array.isArray(list) || !list.length) return [];
  return list.filter((ev) => time - ev.t <= fxDurationMs(ev));
}

/** Recent hit feedback keyed by target id for ship rim flashes. */
export function hitFeedbackByTarget(battle, time) {
  const map = new Map();
  for (const ev of activeFxEvents(battle, time)) {
    if (!ev.targetId || ev.kind === 'lod_pulse' || ev.kind === 'jump_in'
      || ev.kind === 'wing_launch' || ev.kind === 'wing_recover') continue;
    if (time - ev.t > BATTLE_FX_HIT_FEEDBACK_MS && ev.kind !== 'kill') continue;
    const prev = map.get(ev.targetId);
    if (!prev || ev.t >= prev.t) {
      map.set(ev.targetId, {
        t: ev.t,
        facing: ev.facing,
        shieldAbsorbed: ev.shieldAbsorbed > 0,
        hullDamage: ev.hullDamage > 0,
        destroyed: !!ev.destroyed || ev.kind === 'kill',
        ionDisrupt: ev.profile === 'ion' && ev.hullDamage > 0,
        profile: ev.profile,
      });
    }
  }
  return map;
}

export function combatFxSummary(battle, time = null) {
  const events = Array.isArray(battle?.fxEvents) ? battle.fxEvents : [];
  const now = time ?? (events.length ? events[events.length - 1].t : 0);
  const active = activeFxEvents(battle, now);
  const byProfile = {};
  const byKind = {};
  for (const ev of events) {
    byProfile[ev.profile] = (byProfile[ev.profile] ?? 0) + 1;
    byKind[ev.kind] = (byKind[ev.kind] ?? 0) + 1;
  }
  const activeByProfile = {};
  for (const ev of active) {
    activeByProfile[ev.profile] = (activeByProfile[ev.profile] ?? 0) + 1;
  }
  return {
    total: events.length,
    active: active.length,
    byProfile,
    byKind,
    activeByProfile,
    profiles: Object.keys(byProfile).sort(),
  };
}

function worldToScreenFn(camera, worldToScreen, canvas, x, y) {
  return worldToScreen(camera, x, y, canvas);
}

function drawMuzzleSpark(ctx, x, y, color, alpha, zoom) {
  const r = Math.max(1.5, 3.2 * zoom);
  ctx.beginPath();
  ctx.fillStyle = withAlpha(color, alpha);
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawImpactTick(ctx, x, y, alpha, zoom, shield) {
  const r = Math.max(1.2, (shield ? 4.5 : 3.2) * zoom);
  ctx.beginPath();
  ctx.fillStyle = withAlpha(shield ? THEME.battle.shieldFlash : THEME.battle.hullSpark, alpha);
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawHeavyImpact(ctx, x, y, age, duration, life, color, zoom, profile) {
  const u = clamp01(age / Math.max(1, duration));
  const radius = Math.max(10, (profile === 'torpedo' ? 34 : 24) * zoom) * (0.4 + u * 0.9);
  const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
  glow.addColorStop(0, withAlpha('#ffffff', 0.85 * life));
  glow.addColorStop(0.28, withAlpha(color, 0.62 * life));
  glow.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = withAlpha(color, 0.72 * life);
  ctx.lineWidth = Math.max(1, 1.7 * zoom);
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.82, 0, Math.PI * 2);
  ctx.stroke();
  const shards = profile === 'beam_lance' ? 4 : 7;
  for (let i = 0; i < shards; i++) {
    const angle = i / shards * Math.PI * 2 + age * 0.006;
    const inner = radius * 0.35;
    const outer = radius * (0.75 + (i % 3) * 0.14);
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(angle) * inner, y + Math.sin(angle) * inner);
    ctx.lineTo(x + Math.cos(angle) * outer, y + Math.sin(angle) * outer);
    ctx.stroke();
  }
}

function drawWingFlyby(ctx, start, end, age, duration, life, color, zoom) {
  const u = clamp01(age / Math.max(1, duration));
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const x = start.x + dx * Math.min(1, u * 1.18);
  const y = start.y + dy * Math.min(1, u * 1.18);
  const trail = Math.min(len * 0.45, Math.max(30, 92 * zoom));
  const gradient = ctx.createLinearGradient(x - ux * trail, y - uy * trail, x, y);
  gradient.addColorStop(0, withAlpha(color, 0));
  gradient.addColorStop(0.7, withAlpha(color, 0.28 * life));
  gradient.addColorStop(1, withAlpha('#ffffff', 0.9 * life));
  ctx.strokeStyle = gradient;
  ctx.lineWidth = Math.max(1.2, 2.4 * zoom);
  ctx.beginPath();
  ctx.moveTo(x - ux * trail, y - uy * trail);
  ctx.lineTo(x, y);
  ctx.stroke();
}

function drawWithdrawal(ctx, start, end, age, duration, life, color, zoom) {
  const u = clamp01(age / Math.max(1, duration));
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  ctx.save();
  ctx.setLineDash([Math.max(5, 9 * zoom), Math.max(4, 7 * zoom)]);
  ctx.lineDashOffset = -age * 0.06;
  ctx.strokeStyle = withAlpha(color, 0.5 * life);
  ctx.lineWidth = Math.max(1.2, 1.8 * zoom);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(start.x + ux * Math.min(len, 240 * zoom) * (0.4 + u * 0.6), start.y + uy * Math.min(len, 240 * zoom) * (0.4 + u * 0.6));
  ctx.stroke();
  ctx.restore();
}

function facingAngles(facing, heading) {
  const h = heading ?? 0;
  if (facing === 'front') return [h - 0.55, h + 0.55];
  if (facing === 'aft') return [h + Math.PI - 0.55, h + Math.PI + 0.55];
  if (facing === 'port') return [h + Math.PI / 2 - 0.55, h + Math.PI / 2 + 0.55];
  if (facing === 'starboard') return [h - Math.PI / 2 - 0.55, h - Math.PI / 2 + 0.55];
  return [h - 0.7, h + 0.7];
}

function drawShieldArc(ctx, x, y, facing, heading, alpha, zoom) {
  if (!facing) return;
  const [a0, a1] = facingAngles(facing, heading);
  const r = Math.max(8, 14 * zoom);
  ctx.beginPath();
  ctx.strokeStyle = withAlpha(THEME.battle.shieldFlash, alpha * 0.9);
  ctx.lineWidth = Math.max(1.5, 2.4 * zoom);
  ctx.arc(x, y, r, a0, a1);
  ctx.stroke();
}

function drawKillBloom(ctx, x, y, age, zoom, durationMs = BATTLE_FX_KILL_MS) {
  const life = clamp01(1 - age / Math.max(1, durationMs));
  if (life <= 0) return;
  const roleScale = durationMs > BATTLE_FX_KILL_MS ? 1.25 : 1;
  const r = Math.max(10, 28 * zoom) * (0.55 + (1 - life) * 0.9) * roleScale;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, withAlpha(THEME.battle.killBloom, 0.55 * life));
  g.addColorStop(0.45, withAlpha(THEME.battle.hullSpark, 0.28 * life));
  g.addColorStop(1, withAlpha(THEME.battle.killBloom, 0));
  ctx.beginPath();
  ctx.fillStyle = g;
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  const shards = 5;
  ctx.strokeStyle = withAlpha(THEME.battle.hullSpark, 0.55 * life);
  ctx.lineWidth = Math.max(1, 1.2 * zoom);
  for (let i = 0; i < shards; i++) {
    const a = (i / shards) * Math.PI * 2 + age * 0.01;
    const len = r * (0.45 + (i % 2) * 0.2);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
}

function drawKinetic(ctx, start, end, age, life, color, zoom, volley, seed, mode) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const count = mode === 'detail' ? Math.max(1, volley) : 1;
  for (let i = 0; i < count; i++) {
    const jitter = ((seed >> (i * 3)) & 7) / 7 - 0.5;
    const off = jitter * 4.5 * zoom;
    const sx = start.x + nx * off;
    const sy = start.y + ny * off;
    const ex = end.x + nx * off * 0.35;
    const ey = end.y + ny * off * 0.35;
    const g = ctx.createLinearGradient(sx, sy, ex, ey);
    g.addColorStop(0, withAlpha(color, 0.15 * life));
    g.addColorStop(0.4, withAlpha(color, 0.9 * life));
    g.addColorStop(1, withAlpha(color, 0));
    ctx.strokeStyle = g;
    ctx.lineWidth = Math.max(1, (1.4 - i * 0.2) * zoom);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
  }
  if (mode === 'detail') drawMuzzleSpark(ctx, start.x, start.y, color, life, zoom);
}

function drawPointDefense(ctx, start, end, age, life, color, zoom, volley, seed, mode) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const full = Math.hypot(dx, dy) || 1;
  const short = Math.min(full, full * 0.55);
  const ux = dx / full;
  const uy = dy / full;
  const count = mode === 'detail' ? Math.max(3, volley) : 2;
  for (let i = 0; i < count; i++) {
    const phase = (age / 30 + i * 0.35) % 1;
    const pulse = phase < 0.55 ? 1 : clamp01(1 - (phase - 0.55) / 0.45);
    const jitter = (((seed >> (i * 2)) & 15) / 15 - 0.5) * 6 * zoom;
    const nx = -uy;
    const ny = ux;
    const sx = start.x + nx * jitter;
    const sy = start.y + ny * jitter;
    const ex = sx + ux * short * (0.7 + i * 0.06);
    const ey = sy + uy * short * (0.7 + i * 0.06);
    ctx.strokeStyle = withAlpha(color, 0.85 * life * pulse);
    ctx.lineWidth = Math.max(0.8, 1.1 * zoom);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
  }
}

function drawTorpedo(ctx, start, end, age, duration, life, color, zoom, mode) {
  const u = clamp01(age / Math.max(1, duration * 0.85));
  const x = start.x + (end.x - start.x) * u;
  const y = start.y + (end.y - start.y) * u;
  const trail = ctx.createLinearGradient(start.x, start.y, x, y);
  trail.addColorStop(0, withAlpha(color, 0));
  trail.addColorStop(1, withAlpha(color, 0.55 * life));
  ctx.strokeStyle = trail;
  ctx.lineWidth = Math.max(1.2, 2 * zoom);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(x, y);
  ctx.stroke();
  const r = Math.max(2.5, 4.5 * zoom);
  const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 2.2);
  glow.addColorStop(0, withAlpha('#fff5e6', 0.95 * life));
  glow.addColorStop(0.4, withAlpha(color, 0.8 * life));
  glow.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, r * 2.2, 0, Math.PI * 2);
  ctx.fill();
  if (u > 0.92 || mode !== 'detail') {
    drawImpactTick(ctx, end.x, end.y, life * clamp01((u - 0.85) / 0.15), zoom, false);
  }
}

function drawBeam(ctx, start, end, life, color, zoom, mode) {
  const g = ctx.createLinearGradient(start.x, start.y, end.x, end.y);
  g.addColorStop(0, withAlpha(color, 0.2 * life));
  g.addColorStop(0.2, withAlpha(color, 0.95 * life));
  g.addColorStop(1, withAlpha('#ffffff', 0.55 * life));
  ctx.strokeStyle = withAlpha(color, 0.25 * life);
  ctx.lineWidth = Math.max(3, (mode === 'detail' ? 5.5 : 3.5) * zoom);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.strokeStyle = g;
  ctx.lineWidth = Math.max(1.2, (mode === 'detail' ? 2.2 : 1.4) * zoom);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
}

function drawIon(ctx, start, end, age, life, color, zoom, seed, mode, disrupt) {
  const segs = mode === 'detail' ? 5 : 2;
  ctx.strokeStyle = withAlpha(color, 0.9 * life);
  ctx.lineWidth = Math.max(1.1, 1.6 * zoom);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  for (let i = 1; i <= segs; i++) {
    const u = i / segs;
    const bx = start.x + (end.x - start.x) * u;
    const by = start.y + (end.y - start.y) * u;
    if (i < segs && mode === 'detail') {
      const jag = Math.sin(age * 0.08 + i * 1.7 + (seed & 15)) * 7 * zoom;
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const len = Math.hypot(dx, dy) || 1;
      ctx.lineTo(bx + (-dy / len) * jag, by + (dx / len) * jag);
    } else {
      ctx.lineTo(bx, by);
    }
  }
  ctx.stroke();
  if (disrupt && mode === 'detail') {
    ctx.strokeStyle = withAlpha(THEME.battle.ion, 0.45 * life);
    ctx.lineWidth = Math.max(1, 1.2 * zoom);
    const r = Math.max(6, 10 * zoom);
    ctx.beginPath();
    ctx.arc(end.x, end.y, r * (0.8 + 0.2 * Math.sin(age * 0.05)), 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawRepair(ctx, start, end, age, life, zoom) {
  const color = THEME.battle.repair;
  const midX = (start.x + end.x) * 0.5 + Math.sin(age * 0.02) * 6 * zoom;
  const midY = (start.y + end.y) * 0.5 + Math.cos(age * 0.02) * 6 * zoom;
  ctx.strokeStyle = withAlpha(color, 0.65 * life);
  ctx.lineWidth = Math.max(1.4, 2.2 * zoom);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.quadraticCurveTo(midX, midY, end.x, end.y);
  ctx.stroke();
  drawMuzzleSpark(ctx, end.x, end.y, color, life * 0.8, zoom);
}

function drawLodPulse(ctx, start, end, life, color, zoom) {
  const g = ctx.createLinearGradient(start.x, start.y, end.x, end.y);
  g.addColorStop(0, withAlpha(color, 0.55 * life));
  g.addColorStop(1, withAlpha(color, 0));
  ctx.strokeStyle = g;
  ctx.lineWidth = Math.max(1, 1.3 * zoom);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
}

function drawJumpInCue(ctx, start, end, age, duration, life, color, zoom) {
  const u = clamp01(age / Math.max(1, duration));
  const x = start.x + (end.x - start.x) * u;
  const y = start.y + (end.y - start.y) * u;
  ctx.save();
  ctx.strokeStyle = withAlpha(color, 0.55 * life);
  ctx.lineWidth = Math.max(1.2, 2.2 * zoom);
  ctx.setLineDash([Math.max(4, 6 * zoom), Math.max(3, 4 * zoom)]);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.setLineDash([]);
  const r = Math.max(8, (18 + (1 - u) * 22) * zoom);
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, withAlpha(color, 0.55 * life));
  g.addColorStop(1, withAlpha(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = withAlpha(color, 0.85 * life);
  ctx.lineWidth = Math.max(1, 1.5 * zoom);
  ctx.beginPath();
  ctx.arc(end.x, end.y, Math.max(6, 10 * zoom) * (0.6 + u * 0.5), 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawWingTransferCue(ctx, start, end, age, duration, life, color, zoom, recovering) {
  const u = clamp01(age / Math.max(1, duration));
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const segments = 5;
  ctx.save();
  ctx.lineCap = 'round';
  // Continuous dashed sortie stream along the hangar→slot path.
  ctx.setLineDash([Math.max(3, 5 * zoom), Math.max(2, 4 * zoom)]);
  ctx.strokeStyle = withAlpha(color, 0.35 * life);
  ctx.lineWidth = Math.max(1, 1.4 * zoom);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  ctx.setLineDash([]);

  for (let i = 0; i < segments; i++) {
    const segU = clamp01(u * 1.15 - i * 0.12);
    if (segU <= 0) continue;
    const x0 = start.x + dx * Math.max(0, segU - 0.14);
    const y0 = start.y + dy * Math.max(0, segU - 0.14);
    const x1 = start.x + dx * segU;
    const y1 = start.y + dy * segU;
    ctx.strokeStyle = withAlpha(color, (0.55 + (1 - i / segments) * 0.35) * life);
    ctx.lineWidth = Math.max(1.2, (2.4 - i * 0.25) * zoom);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  const head = recovering ? end : {
    x: start.x + dx * u,
    y: start.y + dy * u,
  };
  const ringAt = recovering ? end : start;
  ctx.strokeStyle = withAlpha(color, 0.72 * life);
  ctx.lineWidth = Math.max(1, 1.4 * zoom);
  ctx.beginPath();
  ctx.arc(ringAt.x, ringAt.y, Math.max(5, (7 + u * 8) * zoom), 0, Math.PI * 2);
  ctx.stroke();
  drawMuzzleSpark(ctx, head.x, head.y, color, life, zoom);
  ctx.restore();
}

/**
 * Draw active StS combat FX for a battle.
 * @param {object} opts
 * @param {CanvasRenderingContext2D} opts.ctx
 * @param {object} opts.battle
 * @param {HTMLCanvasElement} opts.canvas
 * @param {'detail'|'lite'|'swarm'} opts.mode
 * @param {number} opts.time
 * @param {object} opts.camera
 * @param {Function} opts.worldToScreen
 * @param {Function} [opts.screenInView]
 * @param {Map} [opts.unitHeadingById]
 */
export function drawCombatFx({
  ctx,
  battle,
  canvas,
  mode = 'detail',
  time,
  camera,
  worldToScreen,
  screenInView = null,
  unitHeadingById = null,
}) {
  if (!battle || !ctx) return { drawn: 0 };
  const events = activeFxEvents(battle, time);
  if (!events.length) return { drawn: 0 };

  const limit = mode === 'swarm' ? BATTLE_FX_SWARM_DRAW_LIMIT : BATTLE_FX_DRAW_LIMIT;
  const zoom = Math.max(0.35, camera?.zoom ?? 1);
  const reducedMotion = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  let drawn = 0;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (let i = events.length - 1; i >= 0 && drawn < limit; i--) {
    const ev = events[i];
    const age = time - ev.t;
    const duration = fxDurationMs(ev);
    const life = clamp01(1 - age / duration);
    if (life <= 0) continue;

    const start = worldToScreenFn(camera, worldToScreen, canvas, ev.ax, ev.ay);
    const end = worldToScreenFn(camera, worldToScreen, canvas, ev.tx, ev.ty);
    if (screenInView && !screenInView(start, canvas, 100) && !screenInView(end, canvas, 100)) continue;

    const color = profileColor(ev.profile, ev.side);
    const seed = hashId(ev.attackerId ?? ev.targetId);

    if (ev.kind === 'kill') {
      drawKillBloom(ctx, end.x, end.y, age, zoom, duration);
      drawn++;
      continue;
    }

    if (ev.kind === 'jump_in') {
      drawJumpInCue(ctx, start, end, age, duration, life, color, zoom);
      drawn++;
      continue;
    }

    if (ev.kind === 'wing_launch' || ev.kind === 'wing_recover') {
      drawWingTransferCue(
        ctx,
        start,
        end,
        age,
        duration,
        life,
        color,
        zoom,
        ev.kind === 'wing_recover',
      );
      drawn++;
      continue;
    }

    if (ev.kind === 'wing_flyby') {
      if (reducedMotion) drawLodPulse(ctx, start, end, life, color, zoom);
      else drawWingFlyby(ctx, start, end, age, duration, life, color, zoom);
      drawn++;
      continue;
    }

    if (ev.kind === 'heavy_impact') {
      if (reducedMotion) drawImpactTick(ctx, end.x, end.y, life, zoom, ev.profile === 'torpedo');
      else drawHeavyImpact(ctx, end.x, end.y, age, duration, life, color, zoom, ev.profile);
      drawn++;
      continue;
    }

    if (ev.kind === 'withdrawal') {
      if (reducedMotion) drawLodPulse(ctx, start, end, life, color, zoom);
      else drawWithdrawal(ctx, start, end, age, duration, life, color, zoom);
      drawn++;
      continue;
    }

    if (mode === 'swarm' || ev.kind === 'lod_pulse') {
      drawLodPulse(ctx, start, end, life, color, zoom);
      if (ev.destroyed) drawKillBloom(ctx, end.x, end.y, age, zoom, duration);
      drawn++;
      continue;
    }

    if (ev.profile === 'torpedo') {
      drawTorpedo(ctx, start, end, age, duration, life, color, zoom, mode);
    } else if (ev.profile === 'beam_lance') {
      drawBeam(ctx, start, end, life, color, zoom, mode);
    } else if (ev.profile === 'ion') {
      drawIon(ctx, start, end, age, life, color, zoom, seed, mode, ev.hullDamage > 0);
    } else if (ev.profile === 'repair') {
      drawRepair(ctx, start, end, age, life, zoom);
    } else if (ev.profile === 'point_defense') {
      drawPointDefense(ctx, start, end, age, life, color, zoom, ev.volleyCount ?? 4, seed, mode);
    } else {
      drawKinetic(ctx, start, end, age, life, color, zoom, ev.volleyCount ?? 2, seed, mode);
    }

    if (mode === 'detail') {
      if (ev.shieldAbsorbed > 0) {
        const heading = unitHeadingById?.get(ev.targetId) ?? 0;
        drawShieldArc(ctx, end.x, end.y, ev.facing, heading, life, zoom);
      }
      if (ev.hullDamage > 0 && ev.profile !== 'torpedo') {
        drawImpactTick(ctx, end.x, end.y, life, zoom, false);
      } else if (ev.shieldAbsorbed > 0 && ev.hullDamage <= 0) {
        drawImpactTick(ctx, end.x, end.y, life * 0.85, zoom, true);
      }
    } else if (ev.hullDamage > 0 || ev.shieldAbsorbed > 0) {
      drawImpactTick(ctx, end.x, end.y, life * 0.7, zoom, ev.shieldAbsorbed > 0 && ev.hullDamage <= 0);
    }

    drawn++;
  }

  ctx.restore();
  return { drawn };
}

export function combatRenderModeForCount(liveCount, zoom = 1) {
  if (liveCount >= BATTLE_RENDER_SWARM_UNITS) return 'swarm';
  if (liveCount >= BATTLE_RENDER_LOD_UNITS || zoom < 0.5) return 'lite';
  return 'detail';
}
