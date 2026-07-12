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
  GALAXY_LOD_ZOOM,
  SHUTTLE_SIZE,
  SAIL_SHUTTLE_SIZE,
  FLAGSHIP_RADIUS,
  CAPTURE_HOLD_MS,
  BATTLE_RENDER_LOD_UNITS,
  BATTLE_RENDER_SWARM_UNITS,
  BATTLE_TRACER_LIMIT,
  TACTICAL_WEAPON_COOLDOWN_MS,
  TACTICAL_WEAPON_RANGE,
} from './constants.js';
import { drawStar, drawPlanet, drawMoon, drawBlackHole, drawStarOverlays } from './celestial-render.js';
import {
  settledInProgressDots,
  inFlightSailDots,
  foundryLauncherSupplyLines,
} from './dyson-visuals.js';
import {
  drawFoundrySupplyTie,
  drawCompletedShellRings,
  drawInProgressSailDots,
} from './dyson-render.js';
import { drawDysonLensFlare } from './dyson-megastructure-render.js';
import { beginStarPass, flushStars } from './gl/star-renderer.js';
import { typeSizeBonus } from './star-types.js';
import {
  createRng,
  systemById,
  planetPosition,
  moonPosition,
  displayTime,
  hasOutpost,
  hasShipyard,
  hasFoundry,
  ensureDyson,
  isPlayerOwned,
  isAiOwned,
} from './state.js';
import { shuttlePositions } from './shuttles.js';
import { outpostSurfaceSites } from './surface-structures.js';
import { drawLandingPad, drawMiningRig, drawSurfaceBuilding } from './surface-structures-render.js';
import { structureSites } from './structure-sites.js';
import {
  drawShipyardStation,
  drawSailLauncher,
  drawLaunchMuzzleFlash,
  drawDrydockStation,
  drawOrbitalDefensePlatform,
  drawOrbitalBuilding,
  drawStarNodeBuilding,
  ORBITAL_BUILDING_VISUAL_TYPES,
  STAR_NODE_BUILDING_VISUAL_TYPES,
} from './structure-render.js';
import { sailShuttlePositions, foundryAnchor } from './sail-shuttles.js';
import { constructionSiteAnchor, dronePoses } from './drone-motion.js';
import { jobProgress } from './drones.js';
import {
  drawConstructionAssembly,
  drawConstructionDrone,
  drawDroneTrail,
  drawDroneWorkBeam,
} from './drone-render.js';
import { drawSailFoundryRingStation, drawSailFoundryLabel, sailFoundryLabelAnchor } from './foundry-render.js';
import {
  drawResearchStation,
  drawResearchStationLabel,
  researchStationLabelAnchor,
} from './research-render.js';
import { getFlagshipInput, getFlagshipDisplayPose, transitStatus, isFlagshipOrbiting, getFlagshipOrbitVisual } from './flagship.js';
import { scoutTransitPositions, scoutsAtSystem } from './scout.js';
import { hasIntel } from './intel.js';
import { captureProgressMs, canHoldCapture } from './capture.js';
import { laneBulge, laneControlPoint } from './galaxy.js';
import { getGraph, getActiveGalaxy, wormholeIdForGalaxy } from './galaxy-scope.js';
import { getBattleState } from './combat.js';
import { playerShipsAtSystem, playerShipTransitPositions } from './fleets.js';
import {
  pirateFleetAtSystem,
  pirateSystemsWithPresence,
  pirateFleetMarkersForGalaxy,
  pirateTransitLaneKeys,
  pirateFleetTransitMarkersForGalaxy,
} from './pirates.js';
import {
  drawHullSprite,
  drawHullSpriteLite,
  drawFlagshipSprite,
  drawHeroFlagshipSprite,
  drawScoutSprite,
  drawShuttleSprite,
  drawFleetMarker,
} from './ship-sprites.js';
import { fleetMarkersForGalaxy, fleetTransitLaneKeys, fleetTransitMarkersForGalaxy } from './battle-groups.js';
import { ambientShipPose, ambientPiratePose, buildKeepOutBodyCache } from './ship-motion.js';
import { weaponProfile } from './hull.js';
import { builderDroneTransitPositions } from './builder-drones.js';
import {
  activeConvoys,
  convoyTransitStatus,
  localTransportSnapshots,
  logisticsLaneKey,
} from './logistics.js';
import {
  drawExportDepot,
  drawSpaceCompressionJump,
  exportDepotWorldPose,
} from './trade-nexus-render.js';
import {
  THEME,
  hexToRgba,
  drawQuadraticCurve,
} from './theme.js';

export const camera = { x: 0, y: 0, zoom: 1 };
export const galaxyCamera = { x: 0, y: 0, zoom: 0.4 };
export const follow = { enabled: false };

let lastGalaxyPerf = {
  tier: 'close',
  visibleStars: 0,
  visibleLanes: 0,
  fleetMarkers: 0,
  droneMarkers: 0,
  lastDrawMs: 0,
};

export function galaxyPerfSummary() {
  return { ...lastGalaxyPerf };
}

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

const titleCam = { x: 0, y: 0, zoom: 1 };

