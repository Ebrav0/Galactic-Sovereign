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
  FLAGSHIP_RADIUS,
  CAPTURE_HOLD_MS,
} from './constants.js';
import { drawStar, drawPlanet, drawMoon, drawBlackHole } from './celestial-render.js';
import {
  createRng,
  systemById,
  planetPosition,
  moonPosition,
  hasOutpost,
  hasShipyard,
  isPlayerOwned,
} from './state.js';
import { shuttlePositions } from './shuttles.js';
import { getFlagshipInput, transitStatus } from './flagship.js';
import { scoutTransitPositions, scoutsAtSystem } from './scout.js';
import { hasIntel } from './intel.js';
import { captureProgressMs, canHoldCapture } from './capture.js';
import { shipyardBuildProgress } from './production.js';
import {
  THEME,
  hexToRgba,
  drawCurvedLane,
  bezierPoint,
} from './theme.js';

export const camera = { x: 0, y: 0, zoom: 1 };
export const galaxyCamera = { x: 0, y: 0, zoom: 0.4 };
export const follow = { enabled: true };

export function clampZoom(z) {
  return Math.min(CAMERA_MAX_ZOOM, Math.max(CAMERA_MIN_ZOOM, z));
}

export function clampGalaxyZoom(z) {
  return Math.min(GALAXY_CAMERA_MAX_ZOOM, Math.max(GALAXY_CAMERA_MIN_ZOOM, z));
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

export function updateFollowCamera(state, viewedSystemId, dtMs) {
  const f = state.flagship;
  if (!follow.enabled || f.transit || f.systemId !== viewedSystemId) return;
  const k = 1 - Math.exp(-CAMERA_FOLLOW_RATE * (dtMs / 1000));
  camera.x += (f.x - camera.x) * k;
  camera.y += (f.y - camera.y) * k;
}

export function snapCameraTo(x, y) {
  camera.x = x;
  camera.y = y;
}

let starfield = null;
function getStarfield() {
  if (!starfield) {
    const rng = createRng(0xbeef);
    starfield = Array.from({ length: STARFIELD_COUNT }, () => ({
      x: (rng() - 0.5) * STARFIELD_SPREAD,
      y: (rng() - 0.5) * STARFIELD_SPREAD,
      r: 0.4 + rng() * 1.1,
      a: 0.25 + rng() * 0.6,
    }));
  }
  return starfield;
}

function drawStarfield(ctx, cam, canvas) {
  for (const s of getStarfield()) {
    const p = worldToScreen(cam, s.x, s.y, canvas);
    if (p.x < -5 || p.x > canvas.width + 5 || p.y < -5 || p.y > canvas.height + 5) continue;
    ctx.globalAlpha = s.a;
    ctx.fillStyle = THEME.starfield;
    ctx.beginPath();
    ctx.arc(p.x, p.y, s.r, 0, Math.PI * 2);
    ctx.fill();
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

export function drawSystem(ctx, state, systemId, selection) {
  const canvas = ctx.canvas;
  const system = systemById(state, systemId);
  ctx.fillStyle = THEME.bgDeep;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!system) return;

  const intel = hasIntel(state, systemId);

  drawStarfield(ctx, camera, canvas);

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
    time: state.time,
    intel,
    state,
    systemId,
  });

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

  ctx.fillStyle = THEME.accentCyan;
  for (const sh of shuttlePositions(state, systemId)) {
    const ss = worldToScreen(camera, sh.x, sh.y, canvas);
    ctx.shadowColor = THEME.accentCyan;
    ctx.shadowBlur = 4;
    ctx.beginPath();
    ctx.arc(ss.x, ss.y, Math.max(1, SHUTTLE_SIZE * z), 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  const f = state.flagship;
  if (f.systemId === systemId && !f.transit) {
    const fs = worldToScreen(camera, f.x, f.y, canvas);
    const inp = getFlagshipInput();
    const thrusting = !state.paused && (inp.x !== 0 || inp.y !== 0);
    drawFlagshipSprite(ctx, fs.x, fs.y, f.heading, FLAGSHIP_RADIUS * z, thrusting);
  }
}

function drawFlagshipSprite(ctx, x, y, heading, r, thrusting) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);

  if (thrusting) {
    const flicker = 0.75 + 0.25 * Math.sin(performance.now() / 40);
    const flameLen = r * 2.4 * flicker;
    const flame = ctx.createLinearGradient(-r, 0, -r - flameLen, 0);
    flame.addColorStop(0, hexToRgba(THEME.accentCyan, 0.9));
    flame.addColorStop(0.5, hexToRgba(THEME.accentCyan, 0.4));
    flame.addColorStop(1, hexToRgba(THEME.accentCyan, 0));
    ctx.fillStyle = flame;
    ctx.beginPath();
    ctx.moveTo(-r * 0.9, r * 0.45);
    ctx.lineTo(-r - flameLen, 0);
    ctx.lineTo(-r * 0.9, -r * 0.45);
    ctx.closePath();
    ctx.fill();
  }

  ctx.beginPath();
  ctx.moveTo(r * 1.7, 0);
  ctx.lineTo(-r * 1.1, r * 0.95);
  ctx.lineTo(-r * 0.65, 0);
  ctx.lineTo(-r * 1.1, -r * 0.95);
  ctx.closePath();
  ctx.fillStyle = THEME.hull;
  ctx.fill();
  ctx.strokeStyle = THEME.accentCyan;
  ctx.lineWidth = Math.max(1, r * 0.14);
  ctx.stroke();

  ctx.fillStyle = THEME.accentCyan;
  ctx.shadowColor = THEME.accentCyan;
  ctx.shadowBlur = r * 0.5;
  ctx.beginPath();
  ctx.arc(r * 0.55, 0, Math.max(1, r * 0.3), 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.restore();
}

function drawScoutSprite(ctx, x, y, angle, r, selected) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(r * 1.4, 0);
  ctx.lineTo(-r, r * 0.7);
  ctx.lineTo(-r * 0.5, 0);
  ctx.lineTo(-r, -r * 0.7);
  ctx.closePath();
  ctx.fillStyle = selected ? THEME.scout.selected : THEME.scout.normal;
  ctx.fill();
  ctx.strokeStyle = selected ? THEME.accentGreen : THEME.accentCyan;
  ctx.lineWidth = Math.max(1, r * 0.15);
  ctx.stroke();
  ctx.restore();
}

