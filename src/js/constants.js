// ALL balance numbers live here (IMPLEMENTATION_PLAN §3).
// Logic files must import from this module — never hardcode numbers.

export const SAVE_VERSION = 4;

// --- Simulation ---
export const TICK_MS = 50;                 // 20 ticks per second
export const AUTOSAVE_INTERVAL_MS = 120000; // 2 minutes

// --- Starting conditions ---
export const STARTING_CREDITS = 900;
export const DEFAULT_SEED = 1;

// --- Economy (GDD §6) ---
export const OUTPOST_COST = 300;             // credits
export const OUTPOST_BASE_INCOME = 2;        // credits per second, before moon bonus
export const MOON_YIELD_BONUS = 0.5;         // +50% of base per moon on the same planet

// --- Structures ---
export const SHIPYARD_COST = 400;
export const SCOUT_HULL_COST = 120;

// --- Combat hulls (Phase 2) ---
export const HULL_STATS = {
  scout: { hp: 50, dps: 0, captureForce: 0, cost: 120, buildMs: 18000, laneSpeed: 140, healRate: 0 },
  corvette: { hp: 120, dps: 8, captureForce: 1, cost: 180, buildMs: 22000, laneSpeed: 120, healRate: 0 },
  frigate: { hp: 200, dps: 12, captureForce: 2, cost: 280, buildMs: 30000, laneSpeed: 110, healRate: 0 },
  destroyer: { hp: 350, dps: 18, captureForce: 3, cost: 450, buildMs: 40000, laneSpeed: 100, healRate: 0 },
  cruiser: { hp: 500, dps: 22, captureForce: 4, cost: 650, buildMs: 55000, laneSpeed: 95, healRate: 0 },
  light_carrier: { hp: 400, dps: 5, captureForce: 2, cost: 550, buildMs: 50000, laneSpeed: 90, healRate: 0 },
  fighter: { hp: 30, dps: 6, captureForce: 0, cost: 0, buildMs: 0, laneSpeed: 140, healRate: 0 },
  bomber: { hp: 40, dps: 10, captureForce: 0, cost: 0, buildMs: 0, laneSpeed: 120, healRate: 0 },
  healer: { hp: 150, dps: 0, captureForce: 1, cost: 320, buildMs: 35000, laneSpeed: 105, healRate: 15 },
};

export const COMBAT_HULL_TYPES = ['corvette', 'frigate', 'destroyer', 'cruiser', 'light_carrier', 'healer'];
export const SHIPYARD_COMBAT_HULLS = ['corvette', 'frigate', 'destroyer', 'healer'];

export const SHIP_LANE_SPEED = 100;
export const FLEET_STATION_ORBIT_PAD = 300;   // min distance beyond star edge for idle formation
export const FLEET_STATION_BODY_PAD = 95;     // orbit offset from shipyard planet
export const SHIP_LANE_MIN_LEG_MS = 2000;

// --- Ship motion (ambient patrol + keep-out) ---
export const STAR_KEEP_OUT_PAD = 120;
export const STAR_KEEP_OUT_ORBIT_FRACTION = 0.88; // star repulsion fades out by innermost orbit
export const PLANET_KEEP_OUT_PAD = 80;
export const MOON_KEEP_OUT_PAD = 45;
export const AMBIENT_PATROL_RADIUS = 55;
export const AMBIENT_PATROL_OMEGA = 0.38;
export const KEEP_OUT_SOFT_ZONE = 2.4;       // repulsion reach as multiple of keep radius
export const KEEP_OUT_REPULSION = 480;       // flagship push accel (world units / s²)
export const KEEP_OUT_NUDGE_STRENGTH = 320;  // kinematic ships + tactical nudge

// --- Flagship combat ---
export const FLAGSHIP_HP = 2000;
export const FLAGSHIP_DPS = 25;

// --- Tactical combat ---
export const TACTICAL_WEAPON_RANGE = 280;
export const TACTICAL_WEAPON_COOLDOWN_MS = 800;
export const TACTICAL_SHIP_SPEED = 45;
export const TACTICAL_BATTLE_RADIUS = 900;

// --- Auto-resolve ---
export const STANCE_MODIFIERS = { aggressive: 1.2, balanced: 1.0, defensive: 0.85 };
export const HEALER_AUTO_COEF = 0.25;

// --- Pirates (Phase 2 test faction) ---
export const PIRATE_FLEET_COUNT = 2;
export const PIRATE_WANDER_MS = 45000;
export const PIRATE_RESPAWN_MS = 120000;
export const PIRATE_LANE_SPEED = 85;
export const PIRATE_LANE_MIN_LEG_MS = 2200;
export const PIRATE_SHIPS = [
  { hull: 'corvette', count: 2 },
  { hull: 'frigate', count: 1 },
];

