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
 * @property {string} displayName
 * @property {string} description
 * @property {'convective'|'giant'|'compact'|'binary'|'supergiant'|'pulsar'|'quasar'|'brown_dwarf'|'neutron'|'magnetar'|'wolf_rayet'|'hypergiant'|'black_hole_binary'} rendererKind
 * @property {number} visualExtent
 * @property {number} exposure
 * @property {number} chromaticStrength
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
    features: ['granulation', 'sunspots', 'prominences', 'flareBursts', 'lightning'],
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
    features: ['granulation', 'sunspots', 'prominences', 'flareBursts', 'lightning'],
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
    features: ['compactCore', 'granulation', 'sunspots', 'prominences', 'flareBursts', 'lightning'],
    weight: 14,
    nodeSizeBonus: -1,
  },
  brown_dwarf: {
    id: 'brown_dwarf',
    color: '#9b5038',
    secondaryColor: '#4b2640',
    coronaColor: '#d67b58',
    radiusRange: [82, 112],
    glowScale: 1.8,
    pulseSpeed: 0.00028,
    rotationSpeed: 0.000052,
    features: ['granulation', 'diffuseHalo', 'lightning'],
    weight: 10,
    nodeSizeBonus: -2,
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
    features: ['lensSpikes', 'diffuseHalo', 'prominences', 'flareBursts', 'lightning'],
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
  neutron_star: {
    id: 'neutron_star',
    color: '#f7fbff',
    secondaryColor: '#78cfff',
    coronaColor: '#a88cff',
    radiusRange: [50, 66],
    glowScale: 3.8,
    pulseSpeed: 0.0014,
    rotationSpeed: 0.00034,
    features: ['compactCore', 'lensSpikes', 'diffuseHalo', 'lightning'],
    weight: 5,
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
    features: ['compactCore', 'granulation', 'sunspots', 'flareBursts', 'lightning'],
    weight: 4,
    nodeSizeBonus: -1,
  },
  magnetar: {
    id: 'magnetar',
    color: '#f4ecff',
    secondaryColor: '#a86dff',
    coronaColor: '#69ddff',
    radiusRange: [54, 70],
    glowScale: 5.4,
    pulseSpeed: 0.0032,
    rotationSpeed: 0.00072,
    features: ['compactCore', 'lensSpikes', 'diffuseHalo', 'flareBursts', 'lightning'],
    weight: 3,
    nodeSizeBonus: 0,
  },
  wolf_rayet: {
    id: 'wolf_rayet',
    color: '#d7ecff',
    secondaryColor: '#699cff',
    coronaColor: '#eaf8ff',
    radiusRange: [175, 220],
    glowScale: 5.6,
    pulseSpeed: 0.00062,
    rotationSpeed: 0.000058,
    features: ['lensSpikes', 'diffuseHalo', 'prominences', 'flareBursts', 'lightning'],
    weight: 4,
    nodeSizeBonus: 3,
  },
  binary: {
    id: 'binary',
    color: '#ffd9a0',
    secondaryColor: '#79b8ff',
    coronaColor: '#eef6ff',
    radiusRange: [155, 205],
    glowScale: 4.2,
    pulseSpeed: 0.00055,
    rotationSpeed: 0.00004,
    features: ['lensSpikes', 'diffuseHalo', 'prominences'],
    weight: 0,
    nodeSizeBonus: 2,
  },
  red_supergiant: {
    id: 'red_supergiant',
    color: '#ff5538',
    secondaryColor: '#b91f20',
    coronaColor: '#ff9a63',
    radiusRange: [245, 290],
    glowScale: 5.8,
    pulseSpeed: 0.00018,
    rotationSpeed: 0.000006,
    features: ['granulation', 'diffuseHalo', 'prominences', 'flareBursts', 'lightning'],
    weight: 0,
    nodeSizeBonus: 5,
  },
  blue_supergiant: {
    id: 'blue_supergiant',
    color: '#75aaff',
    secondaryColor: '#315ee8',
    coronaColor: '#d5e8ff',
    radiusRange: [235, 280],
    glowScale: 6.2,
    pulseSpeed: 0.00028,
    rotationSpeed: 0.000032,
    features: ['lensSpikes', 'diffuseHalo', 'prominences', 'flareBursts', 'lightning'],
    weight: 0,
    nodeSizeBonus: 5,
  },
  hypergiant: {
    id: 'hypergiant',
    color: '#ffb05f',
    secondaryColor: '#e83d47',
    coronaColor: '#ffd49a',
    radiusRange: [285, 330],
    glowScale: 7.2,
    pulseSpeed: 0.00016,
    rotationSpeed: 0.000005,
    features: ['granulation', 'diffuseHalo', 'prominences', 'flareBursts', 'lightning'],
    weight: 3,
    nodeSizeBonus: 7,
  },
  pulsar: {
    id: 'pulsar',
    color: '#e8f5ff',
    secondaryColor: '#6bd6ff',
    coronaColor: '#b78cff',
    radiusRange: [64, 82],
    glowScale: 4.8,
    pulseSpeed: 0.0048,
    rotationSpeed: 0.0012,
    features: ['compactCore', 'lensSpikes', 'diffuseHalo', 'lightning'],
    weight: 0,
    nodeSizeBonus: 1,
  },
  black_hole_system: {
    id: 'black_hole_system',
    color: '#ffd4a3',
    secondaryColor: '#ff744c',
    coronaColor: '#76ddff',
    radiusRange: [115, 150],
    glowScale: 6.8,
    pulseSpeed: 0.001,
    rotationSpeed: 0.00038,
    features: ['compactCore', 'lensSpikes', 'diffuseHalo', 'lightning'],
    weight: 2,
    nodeSizeBonus: 5,
  },
  quasar: {
    id: 'quasar',
    color: '#fff1d6',
    secondaryColor: '#ff8b4d',
    coronaColor: '#8fdcff',
    radiusRange: [105, 135],
    glowScale: 7.2,
    pulseSpeed: 0.0011,
    rotationSpeed: 0.0003,
    features: ['compactCore', 'lensSpikes', 'diffuseHalo'],
    weight: 0,
    nodeSizeBonus: 6,
  },
};

