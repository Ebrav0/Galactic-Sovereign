// ALL balance numbers live here (IMPLEMENTATION_PLAN §3).
// Logic files must import from this module — never hardcode numbers.

export const SAVE_VERSION = 3;

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

// --- Combat ship transit ---
export const SHIP_LANE_SPEED = 100;
export const SHIP_LANE_MIN_LEG_MS = 2000;

// --- Capture (GDD §9) ---
export const CAPTURE_BASE = 1;
export const CAPTURE_PER_PLANET = 1;
export const CAPTURE_PER_MOON = 0.5;
export const CAPTURE_STRUCTURE_WEIGHT = { outpost: 2, shipyard: 4 };
export const CAPTURE_FLAGSHIP_FORCE = 3;
export const CAPTURE_HOLD_MS = 20000;
export const CAPTURE_GARRISON_WEIGHT = 0.5;

// --- Garrison seeding ---
export const GARRISON_BASE = 1;
export const GARRISON_PER_PLANET = 0.5;
export const GARRISON_PER_STRUCTURE = 0.5;
export const GARRISON_MAX_UNITS = 8;

// --- Flagship combat ---
export const FLAGSHIP_MAX_HP = 500;
export const FLAGSHIP_DPS = 25;
export const FLAGSHIP_CAPTURE_FORCE = 3;
export const FLAGSHIP_COMBAT_SPEED = 340;

// --- Tactical combat ---
export const COMBAT_WEAPON_RANGE = 180;
export const COMBAT_HEALER_RANGE = 160;
export const COMBAT_HEALER_RATE = 8;         // HP restored per tick
export const COMBAT_DAMAGE_PER_TICK = 1;     // multiplier: dps * TICK_MS / 1000
export const COMBAT_UNIT_RADIUS = 7;
export const COMBAT_SPAWN_RADIUS = 380;

// --- Auto-resolve ---
export const AUTO_RESOLVE_MS = 8000;
export const AUTO_RESOLVE_HEALER_BONUS = 0.15;  // +15% effective HP per healer
export const AUTO_RESOLVE_RPS = {
  interceptor_wing: { strongVs: ['bomber_wing'], weakVs: ['destroyer', 'cruiser'] },
  bomber_wing: { strongVs: ['cruiser', 'destroyer', 'light_carrier'], weakVs: ['interceptor_wing', 'corvette'] },
  corvette: { strongVs: ['bomber_wing'], weakVs: ['frigate', 'destroyer'] },
  frigate: { strongVs: ['corvette', 'interceptor_wing'], weakVs: ['destroyer', 'cruiser'] },
  destroyer: { strongVs: ['frigate', 'corvette'], weakVs: ['bomber_wing', 'cruiser'] },
  cruiser: { strongVs: ['destroyer', 'bomber_wing'], weakVs: ['interceptor_wing', 'bomber_wing'] },
  light_carrier: { strongVs: ['corvette'], weakVs: ['bomber_wing', 'destroyer'] },
  healer: { strongVs: [], weakVs: ['destroyer', 'cruiser', 'bomber_wing'] },
  light_hauler: { strongVs: [], weakVs: ['corvette', 'frigate', 'destroyer'] },
};

// --- Carrier wings ---
export const CARRIER_DEFAULT_WINGS = { interceptor: 4, bomber: 2 };

// --- Hull stats (Phase 2 roster) ---
export const HULL_STATS = {
  scout: {
    hp: 40, dps: 0, speed: 140, cost: 120, buildMs: 18000,
    captureForce: 0, contestsCapture: false, shipyardBuild: true, category: 'special',
  },
  corvette: {
    hp: 80, dps: 12, speed: 220, cost: 180, buildMs: 20000,
    captureForce: 1, contestsCapture: true, shipyardBuild: true, category: 'escort',
  },
  frigate: {
    hp: 120, dps: 18, speed: 180, cost: 280, buildMs: 28000,
    captureForce: 2, contestsCapture: true, shipyardBuild: true, category: 'escort',
  },
  destroyer: {
    hp: 180, dps: 28, speed: 140, cost: 420, buildMs: 36000,
    captureForce: 3, contestsCapture: true, shipyardBuild: true, category: 'line',
  },
  cruiser: {
    hp: 320, dps: 35, speed: 110, cost: 650, buildMs: 48000,
    captureForce: 5, contestsCapture: true, shipyardBuild: true, category: 'capital',
    priorityHeal: 2,
  },
  light_carrier: {
    hp: 200, dps: 5, speed: 120, cost: 520, buildMs: 42000,
    captureForce: 4, contestsCapture: true, shipyardBuild: true, category: 'carrier',
    wings: CARRIER_DEFAULT_WINGS,
  },
  healer: {
    hp: 100, dps: 0, speed: 150, cost: 350, buildMs: 32000,
    captureForce: 1, contestsCapture: true, shipyardBuild: true, category: 'support',
    healRate: COMBAT_HEALER_RATE,
  },
  light_hauler: {
    hp: 60, dps: 0, speed: 100, cost: 140, buildMs: 16000,
    captureForce: 0, contestsCapture: false, shipyardBuild: true, category: 'transport',
  },
};

