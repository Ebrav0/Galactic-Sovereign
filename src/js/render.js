// Canvas 2D rendering. Reads state; never mutates it (IMPLEMENTATION_PLAN §4).

import {
  STARFIELD_COUNT,
  STARFIELD_SPREAD,
  SELECTION_PULSE_MS,
  CAMERA_MIN_ZOOM,
  CAMERA_MAX_ZOOM,
  CAMERA_FOLLOW_RATE,
  GALAXY_CAMERA_MIN_ZOOM,
  GALAXY_CAMERA_MAX_ZOOM,
  SHUTTLE_SIZE,
  SAIL_SHUTTLE_SIZE,
  FLAGSHIP_RADIUS,
  CAPTURE_HOLD_MS,
} from './constants.js';
import { drawStar, drawPlanet, drawMoon, drawBlackHole, drawStarOverlays } from './celestial-render.js';
import { beginStarPass, flushStars } from './gl/star-renderer.js';
import { typeSizeBonus } from './star-types.js';
import {
  createRng,
  systemById,
  planetPosition,
  moonPosition,
  hasOutpost,
  hasShipyard,
  hasFoundry,
  ensureDyson,
  isPlayerOwned,
} from './state.js';
import { shuttlePositions } from './shuttles.js';
import { sailShuttlePositions, foundryAnchor, launchBurstOrigins } from './sail-shuttles.js';
import { getFlagshipInput, getFlagshipDisplayPose, transitStatus } from './flagship.js';
import { scoutTransitPositions, scoutsAtSystem } from './scout.js';
import { hasIntel } from './intel.js';
import { captureProgressMs, canHoldCapture } from './capture.js';
import { shipyardBuildProgress } from './production.js';
import { laneBulge, laneControlPoint } from './galaxy.js';
import { getBattleState } from './combat.js';
import { playerShipsAtSystem } from './fleets.js';
import { pirateFleetAtSystem, pirateSystemsWithPresence } from './pirates.js';
import {
  drawHullSprite,
  drawFlagshipSprite,
  drawScoutSprite,
  drawShuttleSprite,
} from './ship-sprites.js';
import { ambientShipPose, ambientPiratePose } from './ship-motion.js';
import {
  THEME,
  hexToRgba,
  bezierPoint,
  drawQuadraticCurve,
} from './theme.js';

export const camera = { x: 0, y: 0, zoom: 1 };
export const galaxyCamera = { x: 0, y: 0, zoom: 0.4 };
export const follow = { enabled: false };

export function clampZoom(z) {
  return Math.min(CAMERA_MAX_ZOOM, Math.max(CAMERA_MIN_ZOOM, z));
}

export function clampGalaxyZoom(z) {
  return Math.min(GALAXY_CAMERA_MAX_ZOOM, Math.max(GALAXY_CAMERA_MIN_ZOOM, z));
}

let starAnimOrigin = performance.now();

/** Session-relative clock for fluid star visuals (game time alone starts near zero). */
export function starVisualTime(state) {
  return state.time + performance.now() - starAnimOrigin;
}

export function worldToScreen(cam, wx, wy, canvas) {
  return {
    x: (wx - cam.x) * cam.zoom + canvas.width / 2,
    y: (wy - cam.y) * cam.zoom + canvas.height / 2,
  };
}

export function screenToWorld(cam, sx, sy, canvas) {
  return {
    x: (sx - canvas.width / 2) / cam.zoom + cam.x,
    y: (sy - canvas.height / 2) / cam.zoom + cam.y,
  };
}

export function updateFollowCamera(state, viewedSystemId, dtMs, accumulatorMs = 0) {
  const f = state.flagship;
  if (!follow.enabled || f.transit || f.systemId !== viewedSystemId) return;
  const pose = getFlagshipDisplayPose(state, accumulatorMs);
  const k = 1 - Math.exp(-CAMERA_FOLLOW_RATE * (dtMs / 1000));
  camera.x += (pose.x - camera.x) * k;
  camera.y += (pose.y - camera.y) * k;
}

export function snapCameraTo(x, y) {
  camera.x = x;
  camera.y = y;
}