// --- Production ---
export const SCOUT_BUILD_MS = 18000;
export const SHIPYARD_SLOTS = 1;

// --- Scout transit ---
export const SCOUT_LANE_SPEED = 140;
export const SCOUT_LANE_MIN_LEG_MS = 1800;

// --- Capture (GDD §9) ---
export const CAPTURE_BASE = 1;
export const CAPTURE_PER_PLANET = 1;
export const CAPTURE_PER_MOON = 0.5;
export const CAPTURE_STRUCTURE_WEIGHT = { outpost: 2, shipyard: 4 };
export const CAPTURE_FLAGSHIP_FORCE = 2;
export const CAPTURE_HOLD_MS = 20000;

// --- Galaxy generation (GDD §4–5) ---
export const GALAXY_STAR_COUNT = 20;
export const GALAXY_RADIUS = 950;                // max star distance from the galactic core
export const GALAXY_INNER_RADIUS = 260;          // keep stars clear of the black hole
export const GALAXY_MIN_STAR_SPACING = 190;      // rejection-sampling minimum distance
export const GALAXY_EXTRA_LANE_MAX_DIST = 430;   // non-MST lanes must be shorter than this
export const GALAXY_TARGET_AVG_DEGREE = 2.6;     // stop adding extra lanes past this
export const GALAXY_MAX_DEGREE = 4;              // per-node lane cap
export const BLACK_HOLE_MIN_LANES = 2;           // the core is a reachable travel node
export const DEAD_STAR_CHANCE = 0.18;            // probability a non-home star has 0 planets
export const OTHER_PLANET_COUNT_RANGE = [1, 5];  // planet roll for non-home stars

// --- Flagship (GDD §8) ---
export const FLAGSHIP_ACCEL = 420;         // world units / s^2 while thrusting
export const FLAGSHIP_MAX_SPEED = 340;     // world units / s
export const FLAGSHIP_DRAG = 2.5;          // 1/s velocity damping while coasting
export const FLAGSHIP_RADIUS = 9;          // draw radius (world units)
export const FLAGSHIP_SPAWN_ORBIT = 580;   // spawn distance from the home star
export const FLAGSHIP_ENTRY_MARGIN = 280;  // arrival distance beyond the outermost orbit
export const FLAGSHIP_ENTRY_MIN_RADIUS = 1400;

// --- Lane transit ---
export const LANE_SPEED = 90;              // galaxy-map units per second
export const LANE_MIN_LEG_MS = 2500;       // floor so short lanes still read as travel

// --- Home system generation ---
export const HOME_SYSTEM_NAME = 'Solara Prime';
export const STAR_RADIUS = 200;
export const PLANET_COUNT_RANGE = [2, 3];        // min, max (inclusive)
export const PLANET_ORBIT_BASE = 800;            // world units, first orbit
export const PLANET_ORBIT_SPACING = 550;         // gap between orbits
export const PLANET_RADIUS_RANGE = [22, 38];
export const PLANET_ORBIT_PERIOD_RANGE = [180000, 420000]; // ms per revolution
export const MOON_COUNT_RANGE = [1, 3];          // for the guaranteed habitable planet
export const MOON_ORBIT_BASE = 110;
export const MOON_ORBIT_SPACING = 55;
export const MOON_RADIUS = 12;
export const MOON_RADIUS_RANGE = [8, 16];
export const MOON_ORBIT_PERIOD_RANGE = [24000, 60000];

// --- Shuttles (visual only) ---
export const SHUTTLE_TRIP_MS = 8000;   // one full planet->moon->planet round trip
export const SHUTTLE_SIZE = 2.2;       // draw radius

// --- Camera ---
export const CAMERA_MIN_ZOOM = 0.15;
export const CAMERA_MAX_ZOOM = 3.5;
export const CAMERA_DEFAULT_ZOOM = 0.38;
export const CAMERA_ZOOM_STEP = 1.1;   // per wheel notch
export const CAMERA_FOLLOW_RATE = 6;   // 1/s exponential approach toward the flagship
export const GALAXY_CAMERA_MIN_ZOOM = 0.22;
export const GALAXY_CAMERA_MAX_ZOOM = 2.2;

// --- Rendering ---
export const STARFIELD_COUNT = 320;
export const STARFIELD_SPREAD = 10500;         // half-extent of background starfield
export const CELESTIAL_VISUAL_SCALE = 1.35;    // render-only body size multiplier
export const SELECTION_PULSE_MS = 1600;
export const STAR_BLOOM_SCALE = 1.0;           // bloom FBO resolution fraction (full res avoids blocky upscale)
export const STAR_BLOOM_THRESHOLD = 0.38;      // luminance threshold for HDR bloom
export const STAR_GL_QUALITY = 'medium';       // 'high' | 'medium' | 'low'
