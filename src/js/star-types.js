// Star type definitions — generation weights, palettes, and visual profiles.
// Used by state generation and celestial rendering (galaxy + system views).

import { STAR_RADIUS } from './constants.js';

/** @typedef {'granulation'|'sunspots'|'prominences'|'lensSpikes'|'diffuseHalo'|'flareBursts'|'compactCore'|'lightning'} StarFeature */

/**
 * @typedef {Object} StarTypeProfile
 * @property {string} id
 * @property {string} color
 * @property {string} secondaryColor
 * @property {string} coronaColor
 * @property {[number, number]} radiusRange
 * @property {number} glowScale
 * @property {number} pulseSpeed
 * @property {number} rotationSpeed
 * @property {StarFeature[]} features
 * @property {number} weight
 * @property {number} nodeSizeBonus
 */

/** @type {Record<string, StarTypeProfile>} */
export const STAR_TYPES = {
  yellow_dwarf: {
    id: 'yellow_dwarf',
    color: '#ffd27a',
    secondaryColor: '#ffb46b',
    coronaColor: '#ffe9a8',
    radiusRange: [155, 205],
    glowScale: 3.2,
    pulseSpeed: 0.0003,
    rotationSpeed: 0.000014,
    features: ['granulation', 'sunspots', 'prominences', 'lightning'],
    weight: 22,
    nodeSizeBonus: 0,
  },
  orange_dwarf: {
    id: 'orange_dwarf',
    color: '#ffb46b',
    secondaryColor: '#e88840',
    coronaColor: '#ffd090',
    radiusRange: [130, 170],
    glowScale: 2.8,
    pulseSpeed: 0.0004,
    rotationSpeed: 0.000016,
    features: ['granulation', 'sunspots', 'prominences', 'lightning'],
    weight: 16,
    nodeSizeBonus: 0,
  },
  red_dwarf: {
    id: 'red_dwarf',
    color: '#ff6b4a',
    secondaryColor: '#cc4030',
    coronaColor: '#ff9070',
    radiusRange: [105, 135],
    glowScale: 2.2,
    pulseSpeed: 0.00095,
    rotationSpeed: 0.000048,
    features: ['compactCore', 'sunspots', 'lightning'],
    weight: 14,
    nodeSizeBonus: -1,
  },
  white_main: {
    id: 'white_main',
    color: '#f0f4ff',
    secondaryColor: '#c8d4f0',
    coronaColor: '#ffffff',
    radiusRange: [145, 185],
    glowScale: 3.4,
    pulseSpeed: 0.0005,
    rotationSpeed: 0.000028,
    features: ['lensSpikes', 'sunspots', 'granulation', 'lightning'],
    weight: 10,
    nodeSizeBonus: 0,
  },
  blue_white: {
    id: 'blue_white',
    color: '#9fc7ff',
    secondaryColor: '#6a9ee8',
    coronaColor: '#cfe3ff',
    radiusRange: [160, 220],
    glowScale: 3.8,
    pulseSpeed: 0.00042,
    rotationSpeed: 0.000042,
    features: ['lensSpikes', 'diffuseHalo', 'lightning'],
    weight: 8,
    nodeSizeBonus: 1,
  },
  blue_giant: {
    id: 'blue_giant',
    color: '#7ab0ff',
    secondaryColor: '#4a78d8',
    coronaColor: '#a8c8ff',
    radiusRange: [195, 238],
    glowScale: 4.5,
    pulseSpeed: 0.00035,
    rotationSpeed: 0.000022,
    features: ['lensSpikes', 'diffuseHalo', 'prominences', 'lightning'],
    weight: 5,
    nodeSizeBonus: 3,
  },
  red_giant: {
    id: 'red_giant',
    color: '#ff7040',
    secondaryColor: '#cc4020',
    coronaColor: '#ff9060',
    radiusRange: [205, 245],
    glowScale: 4.8,
    pulseSpeed: 0.00022,
    rotationSpeed: 0.000008,
    features: ['diffuseHalo', 'prominences', 'granulation', 'lightning'],
    weight: 6,
    nodeSizeBonus: 3,
  },
  subgiant: {
    id: 'subgiant',
    color: '#ff9d7a',
    secondaryColor: '#e87050',
    coronaColor: '#ffb890',
    radiusRange: [175, 215],
    glowScale: 3.5,
    pulseSpeed: 0.0006,
    rotationSpeed: 0.000024,
    features: ['diffuseHalo', 'prominences', 'lightning'],
    weight: 5,
    nodeSizeBonus: 2,
  },
  white_dwarf: {
    id: 'white_dwarf',
    color: '#e8eeff',
    secondaryColor: '#b8c8e8',
    coronaColor: '#c8b0ff',
    radiusRange: [70, 95],
    glowScale: 2.0,
    pulseSpeed: 0.00085,
    rotationSpeed: 0.000055,
    features: ['compactCore', 'lightning'],
    weight: 0,
    nodeSizeBonus: -1,
  },
  flare_star: {
    id: 'flare_star',
    color: '#ff5840',
    secondaryColor: '#cc3020',
    coronaColor: '#ff8060',
    radiusRange: [100, 130],
    glowScale: 2.6,
    pulseSpeed: 0.0016,
    rotationSpeed: 0.000058,
    features: ['compactCore', 'sunspots', 'lightning'],
    weight: 4,
    nodeSizeBonus: -1,
  },
};