let starfield = null;
let nebulae = null;
function getStarfield() {
  if (!starfield) {
    const rng = createRng(0xbeef);
    const tints = ['#c8d4e8', '#e8dcc8', '#b8c8f0', '#f0d8b8', '#d0e0ff'];
    // Three parallax depth layers: far dust, mid stars, near bright stars.
    const layers = [
      { count: Math.floor(STARFIELD_COUNT * 0.5), depth: 0.25, rMin: 0.3, rMax: 0.8, aMax: 0.45 },
      { count: Math.floor(STARFIELD_COUNT * 0.35), depth: 0.55, rMin: 0.5, rMax: 1.3, aMax: 0.7 },
      { count: Math.floor(STARFIELD_COUNT * 0.15), depth: 1.0, rMin: 0.9, rMax: 1.9, aMax: 0.95 },
    ];
    starfield = layers.flatMap((layer) =>
      Array.from({ length: layer.count }, () => ({
        x: (rng() - 0.5) * STARFIELD_SPREAD,
        y: (rng() - 0.5) * STARFIELD_SPREAD,
        r: layer.rMin + rng() * (layer.rMax - layer.rMin),
        a: 0.2 + rng() * (layer.aMax - 0.2),
        depth: layer.depth,
        tint: tints[Math.floor(rng() * tints.length)],
        twinkle: rng() * Math.PI * 2,
        twinkleSpeed: 0.0008 + rng() * 0.0015,
        bright: layer.depth === 1.0 && rng() > 0.55,
      })),
    );
  }
  return starfield;
}

function getNebulae() {
  if (!nebulae) {
    const rng = createRng(0xcafe);
    const palettes = [
      ['rgba(90, 60, 160, 0.16)', 'rgba(40, 30, 90, 0)'],
      ['rgba(40, 110, 150, 0.13)', 'rgba(20, 50, 80, 0)'],
      ['rgba(150, 70, 110, 0.11)', 'rgba(70, 30, 60, 0)'],
      ['rgba(60, 90, 170, 0.14)', 'rgba(30, 40, 90, 0)'],
    ];
    nebulae = Array.from({ length: 7 }, () => ({
      x: (rng() - 0.5) * STARFIELD_SPREAD * 0.8,
      y: (rng() - 0.5) * STARFIELD_SPREAD * 0.8,
      r: 900 + rng() * 2400,
      palette: palettes[Math.floor(rng() * palettes.length)],
      depth: 0.15 + rng() * 0.2,
    }));
  }
  return nebulae;
}

function parallaxToScreen(cam, wx, wy, depth, canvas) {
  return {
    x: (wx - cam.x * depth) * cam.zoom + canvas.width / 2,
    y: (wy - cam.y * depth) * cam.zoom + canvas.height / 2,
  };
}

