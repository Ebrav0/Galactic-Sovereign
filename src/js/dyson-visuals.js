// Dyson megastructure visuals — supply ties, sail dot slots, in-flight particles (never serialized).

import {
  SHELL_SAILS_REQUIRED,
  SHELL_COUNT,
  LAUNCHER_BATCH_SIZE,
  LAUNCHER_BURST_MS,
  SAIL_LAUNCH_FLIGHT_MS,
  SAIL_LAUNCH_STAGGER_MS,
  SAIL_DOT_LOD_ZOOM,
  SAIL_DOT_DRAW_MAX,
  SAIL_DOT_LOD_STRIDE_TARGET,
  CELESTIAL_VISUAL_SCALE,
} from './constants.js';
import {
  systemById,
  hasFoundry,
  dysonLaunchers,
  ensureDyson,
  hashSeed,
} from './state.js';
import { foundryAnchor } from './sail-shuttles.js';
import { launcherSiteById } from './structure-sites.js';

/** Closest point on foundry equatorial ring toward a target. */
export function foundryRingClosestPoint(planetX, planetY, ringR, targetX, targetY) {
  const angle = Math.atan2(targetY - planetY, targetX - planetX);
  return {
    x: planetX + Math.cos(angle) * ringR,
    y: planetY + Math.sin(angle) * ringR,
    angle,
  };
}

/** 1-based completed shell tier → world orbit radius around star at origin. */
export function shellOrbitRadius(starRadius, shellTier) {
  const visualR = starRadius * CELESTIAL_VISUAL_SCALE;
  return visualR * (1.08 + shellTier * 0.06);
}

/** Slot on the in-progress shell ring (slot 0 .. SHELL_SAILS_REQUIRED-1). */
export function inProgressSailDotPosition(slot, completedShells, starRadius) {
  const shellTier = completedShells + 1;
  const orbitR = shellOrbitRadius(starRadius, shellTier);
  const jitter = ((hashSeed(0xca01 + completedShells, String(slot)) % 1000) / 1000) * 0.00002;
  const angle = (slot / SHELL_SAILS_REQUIRED) * Math.PI * 2 + jitter;
  return {
    x: Math.cos(angle) * orbitR,
    y: Math.sin(angle) * orbitR,
    slot,
    shellTier,
    orbitR,
    angle,
  };
}

export function sailDotDrawStride(settledCount, zoom) {
  if (settledCount <= 0) return 1;
  if (zoom >= SAIL_DOT_LOD_ZOOM && settledCount <= SAIL_DOT_DRAW_MAX) return 1;
  if (zoom < SAIL_DOT_LOD_ZOOM) {
    return Math.max(1, Math.ceil(settledCount / SAIL_DOT_LOD_STRIDE_TARGET));
  }
  return Math.max(1, Math.ceil(settledCount / SAIL_DOT_DRAW_MAX));
}

export function foundryLauncherSupplyLines(state, systemId, time = state.time) {
  const fa = foundryAnchor(state, systemId, time);
  if (!fa.foundryId || !fa.planetId) return [];

  const launchers = dysonLaunchers(state, systemId);
  return launchers.map((launcher) => {
    const site = launcherSiteById(state, systemId, launcher.id, time);
    if (!site) return null;
    const from = foundryRingClosestPoint(fa.planetX, fa.planetY, fa.ringR, site.dockX, site.dockY);
    return {
      launcherId: launcher.id,
      fromX: from.x,
      fromY: from.y,
      toX: site.dockX,
      toY: site.dockY,
      fromAngle: from.angle,
    };
  }).filter(Boolean);
}

export function settledInProgressDots(state, systemId, starRadius) {
  const system = systemById(state, systemId);
  if (!system) return [];
  const dyson = ensureDyson(system);
  if (dyson.completedShells >= SHELL_COUNT) return [];

  const count = Math.floor(dyson.shellSails);
  const dots = [];
  for (let slot = 0; slot < count; slot++) {
    const pos = inProgressSailDotPosition(slot, dyson.completedShells, starRadius);
    dots.push({ ...pos, settled: true, progress: 1 });
  }
  return dots;
}