const TYPE_LIST = Object.values(STAR_TYPES);
const GENERATION_POOL = TYPE_LIST.filter((t) => t.weight > 0);
const DEAD_STAR_TYPES = ['white_dwarf', 'subgiant'];

const LEGACY_COLOR_MAP = {
  '#ffd27a': 'yellow_dwarf',
  '#ffb46b': 'orange_dwarf',
  '#ffe9a8': 'yellow_dwarf',
  '#9fc7ff': 'blue_white',
  '#ff9d7a': 'subgiant',
  '#cfe3ff': 'blue_white',
};

function rangeFromProfile(rng, [min, max]) {
  return Math.round(min + rng() * (max - min));
}

/**
 * Pick a star type for procedural generation.
 * @param {() => number} rng
 * @param {{ isHome?: boolean, isDead?: boolean }} opts
 */
export function pickStarType(rng, { isHome = false, isDead = false } = {}) {
  if (isHome) return STAR_TYPES.yellow_dwarf;
  if (isDead) {
    const id = DEAD_STAR_TYPES[Math.floor(rng() * DEAD_STAR_TYPES.length)];
    return STAR_TYPES[id];
  }

  let roll = rng();
  let acc = 0;
  const total = GENERATION_POOL.reduce((s, t) => s + t.weight, 0);
  for (const profile of GENERATION_POOL) {
    acc += profile.weight / total;
    if (roll <= acc) return profile;
  }
  return STAR_TYPES.yellow_dwarf;
}

/**
 * Resolve star type from save data (explicit type or legacy heuristics).
 * @param {{ type?: string, color?: string, radius?: number, kind?: string }} star
 */
