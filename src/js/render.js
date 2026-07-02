// Canvas 2D rendering. Reads state; never mutates it (IMPLEMENTATION_PLAN §4).

import {
  STARFIELD_COUNT,
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
      x: (rng() - 0.5) * 4600,
      y: (rng() - 0.5) * 4600,
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
    ctx.fillStyle = '#cfe0ff';
    ctx.beginPath();
    ctx.arc(p.x, p.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

const PLANET_COLORS = {
  habitable: '#4f9e6b',
  barren: '#9e8a72',
  gas: '#b07adb',
};

// ============================= SYSTEM VIEW =============================

export function drawSystem(ctx, state, systemId, selection) {
  const canvas = ctx.canvas;
  const system = systemById(state, systemId);
  ctx.fillStyle = '#05070f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!system) return;

  const intel = hasIntel(state, systemId);

  drawStarfield(ctx, camera, canvas);

  const z = camera.zoom;
  const starScreen = worldToScreen(camera, 0, 0, canvas);

  ctx.strokeStyle = 'rgba(120, 160, 255, 0.14)';
  ctx.lineWidth = 1;
  for (const planet of system.bodies) {
    ctx.beginPath();
    ctx.arc(starScreen.x, starScreen.y, planet.orbitRadius * z, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (system.star.kind === 'blackhole') {
    drawBlackHole(ctx, starScreen.x, starScreen.y, system.star.radius * z, state.time, true);
  } else {
    const starR = system.star.radius * z;
    const glow = ctx.createRadialGradient(starScreen.x, starScreen.y, starR * 0.4, starScreen.x, starScreen.y, starR * 2.6);
    glow.addColorStop(0, 'rgba(255, 210, 122, 0.55)');
    glow.addColorStop(1, 'rgba(255, 210, 122, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(starScreen.x, starScreen.y, starR * 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = system.star.color;
    ctx.beginPath();
    ctx.arc(starScreen.x, starScreen.y, starR, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const planet of system.bodies) {
    const wp = planetPosition(planet, state.time);
    const sp = worldToScreen(camera, wp.x, wp.y, canvas);
    const pr = planet.radius * z;

    for (const moon of planet.moons) {
      ctx.strokeStyle = 'rgba(120, 160, 255, 0.10)';
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, moon.orbitRadius * z, 0, Math.PI * 2);
      ctx.stroke();

      const wm = moonPosition(planet, moon, state.time);
      const sm = worldToScreen(camera, wm.x, wm.y, canvas);
      ctx.fillStyle = intel ? '#a8b4cc' : 'rgba(80, 90, 110, 0.5)';
      ctx.beginPath();
      ctx.arc(sm.x, sm.y, moon.radius * z, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = intel ? (PLANET_COLORS[planet.type] ?? '#888') : 'rgba(60, 70, 90, 0.55)';
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, pr, 0, Math.PI * 2);
    ctx.fill();

    if (intel && hasOutpost(state, systemId, planet.id)) {
      ctx.strokeStyle = '#ffd27a';
      ctx.lineWidth = Math.max(1, 1.5 * z);
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, pr + 4 * z, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    if (intel && hasShipyard(state, systemId, planet.id)) {
      ctx.strokeStyle = '#7ad0ff';
      ctx.lineWidth = Math.max(1, 2 * z);
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, pr + 8 * z, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;

      const shipyard = system.structures.find(
        (s) => s.type === 'shipyard' && s.bodyId === planet.id,
      );
      if (shipyard?.build) {
        const prog = shipyardBuildProgress(shipyard, state.time);
        ctx.strokeStyle = `rgba(122, 208, 255, ${0.4 + 0.5 * prog})`;
        ctx.lineWidth = Math.max(1, 2.5 * z);
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, pr + 12 * z, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1;
      }
    }

    if (selection === planet.id) {
      const pulse = 0.5 + 0.5 * Math.sin((performance.now() / SELECTION_PULSE_MS) * Math.PI * 2);
      ctx.strokeStyle = `rgba(122, 255, 158, ${0.4 + 0.5 * pulse})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, pr + (8 + 3 * pulse) * z, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    ctx.fillStyle = intel ? 'rgba(207, 224, 255, 0.75)' : 'rgba(100, 110, 130, 0.6)';
    ctx.font = `${Math.max(10, 11 * z)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(intel ? planet.name : 'Unknown', sp.x, sp.y - pr - 8 * z);
    if (intel) {
      ctx.fillStyle = 'rgba(122, 141, 181, 0.85)';
      ctx.font = `${Math.max(8, 9 * z)}px sans-serif`;
      ctx.fillText(planet.type, sp.x, sp.y + pr + 14 * z);
    }
  }

  ctx.fillStyle = '#7ad0ff';
  for (const sh of shuttlePositions(state, systemId)) {
    const ss = worldToScreen(camera, sh.x, sh.y, canvas);
    ctx.beginPath();
    ctx.arc(ss.x, ss.y, Math.max(1, SHUTTLE_SIZE * z), 0, Math.PI * 2);
    ctx.fill();
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
    flame.addColorStop(0, 'rgba(122, 208, 255, 0.9)');
    flame.addColorStop(1, 'rgba(122, 208, 255, 0)');
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
  ctx.fillStyle = '#dfe9ff';
  ctx.fill();
  ctx.strokeStyle = '#7ad0ff';
  ctx.lineWidth = Math.max(1, r * 0.14);
  ctx.stroke();

  ctx.fillStyle = '#7ad0ff';
  ctx.beginPath();
  ctx.arc(r * 0.55, 0, Math.max(1, r * 0.3), 0, Math.PI * 2);
  ctx.fill();

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
  ctx.fillStyle = selected ? '#b8ffb8' : '#9fc7ff';
  ctx.fill();
  ctx.strokeStyle = selected ? '#7aff9e' : '#7ad0ff';
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
  ctx.fillStyle = '#04060d';
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

  // Scout route lanes
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
      ctx.strokeStyle = 'rgba(122, 255, 158, 0.45)';
      ctx.lineWidth = Math.max(1, 1.8 * z);
    } else {
      ctx.setLineDash([]);
      ctx.strokeStyle = onFlagshipRoute ? 'rgba(255, 210, 122, 0.55)' : 'rgba(110, 150, 255, 0.22)';
      ctx.lineWidth = Math.max(1, (onFlagshipRoute ? 2 : 1.4) * z);
    }
    ctx.beginPath();
    ctx.moveTo(sa.x, sa.y);
    ctx.lineTo(sb.x, sb.y);
    ctx.stroke();
    ctx.setLineDash([]);

    for (let k = 0; k < 2; k++) {
      const t = ((state.time / 6000) + k * 0.5 + i * 0.13) % 1;
      const px = sa.x + (sb.x - sa.x) * t;
      const py = sa.y + (sb.y - sa.y) * t;
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#9fc7ff';
      ctx.beginPath();
      ctx.arc(px, py, Math.max(1, 2 * z), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  const bhScreen = worldToScreen(galaxyCamera, galaxy.blackHole.x, galaxy.blackHole.y, canvas);
  drawBlackHole(ctx, bhScreen.x, bhScreen.y, BLACK_HOLE_NODE_RADIUS * z, state.time, false);
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(207, 224, 255, 0.8)';
  ctx.font = `${Math.max(10, 12 * z)}px sans-serif`;
  ctx.fillText(galaxy.blackHole.name, bhScreen.x, bhScreen.y + (BLACK_HOLE_NODE_RADIUS + 44) * z);
  ctx.fillStyle = 'rgba(176, 122, 219, 0.75)';
  ctx.font = `${Math.max(8, 9.5 * z)}px sans-serif`;
  ctx.fillText('Wormhole — dormant', bhScreen.x, bhScreen.y + (BLACK_HOLE_NODE_RADIUS + 58) * z);

  for (const star of galaxy.stars) {
    const system = systemById(state, star.id);
    const s = worldToScreen(galaxyCamera, star.x, star.y, canvas);
    const nodeR = starNodeRadius(state, star.id) * z;
    const color = system?.star.color ?? '#ffd27a';
    const intel = hasIntel(state, star.id);
    const owned = isPlayerOwned(state, star.id);

    if (!intel) {
      ctx.fillStyle = 'rgba(20, 25, 40, 0.75)';
      ctx.beginPath();
      ctx.arc(s.x, s.y, nodeR * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    const glow = ctx.createRadialGradient(s.x, s.y, nodeR * 0.3, s.x, s.y, nodeR * 3);
    glow.addColorStop(0, hexToRgba(color, intel ? 0.5 : 0.15));
    glow.addColorStop(1, hexToRgba(color, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(s.x, s.y, nodeR * 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = intel ? color : 'rgba(80, 90, 110, 0.6)';
    ctx.beginPath();
    ctx.arc(s.x, s.y, nodeR, 0, Math.PI * 2);
    ctx.fill();

    if (state.stronghold === star.id) {
      ctx.strokeStyle = '#ffd27a';
      ctx.lineWidth = Math.max(1, 2 * z);
      ctx.beginPath();
      ctx.arc(s.x, s.y, nodeR + 6 * z, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (owned) {
      ctx.strokeStyle = 'rgba(255, 210, 122, 0.7)';
      ctx.lineWidth = Math.max(1, 1.5 * z);
      ctx.beginPath();
      ctx.arc(s.x, s.y, nodeR + 10 * z, 0, Math.PI * 2);
      ctx.stroke();
    }

    const progress = captureProgressMs(state, star.id);
    if (progress > 0 && canHoldCapture(state, star.id)) {
      const frac = progress / CAPTURE_HOLD_MS;
      ctx.strokeStyle = 'rgba(122, 255, 158, 0.85)';
      ctx.lineWidth = Math.max(2, 3 * z);
      ctx.beginPath();
      ctx.arc(s.x, s.y, nodeR + 14 * z, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
      ctx.stroke();
    }

    if (system && system.structures.length > 0 && intel) {
      const hasSy = system.structures.some((st) => st.type === 'shipyard');
      ctx.fillStyle = hasSy ? '#7ad0ff' : '#7aff9e';
      ctx.beginPath();
      ctx.arc(s.x + nodeR + 5 * z, s.y - nodeR - 5 * z, Math.max(1.5, 2.5 * z), 0, Math.PI * 2);
      ctx.fill();
    }

    if (intel) {
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(207, 224, 255, 0.85)';
      ctx.font = `${Math.max(10, 12 * z)}px sans-serif`;
      ctx.fillText(star.name, s.x, s.y + nodeR + 16 * z);
      ctx.fillStyle = 'rgba(122, 141, 181, 0.9)';
      ctx.font = `${Math.max(8, 9.5 * z)}px sans-serif`;
      const n = system?.bodies.length ?? 0;
      ctx.fillText(n === 0 ? 'dead star' : `${n} planet${n === 1 ? '' : 's'}`, s.x, s.y + nodeR + 29 * z);
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
    ctx.strokeStyle = `rgba(255, 210, 122, ${0.35 + 0.4 * pulse})`;
    ctx.lineWidth = Math.max(1, 1.6 * z);
    ctx.beginPath();
    ctx.arc(ds.x, ds.y, (starNodeRadius(state, transit.destId) + (10 + 4 * pulse)) * z, 0, Math.PI * 2);
    ctx.stroke();
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

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function drawBlackHole(ctx, x, y, r, time, large) {
  const diskScale = large ? 2.6 : 1.9;

  const glow = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * (diskScale + 1.6));
  glow.addColorStop(0, 'rgba(150, 90, 255, 0.30)');
  glow.addColorStop(0.6, 'rgba(90, 60, 200, 0.12)');
  glow.addColorStop(1, 'rgba(90, 60, 200, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, r * (diskScale + 1.6), 0, Math.PI * 2);
  ctx.fill();

  const disk = ctx.createRadialGradient(x, y, r * 1.02, x, y, r * diskScale);
  disk.addColorStop(0, 'rgba(255, 170, 90, 0.75)');
  disk.addColorStop(0.35, 'rgba(255, 120, 150, 0.35)');
  disk.addColorStop(1, 'rgba(150, 90, 255, 0)');
  ctx.fillStyle = disk;
  ctx.beginPath();
  ctx.arc(x, y, r * diskScale, 0, Math.PI * 2);
  ctx.arc(x, y, r, 0, Math.PI * 2, true);
  ctx.fill();

  const base = (time / 5000) * Math.PI * 2;
  for (let i = 0; i < 3; i++) {
    const start = base * (1 + i * 0.35) + (i * Math.PI * 2) / 3;
    ctx.strokeStyle = i % 2 === 0 ? 'rgba(180, 130, 255, 0.55)' : 'rgba(122, 208, 255, 0.45)';
    ctx.lineWidth = Math.max(1, r * 0.08);
    ctx.beginPath();
    ctx.arc(x, y, r * (1.25 + i * 0.28), start, start + Math.PI * 0.9);
    ctx.stroke();
  }

  ctx.fillStyle = '#02030a';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(180, 130, 255, 0.6)';
  ctx.lineWidth = Math.max(1, r * 0.06);
  ctx.stroke();
}

// ============================= HIT TESTS =============================

export function hitTestPlanet(state, systemId, wx, wy) {
  const system = systemById(state, systemId);
  if (!system) return null;
  for (const planet of system.bodies) {
    const p = planetPosition(planet, state.time);
    const dx = wx - p.x;
    const dy = wy - p.y;
    const hitR = planet.radius + 6 / camera.zoom;
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