/** Slow-drifting starfield for the title screen. */
export function drawTitleBackground(ctx, canvas, time = 0) {
  const drift = time * 0.00003;
  titleCam.x = Math.sin(drift) * 140;
  titleCam.y = Math.cos(drift * 0.72) * 90;
  ctx.fillStyle = THEME.bgDeep;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawStarfield(ctx, titleCam, canvas, time);
  const cx = canvas.width * 0.5;
  const cy = canvas.height * 0.5;
  const r = Math.max(canvas.width, canvas.height) * 0.62;
  const g = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

/** Radial star streaks for the warp intro tunnel effect. */
export function drawWarpStarfield(ctx, canvas, time = 0, intensity = 0, mask = null) {
  const cx = mask?.cx ?? canvas.width * 0.5;
  const cy = mask?.cy ?? canvas.height * 0.5;
  const maskR = mask?.r ?? 0;

  for (const n of getNebulae()) {
    const baseX = cx + n.x * 0.018;
    const baseY = cy + n.y * 0.018;
    const pull = 1 - intensity * 0.45;
    const px = cx + (baseX - cx) * pull;
    const py = cy + (baseY - cy) * pull;
    const sr = n.r * 0.035 * (1 + intensity * 0.4);
    const g = ctx.createRadialGradient(px, py, sr * 0.1, px, py, sr);
    g.addColorStop(0, n.palette[0]);
    g.addColorStop(1, n.palette[1]);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, py, sr, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const s of getStarfield()) {
    const wobbleX = Math.sin(time * 0.35 + s.twinkle) * 18;
    const wobbleY = Math.cos(time * 0.28 + s.twinkle) * 18;
    const sx = cx + (s.x + wobbleX) * 0.016;
    const sy = cy + (s.y + wobbleY) * 0.016;
    const dx = sx - cx;
    const dy = sy - cy;
    const dist = Math.hypot(dx, dy) || 0.001;
    const angle = Math.atan2(dy, dx) + s.twinkle * 0.08;
    const radialPush = intensity * s.depth * (320 + time * 420);
    const px = cx + Math.cos(angle) * (dist + radialPush);
    const py = cy + Math.sin(angle) * (dist + radialPush);
    const twinkle = 0.55 + 0.45 * Math.sin(time * s.twinkleSpeed * 1000 + s.twinkle);

    if (intensity > 0.18) {
      const streakLen = s.r * (2 + intensity * 14) * s.depth;
      const tailX = px - Math.cos(angle) * streakLen;
      const tailY = py - Math.sin(angle) * streakLen;
      if (maskR > 0) {
        const tailDist = Math.hypot(tailX - cx, tailY - cy);
        const headDist = Math.hypot(px - cx, py - cy);
        if (tailDist < maskR * 0.85 && headDist > maskR * 0.35) continue;
        const band = maskR * 0.12;
        if (Math.abs(tailY - cy) < band && Math.abs(py - cy) < band && Math.abs(tailX - cx) < maskR * 1.4) continue;
      }
      ctx.globalAlpha = s.a * twinkle;
      ctx.strokeStyle = s.tint;
      ctx.lineWidth = Math.max(0.5, s.r * (0.6 + intensity));
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(px, py);
      ctx.stroke();
    } else {
      ctx.globalAlpha = s.a * twinkle;
      ctx.fillStyle = s.tint;
      ctx.beginPath();
      ctx.arc(px, py, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function drawCinematicSystemBackdrop(ctx, cam, canvas, time = 0, battle = null) {
  const w = canvas.width;
  const h = canvas.height;
  const cx = w * 0.5;
  const cy = h * 0.5;
  const drift = Math.sin(time / 17000) * 0.08;

  ctx.save();
  ctx.globalCompositeOperation = 'screen';

  let g = ctx.createRadialGradient(cx - w * (0.28 + drift), cy - h * 0.34, 0, cx - w * 0.2, cy - h * 0.25, w * 0.82);
  g.addColorStop(0, THEME.cinematic.nebulaCyan);
  g.addColorStop(0.48, THEME.cinematic.nebulaRose);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  g = ctx.createLinearGradient(0, h * 0.18, w, h * 0.86);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.42, THEME.cinematic.dust);
  g.addColorStop(0.56, THEME.cinematic.nebulaGold);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  if (battle?.active) {
    const pulse = 0.45 + 0.35 * Math.sin(time / 520);
    g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) * 0.72);
    g.addColorStop(0, `rgba(255, 58, 92, ${0.08 + pulse * 0.05})`);
    g.addColorStop(0.62, THEME.battle.hazard);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  ctx.globalCompositeOperation = 'source-over';
  const vignette = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.22, cx, cy, Math.max(w, h) * 0.66);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, THEME.cinematic.vignette);
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);

  const letterboxH = Math.max(20, h * 0.045);
  const top = ctx.createLinearGradient(0, 0, 0, letterboxH);
  top.addColorStop(0, THEME.cinematic.letterbox);
  top.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, w, letterboxH);
  const bottom = ctx.createLinearGradient(0, h, 0, h - letterboxH);
  bottom.addColorStop(0, THEME.cinematic.letterbox);
  bottom.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = bottom;
  ctx.fillRect(0, h - letterboxH, w, letterboxH);

  ctx.restore();
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
  const t = displayTime(state, accumulatorMs);

  beginStarPass('system');

  drawStarfield(ctx, camera, canvas, t);
  const activeBattle = getBattleState(state, systemId);
  drawCinematicSystemBackdrop(ctx, camera, canvas, t, activeBattle);

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
  if (intel && (dyson.completedShells > 0 || dyson.shellSails > 0 || hasFoundry(state, systemId))) {
    drawCompletedShellRings(
      ctx,
      starScreen.x,
      starScreen.y,
      z,
      dyson.completedShells,
      system.star.radius,
      t,
      dyson.lastShellCompletedAt,
      state.seed ?? 0,
    );
    const settled = settledInProgressDots(state, systemId, system.star.radius);
    const inFlight = inFlightSailDots(state, systemId, system.star.radius, t);
    if (settled.length > 0 || inFlight.length > 0) {
      drawInProgressSailDots(ctx, starScreen.x, starScreen.y, z, settled, inFlight, t);
    }
  }
  drawStarOverlays(ctx, {
    completedShells: dyson.completedShells,
    starRadius: system.star.radius,
    x: starScreen.x,
    y: starScreen.y,
    zoom: z,
    time: t,
  });
  if (intel && dyson.completedShells >= 8) {
    drawDysonLensFlare(
      ctx,
      starScreen.x,
      starScreen.y,
      z,
      dyson.completedShells,
      system.star.radius,
      t,
    );
  }

  const depotStructure = intel
    ? system.structures?.find((structure) => structure.type === 'export_depot')
    : null;
  const depotPose = depotStructure ? exportDepotWorldPose(system, t) : null;
  if (depotPose) {
    const depotScreen = worldToScreen(camera, depotPose.x, depotPose.y, canvas);
    drawOrbitRing(ctx, starScreen.x, starScreen.y, depotPose.orbitRadius * z, 0.08);
    drawExportDepot(
      ctx,
      depotScreen.x,
      depotScreen.y,
      Math.max(7, 16 * z),
      t,
      { active: depotStructure.operational !== false },
    );
    if (z > 0.28) {
      labelText(ctx, 'EXPORT DEPOT', depotScreen.x, depotScreen.y + Math.max(18, 27 * z), Math.max(8, 9 * z), THEME.accentCyan);
    }

    for (const transport of localTransportSnapshots(state)
      .filter((entry) => entry.systemId === systemId)) {
      const planet = system.bodies.find((body) => body.id === transport.fromBodyId);
      if (!planet) continue;
      const origin = planetPosition(planet, t);
      const p = transport.progress * transport.progress * (3 - 2 * transport.progress);
      const wx = origin.x + (depotPose.x - origin.x) * p;
      const wy = origin.y + (depotPose.y - origin.y) * p;
      const shipScreen = worldToScreen(camera, wx, wy, canvas);
      drawShuttleSprite(
        ctx,
        shipScreen.x,
        shipScreen.y,
        Math.atan2(depotPose.y - origin.y, depotPose.x - origin.x),
        Math.max(3.5, 6 * z),
        { active: true, time: t, loaded: true },
      );
    }

    for (const convoy of activeConvoys(state)
      .filter((entry) => entry.fromSystemId === systemId && entry.status === 'jumping')) {
      const status = convoyTransitStatus(state, convoy);
      const stagingX = depotPose.x + Math.cos(depotPose.heading) * 46;
      const stagingY = depotPose.y + Math.sin(depotPose.heading) * 46;
      const shipScreen = worldToScreen(camera, stagingX, stagingY, canvas);
      drawHullSpriteLite(ctx, shipScreen.x, shipScreen.y, 'freighter', Math.max(4, 8 * z), {
        heading: depotPose.heading,
        side: convoy.ownerId === 'player' ? 'player' : 'ai',
      });
      drawSpaceCompressionJump(
        ctx,
        shipScreen.x,
        shipScreen.y,
        depotPose.heading,
        Math.max(12, 26 * z),
        status?.progress ?? 0,
      );
    }
  }

  const sortedPlanets = [...system.bodies].sort((a, b) => b.orbitRadius - a.orbitRadius);
  const surfaceSites = intel ? outpostSurfaceSites(state, systemId, t) : [];
  const orbitalStructures = intel ? structureSites(state, systemId, t) : [];

  if (intel) {
    for (const st of orbitalStructures) {
      if (!STAR_NODE_BUILDING_VISUAL_TYPES.includes(st.kind)) continue;
      const ss = worldToScreen(camera, st.x, st.y, canvas);
      drawOrbitRing(ctx, starScreen.x, starScreen.y, st.orbitR * z, 0.08);
      drawStarNodeBuilding(ctx, ss.x, ss.y, z, st, t);
    }
  }

  for (const planet of sortedPlanets) {
    const wp = planetPosition(planet, t);
    const sp = worldToScreen(camera, wp.x, wp.y, canvas);
    const pr = planet.radius * z;
    const lightAngle = lightAngleFromOrigin(wp.x, wp.y);

    for (const moon of planet.moons) {
      drawOrbitRing(ctx, sp.x, sp.y, moon.orbitRadius * z, 0.1);
    }

    for (const moon of planet.moons) {
      const wm = moonPosition(planet, moon, t);
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

      if (intel && hasOutpost(state, systemId, planet.id)) {
        for (const site of surfaceSites) {
          if (site.planetId !== planet.id || site.moonId !== moon.id) continue;
          if (site.kind === 'planet-pad') continue;
          const ss = worldToScreen(camera, site.x, site.y, canvas);
          if (site.kind === 'moon-rig') {
            drawMiningRig(ctx, ss.x, ss.y, site.heading, z, {
              active: site.active,
              time: t,
              seed: site.seed,
            });
          } else if (site.kind.startsWith('surface-')) {
            drawSurfaceBuilding(ctx, ss.x, ss.y, site.heading, z, {
              type: site.structureType,
              active: site.active,
              time: t,
              seed: site.seed,
              level: site.level,
            });
          } else {
            drawLandingPad(ctx, ss.x, ss.y, site.heading, z, {
              active: site.active,
              time: t,
            });
          }
        }
      }

      if (intel) {
        for (const st of orbitalStructures) {
          if (st.bodyId !== moon.id) continue;
          const ls = worldToScreen(camera, st.x, st.y, canvas);
          if (st.kind === 'launcher') {
            drawSailLauncher(ctx, ls.x, ls.y, z, st, t);
          } else if (st.kind === 'drydock') {
            drawDrydockStation(ctx, ls.x, ls.y, z, st, t);
          } else if (st.kind === 'orbital_defense') {
            drawOrbitalDefensePlatform(ctx, ls.x, ls.y, z, st, t);
          } else if (st.kind === 'research_station') {
            drawResearchStation(ctx, ls.x, ls.y, z, st, t);
          } else if (ORBITAL_BUILDING_VISUAL_TYPES.includes(st.kind)) {
            drawOrbitalBuilding(ctx, ls.x, ls.y, z, st, t);
          }
        }
      }
    }

    drawPlanet(ctx, {
      planet,
      x: sp.x,
      y: sp.y,
      screenR: pr,
      time: t,
      intel,
      lightAngle,
      state,
      systemId,
    });

    if (intel && hasOutpost(state, systemId, planet.id)) {
      for (const site of surfaceSites) {
        if (site.planetId !== planet.id || site.moonId) continue;
        const ss = worldToScreen(camera, site.x, site.y, canvas);
        if (site.kind === 'planet-pad') {
          drawLandingPad(ctx, ss.x, ss.y, site.heading, z, {
            active: site.active,
            time: t,
          });
        } else if (site.kind.startsWith('surface-')) {
          drawSurfaceBuilding(ctx, ss.x, ss.y, site.heading, z, {
            type: site.structureType,
            active: site.active,
            time: t,
            seed: site.seed,
            level: site.level,
          });
        }
      }

      drawGlowRing(ctx, sp.x, sp.y, pr + 6 * z, THEME.accentGold, Math.max(1, 1.5 * z), 0.85);
    }

    if (intel) {
      for (const st of orbitalStructures) {
        if (st.planetId !== planet.id) continue;
        const ss = worldToScreen(camera, st.x, st.y, canvas);
        if (st.kind === 'shipyard') {
          drawShipyardStation(ctx, ss.x, ss.y, z, st, t);
        } else if (st.kind === 'drydock') {
          drawDrydockStation(ctx, ss.x, ss.y, z, st, t);
        } else if (st.kind === 'orbital_defense') {
          drawOrbitalDefensePlatform(ctx, ss.x, ss.y, z, st, t);
        } else if (st.kind === 'research_station' && st.bodyId === planet.id) {
          drawResearchStation(ctx, ss.x, ss.y, z, st, t);
          const label = researchStationLabelAnchor(ss.x, ss.y, z);
          drawResearchStationLabel(ctx, label, z);
        } else if (ORBITAL_BUILDING_VISUAL_TYPES.includes(st.kind)) {
          drawOrbitalBuilding(ctx, ss.x, ss.y, z, st, t);
        } else if (st.kind === 'launcher' && st.bodyId === planet.id) {
          drawSailLauncher(ctx, ss.x, ss.y, z, st, t);
        }
      }
    }

    if (intel && hasShipyard(state, systemId, planet.id)) {
      drawGlowRing(ctx, sp.x, sp.y, pr + 12 * z, THEME.accentCyan, Math.max(1, 2 * z), 0.35);
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

  if (intel && (hasFoundry(state, systemId) || system.structures.some((s) => s.type === 'sail_foundry'))) {
    const fa = foundryAnchor(state, systemId, t);
    if (fa.planetId && fa.foundryId) {
      const ps = worldToScreen(camera, fa.planetX, fa.planetY, canvas);
      const ringScreenR = fa.ringR * z;
      const foundryStructure = system.structures.find((structure) => structure.id === fa.foundryId);
      const foundryJob = foundryStructure?.construction
        ? (state.constructionJobs ?? []).find((job) => job.id === foundryStructure.construction.jobId)
        : null;
      const foundryBuildProgress = foundryJob ? jobProgress(foundryJob) : 1;
      ctx.save();
      ctx.globalAlpha = foundryStructure?.construction
        ? 0.12 + 0.88 * foundryBuildProgress
        : 1;
      drawSailFoundryRingStation(ctx, ps.x, ps.y, ringScreenR, z, t, fa.foundryId);
      ctx.restore();
      if (!foundryStructure?.construction || foundryBuildProgress >= 0.6) {
        const label = sailFoundryLabelAnchor(ps.x, ps.y, ringScreenR, fa.dockAngle);
        drawSailFoundryLabel(ctx, label, z);
      }
    }

    for (const line of foundryLauncherSupplyLines(state, systemId, t)) {
      const from = worldToScreen(camera, line.fromX, line.fromY, canvas);
      const to = worldToScreen(camera, line.toX, line.toY, canvas);
      drawFoundrySupplyTie(ctx, {
        fromX: from.x,
        fromY: from.y,
        toX: to.x,
        toY: to.y,
      }, z, t);
    }
  }

  for (const sh of shuttlePositions(state, systemId, t)) {
    const ss = worldToScreen(camera, sh.x, sh.y, canvas);
    drawShuttleSprite(ctx, ss.x, ss.y, sh.heading, Math.max(2.5, SHUTTLE_SIZE * z), {
      wingSpread: sh.wingSpread,
      thrusting: sh.thrusting && !state.paused,
      seed: sh.seed,
    });
  }

  ctx.fillStyle = THEME.accentGold;
  for (const sh of sailShuttlePositions(state, systemId, t)) {
    const ss = worldToScreen(camera, sh.x, sh.y, canvas);
    ctx.shadowColor = THEME.accentGold;
    ctx.shadowBlur = 5;
    ctx.beginPath();
    ctx.arc(ss.x, ss.y, Math.max(1.2, SAIL_SHUTTLE_SIZE * z), 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  const f = state.flagship;
  const flagshipDisplayPose = f.systemId === systemId && !f.transit
    ? getFlagshipDisplayPose(state, accumulatorMs)
    : null;

  const activeConstructionJobs = (state.constructionJobs ?? []).filter(
    (job) => job.galaxyId === state.activeGalaxyId
      && job.systemId === systemId
      && job.status !== 'complete'
      && job.status !== 'failed',
  );
  activeConstructionJobs.forEach((job, index) => {
    const anchor = constructionSiteAnchor(state, job, t);
    const site = worldToScreen(camera, anchor.x, anchor.y, canvas);
    if (!screenInView(site, canvas, 75)) return;
    drawConstructionAssembly(ctx, site.x, site.y, z, {
      type: job.structureType,
      progress: jobProgress(job),
      time: t,
      seed: index * 0.83 + job.id.length * 0.17,
    });
  });

  for (const dp of dronePoses(state, systemId, t, flagshipDisplayPose)) {
    const ds = worldToScreen(camera, dp.x, dp.y, canvas);
    if (!screenInView(ds, canvas, 45)) continue;
    if (dp.working && Number.isFinite(dp.workTargetX) && Number.isFinite(dp.workTargetY)) {
      const target = worldToScreen(camera, dp.workTargetX, dp.workTargetY, canvas);
      drawDroneWorkBeam(ctx, ds.x, ds.y, target.x, target.y, z, t, dp.drone.slotIndex);
    }
    drawDroneTrail(ctx, ds.x, ds.y, dp.heading, z, dp.phase);
    drawConstructionDrone(ctx, ds.x, ds.y, dp.heading, z, {
      phase: dp.phase,
      working: dp.working,
      time: t,
      seed: dp.drone.slotIndex,
    });
  }

  for (const st of orbitalStructures) {
    if (st.kind === 'launcher' && st.firing) {
      drawLaunchMuzzleFlash(ctx, st, z, camera, canvas, worldToScreen);
    }
  }

  drawBuilderDroneConstruction(ctx, state, system, canvas, z, t);

  if (f.systemId === systemId && !f.transit) {
    const orbitVisual = getFlagshipOrbitVisual(state, t);
    if (orbitVisual) {
      const os = worldToScreen(camera, orbitVisual.cx, orbitVisual.cy, canvas);
      drawOrbitRing(ctx, os.x, os.y, orbitVisual.radius * z, 0.32);
    }

    const pose = flagshipDisplayPose;
    const fs = worldToScreen(camera, pose.x, pose.y, canvas);
    const inp = getFlagshipInput();
    const orbiting = isFlagshipOrbiting(state);
    const thrusting = !state.paused && !orbiting && (inp.x !== 0 || inp.y !== 0);
    drawFlagshipSprite(
      ctx,
      fs.x,
      fs.y,
      pose.heading,
      FLAGSHIP_RADIUS * z,
      thrusting,
      state.flagship.hp ?? state.systemBattles?.[systemId]?.flagshipHp ?? 1,
      state.flagship.maxHp ?? 1,
    );
  }

  drawCombatLayer(ctx, state, systemId, canvas, z, t);

  flushStars(ctx, 'outer');
  flushStars(ctx, 'bloom');
  drawCinematicSystemGrade(ctx, canvas, activeBattle, t);
}

function drawCinematicSystemGrade(ctx, canvas, battle = null, time = 0) {
  const w = canvas.width;
  const h = canvas.height;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  const edge = ctx.createRadialGradient(w * 0.5, h * 0.52, Math.min(w, h) * 0.24, w * 0.5, h * 0.52, Math.max(w, h) * 0.72);
  edge.addColorStop(0, 'rgba(0,0,0,0)');
  edge.addColorStop(1, battle?.active ? 'rgba(1,2,8,0.44)' : 'rgba(1,2,8,0.32)');
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, w, h);

  if (battle?.active) {
    const pulse = 0.4 + 0.25 * Math.sin(time / 380);
    ctx.fillStyle = `rgba(255, 63, 95, ${0.035 + pulse * 0.03})`;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}

function combatRenderMode(unitCount, z) {
  if (unitCount >= BATTLE_RENDER_SWARM_UNITS || z < 0.23) return 'swarm';
  if (unitCount >= BATTLE_RENDER_LOD_UNITS || z < 0.5) return 'lite';
  return 'detail';
}

function drawCombatShipSprite(ctx, x, y, hull, baseR, opts, mode = 'detail') {
  if (mode === 'detail') {
    drawHullSprite(ctx, x, y, hull, baseR, opts);
    return;
  }
  drawHullSpriteLite(ctx, x, y, hull, baseR, {
    ...opts,
    showHp: mode === 'lite' && opts.hp < opts.maxHp * 0.55,
    alpha: mode === 'swarm' ? 0.82 : 1,
  });
}

function sideTracer(side, hull) {
  if (hull === 'healer') return THEME.battle.tracerHeal;
  if (side === 'enemy') return THEME.battle.tracerEnemy;
  return THEME.battle.tracerPlayer;
}

function weaponTracer(unit) {
  if (unit.weaponProfile === 'point_defense') return 'rgba(180, 245, 255, 0.92)';
  if (unit.weaponProfile === 'torpedo') return 'rgba(255, 178, 95, 0.95)';
  if (unit.weaponProfile === 'beam_lance') return 'rgba(125, 223, 255, 0.95)';
  if (unit.weaponProfile === 'ion') return 'rgba(176, 124, 255, 0.95)';
  return sideTracer(unit.side, unit.hull);
}

function drawBattleEnvelope(ctx, battle, canvas, z, time) {
  if (!battle?.units?.length) return;
  let x = 0;
  let y = 0;
  let n = 0;
  for (const unit of battle.units) {
    if (unit.hp <= 0) continue;
    x += unit.x;
    y += unit.y;
    n++;
  }
  if (!n) return;
  const center = worldToScreen(camera, x / n, y / n, canvas);
  const radius = Math.max(190, Math.min(720, Math.sqrt(n) * 64)) * z;
  const pulse = 0.45 + 0.28 * Math.sin(time / 640);

  ctx.save();
  ctx.strokeStyle = `rgba(255, 111, 125, ${0.2 + pulse * 0.2})`;
  ctx.lineWidth = Math.max(1, 1.5 * z);
  ctx.setLineDash([Math.max(7, 12 * z), Math.max(5, 8 * z)]);
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);

  const g = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius * 1.35);
  g.addColorStop(0, 'rgba(255, 80, 110, 0.06)');
  g.addColorStop(1, 'rgba(255, 80, 110, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius * 1.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBattleTracers(ctx, battle, canvas, mode, time) {
  if (!battle?.units?.length) return;
  let drawn = 0;
  ctx.save();
  ctx.lineCap = 'round';
  for (const unit of battle.units) {
    if (drawn >= BATTLE_TRACER_LIMIT) break;
    if (unit.hp <= 0) continue;
    const profile = weaponProfile(unit.weaponProfile ?? 'kinetic');
    const cooldown = profile.cooldownMs ?? TACTICAL_WEAPON_COOLDOWN_MS;
    const sinceFire = cooldown - (unit.cooldownMs ?? 0);
    if (sinceFire < 0 || sinceFire > 170) continue;
    const start = worldToScreen(camera, unit.x, unit.y, canvas);
    if (!screenInView(start, canvas, 80)) continue;
    const len = (mode === 'detail' ? (profile.range ?? TACTICAL_WEAPON_RANGE) * 0.62 : (profile.range ?? TACTICAL_WEAPON_RANGE) * 0.44) * camera.zoom;
    const heading = unit.heading ?? 0;
    const alpha = Math.max(0, 1 - sinceFire / 170);
    const endX = start.x + Math.cos(heading) * len;
    const endY = start.y + Math.sin(heading) * len;
    const g = ctx.createLinearGradient(start.x, start.y, endX, endY);
    const tracer = weaponTracer(unit);
    g.addColorStop(0, tracer.replace(/[\d.]+\)$/, `${0.15 * alpha})`));
    g.addColorStop(0.35, tracer);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = g;
    ctx.lineWidth = Math.max(1, (mode === 'detail' ? 1.6 : 1.1) * camera.zoom);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    drawn++;
  }
  ctx.restore();
}

function drawCombatLayer(ctx, state, systemId, canvas, z, time = state.time) {
  const system = systemById(state, systemId);
  if (!system) return;
  const baseR = Math.max(4, 6 * z);
  const battle = getBattleState(state, systemId);

  if (battle?.active && battle.units?.length) {
    const liveCount = battle.units.reduce((n, unit) => n + (unit.hp > 0 ? 1 : 0), 0);
    const mode = combatRenderMode(liveCount, z);
    drawBattleEnvelope(ctx, battle, canvas, z, time);
    drawBattleTracers(ctx, battle, canvas, mode, time);
    for (const unit of battle.units) {
      if (unit.hp <= 0) continue;
      const p = worldToScreen(camera, unit.x, unit.y, canvas);
      if (!screenInView(p, canvas, 70)) continue;
      drawCombatShipSprite(ctx, p.x, p.y, unit.hull, baseR, {
        heading: unit.heading ?? 0,
        side: unit.side,
        hp: unit.hp,
        maxHp: unit.maxHp,
        showHp: mode === 'detail',
      }, mode);
    }
    return;
  }

  const bodyCache = buildKeepOutBodyCache(system, time);

  const playerShips = playerShipsAtSystem(state, systemId);
  const pirateFleets = pirateFleetAtSystem(state, systemId);
  const pirateTotal = pirateFleets.reduce((n, f) => n + f.ships.filter((s) => s.hp > 0).length, 0);
  const ambientMode = combatRenderMode(playerShips.length + pirateTotal, z);
  playerShips.forEach((ship, idx) => {
    const pose = ambientShipPose(state, system, ship, idx, playerShips.length, time, bodyCache);
    const p = worldToScreen(camera, pose.x, pose.y, canvas);
    if (!screenInView(p, canvas, 70)) return;
    drawCombatShipSprite(ctx, p.x, p.y, ship.hull, baseR, {
      heading: pose.heading,
      side: 'player',
      hp: ship.hp,
      maxHp: ship.maxHp,
      showHp: ambientMode === 'detail',
    }, ambientMode);
  });

  let pIdx = 0;
  for (const fleet of pirateFleets) {
    for (const ship of fleet.ships) {
      if (ship.hp <= 0) continue;
      const pose = ambientPiratePose(state, system, ship, fleet.id, pIdx, pirateTotal, time, bodyCache);
      const p = worldToScreen(camera, pose.x, pose.y, canvas);
      if (!screenInView(p, canvas, 70)) { pIdx++; continue; }
      drawCombatShipSprite(ctx, p.x, p.y, ship.hull, baseR, {
        heading: pose.heading,
        side: 'enemy',
        hp: ship.hp,
        maxHp: ship.maxHp,
        showHp: ambientMode === 'detail',
      }, ambientMode);
      pIdx++;
    }
  }
}

function bodyWorldPosition(system, bodyId, time) {
  for (const planet of system.bodies) {
    if (planet.id === bodyId) return planetPosition(planet, time);
    const moon = planet.moons.find((m) => m.id === bodyId);
    if (moon) return moonPosition(planet, moon, time);
  }
  return null;
}

function drawBuilderDroneConstruction(ctx, state, system, canvas, z, time) {
  const drones = (state.builderDrones ?? []).filter(
    (d) => d.galaxyId === state.activeGalaxyId
      && d.status === 'building'
      && d.targetSystemId === system.id
      && d.targetBodyId,
  );
  for (const drone of drones) {
    const pos = bodyWorldPosition(system, drone.targetBodyId, time);
    if (!pos) continue;
    const phase = Math.sin(time / 220 + drone.id.length) * 0.5 + 0.5;
    const x = pos.x + 56;
    const y = pos.y - 46;
    const s = worldToScreen(camera, x, y, canvas);
    if (!screenInView(s, canvas, 50)) continue;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.strokeStyle = `rgba(255, 184, 92, ${0.35 + phase * 0.35})`;
    ctx.lineWidth = Math.max(1, 1.4 * z);
    ctx.setLineDash([4 * z, 5 * z]);
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(7, 18 * z), 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowColor = 'rgba(255, 184, 92, 0.9)';
    ctx.shadowBlur = 8;
    ctx.fillStyle = 'rgba(255, 184, 92, 0.95)';
    const r = Math.max(3, 5 * z);
    ctx.beginPath();
    ctx.moveTo(r * 1.8, 0);
    ctx.lineTo(-r, -r * 0.8);
    ctx.lineTo(-r * 0.4, 0);
    ctx.lineTo(-r, r * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(157, 229, 255, 0.8)';
    ctx.beginPath();
    ctx.moveTo(-r * 2.2, r * 1.6);
    ctx.lineTo(-r * 3.2 - phase * r, r * 2.3);
    ctx.moveTo(-r * 1.8, -r * 1.4);
    ctx.lineTo(-r * 3.0 - phase * r, -r * 2.1);
    ctx.stroke();
    ctx.restore();
  }
}

// ============================= GALAXY VIEW =============================

function starNodeRadius(state, starId) {
  const system = systemById(state, starId);
  const bonus = typeSizeBonus(system?.star);
  return 9 + (system ? system.bodies.length : 0) * 1.6 + bonus;
}

const BLACK_HOLE_NODE_RADIUS = 26;

function laneKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** A compact, state-backed label for a scouted system on the strategic map. */
function galaxySystemReadout(system, { owned, aiOwned, pirateAtStar, fleetAtStar }) {
  const worldCount = system?.bodies.length ?? 0;
  const worlds = worldCount === 1 ? '1 world' : `${worldCount} worlds`;
  const structures = system?.structures ?? [];
  const has = (type) => structures.some((s) => s.type === type);

  if (pirateAtStar.length > 0) {
    const ships = pirateAtStar.reduce((n, fleet) => n + fleet.shipCount, 0);
    return { text: `PIRATE FLEET · ${ships} ships`, color: THEME.dangerHot };
  }
  if (aiOwned) {
    const asset = has('shipyard') ? 'shipyard' : has('orbital_defense') ? 'defenses' : worlds;
    return { text: `HOSTILE · ${asset}`, color: '#d194ff' };
  }
  if (owned) {
    const asset = has('sail_foundry') ? 'foundry' : has('shipyard') ? 'shipyard' : has('outpost') ? 'outpost' : worlds;
    return { text: `YOUR SYSTEM · ${asset}`, color: THEME.accentGold };
  }
  if (fleetAtStar.length > 0) {
    const ships = fleetAtStar.reduce((n, fleet) => n + fleet.shipCount, 0);
    return { text: `FRIENDLY FLEET · ${ships} ships`, color: THEME.accentGreen };
  }
  return { text: `NEUTRAL · ${worlds}`, color: THEME.textMuted };
}

function drawTrafficChevron(ctx, x, y, angle, color, z) {
  const r = Math.max(2.1, 4.1 * z);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = Math.max(2, 5 * z);
  ctx.beginPath();
  ctx.moveTo(r * 1.45, 0);
  ctx.lineTo(-r, -r * 0.78);
  ctx.lineTo(-r * 0.45, 0);
  ctx.lineTo(-r, r * 0.78);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawGalaxyReadout(ctx, state, galaxy, trafficCount, pirateFleetCount, convoyCount = 0) {
  const intelCount = galaxy.stars.reduce((count, star) => count + (hasIntel(state, star.id) ? 1 : 0), 0);
  let owned = 0;
  let hostile = 0;
  for (const star of galaxy.stars) {
    if (isPlayerOwned(state, star.id)) owned++;
    else if (isAiOwned(state, star.id)) hostile++;
  }

  const lines = [
    'GALACTIC INTEL',
    `Known systems  ${intelCount}/${galaxy.stars.length}`,
    `Territory  ${owned} yours · ${hostile} hostile`,
    `Alerts  ${pirateFleetCount} pirate fleet${pirateFleetCount === 1 ? '' : 's'}`,
    `Live lane traffic  ${trafficCount} · ${convoyCount} convoys`,
  ];
  const lineH = 17;
  const width = 230;
  const height = 22 + lines.length * lineH;
  // HUD and queue panels occupy the upper left; keep strategic information
  // in the open map area beneath the top bar instead.
  const x = ctx.canvas.width - width - 20;
  const y = 72;
  ctx.save();
  ctx.fillStyle = 'rgba(5, 10, 22, 0.76)';
  ctx.strokeStyle = 'rgba(116, 203, 255, 0.32)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, width, height, 6);
  else ctx.rect(x, y, width, height);
  ctx.fill();
  ctx.stroke();
  ctx.font = '600 12px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  lines.forEach((line, index) => {
    ctx.fillStyle = index === 0 ? THEME.accentCyan : index === lines.length - 1 ? THEME.accentGreen : THEME.textSecondary;
    ctx.fillText(line, x + 12, y + 14 + index * lineH);
  });
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = THEME.textMuted;
  ctx.fillText('Chevrons show actual ship direction', x + 12, y + height - 10);
  ctx.restore();
}

export function drawGalaxy(
  ctx,
  state,
  selectedScoutId = null,
  selectedBattleGroupId = null,
  tutorialTargetSystemId = null,
) {
  const drawStartedAt = performance.now();
  const canvas = ctx.canvas;
  ctx.fillStyle = THEME.bgGalaxy;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  beginStarPass('galaxy');

  drawStarfield(ctx, galaxyCamera, canvas, state.time);

  const z = galaxyCamera.zoom;
  const galaxy = getGraph(state);
  const transit = transitStatus(state);
  const lod = z < GALAXY_LOD_ZOOM;
  const tier = z < 0.09 ? 'far' : z < 0.22 ? 'mid' : 'close';
  let visibleStars = 0;
  let visibleLanes = 0;
  const whId = wormholeIdForGalaxy(state.activeGalaxyId);
  const wh = state.wormholes?.[whId];
  const whLabel = state.flagship.wormholeTransit
    ? 'Wormhole — in transit'
    : wh?.anchor
      ? 'Wormhole — anchored'
      : 'Wormhole — active';

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

  const overlayState = { threat: true, sensor: false, blockade: true, ...(state.mapOverlays ?? {}) };
  const blockadePrefix = `${state.activeGalaxyId}:`;
  const blockadeRoutes = new Set((state.logistics?.blockades?.lanes ?? [])
    .filter((entry) => entry.startsWith(blockadePrefix))
    .map((entry) => entry.slice(blockadePrefix.length)));
  const logisticsRoutes = new Set();
  for (const route of state.logistics?.routes ?? []) {
    if (route.galaxyId !== state.activeGalaxyId || route.paused) continue;
    for (let i = 0; i < (route.path?.length ?? 0) - 1; i++) {
      logisticsRoutes.add(logisticsLaneKey(route.path[i], route.path[i + 1]));
    }
  }
  const convoyTransit = activeConvoys(state)
    .map((convoy) => ({ convoy, status: convoyTransitStatus(state, convoy) }))
    .filter((entry) => entry.status);
  for (const { convoy } of convoyTransit) {
    for (let i = convoy.legIndex ?? 0; i < convoy.path.length - 1; i++) {
      logisticsRoutes.add(logisticsLaneKey(convoy.path[i], convoy.path[i + 1]));
    }
  }
  const fleetRoutes = fleetTransitLaneKeys(state, selectedBattleGroupId);
  const piratePresence = new Set(pirateSystemsWithPresence(state));
  const pirateRoutes = pirateTransitLaneKeys(state);
  const scoutTransit = scoutTransitPositions(state);
  const playerShipTransit = playerShipTransitPositions(state);
  const pirateTransit = pirateFleetTransitMarkersForGalaxy(state);
  const droneTransit = builderDroneTransitPositions(state);
  const liveTraffic = [
    ...(transit ? [{ ...transit, color: THEME.accentGold }] : []),
    ...scoutTransit.map((entry) => ({ ...entry, color: THEME.laneScout })),
    ...playerShipTransit.map((entry) => ({ ...entry, color: THEME.accentGreen })),
    ...pirateTransit.map((entry) => ({ ...entry, color: THEME.dangerHot })),
    ...droneTransit.map((entry) => ({ ...entry, color: '#ffb85c' })),
    ...convoyTransit
      .filter(({ status }) => status.phase === 'in_transit')
      .map(({ status }) => ({ ...status, color: '#76ddff' })),
  ];
  const pirateMarkers = pirateFleetMarkersForGalaxy(state);
  const pirateMarkersBySystem = new Map();
  for (const marker of pirateMarkers) {
    const list = pirateMarkersBySystem.get(marker.systemId) ?? [];
    list.push(marker);
    pirateMarkersBySystem.set(marker.systemId, list);
  }
  const fleetMarkers = fleetMarkersForGalaxy(state, selectedBattleGroupId);
  const fleetMarkersBySystem = new Map();
  for (const marker of fleetMarkers) {
    const list = fleetMarkersBySystem.get(marker.systemId) ?? [];
    list.push(marker);
    fleetMarkersBySystem.set(marker.systemId, list);
  }

  for (let i = 0; i < galaxy.lanes.length; i++) {
    const [aId, bId] = galaxy.lanes[i];
    const a = nodePos(galaxy, aId);
    const b = nodePos(galaxy, bId);
    const sa = worldToScreen(galaxyCamera, a.x, a.y, canvas);
    const sb = worldToScreen(galaxyCamera, b.x, b.y, canvas);
    if (!screenInView(sa, canvas) && !screenInView(sb, canvas)) continue;

    const key = laneKey(aId, bId);
    const onFlagshipRoute = routeLanes?.has(key);
    const onScoutRoute = scoutRoutes.has(key);
    const onFleetRoute = fleetRoutes.all.has(key);
    const onFleetSelectedRoute = fleetRoutes.selected.has(key);
    const onPirateRoute = pirateRoutes.has(key);
    const onLogisticsRoute = logisticsRoutes.has(key);
    const onBlockade = overlayState.blockade && blockadeRoutes.has(key);
    if (tier === 'far' && !onFlagshipRoute && !onScoutRoute && !onFleetRoute && !onPirateRoute && !onLogisticsRoute && !onBlockade && (i % 3 !== 0)) {
      continue;
    }
    visibleLanes++;

    if (onBlockade) {
      ctx.setLineDash([3 * z, 3 * z]);
      ctx.strokeStyle = hexToRgba(THEME.dangerHot, 0.92);
      ctx.lineWidth = Math.max(1.8, 3 * z);
    } else if (onPirateRoute) {
      ctx.setLineDash([5 * z, 4 * z]);
      ctx.strokeStyle = hexToRgba(THEME.dangerHot, 0.72);
      ctx.lineWidth = Math.max(1.2, 2.2 * z);
    } else if (onLogisticsRoute) {
      ctx.setLineDash([9 * z, 4 * z, 2 * z, 4 * z]);
      ctx.strokeStyle = hexToRgba('#76ddff', 0.86);
      ctx.lineWidth = Math.max(1.5, 2.5 * z);
    } else if (onScoutRoute) {
      ctx.setLineDash([6 * z, 4 * z]);
      ctx.strokeStyle = THEME.laneScout;
      ctx.lineWidth = Math.max(1, 1.8 * z);
    } else if (onFleetSelectedRoute) {
      ctx.setLineDash([7 * z, 3 * z]);
      ctx.strokeStyle = THEME.laneFleetSelected;
      ctx.lineWidth = Math.max(1, 2.2 * z);
    } else if (onFleetRoute) {
      ctx.setLineDash([6 * z, 4 * z]);
      ctx.strokeStyle = THEME.laneFleet;
      ctx.lineWidth = Math.max(1, 1.9 * z);
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

  }

  // These are not ambient particles: every chevron maps to an active transit
  // record.  Their heading is the lane tangent, so reverse travel clearly
  // follows the same curve in the opposite direction.
  for (const entry of liveTraffic) {
    const s = worldToScreen(galaxyCamera, entry.x, entry.y, canvas);
    if (!screenInView(s, canvas, 20)) continue;
    drawTrafficChevron(ctx, s.x, s.y, entry.angle, entry.color, z);
  }

  const bhScreen = worldToScreen(galaxyCamera, galaxy.blackHole.x, galaxy.blackHole.y, canvas);
  if (tier === 'far') {
    const r = Math.max(3, BLACK_HOLE_NODE_RADIUS * z);
    ctx.save();
    ctx.strokeStyle = 'rgba(176, 122, 219, 0.7)';
    ctx.lineWidth = Math.max(1, 1.4 * z);
    ctx.beginPath();
    ctx.arc(bhScreen.x, bhScreen.y, r * 2.1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(5, 6, 12, 0.95)';
    ctx.shadowColor = 'rgba(176, 122, 219, 0.7)';
    ctx.shadowBlur = 10 * z;
    ctx.beginPath();
    ctx.arc(bhScreen.x, bhScreen.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else {
    const wormholeTransit = state.flagship.wormholeTransit;
    const wormholeProgress = wormholeTransit
      ? Math.max(0, Math.min(1, (state.time - wormholeTransit.startTime) / Math.max(1, wormholeTransit.durationMs)))
      : 0;
    drawBlackHole(
      ctx,
      bhScreen.x,
      bhScreen.y,
      BLACK_HOLE_NODE_RADIUS * z,
      state.time,
      !!wh?.anchor || !!wormholeTransit,
      wormholeTransit ? Math.sin(wormholeProgress * Math.PI) : 0,
    );
  }

  for (let starIdx = 0; starIdx < galaxy.stars.length; starIdx++) {
    const star = galaxy.stars[starIdx];
    const system = systemById(state, star.id);
    const s = worldToScreen(galaxyCamera, star.x, star.y, canvas);
    if (!screenInView(s, canvas, 40)) continue;
    const nodeR = starNodeRadius(state, star.id) * z;
    const intel = hasIntel(state, star.id);
    const important = intel || state.stronghold === star.id || piratePresence.has(star.id);
    if (tier === 'far' && !important && starIdx % 2 !== 0) continue;
    visibleStars++;

    if (!intel) {
      ctx.fillStyle = THEME.fog.galaxyNode;
      ctx.beginPath();
      ctx.arc(s.x, s.y, nodeR * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    if (tier === 'far') {
      const nexus = system?.star?.kind === 'trade_nexus';
      ctx.fillStyle = intel ? (nexus ? '#76ddff' : (system?.star?.color ?? THEME.textSecondary)) : THEME.fog.star;
      ctx.globalAlpha = intel ? 0.9 : 0.5;
      ctx.beginPath();
      ctx.arc(s.x, s.y, Math.max(1.8, nodeR * 0.72), 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (nexus && intel) drawGlowRing(ctx, s.x, s.y, Math.max(4, nodeR * 1.45), '#ffce7a', Math.max(1, 1.5 * z), 0.8);
    } else if (system?.star) {
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

  labelText(ctx, getActiveGalaxy(state)?.name ?? 'Galaxy', bhScreen.x, bhScreen.y - (BLACK_HOLE_NODE_RADIUS + 52) * z, Math.max(9, 11 * z), THEME.accentCyan);
  labelText(ctx, galaxy.blackHole.name, bhScreen.x, bhScreen.y + (BLACK_HOLE_NODE_RADIUS + 44) * z, Math.max(10, 12 * z), THEME.textSecondary);
  labelText(ctx, whLabel, bhScreen.x, bhScreen.y + (BLACK_HOLE_NODE_RADIUS + 58) * z, Math.max(8, 9.5 * z), 'rgba(176, 122, 219, 0.85)');
  drawGalaxyReadout(ctx, state, galaxy, liveTraffic.length, pirateMarkers.length + pirateTransit.length, convoyTransit.length);

  for (let starIdx = 0; starIdx < galaxy.stars.length; starIdx++) {
    const star = galaxy.stars[starIdx];
    const system = systemById(state, star.id);
    const s = worldToScreen(galaxyCamera, star.x, star.y, canvas);
    if (!screenInView(s, canvas, 40)) continue;
    const nodeR = starNodeRadius(state, star.id) * z;
    const intel = hasIntel(state, star.id);
    const owned = isPlayerOwned(state, star.id);
    const aiOwned = isAiOwned(state, star.id);
    const fleetAtStar = fleetMarkersBySystem.get(star.id) ?? [];
    const pirateAtStar = pirateMarkersBySystem.get(star.id) ?? [];
    const important = intel || owned || aiOwned || state.stronghold === star.id || piratePresence.has(star.id) || fleetAtStar.length > 0 || pirateAtStar.length > 0;
    if (tier === 'far' && !important && starIdx % 2 !== 0) continue;

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

    if (tutorialTargetSystemId === star.id) {
      const pulse = 0.5 + 0.5 * Math.sin((performance.now() / SELECTION_PULSE_MS) * Math.PI * 2);
      drawGlowRing(
        ctx,
        s.x,
        s.y,
        nodeR + (13 + 5 * pulse) * z,
        THEME.accentCyan,
        Math.max(1.2, 2.2 * z),
        0.62 + 0.32 * pulse,
      );
      if (tier !== 'far') {
        labelText(ctx, 'Tutorial target', s.x, s.y - nodeR - 17 * z, Math.max(8, 10 * z), THEME.accentCyan);
      }
    }

    if (owned) {
      drawGlowRing(ctx, s.x, s.y, nodeR + 10 * z, THEME.accentGold, Math.max(1, 1.5 * z), 0.65);
    }
    if (aiOwned) {
      drawGlowRing(ctx, s.x, s.y, nodeR + 10 * z, '#c44dff', Math.max(1, 1.5 * z), 0.75);
      ctx.fillStyle = '#c44dff';
      ctx.beginPath();
      ctx.arc(s.x + nodeR + 6 * z, s.y - nodeR - 4 * z, Math.max(2, 3 * z), 0, Math.PI * 2);
      ctx.fill();
    }

    if (piratePresence.has(star.id)) {
      ctx.fillStyle = '#ff4444';
      ctx.shadowColor = '#ff4444';
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(s.x - nodeR - 8 * z, s.y + nodeR + 6 * z, Math.max(2, 3.5 * z), 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      if (overlayState.threat) {
        drawGlowRing(ctx, s.x, s.y, nodeR + 20 * z, THEME.dangerHot, Math.max(1, 2 * z), 0.42);
      }
    }

    if (overlayState.sensor && intel) {
      const sensorColor = owned ? THEME.accentCyan : 'rgba(126, 145, 186, 0.8)';
      ctx.save();
      ctx.setLineDash([4 * z, 5 * z]);
      ctx.strokeStyle = sensorColor;
      ctx.lineWidth = Math.max(0.8, 1.1 * z);
      ctx.beginPath();
      ctx.arc(s.x, s.y, nodeR + 24 * z, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
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

    const labelImportant = owned || aiOwned || state.stronghold === star.id
      || system?.star?.kind === 'trade_nexus'
      || fleetAtStar.length > 0 || piratePresence.has(star.id) || pirateAtStar.length > 0;
    if (intel && tier !== 'far' && (tier === 'close' || labelImportant)) {
      labelText(ctx, star.name, s.x, s.y + nodeR + 16 * z, Math.max(10, 12 * z), THEME.textLabel);
      if (tier === 'close') {
        const readout = system?.star?.kind === 'trade_nexus'
          ? { text: 'TRADE NEXUS · INTERSTELLAR MARKET', color: '#ffce7a' }
          : galaxySystemReadout(system, { owned, aiOwned, pirateAtStar, fleetAtStar });
        labelText(
          ctx,
          readout.text,
          s.x,
          s.y + nodeR + 29 * z,
          Math.max(8, 9.5 * z),
          readout.color,
        );
      }
    }

    if (state.flagship.galaxyId === state.activeGalaxyId && state.flagship.systemId === star.id) {
      drawFlagshipSprite(ctx, s.x + nodeR + 14 * z, s.y - nodeR - 12 * z, -Math.PI / 4, Math.max(3, 5.5 * z), false);
    }

    let heroIdx = 0;
    for (const hero of state.heroFlagships ?? []) {
      if (hero.galaxyId !== state.activeGalaxyId || hero.systemId !== star.id || hero.transit) continue;
      if (state.time < (hero.buildCompleteAt ?? 0)) continue;
      drawHeroFlagshipSprite(
        ctx,
        s.x - nodeR - 14 * z - heroIdx * 12 * z,
        s.y + nodeR + 10 * z,
        Math.PI / 5,
        Math.max(2.5, 4.5 * z),
        hero.hp,
        hero.maxHp,
      );
      heroIdx++;
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

    fleetAtStar.forEach((marker, idx) => {
      drawFleetMarker(
        ctx,
        s.x - nodeR - 12 * z - idx * 22 * z,
        s.y + nodeR + 12 * z,
        z,
        marker,
      );
    });

    pirateAtStar.forEach((marker, idx) => {
      drawFleetMarker(
        ctx,
        s.x + nodeR + 18 * z + idx * 30 * z,
        s.y + nodeR + 12 * z,
        z,
        marker,
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

  for (const entry of scoutTransit) {
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

  for (const marker of fleetTransitMarkersForGalaxy(state, selectedBattleGroupId)) {
    const s = worldToScreen(galaxyCamera, marker.x, marker.y, canvas);
    drawFleetMarker(ctx, s.x, s.y, z, marker);

    if (marker.selected && marker.destId) {
      const dest = nodePos(galaxy, marker.destId);
      const ds = worldToScreen(galaxyCamera, dest.x, dest.y, canvas);
      const pulse = 0.5 + 0.5 * Math.sin((performance.now() / SELECTION_PULSE_MS) * Math.PI * 2);
      drawGlowRing(
        ctx,
        ds.x,
        ds.y,
        (starNodeRadius(state, marker.destId) + (10 + 4 * pulse)) * z,
        THEME.accentGreen,
        Math.max(1, 1.6 * z),
        0.35 + 0.4 * pulse,
      );
    }
  }

  for (const marker of pirateTransit) {
    const s = worldToScreen(galaxyCamera, marker.x, marker.y, canvas);
    if (!screenInView(s, canvas, 50)) continue;
    drawFleetMarker(ctx, s.x, s.y, z, marker);
    if (marker.intent === 'raid' && marker.destId) {
      const dest = nodePos(galaxy, marker.destId);
      const ds = worldToScreen(galaxyCamera, dest.x, dest.y, canvas);
      const pulse = 0.5 + 0.5 * Math.sin((performance.now() / SELECTION_PULSE_MS) * Math.PI * 2);
      drawGlowRing(
        ctx,
        ds.x,
        ds.y,
        (starNodeRadius(state, marker.destId) + (9 + 4 * pulse)) * z,
        THEME.dangerHot,
        Math.max(1, 1.6 * z),
        0.28 + 0.42 * pulse,
      );
    }
  }

  for (const entry of droneTransit) {
    if (tier === 'far' && !entry.drone?.targetSystemId) continue;
    const s = worldToScreen(galaxyCamera, entry.x, entry.y, canvas);
    if (!screenInView(s, canvas, 40)) continue;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(entry.angle);
    ctx.fillStyle = 'rgba(255, 184, 92, 0.92)';
    ctx.shadowColor = 'rgba(255, 184, 92, 0.8)';
    ctx.shadowBlur = 7;
    const r = Math.max(2.2, 4.2 * z);
    ctx.beginPath();
    ctx.moveTo(r * 1.8, 0);
    ctx.lineTo(-r, -r * 0.8);
    ctx.lineTo(-r * 0.45, 0);
    ctx.lineTo(-r, r * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  for (const { convoy, status } of convoyTransit) {
    if (status.phase === 'delivered' || status.phase === 'intercepted') continue;
    const s = worldToScreen(galaxyCamera, status.x, status.y, canvas);
    if (!screenInView(s, canvas, 50)) continue;
    const heading = Number.isFinite(status.angle) ? status.angle : 0;
    drawHullSpriteLite(ctx, s.x, s.y, 'freighter', Math.max(3.5, 7.5 * z), {
      heading,
      side: convoy.ownerId === 'player' && status.phase !== 'paused' ? 'player' : 'ai',
    });
    if (status.phase === 'jumping') {
      drawSpaceCompressionJump(ctx, s.x, s.y, heading, Math.max(10, 23 * z), status.progress);
    }
    if (tier === 'close') {
      labelText(
        ctx,
        convoy.id.toUpperCase(),
        s.x,
        s.y + Math.max(15, 21 * z),
        Math.max(7, 8 * z),
        convoy.ownerId === 'player' ? '#76ddff' : '#ff7a7a',
      );
    }
  }

  flushStars(ctx, 'bloom');

  const swAction = state.superweapon?.lastAction;
  if (swAction && state.time - swAction.at < 4000) {
    const target = nodePos(galaxy, swAction.targetSystemId);
    if (target) {
      const ts = worldToScreen(galaxyCamera, target.x, target.y, canvas);
      const pulse = 1 - (state.time - swAction.at) / 4000;
      const color = swAction.type === 'destroy' ? '#ff4466' : swAction.type === 'create' ? '#66ffaa' : '#aa88ff';
      drawGlowRing(ctx, ts.x, ts.y, (40 + 30 * pulse) * z, color, Math.max(2, 3 * z), 0.25 + 0.45 * pulse);
    }
  }

  lastGalaxyPerf = {
    tier,
    visibleStars,
    visibleLanes,
    fleetMarkers: fleetMarkers.length,
    pirateMarkers: pirateMarkers.length + pirateTransit.length,
    droneMarkers: droneTransit.length,
    convoyMarkers: convoyTransit.length,
    lastDrawMs: Math.round((performance.now() - drawStartedAt) * 100) / 100,
  };
}

function screenInView(s, canvas, margin = 60) {
  return s.x >= -margin && s.y >= -margin
    && s.x <= canvas.width + margin && s.y <= canvas.height + margin;
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
  const galaxy = getGraph(state);
  const halo = 14 / galaxyCamera.zoom;
  for (const star of galaxy.stars) {
    const hitR = starNodeRadius(state, star.id) + halo;
    const dx = wx - star.x;
    const dy = wy - star.y;
    if (dx * dx + dy * dy <= hitR * hitR) return star.id;
  }
  const bh = galaxy.blackHole;
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
  const galaxy = getGraph(state);
  for (const star of galaxy.stars) {
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

export function hitTestFleetMarker(state, wx, wy, selectedBattleGroupId = null) {
  const halo = 18 / galaxyCamera.zoom;
  for (const marker of fleetTransitMarkersForGalaxy(state, selectedBattleGroupId)) {
    const dx = wx - marker.x;
    const dy = wy - marker.y;
    if (dx * dx + dy * dy <= halo * halo) return marker.groupId;
  }

  const galaxy = getGraph(state);
  const markersBySystem = new Map();
  for (const marker of fleetMarkersForGalaxy(state, selectedBattleGroupId)) {
    const list = markersBySystem.get(marker.systemId) ?? [];
    list.push(marker);
    markersBySystem.set(marker.systemId, list);
  }

  for (const star of galaxy.stars) {
    const markers = markersBySystem.get(star.id);
    if (!markers?.length) continue;
    const nodeR = starNodeRadius(state, star.id);
    for (let idx = 0; idx < markers.length; idx++) {
      const mx = star.x - nodeR - 12 - idx * 22;
      const my = star.y + nodeR + 12;
      const dx = wx - mx;
      const dy = wy - my;
      if (dx * dx + dy * dy <= halo * halo) return markers[idx].groupId;
    }
  }
  return null;
}
