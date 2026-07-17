// Horizontal left-to-right tech tree — center spine with many branch rows.
// Each lane is a single horizontal track (no vertical stacking within a lane).
// Colliding nodes nudge right so branches read left→right, not as piles.

import { derivedTier, isSpineTech, TECH_SPINE_IDS, techNode } from './tech-web.js';

/**
 * Vertical categories (top → bottom). Spine stays centered —
 * equal lane count above and below so the tree reads balanced.
 */
export const TECH_LANE_ORDER = [
  // Above spine (6)
  'mil_capital',
  'mil_carrier',
  'mil_screen',
  'mil_defense',
  'economy',
  'trade',
  // Center
  'spine',
  // Below spine (6)
  'hull_mods',
  'sw_modes',
  'research',
  'wormhole',
  'diplomacy',
  'flagship',
];

export const TECH_LANE_LABELS = Object.freeze({
  mil_capital: 'Capitals',
  mil_carrier: 'Carriers',
  mil_screen: 'Escorts',
  mil_defense: 'Defense',
  hull_mods: 'Hull Forge',
  economy: 'Economy',
  trade: 'Trade',
  spine: 'Main Path',
  sw_modes: 'Strategy',
  research: 'Research',
  wormhole: 'Wormhole',
  diplomacy: 'Diplomacy',
  flagship: 'Flagship',
});

/** Fallback cluster → lane when id heuristics do not match. */
export const CLUSTER_TO_LANE = Object.freeze({
  military: 'mil_capital',
  economy: 'economy',
  trade: 'trade',
  megastructure: 'economy',
  research: 'research',
  wormhole: 'wormhole',
  diplomacy: 'diplomacy',
  flagship: 'flagship',
  superweapon: 'sw_modes',
});

/** @deprecated cluster band API — kept for legend filters. */
export const TECH_CLUSTER_ORDER = [
  'economy',
  'military',
  'megastructure',
  'trade',
  'wormhole',
  'research',
  'diplomacy',
  'superweapon',
  'flagship',
];

export const CLUSTER_BAND = Object.fromEntries(
  TECH_CLUSTER_ORDER.map((clusterId, index) => [clusterId, index]),
);

export const LANE_BAND = Object.fromEntries(
  TECH_LANE_ORDER.map((laneId, index) => [laneId, index]),
);

export const NODE_SIZE = 52;
export const SPINE_NODE_SIZE = 64;
export const COL_WIDTH = 300;
export const LANE_HEIGHT = 100;
export const SPINE_LANE_HEIGHT = 118;
export const NODE_GAP = 56;
export const PADDING_X = 180;
export const PADDING_Y = 64;

/** @deprecated kept for callers expecting BAND_HEIGHT */
export const BAND_HEIGHT = LANE_HEIGHT;

const CAPITAL_IDS = new Set([
  'mil_destroyer_unlock', 'mil_destroyer_torpedoes',
  'mil_frigate_unlock', 'mil_frigate_alloy',
  'mil_cruiser_unlock', 'mil_cruiser_beams', 'mil_command_cruiser',
  'mil_battleship_unlock', 'mil_battleship_siege',
  'mil_dreadnought_unlock', 'mil_dreadnought_plate',
  'mil_war_doctrine', 'mil_fleet_academy', 'mil_tri_dock',
  'mil_capital_refit_hub', 'mil_armada_doctrine', 'war_doctrine_hub',
]);

const CARRIER_IDS = new Set([
  'mil_light_carrier', 'mil_carrier_hangar', 'mil_fleet_carrier',
  'mil_carrier_bombers', 'mil_super_carrier', 'mil_fighter_factory',
  'mil_carrier_command', 'mil_carrier_package_hub',
]);

const SCREEN_IDS = new Set([
  'mil_parallel_dock', 'mil_corvette_hardening', 'mil_patrol_cutter',
  'mil_point_defense', 'mil_healer_tech', 'mil_healer_hospital',
  'mil_sensor_ship', 'mil_builder_ship', 'mil_escort_screen_hub',
]);