export const WING_STATS = {
  interceptor_wing: {
    hp: 15, dps: 8, speed: 320, captureForce: 0.5, contestsCapture: true,
    targetPreference: 'bomber_wing',
  },
  bomber_wing: {
    hp: 20, dps: 10, speed: 200, captureForce: 1, contestsCapture: true,
    targetPreference: 'capital',
  },
};

export const BUILDABLE_HULLS = [
  'scout', 'corvette', 'frigate', 'destroyer', 'cruiser',
  'light_carrier', 'healer', 'light_hauler',
];

export const COMBAT_HULLS = BUILDABLE_HULLS.filter((h) => h !== 'scout' && h !== 'light_hauler');

// --- Galaxy generation (GDD §4–5) ---
export const GALAXY_STAR_COUNT = 20;
export const GALAXY_RADIUS = 950;
export const GALAXY_INNER_RADIUS = 260;
export const GALAXY_MIN_STAR_SPACING = 190;
export const GALAXY_EXTRA_LANE_MAX_DIST = 430;
export const GALAXY_TARGET_AVG_DEGREE = 2.6;
export const GALAXY_MAX_DEGREE = 4;
export const BLACK_HOLE_MIN_LANES = 2;
export const DEAD_STAR_CHANCE = 0.18;
export const OTHER_PLANET_COUNT_RANGE = [1, 5];

// --- Flagship (GDD §8) ---
export const FLAGSHIP_ACCEL = 420;
export const FLAGSHIP_MAX_SPEED = 340;
export const FLAGSHIP_DRAG = 2.5;
export const FLAGSHIP_RADIUS = 9;
export const FLAGSHIP_SPAWN_ORBIT = 130;
export const FLAGSHIP_ENTRY_MARGIN = 110;
export const FLAGSHIP_ENTRY_MIN_RADIUS = 320;

// --- Lane transit ---
export const LANE_SPEED = 90;
export const LANE_MIN_LEG_MS = 2500;

// --- Home system generation ---
export const HOME_SYSTEM_NAME = 'Solara Prime';
export const STAR_RADIUS = 46;
export const PLANET_COUNT_RANGE = [2, 3];
export const PLANET_ORBIT_BASE = 180;
export const PLANET_ORBIT_SPACING = 130;
export const PLANET_RADIUS_RANGE = [9, 16];
export const PLANET_ORBIT_PERIOD_RANGE = [180000, 420000];
export const MOON_COUNT_RANGE = [1, 3];
export const MOON_ORBIT_BASE = 24;
export const MOON_ORBIT_SPACING = 12;
export const MOON_RADIUS = 3.5;
export const MOON_ORBIT_PERIOD_RANGE = [24000, 60000];

// --- Shuttles (visual only) ---
export const SHUTTLE_TRIP_MS = 8000;
export const SHUTTLE_SIZE = 2.2;

// --- Camera ---
export const CAMERA_MIN_ZOOM = 0.35;
export const CAMERA_MAX_ZOOM = 3.5;
export const CAMERA_ZOOM_STEP = 1.1;
export const CAMERA_FOLLOW_RATE = 6;
export const GALAXY_CAMERA_MIN_ZOOM = 0.22;
export const GALAXY_CAMERA_MAX_ZOOM = 2.2;

// --- Rendering ---
export const STARFIELD_COUNT = 220;
export const SELECTION_PULSE_MS = 1600;

// --- Auto-resolve replay (stretch) ---
export const REPLAY_DURATION_MS = 4000;