const PROFILE_META = {
  yellow_dwarf: ['Yellow Dwarf', 'A stable golden main-sequence star.', 'convective', 3.8, 1.0, 1.0],
  orange_dwarf: ['Orange Dwarf', 'A stable, long-lived star slightly smaller and cooler than a yellow dwarf.', 'convective', 3.6, 0.94, 0.8],
  red_dwarf: ['Red Dwarf', 'A small, cool, dim star that burns fuel slowly but can produce powerful flares.', 'convective', 3.3, 0.92, 0.7],
  brown_dwarf: ['Brown Dwarf', 'A stormy substellar object too small to sustain normal hydrogen fusion.', 'brown_dwarf', 4.2, 0.78, 0.72],
  white_main: ['White Main-Sequence Star', 'A brilliant white stellar furnace.', 'hot', 4.6, 1.08, 1.35],
  blue_white: ['Blue-White Star', 'A hot blue-white star with a hard corona.', 'hot', 5.0, 1.12, 1.5],
  blue_giant: ['Blue Giant', 'A massive blue star driving fierce stellar winds.', 'hot', 5.8, 1.2, 1.7],
  red_giant: ['Red Giant', 'An older star that has expanded enormously after depleting core hydrogen.', 'giant', 5.8, 1.08, 1.1],
  subgiant: ['Subgiant', 'A swelling star leaving the main sequence.', 'giant', 5.0, 1.02, 0.95],
  white_dwarf: ['White Dwarf', 'A hot, dense stellar remnant compressed to roughly planetary scale.', 'compact', 4.4, 1.16, 1.45],
  neutron_star: ['Neutron Star', 'A city-sized collapsed stellar core with extraordinary density and gravity.', 'neutron', 6.2, 1.24, 1.75],
  flare_star: ['Flare Star', 'A volatile red star throwing frequent plasma eruptions.', 'flare', 5.0, 1.08, 1.0],
  binary: ['Binary System', 'Two stars orbiting a shared barycenter.', 'binary', 5.4, 0.82, 1.55],
  red_supergiant: ['Red Supergiant', 'A colossal convective star shedding its outer layers.', 'supergiant', 6.4, 0.86, 1.2],
  blue_supergiant: ['Blue Supergiant', 'An intensely luminous star with violent ultraviolet winds.', 'supergiant', 6.8, 0.94, 1.9],
  hypergiant: ['Hypergiant', 'An enormous, unstable and short-lived star losing material at a tremendous rate.', 'hypergiant', 8.0, 0.9, 1.75],
  pulsar: ['Pulsar', 'A rapidly rotating compact remnant with sweeping polar beams.', 'pulsar', 7.4, 1.35, 2.0],
  magnetar: ['Magnetar', 'A neutron star with an extreme magnetic field and violent starquake flares.', 'magnetar', 7.5, 1.35, 2.1],
  wolf_rayet: ['Wolf–Rayet Star', 'An extremely hot stripped star driving immense stellar winds before supernova.', 'wolf_rayet', 7.0, 1.15, 1.9],
  black_hole_system: ['Black-Hole System', 'A compact black hole stripping gas from an orbiting stellar companion.', 'black_hole_binary', 8.4, 1.2, 2.15],
  quasar: ['Quasar', 'A rare active compact object with a relativistic accretion disc.', 'quasar', 8.2, 1.4, 2.1],
};

