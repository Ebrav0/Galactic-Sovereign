// ALL balance numbers live here (IMPLEMENTATION_PLAN §3).
// Logic files must import from this module — never hardcode numbers.

export const SAVE_VERSION = 2;

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
export const CAPTURE_FLAGSHIP_FORCE = 1;
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
export const FLAGSHIP_SPAWN_ORBIT = 130;   // spawn distance from the home star
export const FLAGSHIP_ENTRY_MARGIN = 110;  // arrival distance beyond the outermost orbit
export const FLAGSHIP_ENTRY_MIN_RADIUS = 320;

// --- Lane transit ---
export const LANE_SPEED = 90;              // galaxy-map units per second
export const LANE_MIN_LEG_MS = 2500;       // floor so short lanes still read as travel

// --- Home system generation ---
export const HOME_SYSTEM_NAME = 'Solara Prime';
export const STAR_RADIUS = 46;
export const PLANET_COUNT_RANGE = [2, 3];        // min, max (inclusive)
export const PLANET_ORBIT_BASE = 180;            // world units, first orbit
export const PLANET_ORBIT_SPACING = 130;         // gap between orbits
export const PLANET_RADIUS_RANGE = [9, 16];
export const PLANET_ORBIT_PERIOD_RANGE = [180000, 420000]; // ms per revolution
export const MOON_COUNT_RANGE = [1, 3];          // for the guaranteed habitable planet
export const MOON_ORBIT_BASE = 24;
export const MOON_ORBIT_SPACING = 12;
export const MOON_RADIUS = 3.5;
export const MOON_ORBIT_PERIOD_RANGE = [24000, 60000];

// --- Shuttles (visual only) ---
export const SHUTTLE_TRIP_MS = 8000;   // one full planet->moon->planet round trip
export const SHUTTLE_SIZE = 2.2;       // draw radius

// --- Camera ---
export const CAMERA_MIN_ZOOM = 0.35;
export const CAMERA_MAX_ZOOM = 3.5;
export const CAMERA_ZOOM_STEP = 1.1;   // per wheel notch
export const CAMERA_FOLLOW_RATE = 6;   // 1/s exponential approach toward the flagship
export const GALAXY_CAMERA_MIN_ZOOM = 0.22;
export const GALAXY_CAMERA_MAX_ZOOM = 2.2;

// --- Rendering ---
export const STARFIELD_COUNT = 220;
export const SELECTION_PULSE_MS = 1600;