function drawStarfield(ctx, cam, canvas, time = 0) {
  // Deep-space nebula haze (far parallax layer).
  for (const n of getNebulae()) {
    const p = parallaxToScreen(cam, n.x, n.y, n.depth, canvas);
    const sr = n.r * cam.zoom;
    if (p.x < -sr || p.x > canvas.width + sr || p.y < -sr || p.y > canvas.height + sr) continue;
    const g = ctx.createRadialGradient(p.x, p.y, sr * 0.1, p.x, p.y, sr);
    g.addColorStop(0, n.palette[0]);
    g.addColorStop(1, n.palette[1]);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, sr, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const s of getStarfield()) {
    const p = parallaxToScreen(cam, s.x, s.y, s.depth, canvas);
    if (p.x < -6 || p.x > canvas.width + 6 || p.y < -6 || p.y > canvas.height + 6) continue;
    const twinkle = 0.55 + 0.45 * Math.sin(time * s.twinkleSpeed + s.twinkle);
    ctx.globalAlpha = s.a * twinkle;
    ctx.fillStyle = s.tint;
    ctx.beginPath();
    ctx.arc(p.x, p.y, s.r, 0, Math.PI * 2);
    ctx.fill();
    if (s.bright) {
      // Diffraction cross on the brightest foreground stars.
      ctx.globalAlpha = s.a * twinkle * 0.4;
      ctx.strokeStyle = s.tint;
      ctx.lineWidth = 0.6;
      const len = s.r * 3.2 * twinkle;
      ctx.beginPath();
      ctx.moveTo(p.x - len, p.y);
      ctx.lineTo(p.x + len, p.y);
      ctx.moveTo(p.x, p.y - len);
      ctx.lineTo(p.x, p.y + len);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

function lightAngleFromOrigin(wx, wy) {
  return Math.atan2(wy, wx);
}

function drawOrbitRing(ctx, cx, cy, r, alpha = 0.14) {
  ctx.setLineDash([4, 6]);
  ctx.strokeStyle = `rgba(120, 160, 255, ${alpha})`;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawGlowRing(ctx, x, y, r, color, lineWidth, alpha = 1) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = r * 0.4;
  ctx.strokeStyle = hexToRgba(color, alpha);
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function labelText(ctx, text, x, y, size, color, align = 'center') {
  ctx.save();
  ctx.font = `${size}px ${THEME.fontUi}`;
  ctx.textAlign = align;
  ctx.fillStyle = 'rgba(5, 7, 15, 0.75)';
  ctx.fillText(text, x + 1, y + 1);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

// ============================= SYSTEM VIEW =============================

export function drawSystem(ctx, state, systemId, selection, accumulatorMs = 0) {
  const canvas = ctx.canvas;
  const system = systemById(state, systemId);
  ctx.fillStyle = THEME.bgDeep;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!system) return;

  const intel = hasIntel(state, systemId);

  beginStarPass('system');

  drawStarfield(ctx, camera, canvas, state.time);

  const z = camera.zoom;
  const starScreen = worldToScreen(camera, 0, 0, canvas);

  for (const planet of system.bodies) {
    drawOrbitRing(ctx, starScreen.x, starScreen.y, planet.orbitRadius * z, 0.14);
  }

  drawStar(ctx, {
    star: system.star,
    x: starScreen.x,
    y: starScreen.y,
    screenR: system.star.radius * z,
    time: starVisualTime(state),
    intel,
    state,
    systemId,
  });

  flushStars(ctx, 'core');

  const dyson = ensureDyson(system);
  drawStarOverlays(ctx, {
    completedShells: dyson.completedShells,
    shellSails: dyson.shellSails,
    time: state.time,
    starRadius: system.star.radius,
    x: starScreen.x,
    y: starScreen.y,
    zoom: z,
    lastShellCompletedAt: dyson.lastShellCompletedAt,
  });

  if (intel && hasFoundry(state, systemId)) {
    const fa = foundryAnchor(system);
    const fs = worldToScreen(camera, fa.x, fa.y, canvas);
    drawGlowRing(ctx, fs.x, fs.y, 14 * z, THEME.accentGold, Math.max(1, 2 * z), 0.85);
    labelText(ctx, 'Sail Foundry', fs.x, fs.y - 18 * z, Math.max(9, 10 * z), THEME.accentGold);
  }

  const sortedPlanets = [...system.bodies].sort((a, b) => b.orbitRadius - a.orbitRadius);

  for (const planet of sortedPlanets) {
    const wp = planetPosition(planet, state.time);
    const sp = worldToScreen(camera, wp.x, wp.y, canvas);
    const pr = planet.radius * z;
    const lightAngle = lightAngleFromOrigin(wp.x, wp.y);

    for (const moon of planet.moons) {
      drawOrbitRing(ctx, sp.x, sp.y, moon.orbitRadius * z, 0.1);
    }

    for (const moon of planet.moons) {
      const wm = moonPosition(planet, moon, state.time);
      const sm = worldToScreen(camera, wm.x, wm.y, canvas);
      drawMoon(ctx, {
        moon,
        x: sm.x,
        y: sm.y,
        screenR: moon.radius * z,
        intel,
        lightAngle: lightAngleFromOrigin(wm.x, wm.y),
        planetX: sp.x,
        planetY: sp.y,
        planetScreenR: pr,
        state,
        systemId,
      });
    }

    drawPlanet(ctx, {
      planet,
      x: sp.x,
      y: sp.y,
      screenR: pr,
      time: state.time,
      intel,
      lightAngle,
      state,
      systemId,
    });

    if (intel && hasOutpost(state, systemId, planet.id)) {
      drawGlowRing(ctx, sp.x, sp.y, pr + 6 * z, THEME.accentGold, Math.max(1, 1.5 * z), 0.85);
    }

    if (intel && hasShipyard(state, systemId, planet.id)) {
      drawGlowRing(ctx, sp.x, sp.y, pr + 12 * z, THEME.accentCyan, Math.max(1, 2 * z), 0.9);

      const shipyard = system.structures.find(
        (s) => s.type === 'shipyard' && s.bodyId === planet.id,
      );
      if (shipyard?.build) {
        const prog = shipyardBuildProgress(shipyard, state.time);
        ctx.strokeStyle = hexToRgba(THEME.accentCyan, 0.4 + 0.5 * prog);
        ctx.lineWidth = Math.max(1, 2.5 * z);
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, pr + 18 * z, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1;
      }
    }

    if (selection === planet.id) {
      const pulse = 0.5 + 0.5 * Math.sin((performance.now() / SELECTION_PULSE_MS) * Math.PI * 2);
      ctx.strokeStyle = hexToRgba(THEME.accentGreen, 0.4 + 0.5 * pulse);
      ctx.lineWidth = 2;
      ctx.shadowColor = THEME.accentGreen;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, pr + (12 + 4 * pulse) * z, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 1;
    }

    labelText(
      ctx,
      intel ? planet.name : 'Unknown',
      sp.x,
      sp.y - pr - 12 * z,
      Math.max(10, 11 * z),
      intel ? THEME.textSecondary : THEME.fog.label,
    );
    if (intel) {
      labelText(
        ctx,
        planet.type,
        sp.x,
        sp.y + pr + 18 * z,
        Math.max(8, 9 * z),
        THEME.textMuted,
      );
    }
  }

  for (const sh of shuttlePositions(state, systemId)) {
    const ss = worldToScreen(camera, sh.x, sh.y, canvas);
    drawShuttleSprite(ctx, ss.x, ss.y, sh.heading, Math.max(2.5, SHUTTLE_SIZE * z), {
      wingSpread: sh.wingSpread,
      thrusting: sh.thrusting && !state.paused,
      seed: sh.seed,
    });
  }

  ctx.fillStyle = THEME.accentGold;
  for (const sh of sailShuttlePositions(state, systemId)) {
    const ss = worldToScreen(camera, sh.x, sh.y, canvas);
    ctx.shadowColor = THEME.accentGold;
    ctx.shadowBlur = 5;
    ctx.beginPath();
    ctx.arc(ss.x, ss.y, Math.max(1.2, SAIL_SHUTTLE_SIZE * z), 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  for (const burst of launchBurstOrigins(state, systemId)) {
    const bs = worldToScreen(camera, burst.x, burst.y, canvas);
    const fade = 1 - burst.age / 600;
    ctx.strokeStyle = `rgba(255, 220, 140, ${0.6 * fade})`;
    ctx.lineWidth = Math.max(1, 2 * z);
    ctx.beginPath();
    ctx.moveTo(bs.x, bs.y);
    const angle = (state.time / 400 + burst.launcherId.length) % (Math.PI * 2);
    ctx.lineTo(bs.x + Math.cos(angle) * 30 * z * fade, bs.y + Math.sin(angle) * 30 * z * fade);
    ctx.stroke();
  }

  const f = state.flagship;
  if (f.systemId === systemId && !f.transit) {
    const pose = getFlagshipDisplayPose(state, accumulatorMs);
    const fs = worldToScreen(camera, pose.x, pose.y, canvas);
    const inp = getFlagshipInput();
    const thrusting = !state.paused && (inp.x !== 0 || inp.y !== 0);
    drawFlagshipSprite(ctx, fs.x, fs.y, pose.heading, FLAGSHIP_RADIUS * z, thrusting);
  }

  drawCombatLayer(ctx, state, systemId, canvas, z);

  flushStars(ctx, 'outer');
  flushStars(ctx, 'bloom');
}

function drawCombatShipSprite(ctx, x, y, hull, baseR, opts) {
  drawHullSprite(ctx, x, y, hull, baseR, opts);
}

function drawCombatLayer(ctx, state, systemId, canvas, z) {
  const system = systemById(state, systemId);
  if (!system) return;
  const baseR = Math.max(4, 6 * z);
  const battle = getBattleState(state, systemId);

  if (battle?.active && battle.units?.length) {
    for (const unit of battle.units) {
      if (unit.hp <= 0) continue;
      const p = worldToScreen(camera, unit.x, unit.y, canvas);
      drawCombatShipSprite(ctx, p.x, p.y, unit.hull, baseR, {
        heading: unit.heading ?? 0,
        side: unit.side,
        hp: unit.hp,
        maxHp: unit.maxHp,
      });
    }
    return;
  }

  const playerShips = playerShipsAtSystem(state, systemId);
  playerShips.forEach((ship, idx) => {
    const pose = ambientShipPose(state, system, ship, idx, playerShips.length);
    const p = worldToScreen(camera, pose.x, pose.y, canvas);
    drawCombatShipSprite(ctx, p.x, p.y, ship.hull, baseR, {
      heading: pose.heading,
      side: 'player',
      hp: ship.hp,
      maxHp: ship.maxHp,
    });
  });

  const pirateFleets = pirateFleetAtSystem(state, systemId);
  let pIdx = 0;
  const pirateTotal = pirateFleets.reduce((n, f) => n + f.ships.filter((s) => s.hp > 0).length, 0);
  for (const fleet of pirateFleets) {
    for (const ship of fleet.ships) {
      if (ship.hp <= 0) continue;
      const pose = ambientPiratePose(state, system, ship, fleet.id, pIdx, pirateTotal);
      const p = worldToScreen(camera, pose.x, pose.y, canvas);
      drawCombatShipSprite(ctx, p.x, p.y, ship.hull, baseR, {
        heading: pose.heading,
        side: 'enemy',
        hp: ship.hp,
        maxHp: ship.maxHp,
      });
      pIdx++;
    }
  }
}

// ============================= GALAXY VIEW =============================

function starNodeRadius(state, starId) {
  const system = systemById(state, starId);
  const bonus = typeSizeBonus(system?.star);
  return 9 + (system ? system.bodies.length : 0) * 1.6 + bonus;
}

const BLACK_HOLE_NODE_RADIUS = 26;

export function drawGalaxy(ctx, state, selectedScoutId = null) {
  const canvas = ctx.canvas;
  ctx.fillStyle = THEME.bgGalaxy;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  beginStarPass('galaxy');

  drawStarfield(ctx, galaxyCamera, canvas, state.time);

  const z = galaxyCamera.zoom;
  const galaxy = state.galaxy;
  const transit = transitStatus(state);

  let routeLanes = null;
  if (transit) {
    const t = state.flagship.transit;
    routeLanes = new Set();
    for (let i = t.legIndex; i < t.path.length - 1; i++) {
      const a = t.path[i];
      const b = t.path[i + 1];
      routeLanes.add(a < b ? `${a}|${b}` : `${b}|${a}`);
    }
  }

  const scoutRoutes = new Set();
  for (const scout of state.scouts) {
    if (!scout.transit) continue;
    const t = scout.transit;
    for (let i = t.legIndex; i < t.path.length - 1; i++) {
      const a = t.path[i];
      const b = t.path[i + 1];
      scoutRoutes.add(a < b ? `${a}|${b}` : `${b}|${a}`);
    }
  }

  for (let i = 0; i < galaxy.lanes.length; i++) {
    const [aId, bId] = galaxy.lanes[i];
    const a = nodePos(galaxy, aId);
    const b = nodePos(galaxy, bId);
    const sa = worldToScreen(galaxyCamera, a.x, a.y, canvas);
    const sb = worldToScreen(galaxyCamera, b.x, b.y, canvas);

    const key = aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`;
    const onFlagshipRoute = routeLanes?.has(key);
    const onScoutRoute = scoutRoutes.has(key);

    if (onScoutRoute) {
      ctx.setLineDash([6 * z, 4 * z]);
      ctx.strokeStyle = THEME.laneScout;
      ctx.lineWidth = Math.max(1, 1.8 * z);
    } else {
      ctx.setLineDash([]);
      ctx.strokeStyle = onFlagshipRoute ? THEME.laneRoute : THEME.lane;
      ctx.lineWidth = Math.max(1, (onFlagshipRoute ? 2 : 1.4) * z);
    }

    const bulge = laneBulge(galaxy, aId, bId);
    const ctrl = laneControlPoint(a, b, bulge);
    const sc = worldToScreen(galaxyCamera, ctrl.x, ctrl.y, canvas);
    drawQuadraticCurve(ctx, sa.x, sa.y, sc.x, sc.y, sb.x, sb.y);
    ctx.setLineDash([]);

    for (let k = 0; k < 2; k++) {
      const t = ((state.time / 6000) + k * 0.5 + i * 0.13) % 1;
      const pt = bezierPoint(sa.x, sa.y, sc.x, sc.y, sb.x, sb.y, t);
      ctx.globalAlpha = 0.55;
      ctx.shadowColor = THEME.trafficPulse;
      ctx.shadowBlur = 4;
      ctx.fillStyle = THEME.trafficPulse;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, Math.max(1.2, 2.5 * z), 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }
  }

  const bhScreen = worldToScreen(galaxyCamera, galaxy.blackHole.x, galaxy.blackHole.y, canvas);
  drawBlackHole(ctx, bhScreen.x, bhScreen.y, BLACK_HOLE_NODE_RADIUS * z, state.time, false);

  for (const star of galaxy.stars) {
    const system = systemById(state, star.id);
    const s = worldToScreen(galaxyCamera, star.x, star.y, canvas);
    const nodeR = starNodeRadius(state, star.id) * z;
    const intel = hasIntel(state, star.id);

    if (!intel) {
      ctx.fillStyle = THEME.fog.galaxyNode;
      ctx.beginPath();
      ctx.arc(s.x, s.y, nodeR * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    if (system?.star) {
      drawStar(ctx, {
        star: system.star,
        x: s.x,
        y: s.y,
        screenR: nodeR,
        time: starVisualTime(state),
        intel,
        state,
        systemId: star.id,
        mode: 'galaxy',
      });
    }
  }

  flushStars(ctx, 'core');

  labelText(ctx, galaxy.blackHole.name, bhScreen.x, bhScreen.y + (BLACK_HOLE_NODE_RADIUS + 44) * z, Math.max(10, 12 * z), THEME.textSecondary);
  labelText(ctx, 'Wormhole — dormant', bhScreen.x, bhScreen.y + (BLACK_HOLE_NODE_RADIUS + 58) * z, Math.max(8, 9.5 * z), 'rgba(176, 122, 219, 0.75)');

  for (const star of galaxy.stars) {
    const system = systemById(state, star.id);
    const s = worldToScreen(galaxyCamera, star.x, star.y, canvas);
    const nodeR = starNodeRadius(state, star.id) * z;
    const intel = hasIntel(state, star.id);
    const owned = isPlayerOwned(state, star.id);

    if (!system?.star) {
      const color = THEME.accentGold;
      const glow = ctx.createRadialGradient(s.x, s.y, nodeR * 0.3, s.x, s.y, nodeR * 3);
      glow.addColorStop(0, hexToRgba(color, intel ? 0.55 : 0.15));
      glow.addColorStop(1, hexToRgba(color, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(s.x, s.y, nodeR * 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = intel ? color : THEME.fog.star;
      ctx.beginPath();
      ctx.arc(s.x, s.y, nodeR, 0, Math.PI * 2);
      ctx.fill();
    }

    if (state.stronghold === star.id) {
      drawGlowRing(ctx, s.x, s.y, nodeR + 6 * z, THEME.accentGold, Math.max(1, 2 * z), 0.9);
      drawGlowRing(ctx, s.x, s.y, nodeR + 10 * z, THEME.accentGold, Math.max(1, 1 * z), 0.35);
    }

    if (owned) {
      drawGlowRing(ctx, s.x, s.y, nodeR + 10 * z, THEME.accentGold, Math.max(1, 1.5 * z), 0.65);
    }

    if (pirateSystemsWithPresence(state).includes(star.id)) {
      ctx.fillStyle = '#ff4444';
      ctx.shadowColor = '#ff4444';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(s.x - nodeR - 8 * z, s.y + nodeR + 6 * z, Math.max(2, 3.5 * z), 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    const progress = captureProgressMs(state, star.id);
    if (progress > 0 && canHoldCapture(state, star.id)) {
      const frac = progress / CAPTURE_HOLD_MS;
      ctx.strokeStyle = hexToRgba(THEME.accentGreen, 0.85);
      ctx.lineWidth = Math.max(2, 3 * z);
      ctx.beginPath();
      ctx.arc(s.x, s.y, nodeR + 14 * z, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
      ctx.stroke();
    }

    if (system && system.structures.length > 0 && intel) {
      const hasSy = system.structures.some((st) => st.type === 'shipyard');
      ctx.fillStyle = hasSy ? THEME.accentCyan : THEME.accentGreen;
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.arc(s.x + nodeR + 5 * z, s.y - nodeR - 5 * z, Math.max(1.5, 2.5 * z), 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    if (intel) {
      labelText(ctx, star.name, s.x, s.y + nodeR + 16 * z, Math.max(10, 12 * z), THEME.textLabel);
      const n = system?.bodies.length ?? 0;
      labelText(
        ctx,
        n === 0 ? 'dead star' : `${n} planet${n === 1 ? '' : 's'}`,
        s.x,
        s.y + nodeR + 29 * z,
        Math.max(8, 9.5 * z),
        THEME.textMuted,
      );
    }

    if (state.flagship.systemId === star.id) {
      drawFlagshipSprite(ctx, s.x + nodeR + 14 * z, s.y - nodeR - 12 * z, -Math.PI / 4, Math.max(3, 5.5 * z), false);
    }

    const stationed = scoutsAtSystem(state, star.id);
    stationed.forEach((scout, idx) => {
      drawScoutSprite(
        ctx,
        s.x - nodeR - 14 * z - idx * 10 * z,
        s.y - nodeR - 8 * z,
        Math.PI / 4,
        Math.max(2.5, 4.5 * z),
        scout.id === selectedScoutId,
      );
    });
  }

  if (transit) {
    const s = worldToScreen(galaxyCamera, transit.x, transit.y, canvas);
    drawFlagshipSprite(ctx, s.x, s.y, transit.angle, Math.max(3.5, 6.5 * z), true);

    const dest = nodePos(galaxy, transit.destId);
    const ds = worldToScreen(galaxyCamera, dest.x, dest.y, canvas);
    const pulse = 0.5 + 0.5 * Math.sin((performance.now() / SELECTION_PULSE_MS) * Math.PI * 2);
    drawGlowRing(
      ctx,
      ds.x,
      ds.y,
      (starNodeRadius(state, transit.destId) + (10 + 4 * pulse)) * z,
      THEME.accentGold,
      Math.max(1, 1.6 * z),
      0.35 + 0.4 * pulse,
    );
  }

  for (const entry of scoutTransitPositions(state)) {
    const s = worldToScreen(galaxyCamera, entry.x, entry.y, canvas);
    drawScoutSprite(
      ctx,
      s.x,
      s.y,
      entry.angle,
      Math.max(2.5, 4.5 * z),
      entry.scout.id === selectedScoutId,
    );
  }

  flushStars(ctx, 'bloom');
}

function nodePos(galaxy, id) {
  if (id === galaxy.blackHole.id) return galaxy.blackHole;
  return galaxy.stars.find((s) => s.id === id);
}


// ============================= HIT TESTS =============================

export function hitTestPlanet(state, systemId, wx, wy) {
  const system = systemById(state, systemId);
  if (!system) return null;
  for (const planet of system.bodies) {
    const p = planetPosition(planet, state.time);
    const dx = wx - p.x;
    const dy = wy - p.y;
    const hitR = planet.radius + 10 / camera.zoom;
    if (dx * dx + dy * dy <= hitR * hitR) return planet.id;
  }
  return null;
}

export function hitTestStar(state, wx, wy) {
  const halo = 14 / galaxyCamera.zoom;
  for (const star of state.galaxy.stars) {
    const hitR = starNodeRadius(state, star.id) + halo;
    const dx = wx - star.x;
    const dy = wy - star.y;
    if (dx * dx + dy * dy <= hitR * hitR) return star.id;
  }
  const bh = state.galaxy.blackHole;
  const bhR = BLACK_HOLE_NODE_RADIUS + halo;
  if ((wx - bh.x) ** 2 + (wy - bh.y) ** 2 <= bhR * bhR) return bh.id;
  return null;
}

export function hitTestScout(state, wx, wy) {
  const halo = 12 / galaxyCamera.zoom;
  for (const entry of scoutTransitPositions(state)) {
    const dx = wx - entry.x;
    const dy = wy - entry.y;
    if (dx * dx + dy * dy <= halo * halo) return entry.scout.id;
  }
  for (const star of state.galaxy.stars) {
    const stationed = scoutsAtSystem(state, star.id);
    const nodeR = starNodeRadius(state, star.id);
    for (let idx = 0; idx < stationed.length; idx++) {
      const scout = stationed[idx];
      const sx = star.x - nodeR - 14 - idx * 10;
      const sy = star.y - nodeR - 8;
      const dx = wx - sx;
      const dy = wy - sy;
      if (dx * dx + dy * dy <= halo * halo) return scout.id;
    }
  }
  return null;
}