const DEFENSE_IDS = new Set([
  'mil_drydock', 'mil_orbital_defense', 'mil_shield_generator',
  'mil_ion_battery', 'mil_missile_silo_network', 'mil_gravitic_interdiction',
  'mil_orbital_sensor_arrays', 'mil_fortress_doctrine',
]);

const HULL_MOD_IDS = new Set([
  'fs_hull_frame', 'fs_hull_drives', 'fs_hull_arsenal',
  'fs_hull_command', 'fs_hull_sovereign',
  'fs_mobile_shipyard', 'fs_jump_charge', 'fs_diplomacy_aura', 'fs_sovereignty_doctrine',
]);

export function laneForNode(node) {
  if (!node) return 'economy';
  if (isSpineTech(node) || node.tags?.includes('spine')) return 'spine';
  const id = node.id;
  if (CAPITAL_IDS.has(id)) return 'mil_capital';
  if (CARRIER_IDS.has(id)) return 'mil_carrier';
  if (SCREEN_IDS.has(id)) return 'mil_screen';
  if (DEFENSE_IDS.has(id)) return 'mil_defense';
  if (HULL_MOD_IDS.has(id) || /^fs_hull_/.test(id)) return 'hull_mods';
  if (node.cluster === 'military') {
    if (/carrier|hangar|bomber|fighter/.test(id)) return 'mil_carrier';
    if (/defense|shield|silo|interdiction|drydock|ion|sensor_array/.test(id)) return 'mil_defense';
    if (/patrol|healer|corvette|parallel|point_defense|builder|sensor_ship/.test(id)) return 'mil_screen';
    return 'mil_capital';
  }
  return CLUSTER_TO_LANE[node.cluster] ?? 'economy';
}

function nodeSizeFor(node) {
  return isSpineTech(node) || node?.tags?.includes('spine') ? SPINE_NODE_SIZE : NODE_SIZE;
}

function preferredColumn(node) {
  if (isSpineTech(node)) {
    const spineIdx = TECH_SPINE_IDS.indexOf(node.id);
    if (spineIdx >= 0) return spineIdx;
  }
  return Math.max(0, derivedTier(node.id) - 1);
}

/**
 * Lay out nodes as horizontal branch tracks.
 * - One Y per lane (no stacks)
 * - X = max(prereq X) + COL_WIDTH, then slide right on collision
 * - Spine stays a single centered row
 */