export function inFlightSailDots(state, systemId, starRadius, time = state.time) {
  const system = systemById(state, systemId);
  if (!system || !hasFoundry(state, systemId)) return [];

  const dyson = ensureDyson(system);
  if (dyson.completedShells >= SHELL_COUNT) return [];

  const launchers = dysonLaunchers(state, systemId);
  const dots = [];
  const sailsNow = Math.floor(dyson.shellSails);

  for (const launcher of launchers) {
    const site = launcherSiteById(state, systemId, launcher.id, time);
    if (!site) continue;

    const age = time - (dyson.launcherLastFireAt?.[launcher.id] ?? -1e9);
    if (age < 0 || age >= SAIL_LAUNCH_FLIGHT_MS + LAUNCHER_BATCH_SIZE * SAIL_LAUNCH_STAGGER_MS) {
      continue;
    }

    for (let k = 0; k < LAUNCHER_BATCH_SIZE; k++) {
      const stagger = k * SAIL_LAUNCH_STAGGER_MS;
      const localAge = age - stagger;
      if (localAge < 0 || localAge >= SAIL_LAUNCH_FLIGHT_MS) continue;

      const slot = sailsNow - LAUNCHER_BATCH_SIZE + k;
      if (slot < 0 || slot >= SHELL_SAILS_REQUIRED) continue;

      const progress = Math.min(1, Math.max(0, localAge / SAIL_LAUNCH_FLIGHT_MS));
      const target = inProgressSailDotPosition(slot, dyson.completedShells, starRadius);
      const eased = progress * progress * (3 - 2 * progress);
      dots.push({
        x: site.muzzleX + (target.x - site.muzzleX) * eased,
        y: site.muzzleY + (target.y - site.muzzleY) * eased,
        slot,
        progress: eased,
        settled: false,
        launcherId: launcher.id,
        distToStar: Math.hypot(
          site.muzzleX + (target.x - site.muzzleX) * eased,
          site.muzzleY + (target.y - site.muzzleY) * eased,
        ),
      });
    }
  }

  return dots;
}

/** Completed shell tier radii for tests (1-based tiers). */
export function completedShellRingRadii(starRadius, completedShells) {
  const radii = [];
  for (let tier = 1; tier <= completedShells; tier++) {
    radii.push(Math.round(shellOrbitRadius(starRadius, tier) * 10) / 10);
  }
  return radii;
}

export function dysonVisualSummary(state, systemId, starRadius, zoom) {
  const system = systemById(state, systemId);
  const dyson = system ? ensureDyson(system) : null;
  const settled = dyson ? settledInProgressDots(state, systemId, starRadius) : [];
  const inFlight = dyson ? inFlightSailDots(state, systemId, starRadius) : [];
  const supplyLines = hasFoundry(state, systemId)
    ? foundryLauncherSupplyLines(state, systemId)
    : [];
  const inProgressSettledDots = settled.length;
  const dotStride = sailDotDrawStride(inProgressSettledDots, zoom ?? 1);

  const firstLine = supplyLines[0] ?? null;
  const firstLauncher = firstLine
    ? launcherSiteById(state, systemId, firstLine.launcherId)
    : null;

  return {
    supplyLineCount: supplyLines.length,
    completedRingCount: dyson?.completedShells ?? 0,
    inProgressSettledDots,
    inFlightDots: inFlight.length,
    totalDotEquivalent: inProgressSettledDots,
    dotStride,
    currentShellProgress: dyson
      ? Math.round((Math.floor(dyson.shellSails) / SHELL_SAILS_REQUIRED) * 1000) / 1000
      : 0,
    completedRingRadii: dyson ? completedShellRingRadii(starRadius, dyson.completedShells) : [],
    supplyLines: supplyLines.map((l) => ({
      launcherId: l.launcherId,
      fromX: Math.round(l.fromX * 10) / 10,
      fromY: Math.round(l.fromY * 10) / 10,
      toX: Math.round(l.toX * 10) / 10,
      toY: Math.round(l.toY * 10) / 10,
    })),
    closestRingPoint: firstLine
      ? { x: Math.round(firstLine.fromX * 10) / 10, y: Math.round(firstLine.fromY * 10) / 10 }
      : null,
    firstLauncherDock: firstLauncher
      ? { x: Math.round(firstLauncher.dockX * 10) / 10, y: Math.round(firstLauncher.dockY * 10) / 10 }
      : null,
    inFlightSample: inFlight.slice(0, 3).map((d) => ({
      progress: Math.round(d.progress * 1000) / 1000,
      distToStar: Math.round(d.distToStar * 10) / 10,
    })),
    inFlightProgress: inFlight.map((d) => Math.round(d.progress * 1000) / 1000),
    inFlightDistToStar: inFlight.map((d) => Math.round(d.distToStar * 10) / 10),
    shellSails: dyson ? Math.floor(dyson.shellSails) : 0,
  };
}

/** Whether a world point lies near the segment from ring point to launcher dock. */
export function pointNearSupplySegment(px, py, fromX, fromY, toX, toY, tolerance = 8) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const lenSq = dx * dx + dy * dy || 1;
  let t = ((px - fromX) * dx + (py - fromY) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const nx = fromX + t * dx;
  const ny = fromY + t * dy;
  return Math.hypot(px - nx, py - ny) <= tolerance;
}