// ============================= GALAXY VIEW =============================

function starNodeRadius(state, starId) {
  const system = systemById(state, starId);
  return 9 + (system ? system.bodies.length : 0) * 1.6;
}

const BLACK_HOLE_NODE_RADIUS = 26;

export function drawGalaxy(ctx, state, selectedScoutId = null) {
  const canvas = ctx.canvas;
  ctx.fillStyle = THEME.bgGalaxy;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawStarfield(ctx, galaxyCamera, canvas);

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

    const bulge = 0.08 + (i % 3) * 0.03;
    const curve = drawCurvedLane(ctx, sa.x, sa.y, sb.x, sb.y, bulge);
    ctx.setLineDash([]);

    for (let k = 0; k < 2; k++) {
      const t = ((state.time / 6000) + k * 0.5 + i * 0.13) % 1;
      const pt = bezierPoint(sa.x, sa.y, curve.cx, curve.cy, sb.x, sb.y, t);
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
  labelText(ctx, galaxy.blackHole.name, bhScreen.x, bhScreen.y + (BLACK_HOLE_NODE_RADIUS + 44) * z, Math.max(10, 12 * z), THEME.textSecondary);
  labelText(ctx, 'Wormhole — dormant', bhScreen.x, bhScreen.y + (BLACK_HOLE_NODE_RADIUS + 58) * z, Math.max(8, 9.5 * z), 'rgba(176, 122, 219, 0.75)');

  for (const star of galaxy.stars) {
    const system = systemById(state, star.id);
    const s = worldToScreen(galaxyCamera, star.x, star.y, canvas);
    const nodeR = starNodeRadius(state, star.id) * z;
    const color = system?.star.color ?? THEME.accentGold;
    const intel = hasIntel(state, star.id);
    const owned = isPlayerOwned(state, star.id);

    if (!intel) {
      ctx.fillStyle = THEME.fog.galaxyNode;
      ctx.beginPath();
      ctx.arc(s.x, s.y, nodeR * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    const glow = ctx.createRadialGradient(s.x, s.y, nodeR * 0.3, s.x, s.y, nodeR * 3);
    glow.addColorStop(0, hexToRgba(color, intel ? 0.55 : 0.15));
    glow.addColorStop(1, hexToRgba(color, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(s.x, s.y, nodeR * 3, 0, Math.PI * 2);
    ctx.fill();

    const nodeGrad = ctx.createRadialGradient(
      s.x - nodeR * 0.25, s.y - nodeR * 0.25, nodeR * 0.1,
      s.x, s.y, nodeR,
    );
    if (intel) {
      nodeGrad.addColorStop(0, hexToRgba(color, 1));
      nodeGrad.addColorStop(0.7, color);
      nodeGrad.addColorStop(1, hexToRgba(color, 0.6));
    } else {
      nodeGrad.addColorStop(0, THEME.fog.star);
      nodeGrad.addColorStop(1, THEME.fog.star);
    }
    ctx.fillStyle = nodeGrad;
    ctx.beginPath();
    ctx.arc(s.x, s.y, nodeR, 0, Math.PI * 2);
    ctx.fill();

    if (state.stronghold === star.id) {
      drawGlowRing(ctx, s.x, s.y, nodeR + 6 * z, THEME.accentGold, Math.max(1, 2 * z), 0.9);
      drawGlowRing(ctx, s.x, s.y, nodeR + 10 * z, THEME.accentGold, Math.max(1, 1 * z), 0.35);
    }

    if (owned) {
      drawGlowRing(ctx, s.x, s.y, nodeR + 10 * z, THEME.accentGold, Math.max(1, 1.5 * z), 0.65);
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