export function layoutHorizontalTree(nodes) {
  const positions = new Map();
  const byLane = new Map(TECH_LANE_ORDER.map((lane) => [lane, []]));

  for (const node of nodes) {
    const lane = laneForNode(node);
    if (!byLane.has(lane)) byLane.set(lane, []);
    byLane.get(lane).push(node);
  }

  // Band centers: fixed height per lane (no stack inflation).
  const bandCenters = new Map();
  let accY = PADDING_Y;
  for (const laneId of TECH_LANE_ORDER) {
    const band = LANE_BAND[laneId];
    const h = laneId === 'spine' ? SPINE_LANE_HEIGHT : LANE_HEIGHT;
    bandCenters.set(band, accY + h / 2);
    accY += h;
  }
  const totalHeight = accY + PADDING_Y;

  // Place spine first so branch prereqs can lock to spine X.
  const spineNodes = (byLane.get('spine') ?? []).slice().sort(
    (a, b) => TECH_SPINE_IDS.indexOf(a.id) - TECH_SPINE_IDS.indexOf(b.id),
  );
  let spineLastRight = PADDING_X;
  for (let i = 0; i < spineNodes.length; i++) {
    const node = spineNodes[i];
    const size = nodeSizeFor(node);
    let x = PADDING_X + preferredColumn(node) * COL_WIDTH + size / 2;
    // Keep spine nodes in order and non-overlapping.
    const minX = spineLastRight + NODE_GAP + size / 2;
    if (x < minX) x = minX;
    // Also sit to the right of any already-placed prereqs.
    for (const p of node.prereqs ?? []) {
      const pp = positions.get(p);
      if (pp) x = Math.max(x, pp.x + COL_WIDTH);
    }
    const y = bandCenters.get(LANE_BAND.spine);
    positions.set(node.id, { x, y, size, lane: 'spine', spine: true });
    spineLastRight = x + size / 2;
  }

  // Place each branch lane as a single horizontal track.
  for (const laneId of TECH_LANE_ORDER) {
    if (laneId === 'spine') continue;
    const laneNodes = (byLane.get(laneId) ?? []).slice().sort((a, b) => {
      const ta = preferredColumn(a);
      const tb = preferredColumn(b);
      if (ta !== tb) return ta - tb;
      return a.id.localeCompare(b.id);
    });

    // Kahn-ish: repeatedly place any node whose prereqs are placed (or outside).
    const pending = new Set(laneNodes.map((n) => n.id));
    const y = bandCenters.get(LANE_BAND[laneId]);
    let guard = laneNodes.length * 3 + 5;
    let lastRight = PADDING_X;

    while (pending.size && guard-- > 0) {
      let placedAny = false;
      for (const node of laneNodes) {
        if (!pending.has(node.id)) continue;
        const prereqsReady = (node.prereqs ?? []).every((p) => {
          if (positions.has(p)) return true;
          // Prereq in another lane not yet placed — wait only if same lane.
          const pNode = techNode(p);
          return !pNode || laneForNode(pNode) !== laneId;
        });
        if (!prereqsReady) continue;

        const size = nodeSizeFor(node);
        let x = PADDING_X + preferredColumn(node) * COL_WIDTH + size / 2;
        for (const p of node.prereqs ?? []) {
          const pp = positions.get(p);
          if (!pp) continue;
          x = Math.max(x, pp.x + COL_WIDTH);
        }
        // Slide right within this lane — never stack vertically.
        const minX = lastRight + NODE_GAP + size / 2;
        if (x < minX) x = minX;

        positions.set(node.id, {
          x,
          y,
          size,
          lane: laneId,
          spine: false,
        });
        lastRight = x + size / 2;
        pending.delete(node.id);
        placedAny = true;
      }
      if (!placedAny) {
        // Cycle / cross-lane deadlock — force-place remaining by preferred col.
        for (const node of laneNodes) {
          if (!pending.has(node.id)) continue;
          const size = nodeSizeFor(node);
          let x = Math.max(
            PADDING_X + preferredColumn(node) * COL_WIDTH + size / 2,
            lastRight + NODE_GAP + size / 2,
          );
          positions.set(node.id, { x, y, size, lane: laneId, spine: false });
          lastRight = x + size / 2;
          pending.delete(node.id);
        }
      }
    }
  }

  let maxX = PADDING_X;
  for (const pos of positions.values()) {
    maxX = Math.max(maxX, pos.x + pos.size / 2);
  }

  return {
    positions,
    width: maxX + PADDING_X,
    height: totalHeight,
    bandCenters,
    laneCenters: bandCenters,
  };
}

/** Ancestor chain from roots to nodeId (inclusive), for path highlighting. */
export function ancestorChain(nodeId, lookup) {
  const get = typeof lookup === 'function'
    ? (id) => lookup(id)
    : (id) => lookup?.get?.(id) ?? lookup?.[id] ?? null;
  const chain = [];
  const seen = new Set();
  function walk(id) {
    if (!id || seen.has(id)) return;
    seen.add(id);
    const node = get(id);
    if (!node) return;
    for (const p of node.prereqs ?? []) walk(p);
    chain.push(id);
  }
  walk(nodeId);
  return chain;
}