for (const [id, values] of Object.entries(PROFILE_META)) {
  const profile = STAR_TYPES[id];
  if (!profile) continue;
  [profile.displayName, profile.description, profile.rendererKind,
    profile.visualExtent, profile.exposure, profile.chromaticStrength] = values;
}

export const CANONICAL_STAR_TYPES = Object.freeze([
  'yellow_dwarf', 'orange_dwarf', 'red_dwarf', 'brown_dwarf', 'red_giant', 'white_dwarf',
  'neutron_star', 'pulsar', 'magnetar', 'wolf_rayet', 'red_supergiant', 'blue_supergiant',
  'hypergiant', 'black_hole_system', 'binary', 'quasar',
]);

export const EXOTIC_STAR_TYPES = Object.freeze([
  'neutron_star', 'pulsar', 'magnetar', 'wolf_rayet', 'red_supergiant', 'blue_supergiant',
  'hypergiant', 'black_hole_system', 'binary', 'quasar',
]);

function stableHash(seed, key) {
  let h = (Number(seed) >>> 0) ^ 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function hashUnit(seed, key) {
  // FNV is fast and stable, but sequential system ids retain visible low-bit
  // correlation. Avalanche once more before applying rarity thresholds so a
  // real 400-node galaxy follows the intended distribution.
  let h = stableHash(seed, key);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const CATALOG_WEIGHTS = Object.freeze({
  yellow_dwarf: 12,
  orange_dwarf: 15,
  red_dwarf: 18,
  brown_dwarf: 10,
  red_giant: 8,
  white_dwarf: 7,
  neutron_star: 5,
  pulsar: 4,
  magnetar: 3,
  wolf_rayet: 4,
  red_supergiant: 1.5,
  blue_supergiant: 1.5,
  hypergiant: 3,
  black_hole_system: 2,
  binary: 5,
  quasar: 1,
});

export const STELLAR_GENERATION_PROFILES = Object.freeze({
  yellow_dwarf: { planetlessChance: 0.10, planetCount: [2, 5], planetWeights: [0.40, 0.30, 0.30], environmentWeights: [0.80, 0.08, 0.04, 0.08], solarii: 1.00 },
  orange_dwarf: { planetlessChance: 0.08, planetCount: [2, 5], planetWeights: [0.45, 0.25, 0.30], environmentWeights: [0.84, 0.08, 0.02, 0.06], solarii: 0.98 },
  red_dwarf: { planetlessChance: 0.12, planetCount: [1, 4], planetWeights: [0.25, 0.45, 0.30], environmentWeights: [0.72, 0.08, 0.12, 0.08], solarii: 0.92 },
  brown_dwarf: { planetlessChance: 0.18, planetCount: [1, 4], planetWeights: [0.10, 0.45, 0.45], environmentWeights: [0.70, 0.12, 0.03, 0.15], solarii: 0.85 },
  red_giant: { planetlessChance: 0.22, planetCount: [1, 4], planetWeights: [0.12, 0.50, 0.38], environmentWeights: [0.55, 0.20, 0.05, 0.20], solarii: 1.03 },
  white_dwarf: { planetlessChance: 0.40, planetCount: [1, 3], planetWeights: [0.06, 0.65, 0.29], environmentWeights: [0.45, 0.08, 0.17, 0.30], solarii: 0.90 },
  neutron_star: { planetlessChance: 0.55, planetCount: [1, 2], planetWeights: [0.02, 0.78, 0.20], environmentWeights: [0.25, 0.05, 0.35, 0.35], solarii: 0.88 },
  pulsar: { planetlessChance: 0.60, planetCount: [1, 2], planetWeights: [0.01, 0.79, 0.20], environmentWeights: [0.15, 0.05, 0.55, 0.25], solarii: 0.95 },
  magnetar: { planetlessChance: 0.65, planetCount: [1, 2], planetWeights: [0, 0.85, 0.15], environmentWeights: [0.10, 0.05, 0.70, 0.15], solarii: 1.00 },
  wolf_rayet: { planetlessChance: 0.42, planetCount: [1, 3], planetWeights: [0.02, 0.48, 0.50], environmentWeights: [0.25, 0.35, 0.30, 0.10], solarii: 1.10 },
  red_supergiant: { planetlessChance: 0.30, planetCount: [1, 4], planetWeights: [0.08, 0.42, 0.50], environmentWeights: [0.40, 0.32, 0.12, 0.16], solarii: 1.10 },
  blue_supergiant: { planetlessChance: 0.32, planetCount: [1, 4], planetWeights: [0.05, 0.40, 0.55], environmentWeights: [0.38, 0.28, 0.22, 0.12], solarii: 1.12 },
  hypergiant: { planetlessChance: 0.38, planetCount: [1, 4], planetWeights: [0.03, 0.42, 0.55], environmentWeights: [0.30, 0.38, 0.22, 0.10], solarii: 1.15 },
  black_hole_system: { planetlessChance: 0.50, planetCount: [1, 3], planetWeights: [0.02, 0.58, 0.40], environmentWeights: [0.20, 0.15, 0.30, 0.35], solarii: 1.05 },
  binary: { planetlessChance: 0.08, planetCount: [2, 5], planetWeights: [0.30, 0.30, 0.40], environmentWeights: [0.70, 0.12, 0.08, 0.10], solarii: 1.05 },
  quasar: { planetlessChance: 0.72, planetCount: [1, 2], planetWeights: [0, 0.65, 0.35], environmentWeights: [0.05, 0.40, 0.45, 0.10], solarii: 1.15 },
});

const PHYSICAL_RANGES = Object.freeze({
  yellow_dwarf: { massSolar: [0.8, 1.2], temperatureK: [5200, 6000], luminositySolar: [0.6, 1.5], lifetime: '8–14 billion years' },
  orange_dwarf: { massSolar: [0.6, 0.9], temperatureK: [3900, 5200], luminositySolar: [0.1, 0.6], lifetime: '15–30 billion years' },
  red_dwarf: { massSolar: [0.08, 0.6], temperatureK: [2400, 3900], luminositySolar: [0.0001, 0.1], lifetime: '100 billion–10 trillion years' },
  brown_dwarf: { massSolar: [0.013, 0.08], temperatureK: [250, 2400], luminositySolar: [0.000001, 0.01], lifetime: 'Cools continuously' },
  red_giant: { massSolar: [0.8, 8], temperatureK: [3000, 5000], luminositySolar: [100, 3000], lifetime: '10–100 million years in giant phase' },
  white_dwarf: { massSolar: [0.5, 1.35], temperatureK: [5000, 100000], luminositySolar: [0.001, 100], lifetime: 'Cools over trillions of years' },
  neutron_star: { massSolar: [1.1, 2.3], temperatureK: [600000, 1000000], radiusKm: [10, 14], lifetime: 'Long-lived compact remnant' },
  pulsar: { massSolar: [1.1, 2.3], temperatureK: [600000, 1000000], radiusKm: [10, 14], spinPeriodMs: [1.4, 1000], lifetime: '10–100 million year active phase' },
  magnetar: { massSolar: [1.1, 2.3], temperatureK: [600000, 1000000], radiusKm: [10, 14], magneticFieldGauss: [1e14, 1e15], lifetime: 'About 10,000 year active phase' },
  wolf_rayet: { massSolar: [10, 25], temperatureK: [30000, 200000], luminositySolar: [100000, 1000000], lifetime: 'Under 1 million years in stripped phase' },
  red_supergiant: { massSolar: [8, 40], temperatureK: [3400, 4500], luminositySolar: [10000, 500000], lifetime: 'Under 2 million years in supergiant phase' },
  blue_supergiant: { massSolar: [10, 60], temperatureK: [10000, 50000], luminositySolar: [10000, 1000000], lifetime: '1–10 million years' },
  hypergiant: { massSolar: [30, 150], temperatureK: [3500, 35000], luminositySolar: [500000, 5000000], lifetime: 'A few million years' },
  black_hole_system: { compactMassSolar: [3, 30], companionMassSolar: [0.5, 20], accretionTemperatureK: [1000000, 10000000], lifetime: 'Accretion-active binary phase' },
  binary: { totalMassSolar: [1, 20], componentTemperatureK: [2500, 30000], luminositySolar: [0.1, 100000], lifetime: 'Depends on component masses' },
  quasar: { compactMassSolar: [1e6, 1e10], accretionTemperatureK: [10000, 1000000], luminositySolar: [1e10, 1e14], lifetime: '10–100 million year active phase' },
});

function weightedCatalogType(seed, key) {
  const roll = hashUnit(seed, key) * 100;
  let acc = 0;
  for (const id of CANONICAL_STAR_TYPES) {
    acc += CATALOG_WEIGHTS[id] ?? 0;
    if (roll < acc) return id;
  }
  return 'yellow_dwarf';
}

function stableSample(seed, key, [min, max], digits = 2) {
  const value = min + hashUnit(seed, key) * (max - min);
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function stellarPhysicalProperties(star) {
  const profile = getStarVisualProfile(star);
  const ranges = PHYSICAL_RANGES[profile?.id];
  if (!ranges) return null;
  const seed = Number(star?.visualSeed ?? 0) >>> 0;
  const sampled = {};
  for (const [key, value] of Object.entries(ranges)) {
    sampled[key] = Array.isArray(value)
      ? stableSample(seed, `stellar-physical:${profile.id}:${key}`, value, Math.max(...value) >= 10000 ? 0 : 3)
      : value;
  }
  sampled.solariiMultiplier = STELLAR_GENERATION_PROFILES[profile.id]?.solarii ?? 1;
  return sampled;
}

export function stellarSolariiMultiplier(star) {
  return STELLAR_GENERATION_PROFILES[getStarVisualProfile(star)?.id]?.solarii ?? 1;
}

export function assignGalaxyCatalogNumbers(graph, galaxySeed) {
  const normal = (graph?.stars ?? []).filter((star) => !String(star.id).startsWith('sys-created-'));
  const ordered = [...normal].sort((a, b) =>
    stableHash(galaxySeed, `catalog-number:${a.id}`) - stableHash(galaxySeed, `catalog-number:${b.id}`)
    || a.id.localeCompare(b.id));
  const validExisting = new Set();
  for (const star of ordered) {
    if (Number.isInteger(star.catalogNumber) && star.catalogNumber > 0 && !validExisting.has(star.catalogNumber)) {
      validExisting.add(star.catalogNumber);
    } else {
      delete star.catalogNumber;
    }
  }
  const shuffledNumbers = ordered.map((_, index) => index + 1);
  for (const star of ordered) {
    if (Number.isInteger(star.catalogNumber)) continue;
    const number = shuffledNumbers.find((entry) => !validExisting.has(entry));
    star.catalogNumber = number;
    validExisting.add(number);
  }
  let next = Math.max(400, graph?.nextCatalogNumber - 1 || 0,
    ...normal.map((star) => star.catalogNumber ?? 0)) + 1;
  for (const star of (graph?.stars ?? []).filter((entry) => String(entry.id).startsWith('sys-created-'))
    .sort((a, b) => a.id.localeCompare(b.id))) {
    if (!Number.isInteger(star.catalogNumber)) star.catalogNumber = next++;
    else next = Math.max(next, star.catalogNumber + 1);
  }
  graph.nextCatalogNumber = Math.max(graph?.nextCatalogNumber ?? 401, next);
  return graph;
}

export function assignGalaxyStellarCatalog(graph, strongholdStarId, galaxySeed, { preserveExisting = true } = {}) {
  assignGalaxyCatalogNumbers(graph, galaxySeed);
  const stars = graph?.stars ?? [];
  const stronghold = stars.find((star) => star.id === strongholdStarId);
  if (stronghold) stronghold.stellarClass = 'yellow_dwarf';
  const eligible = stars.filter((star) => star.id !== strongholdStarId && star.kind !== 'trade_nexus');
  const floorAssigned = new Set();
  for (const id of CANONICAL_STAR_TYPES.filter((entry) => entry !== 'yellow_dwarf')) {
    if (eligible.some((star) => star.stellarClass === id)) continue;
    const candidates = eligible.filter((star) => !floorAssigned.has(star.id));
    const donorPool = preserveExisting
      ? candidates.filter((star) => !star.stellarClass
        || ['yellow_dwarf', 'orange_dwarf', 'red_dwarf'].includes(star.stellarClass))
      : candidates;
    const chosen = (donorPool.length ? donorPool : candidates).sort((a, b) =>
      stableHash(galaxySeed, `stellar-floor:${id}:${a.id}`) - stableHash(galaxySeed, `stellar-floor:${id}:${b.id}`)
      || a.id.localeCompare(b.id))[0];
    if (chosen) {
      chosen.stellarClass = id;
      floorAssigned.add(chosen.id);
    }
  }
  for (const star of eligible) {
    if (!CANONICAL_STAR_TYPES.includes(star.stellarClass)) {
      star.stellarClass = weightedCatalogType(galaxySeed, `stellar-class:${star.id}`);
    }
    delete star.stellarOverride;
  }
  for (const star of stars.filter((entry) => entry.kind === 'trade_nexus')) {
    delete star.stellarClass;
    delete star.stellarOverride;
  }
  return eligible;
}

/** Assign stable visual-only exotic overrides without consuming system RNG. */
export function assignGalaxyStellarOverrides(graph, strongholdStarId, galaxySeed) {
  const eligible = (graph?.stars ?? []).filter((star) =>
    star.id !== strongholdStarId && star.kind !== 'trade_nexus');
  const unassigned = eligible.filter((star) =>
    !Object.prototype.hasOwnProperty.call(star, 'stellarOverride'));

  // The explicit null is part of the catalog. Once a v19 graph has stored the
  // field, never reinterpret it as missing or a later hash improvement could
  // reroll an established galaxy on load.
  if (unassigned.length === 0) {
    return eligible.filter((star) => star.stellarOverride);
  }

  for (const star of unassigned) {
    const roll = hashUnit(galaxySeed, `stellar-exotic:${star.id}`);
    star.stellarOverride = roll < 0.06 ? 'binary'
      : roll < 0.08 ? 'red_supergiant'
        : roll < 0.09 ? 'blue_supergiant'
          : roll < 0.10 ? 'pulsar'
            : null;
  }

  const quasarRoll = hashUnit(galaxySeed, 'stellar-quasar-presence');
  const alreadyHasQuasar = eligible.some((star) => star.stellarOverride === 'quasar');
  if (quasarRoll < 0.35 && !alreadyHasQuasar && unassigned.length > 0) {
    const chosen = [...unassigned].sort((a, b) =>
      stableHash(galaxySeed, `stellar-quasar:${a.id}`)
      - stableHash(galaxySeed, `stellar-quasar:${b.id}`)
      || a.id.localeCompare(b.id))[0];
    chosen.stellarOverride = 'quasar';
  }
  return eligible.filter((star) => star.stellarOverride);
}

function seededProfileRadius(profile, seed) {
  const unit = hashUnit(seed, `stellar-radius:${profile.id}`);
  return Math.round(profile.radiusRange[0] + unit * (profile.radiusRange[1] - profile.radiusRange[0]));
}

const LEGACY_CLASS_MAP = Object.freeze({
  white_main: 'wolf_rayet',
  blue_white: 'wolf_rayet',
  blue_giant: 'blue_supergiant',
  subgiant: 'red_giant',
  flare_star: 'red_dwarf',
});

export function canonicalizeStellarClass(id) {
  const mapped = LEGACY_CLASS_MAP[id] ?? id;
  return CANONICAL_STAR_TYPES.includes(mapped) ? mapped : 'yellow_dwarf';
}

/** Apply graph catalog classes to hydrated systems and persisted abstract overlays. */
export function applyStellarCatalog(state) {
  for (const galaxy of Object.values(state?.galaxies ?? {})) {
    const byId = new Map((galaxy.graph?.stars ?? []).map((star) => [star.id, star]));
    const apply = (systems) => {
      for (const [systemId, system] of Object.entries(systems ?? {})) {
        const type = byId.get(systemId)?.stellarClass;
        const profile = STAR_TYPES[type];
        if (!profile || system?.star?.kind === 'trade_nexus' || system?.star?.kind === 'blackhole') continue;
        system.star.type = profile.id;
        system.star.color = profile.color;
        system.star.radius = seededProfileRadius(profile, system.star.visualSeed ?? stableHash(state.meta?.seed, `${galaxy.id}:${systemId}`));
      }
    };
    apply(galaxy.systems);
    apply(galaxy.abstract?.systemOverlays);
  }
  return state;
}

// Compatibility export for focused v19 verifiers while v20 becomes canonical.
export const applyStellarOverrides = applyStellarCatalog;

export function stellarCatalogInfo(star) {
  const profile = getStarVisualProfile(star);
  return profile ? {
    id: profile.id,
    displayName: profile.displayName,
    description: profile.description,
    rendererKind: profile.rendererKind,
    properties: stellarPhysicalProperties(star),
    solariiMultiplier: stellarSolariiMultiplier(star),
  } : null;
}

const BINARY_COMPANION_COLORS = ['#77b6ff', '#fff4d6', '#ff9a62', '#d5e4ff'];

/** Stable render-only parameters for compound/exotic stellar silhouettes. */
export function stellarRenderParameters(star, profile = getStarVisualProfile(star)) {
  const seed = Number(star?.visualSeed ?? 0) >>> 0;
  const companionIndex = stableHash(seed, 'binary-companion') % BINARY_COMPANION_COLORS.length;
  const separation = 1.45 + hashUnit(seed, 'binary-separation') * 0.30;
  const companionScale = 0.58 + hashUnit(seed, 'binary-scale') * 0.24;
  // Incline the projected orbit just enough to cross at conjunction. This
  // produces a short eclipse without sacrificing the clear gap for most of
  // the orbit, regardless of the seeded companion size and separation.
  const eclipseThreshold = 0.67 * (1 + companionScale) / (1.1 * separation);
  return {
    companionColor: BINARY_COMPANION_COLORS[companionIndex],
    separation,
    companionScale,
    axisCompression: Math.max(0.48, Math.min(0.78, eclipseThreshold * 0.985)),
    orbitSpeed: 0.22 + hashUnit(seed, 'binary-speed') * 0.2,
    orbitPhase: hashUnit(seed, 'binary-phase') * Math.PI * 2,
    visualExtent: profile?.visualExtent ?? 3.5,
  };
}

const TYPE_LIST = Object.values(STAR_TYPES);
const GENERATION_POOL = TYPE_LIST.filter((t) => t.weight > 0);
const DEAD_STAR_TYPES = ['white_dwarf', 'subgiant'];
const LEGACY_GENERATION_WEIGHTS = Object.freeze({
  yellow_dwarf: 22, orange_dwarf: 16, red_dwarf: 14, white_main: 10,
  blue_white: 8, blue_giant: 5, red_giant: 6, subgiant: 5, flare_star: 4,
});

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

export function pickLegacyStarType(rng, { isHome = false, isDead = false } = {}) {
  if (isHome) return STAR_TYPES.yellow_dwarf;
  if (isDead) return STAR_TYPES[DEAD_STAR_TYPES[Math.floor(rng() * DEAD_STAR_TYPES.length)]];
  const roll = rng();
  const total = Object.values(LEGACY_GENERATION_WEIGHTS).reduce((sum, value) => sum + value, 0);
  let acc = 0;
  for (const [id, weight] of Object.entries(LEGACY_GENERATION_WEIGHTS)) {
    acc += weight / total;
    if (roll <= acc) return STAR_TYPES[id];
  }
  return STAR_TYPES.yellow_dwarf;
}

/**
 * Resolve star type from save data (explicit type or legacy heuristics).
 * @param {{ type?: string, color?: string, radius?: number, kind?: string }} star
 */
export function resolveStarType(star) {
  if (star?.kind === 'blackhole') return null;
  if (star?.stellarClass && STAR_TYPES[canonicalizeStellarClass(star.stellarClass)]) {
    return STAR_TYPES[canonicalizeStellarClass(star.stellarClass)];
  }
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
  brown_dwarf: 0.16,
  white_main: 0.82,
  blue_white: 0.92,
  blue_giant: 0.95,
  red_giant: 0.42,
  subgiant: 0.52,
  white_dwarf: 0.78,
  neutron_star: 1.0,
  flare_star: 0.38,
  magnetar: 1.0,
  wolf_rayet: 1.0,
  binary: 0.76,
  red_supergiant: 0.3,
  blue_supergiant: 1.0,
  hypergiant: 0.72,
  pulsar: 1.0,
  black_hole_system: 0.94,
  quasar: 0.98,
};

const TURBULENCE_BY_TYPE = {
  yellow_dwarf: 0.4,
  orange_dwarf: 0.45,
  red_dwarf: 0.25,
  brown_dwarf: 0.68,
  white_main: 0.35,
  blue_white: 0.65,
  blue_giant: 0.85,
  red_giant: 0.9,
  subgiant: 0.7,
  white_dwarf: 0.15,
  neutron_star: 0.28,
  flare_star: 0.55,
  magnetar: 0.88,
  wolf_rayet: 1.0,
  binary: 0.72,
  red_supergiant: 1.0,
  blue_supergiant: 1.0,
  hypergiant: 1.0,
  pulsar: 0.42,
  black_hole_system: 0.92,
  quasar: 0.95,
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
    exposure: profile?.exposure ?? 1,
    chromaticStrength: profile?.chromaticStrength ?? 1,
  };
}

/** Backfill star.type on all systems (save migration). */
export function backfillStarTypes(state) {
  const scan = (systems) => {
    for (const id of Object.keys(systems ?? {})) {
      const star = systems[id].star;
      if (!star || star.kind === 'blackhole') continue;
      if (!star.type) star.type = resolveStarType(star).id;
    }
  };
  if (state.galaxies) {
    for (const gal of Object.values(state.galaxies)) scan(gal.systems);
  } else {
    scan(state.systems);
  }
}