export function resolveStarType(star) {
  if (star?.kind === 'blackhole') return null;
  if (star?.type && STAR_TYPES[star.type]) return STAR_TYPES[star.type];

  const color = (star?.color ?? '').toLowerCase();
  if (LEGACY_COLOR_MAP[color]) return STAR_TYPES[LEGACY_COLOR_MAP[color]];

  const radius = star?.radius ?? 175;
  if (radius <= 100) {
    if (color.includes('ff') && parseInt(color.slice(3, 5), 16) < 0x60) return STAR_TYPES.flare_star;
    return STAR_TYPES.white_dwarf;
  }
  if (radius >= 205) {
    if (color.includes('7a') || color.includes('ff') && parseInt(color.slice(1, 3), 16) > 0xcc) {
      return radius >= 220 ? STAR_TYPES.blue_giant : STAR_TYPES.red_giant;
    }
    return STAR_TYPES.red_giant;
  }
  if (radius >= 188) return STAR_TYPES.subgiant;
  if (radius <= 135) return STAR_TYPES.red_dwarf;
  if (color.includes('9f') || color.includes('cf') || color.includes('7a')) return STAR_TYPES.blue_white;
  if (color.includes('f0') || color.includes('e8')) return STAR_TYPES.white_main;
  if (color.includes('ff') && parseInt(color.slice(3, 5), 16) < 0x90) return STAR_TYPES.orange_dwarf;
  return STAR_TYPES.yellow_dwarf;
}

/** @param {{ type?: string, color?: string, radius?: number, kind?: string }} star */
export function getStarVisualProfile(star) {
  if (star?.kind === 'blackhole') return null;
  return resolveStarType(star) ?? STAR_TYPES.yellow_dwarf;
}

/** @param {{ type?: string, color?: string, radius?: number, kind?: string }} star */
export function typeSizeBonus(star) {
  const profile = getStarVisualProfile(star);
  return profile?.nodeSizeBonus ?? 0;
}

/**
 * Build star object fields from a type profile.
 * @param {StarTypeProfile} profile
 * @param {() => number} rng
 * @param {{ isHome?: boolean }} opts
 */
export function starFieldsFromType(profile, rng, { isHome = false } = {}) {
  const radius = isHome ? STAR_RADIUS : rangeFromProfile(rng, profile.radiusRange);
  return {
    type: profile.id,
    radius,
    color: profile.color,
  };
}

const FEATURE_BITS = {
  granulation: 1,
  sunspots: 2,
  lensSpikes: 4,
  diffuseHalo: 8,
  flareBursts: 16,
  compactCore: 32,
  prominences: 64,
  lightning: 128,
};

const TEMPERATURE_BY_TYPE = {
  yellow_dwarf: 0.55,
  orange_dwarf: 0.48,
  red_dwarf: 0.35,
  white_main: 0.82,
  blue_white: 0.92,
  blue_giant: 0.95,
  red_giant: 0.42,
  subgiant: 0.52,
  white_dwarf: 0.78,
  flare_star: 0.38,
};

const TURBULENCE_BY_TYPE = {
  yellow_dwarf: 0.4,
  orange_dwarf: 0.45,
  red_dwarf: 0.25,
  white_main: 0.35,
  blue_white: 0.65,
  blue_giant: 0.85,
  red_giant: 0.9,
  subgiant: 0.7,
  white_dwarf: 0.15,
  flare_star: 0.55,
};

/** Pack star feature flags into a GPU bitfield. */
export function starFeatureBits(profile) {
  let bits = 0;
  for (const f of profile?.features ?? []) {
    bits |= FEATURE_BITS[f] ?? 0;
  }
  return bits;
}

/** Derive GPU shader uniforms from a star type profile. */
export function starGpuUniforms(profile) {
  const hasLens = profile?.features?.includes('lensSpikes');
  const hasHalo = profile?.features?.includes('diffuseHalo');
  return {
    temperature: TEMPERATURE_BY_TYPE[profile?.id] ?? 0.5,
    coronaIntensity: (profile?.glowScale ?? 2.5) / 4.5 * (hasHalo ? 1.3 : 1.0),
    lensStrength: hasLens ? 0.85 : 0.0,
    turbulence: TURBULENCE_BY_TYPE[profile?.id] ?? 0.5,
  };
}

/** Backfill star.type on all systems (save migration). */
export function backfillStarTypes(state) {
  for (const id of Object.keys(state.systems)) {
    const star = state.systems[id].star;
    if (!star || star.kind === 'blackhole') continue;
    if (!star.type) {
      star.type = resolveStarType(star).id;
    }
  }
}
