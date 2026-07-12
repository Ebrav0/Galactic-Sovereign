// ALL balance numbers live here (IMPLEMENTATION_PLAN §3).
// Logic files must import from this module — never hardcode numbers.

export const SAVE_VERSION = 14;

// --- Simulation ---
export const TICK_MS = 50;                 // 20 ticks per second
export const AUTOSAVE_INTERVAL_MS = 120000; // 2 minutes

// --- Starting conditions ---
export const STARTING_CREDITS = 900;
export const DEFAULT_SEED = 1;

// --- Economy (GDD §6) ---
export const OUTPOST_COST = 300;             // credits
export const OUTPOST_BASE_INCOME = 2;        // credits per second, before moon bonus
export const OUTPOST_PASSIVE_INCOME = 40;     // exact credits/second per operational player outpost
export const MOON_YIELD_BONUS = 0.5;         // +50% of base per moon on the same planet

// --- Physical logistics (Unified Overhaul / save-v12) ---
export const TRADE_NEXUS_COUNT_PER_GALAXY = 4;
export const LOGISTICS_CARGO_TYPES = ['rawMaterials', 'fuel', 'manufacturedGoods'];
export const LOGISTICS_OUTPOST_RATE = 0.7;          // cargo units / second / outpost
export const LOGISTICS_PRODUCTION_RATES = {
  habitable: { rawMaterials: 0.35, fuel: 0.14, manufacturedGoods: 0.21 },
  barren: { rawMaterials: 0.56, fuel: 0.105, manufacturedGoods: 0.035 },
  gas: { rawMaterials: 0.105, fuel: 0.56, manufacturedGoods: 0.035 },
};
export const LOGISTICS_MOON_PRODUCTION_BONUS = 0.25;
export const LOGISTICS_OUTPOST_STOCK_CAPACITY = 120;
export const LOGISTICS_LOCAL_DISPATCH_CARGO = 2;
export const LOGISTICS_LOCAL_TRANSPORT_CAPACITY = 18;
export const LOGISTICS_DEPOT_CAPACITY = 220;
export const LOGISTICS_MIN_DISPATCH_CARGO = 12;
export const LOGISTICS_CONVOY_CAPACITY = 48;
export const LOGISTICS_LOCAL_TRANSFER_MS = 4800;
export const LOGISTICS_LOCAL_DISPATCH_INTERVAL_MS = 2500;
export const LOGISTICS_JUMP_CHARGE_MS = 1250;
export const LOGISTICS_LANE_SPEED = 115;
export const LOGISTICS_LANE_MIN_LEG_MS = 1500;
export const LOGISTICS_DISPATCH_INTERVAL_MS = 8000;
export const LOGISTICS_ROUTE_PAUSE_MS = 15000;
export const LOGISTICS_DEFAULT_CONVOY_ARMOR = 1;
export const LOGISTICS_RECENT_DELIVERY_WINDOW_MS = 60000;
export const LOGISTICS_CARGO_CREDIT_VALUE = {
  rawMaterials: 4,
  fuel: 6,
  manufacturedGoods: 10,
};

// --- Structures ---
export const SHIPYARD_COST = 400;
export const SCOUT_HULL_COST = 120;

// --- Construction drones (Phase 6) ---
export const DRONE_BASE_CAPACITY = 6;
export const DRONE_BUILDER_SHIP_BONUS = 1;
export const DRONE_MIL_BUILDER_BONUS = 2;
export const DRONE_MAX_PER_SYSTEM = 12;
export const DRONE_MAX_PER_JOB = 2;
export const DRONE_WORK_PER_TICK = 50;           // work-ms added per tick per working drone
export const DRONE_SURVEYOR_SPEED_BONUS = 1.15;  // eco_surveyor researched
export const DRONE_TRIP_MS_MIN = 1200;
export const DRONE_TRIP_MS_MAX = 4800;
export const DRONE_TRIP_MS_PER_UNIT = 0.35;      // scales with flagship↔site distance
export const DRONE_WORK_DWELL_MS = 3200;         // dwell at site per trip cycle
export const DRONE_CYCLE_MS = 6000;              // full outbound+work+return cycle for motion
export const DRONE_PATROL_RADIUS = 42;
export const DRONE_SIZE = 3.2;

export const STRUCTURE_BUILD_MS = {
  outpost: 18000,
  shipyard: 30000,
  trade_station: 24000,
  research_station: 28000,
  sail_foundry: 45000,
  dyson_launcher: 36000,
};

// --- Combat hulls (Phase 2 + GDD roster) ---
export const HULL_STATS = {
  scout: { hp: 50, dps: 0, captureForce: 0, cost: 120, buildMs: 18000, laneSpeed: 140, healRate: 0 },
  corvette: { hp: 120, dps: 8, captureForce: 1, cost: 180, buildMs: 22000, laneSpeed: 120, healRate: 0 },
  patrol_cutter: { hp: 90, dps: 6, captureForce: 1, cost: 150, buildMs: 20000, laneSpeed: 130, healRate: 0 },
  frigate: { hp: 200, dps: 12, captureForce: 2, cost: 280, buildMs: 30000, laneSpeed: 110, healRate: 0 },
  destroyer: { hp: 350, dps: 18, captureForce: 3, cost: 450, buildMs: 40000, laneSpeed: 100, healRate: 0 },
  cruiser: { hp: 500, dps: 22, captureForce: 4, cost: 650, buildMs: 55000, laneSpeed: 95, healRate: 0 },
  battleship: { hp: 750, dps: 28, captureForce: 5, cost: 900, buildMs: 70000, laneSpeed: 90, healRate: 0 },
  dreadnought: { hp: 1000, dps: 35, captureForce: 6, cost: 1200, buildMs: 85000, laneSpeed: 85, healRate: 0 },
  light_carrier: { hp: 400, dps: 5, captureForce: 2, cost: 550, buildMs: 50000, laneSpeed: 90, healRate: 0 },
  fleet_carrier: { hp: 550, dps: 7, captureForce: 3, cost: 750, buildMs: 62000, laneSpeed: 88, healRate: 0 },
  super_carrier: { hp: 700, dps: 10, captureForce: 4, cost: 950, buildMs: 75000, laneSpeed: 85, healRate: 0 },
  light_hauler: { hp: 180, dps: 2, captureForce: 0, cost: 200, buildMs: 25000, laneSpeed: 100, healRate: 0 },
  bulk_freighter: { hp: 280, dps: 2, captureForce: 0, cost: 320, buildMs: 32000, laneSpeed: 85, healRate: 0 },
  armored_convoy: { hp: 400, dps: 5, captureForce: 1, cost: 480, buildMs: 38000, laneSpeed: 80, healRate: 0 },
  fighter: { hp: 30, dps: 6, captureForce: 0, cost: 0, buildMs: 0, laneSpeed: 140, healRate: 0 },
  interceptor: { hp: 25, dps: 7, captureForce: 0, cost: 0, buildMs: 0, laneSpeed: 150, healRate: 0 },
  heavy_fighter: { hp: 45, dps: 12, captureForce: 0, cost: 0, buildMs: 0, laneSpeed: 125, healRate: 0 },
  bomber: { hp: 40, dps: 10, captureForce: 0, cost: 0, buildMs: 0, laneSpeed: 120, healRate: 0 },
  healer: { hp: 150, dps: 0, captureForce: 1, cost: 320, buildMs: 35000, laneSpeed: 105, healRate: 15 },
  sensor_ship: { hp: 120, dps: 0, captureForce: 0, cost: 260, buildMs: 28000, laneSpeed: 115, healRate: 0 },
  builder_ship: { hp: 200, dps: 0, captureForce: 1, cost: 380, buildMs: 42000, laneSpeed: 95, healRate: 0 },
  command_cruiser: { hp: 450, dps: 14, captureForce: 3, cost: 720, buildMs: 58000, laneSpeed: 95, healRate: 0 },
  hero_flagship: {
    hp: 800, dps: 15, captureForce: 2,
    cost: 2000, buildMs: 45000, laneSpeed: 110, healRate: 0,
  },
  miner: { hp: 160, dps: 0, captureForce: 0, cost: 240, buildMs: 30000, laneSpeed: 90, healRate: 0 },
};

/** Carrier-supplied wing craft — not built at shipyards. */
export const CARRIER_WING_HULLS = ['fighter', 'interceptor', 'heavy_fighter', 'bomber'];

export const CARRIER_WING_SPECS = {
  light_carrier: { interceptor: 3, fighter: 2 },
  fleet_carrier: { interceptor: 4, fighter: 3, heavy_fighter: 2 },
  super_carrier: { interceptor: 5, fighter: 4, heavy_fighter: 3, bomber: 3 },
};

export const WEAPON_PROFILES = {
  point_defense: { label: 'Point Defense', range: 190, cooldownMs: 320, antiFighter: 2.8, antiCapital: 0.55, structure: 0.35 },
  kinetic: { label: 'Kinetic Batteries', range: 280, cooldownMs: 760, antiFighter: 0.85, antiCapital: 1.0, structure: 0.9 },
  torpedo: { label: 'Torpedo Bays', range: 340, cooldownMs: 1100, antiFighter: 0.25, antiCapital: 1.65, structure: 1.7 },
  beam_lance: { label: 'Beam Lance', range: 360, cooldownMs: 980, antiFighter: 0.7, antiCapital: 1.35, structure: 1.15 },
  ion: { label: 'Ion Disruptor', range: 300, cooldownMs: 900, antiFighter: 1.25, antiCapital: 1.45, structure: 0.75, disrupt: 0.28 },
  repair: { label: 'Repair Drones', range: 230, cooldownMs: 600, antiFighter: 0, antiCapital: 0, structure: 0 },
};

export const COMBAT_HULL_TYPES = [
  'corvette', 'patrol_cutter', 'frigate', 'destroyer', 'cruiser', 'battleship', 'dreadnought',
  'light_carrier', 'fleet_carrier', 'super_carrier', 'healer', 'sensor_ship', 'builder_ship',
  'command_cruiser', 'light_hauler', 'bulk_freighter', 'armored_convoy', 'miner',
];

export const SHIPYARD_COMBAT_HULLS = COMBAT_HULL_TYPES.filter((h) => !CARRIER_WING_HULLS.includes(h));

/** UI grouping for empire build queue buttons. */
export const SHIP_HULL_CATEGORIES = {
  scout: { label: 'Scout', hulls: ['scout'] },
  escorts: { label: 'Escorts', hulls: ['corvette', 'frigate', 'patrol_cutter'] },
  line: { label: 'Line Warships', hulls: ['destroyer', 'cruiser', 'battleship', 'dreadnought'] },
  carriers: { label: 'Carriers', hulls: ['light_carrier', 'fleet_carrier', 'super_carrier'] },
  transports: { label: 'Transports', hulls: ['light_hauler', 'bulk_freighter', 'armored_convoy'] },
  support: { label: 'Support', hulls: ['healer', 'sensor_ship', 'builder_ship'] },
  special: { label: 'Special', hulls: ['miner', 'command_cruiser'] },
};

export const SHIP_LANE_SPEED = 100;
export const FLEET_STATION_ORBIT_PAD = 300;   // min distance beyond star edge for idle formation
export const FLEET_STATION_BODY_PAD = 95;     // orbit offset from shipyard planet
export const SHIP_LANE_MIN_LEG_MS = 2000;

// --- Flagship builder drones ---
export const BUILDER_DRONE_CAPACITY = 2;
export const BUILDER_DRONE_DEPLOY_COST = 40;
export const BUILDER_DRONE_LANE_SPEED = 150;
export const BUILDER_DRONE_LANE_MIN_LEG_MS = 1500;
export const BUILDER_DRONE_BUILD_TIME_MULT = 1.25;
export const BUILDER_DRONE_OUTPOST_BUILD_MS = 12000;
export const BUILDER_DRONE_SHIPYARD_BUILD_MS = 18000;
export const BUILDER_DRONE_BODY_STRUCTURE_BUILD_MS = 14000;

// --- Ship motion (ambient patrol + keep-out) ---
export const STAR_KEEP_OUT_PAD = 120;
export const STAR_KEEP_OUT_ORBIT_FRACTION = 0.88; // star repulsion fades out by innermost orbit
export const PLANET_KEEP_OUT_PAD = 80;
export const MOON_KEEP_OUT_PAD = 45;
export const AMBIENT_PATROL_RADIUS = 55;
export const AMBIENT_PATROL_OMEGA = 0.38;
export const AMBIENT_KEEP_OUT_PASSES = 3;    // render-only nudge (combat init uses more)
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
export const TACTICAL_LARGE_BATTLE_UNITS = 72;
export const TACTICAL_SWARM_BATTLE_UNITS = 150;
export const TACTICAL_SPATIAL_CELL = 360;

// --- Auto-resolve ---
export const STANCE_MODIFIERS = { aggressive: 1.2, balanced: 1.0, defensive: 0.85 };
export const HEALER_AUTO_COEF = 0.25;

// --- Pirates (Phase 2 test faction) ---
export const PIRATE_FLEET_COUNT = 2;
export const PIRATE_WANDER_MS = 45000;
export const PIRATE_RAID_CHANCE = 0.7;
export const PIRATE_RAID_MAX_HOPS = 5;
export const PIRATE_INTERDICTION_PROGRESS_DELTA = 0.16;
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
export const CAPTURE_STRUCTURE_WEIGHT = {
  outpost: 2,
  mining_complex: 2,
  refinery: 3,
  storage_depot: 2,
  fighter_factory: 4,
  planetary_shield: 5,
  ion_battery: 4,
  shipyard: 4,
  drydock: 4,
  orbital_defense: 5,
  sail_foundry: 6,
  dyson_launcher: 3,
  asteroid_harvester: 2,
  power_grid: 3,
  orbital_habitat: 3,
  nanoforge: 4,
  fleet_academy: 4,
  missile_silo: 4,
  interdiction_array: 5,
  carrier_command: 5,
  sensor_array: 3,
  solar_collector: 4,
  logistics_hub: 4,
  galactic_exchange: 4,
  salvage_yard: 3,
  wormhole_observatory: 5,
  quantum_archive: 4,
  embassy_complex: 3,
  trade_station: 3,
  research_station: 4,
  listening_post: 1,
  lane_relay: 1,
  blockade_fort: 2,
  forward_base: 2,
  supply_cache: 1,
  command_post: 3,
};
export const CAPTURE_DYSON_SHELL_WEIGHT = 2;
export const CAPTURE_FLAGSHIP_FORCE = 2;
export const CAPTURE_HOLD_MS = 20000;

// --- Galaxy generation (GDD §4–5, Phase 4) ---
export const GALAXY_STAR_COUNT = 400;
export const GALAXY_COUNT = 10;
export const GALAXY_RADIUS = 4250;               // scaled ~4.5× for 400-star density
export const GALAXY_INNER_RADIUS = 420;          // keep stars clear of the black hole
export const GALAXY_MIN_STAR_SPACING = 85;       // rejection-sampling minimum distance
export const GALAXY_EXTRA_LANE_MAX_DIST = 720;   // non-MST lanes must be shorter than this
export const GALAXY_TARGET_AVG_DEGREE = 3.35;    // stop adding extra lanes past this
export const GALAXY_MAX_DEGREE = 4;              // per-node lane cap
export const GALAXY_BACKBONE_SPOKE_COUNT = 18; // long-range shortcuts around the rim
export const GALAXY_SMALL_WORLD_LANES = 96;    // random chords to keep diameter low
export const BLACK_HOLE_MIN_LANES = 12;          // core hub keeps travel diameter low
export const DEAD_STAR_CHANCE = 0.18;            // probability a non-home star has 0 planets
export const OTHER_PLANET_COUNT_RANGE = [1, 5];  // planet roll for non-home stars

// --- Stronghold system (fixed roster, Phase 4) ---
export const STRONGHOLD_HABITABLE_COUNT = 5;
export const STRONGHOLD_BARREN_COUNT = 1;
export const STRONGHOLD_GAS_COUNT = 2;
export const STRONGHOLD_MOON_COUNT_RANGE = [1, 4];           // per habitable planet
export const STRONGHOLD_SECONDARY_MOON_COUNT_RANGE = [0, 2]; // barren + gas

// --- Wormholes (Phase 4) ---
export const WORMHOLE_TRANSIT_MS = 8000;
export const WORMHOLE_HAZARD_CREDIT_COST = 50;
export const WORMHOLE_ANCHOR_COST = 2000;
export const WORMHOLE_ANCHOR_BUILD_MS = 30000;

// --- Abstract galaxy simulation (Phase 4) ---
export const ABSTRACT_TICK_CREDITS_RATE = 0.15;   // aiCredits per tick
export const ABSTRACT_TICK_SOLARII_RATE = 0.002;  // aiSolarii per tick
export const ABSTRACT_TICK_DYSON_RATE = 0.0004;   // shell progress per tick
export const ABSTRACT_TICK_FLEET_RATE = 0.08;     // fleetPower per tick

// --- Flagship (GDD §8) ---
export const FLAGSHIP_ACCEL = 420;         // world units / s^2 while thrusting
export const FLAGSHIP_MAX_SPEED = 340;     // world units / s
export const FLAGSHIP_DRAG = 2.5;          // 1/s velocity damping while coasting
export const FLAGSHIP_RADIUS = 9;          // draw radius (world units)
export const FLAGSHIP_SPAWN_ORBIT = 580;   // spawn distance from the home star
export const FLAGSHIP_ENTRY_MARGIN = 280;  // arrival distance beyond the outermost orbit
export const FLAGSHIP_ENTRY_MIN_RADIUS = 1400;
export const FLAGSHIP_ORBIT_OMEGA = 0.07;           // rad/s — slow lazy local orbit
export const FLAGSHIP_ORBIT_PAD_STAR = 220;           // min radius beyond star corona
export const FLAGSHIP_ORBIT_PAD_PLANET = 70;          // min radius beyond planet surface
export const FLAGSHIP_ORBIT_PAD_MOON = 40;            // min radius beyond moon surface
export const FLAGSHIP_ORBIT_MAX_DISTANCE = 520;       // engage planet/moon orbit within this range
export const FLAGSHIP_ORBIT_STAR_MAX_DISTANCE = 920;    // engage star orbit within this range

// --- Lane transit ---
export const LANE_SPEED = 90;              // galaxy-map units per second
export const LANE_MIN_LEG_MS = 2500;       // floor so short lanes still read as travel

// --- Home system generation ---
export const HOME_SYSTEM_NAME = 'Solara Prime';
export const STAR_RADIUS = 200;
export const PLANET_COUNT_RANGE = [2, 3];        // legacy; stronghold uses fixed roster
export const PLANET_ORBIT_BASE = 1100;           // world units, first orbit
export const PLANET_ORBIT_SPACING = 720;         // gap between orbits
export const PLANET_RADIUS_RANGE = [22, 38];
export const PLANET_ORBIT_PERIOD_RANGE = [180000, 420000]; // ms per revolution
export const MOON_COUNT_RANGE = [1, 3];          // for the guaranteed habitable planet
export const MOON_ORBIT_BASE = 165;
export const MOON_ORBIT_SPACING = 85;
export const MOON_RADIUS = 12;
export const MOON_RADIUS_RANGE = [8, 16];
export const MOON_ORBIT_PERIOD_RANGE = [24000, 60000];

// --- Shuttles (visual only) ---
export const SHUTTLE_FLIGHT_MS = 4200;        // one leg: planet surface -> moon surface
export const SHUTTLE_MOON_DWELL_MS = 2500;    // parked on the moon
export const SHUTTLE_PLANET_DWELL_MS = 1600;  // turnaround on the planet surface
export const SHUTTLE_SIZE = 7;                // draw radius (world units)

// --- Dyson megastructure (Phase 3, GDD §6–7) ---
export const FOUNDRY_COST = 800;
export const LAUNCHER_COST = 250;
export const LAUNCHERS_PER_BODY_MAX = 3;
export const SHELL_SAILS_REQUIRED = 5000;
export const SHELL_COUNT = 8;
export const SAIL_CREDIT_COST = 3.0;
export const FOUNDRY_SAIL_RATE = 6;                // sails per second at base
export const LAUNCHER_BATCH_SIZE = 4;
export const LAUNCHER_LAUNCH_INTERVAL_MS = 1000;
export const SAIL_SHUTTLE_CAPACITY = 500;          // sails delivered per shuttle arrival at launcher
export const SOLARII_BASE_RATE = 0.08;             // per second at Shell #1, one system
// Index = completedShells (0 = none, 1–8 = active tier).
export const SOLARII_SHELL_MULTIPLIERS = [0, 1, 1.25, 1.5, 2, 2.5, 3.25, 4, 5];
// Index = completedShells; credit multiplier for outposts in that system.
export const SHELL_BONUS_CREDIT_MULT = [1, 1, 1.1, 1.1, 1.15, 1.2, 1.25, 1.3, 1.35];
// Index = completedShells; foundry sail rate multiplier.
export const SHELL_BONUS_SAIL_EFFICIENCY = [1, 1, 1, 1.15, 1.15, 1.2, 1.25, 1.3, 1.35];
export const SAIL_SHUTTLE_TRIP_MS = 1000;          // full foundry↔launcher round trip (one shuttle on route)
export const SAIL_SHUTTLE_SIZE = 2.8;
export const FOUNDRY_PLANET_PAD = 16;                // clearance beyond planet visual radius
export const FOUNDRY_RING_BAND_HALF = 9;           // half-thickness for planet/moon clearance checks
export const FOUNDRY_MOON_ORBIT_FRACTION = 0.68;   // ring center stays within this fraction of innermost moon orbit
export const FOUNDRY_CAGE_SPIN_OMEGA = 0.042;      // rad/s — whole megastructure rotation
export const FOUNDRY_RING_SPIN_OMEGA = 0.031;      // rad/s — extra spin on tilted rings
export const SHIPYARD_WORLD_RADIUS = 36;           // world units — scales with camera zoom
export const SHIPYARD_ORBIT_PAD = 32;              // fallback orbit pad when planet has no moons
export const SHIPYARD_MOON_CLEARANCE = 14;         // gap beyond moon orbit ring
export const SHIPYARD_SPIN_OMEGA = 0;              // hub mesh spin disabled (fixed orientation)
export const LAUNCHER_WORLD_RADIUS = 32;           // world units — scales with camera zoom
export const LAUNCHER_ORBIT_PAD = 48;              // orbital radius pad for sail launcher platforms
export const LAUNCHER_ORBIT_SPREAD = 0.52;         // rad — angular offset per launcher index on same body
export const LAUNCHER_RAIL_LENGTH = LAUNCHER_WORLD_RADIUS; // muzzle at end of visual rail
export const LAUNCHER_BURST_MS = 600;              // muzzle flash duration after fire
export const SAIL_LAUNCH_FLIGHT_MS = 900;          // sail particle flight launcher → star
export const SAIL_LAUNCH_STAGGER_MS = 35;          // stagger within one 4-sail batch
export const SAIL_DOT_SIZE = 0.8;                  // world units
export const SAIL_DOT_LOD_ZOOM = 0.35;             // full in-progress dot field above this zoom
export const SAIL_DOT_DRAW_MAX = 6000;             // hard cap with stride
export const SAIL_DOT_LOD_STRIDE_TARGET = 400;     // visible settled dots when zoomed out
export const DYSON_MESH_LOD_ZOOM = 0.28;           // below: simplified rings + node dots only
export const DYSON_CAGE_ROTATION_SPEED = 0.018;    // rad/s — geodesic cage spin (shell 5+)
export const DYSON_LATTICE_BLEND_PROGRESS = 0.6;   // shell progress fraction → lattice snap
export const DYSON_CONSTRUCTION_LATTICE_SLOTS = 800; // edge midpoints used for high-progress weave
export const DYSON_MAX_MESH_EDGES = 280;           // hard cap for Canvas draw cost

// --- Camera ---
export const CAMERA_MIN_ZOOM = 0.15;
export const CAMERA_MAX_ZOOM = 3.5;
export const CAMERA_DEFAULT_ZOOM = 0.38;
export const CAMERA_ZOOM_STEP = 1.1;   // per wheel notch
export const CAMERA_FOLLOW_RATE = 6;   // 1/s exponential approach toward the flagship
export const GALAXY_CAMERA_MIN_ZOOM = 0.04;
export const GALAXY_CAMERA_MAX_ZOOM = 2.2;
export const GALAXY_LOD_ZOOM = 0.12;             // below this: simplified lane pulses

// --- Phase 5: Empire layer ---
export const EMPIRE_QUEUE_MAX = 20;
export const RESEARCH_STATION_COST = 550;
export const RESEARCH_STATION_CAP = 3;
export const RESEARCH_STATION_BONUS = 0.15;
export const RESEARCH_BASE_MS = 45000;
export const TRADE_STATION_COST = 450;
export const TRADE_BASE_INCOME = 1.5;
export const TRADE_CONNECTIVITY_BONUS = 0.1;
export const MINING_COMPLEX_COST = 360;
export const REFINERY_COST = 520;
export const STORAGE_DEPOT_COST = 420;
export const FIGHTER_FACTORY_COST = 650;
export const PLANETARY_SHIELD_COST = 900;
export const ION_BATTERY_COST = 760;
export const DRYDOCK_COST = 700;
export const ORBITAL_DEFENSE_COST = 850;
export const ASTEROID_HARVESTER_COST = 480;
export const MINING_COMPLEX_INCOME_BONUS = 0.35;
export const REFINERY_TRADE_BONUS = 0.22;
export const STORAGE_BLOCKADE_REDUCTION = 0.18;
export const FIGHTER_FACTORY_REPLENISH_PER_SEC = 0.08;
export const DRYDOCK_REPAIR_PER_SEC = 4;
export const ORBITAL_DEFENSE_POWER = 32;
export const SHIELD_STRUCTURE_HP_MULT = 1.35;
export const ION_BATTERY_POWER = 26;

// --- Save-v13 building web + structure tiers ---
export const V13_BUILDING_COSTS = Object.freeze({
  power_grid: 600,
  orbital_habitat: 850,
  nanoforge: 900,
  fleet_academy: 950,
  missile_silo: 800,
  interdiction_array: 1200,
  carrier_command: 1100,
  sensor_array: 650,
  solar_collector: 1250,
  logistics_hub: 900,
  galactic_exchange: 1100,
  salvage_yard: 750,
  wormhole_observatory: 1600,
  quantum_archive: 1000,
  embassy_complex: 900,
});

export const V13_BUILDING_HP = Object.freeze({
  power_grid: 300,
  orbital_habitat: 460,
  nanoforge: 380,
  fleet_academy: 400,
  missile_silo: 340,
  interdiction_array: 500,
  carrier_command: 480,
  sensor_array: 300,
  solar_collector: 520,
  logistics_hub: 450,
  galactic_exchange: 420,
  salvage_yard: 380,
  wormhole_observatory: 600,
  quantum_archive: 390,
  embassy_complex: 360,
});

export const VETERANCY_XP_THRESHOLDS = Object.freeze([0, 50, 150, 300]);
export const VETERANCY_BONUS_PER_LEVEL = 0.05;
export const SALVAGE_HULL_RECOVERY_RATE = 0.2;
export const SALVAGE_CARRIER_CRAFT_RECOVERY_RATE = 0.25;

export const V13_BUILDING_EFFECTS = Object.freeze({
  powerGridCargo: 1.15,
  powerGridIndustry: 1.15,
  powerGridShieldHp: 1.2,
  habitatCargo: 1.1,
  habitatResearch: 1.1,
  nanoforgeThroughput: 1.15,
  academyStartingVeterancy: 1,
  academyMaxVeterancy: 3,
  veterancyBonusPerLevel: VETERANCY_BONUS_PER_LEVEL,
  missileAutoResolvePower: 12,
  interdictionRetreatCharge: 1.5,
  carrierWingCapacity: 1.25,
  carrierReplenishment: 1.25,
  sensorIntelHops: 1,
  sensorWeaponRange: 1.1,
  collectorFoundry: 1.15,
  collectorLauncher: 1.1,
  collectorSolarii: 1.05,
  logisticsDepotCapacity: 100,
  logisticsDispatchInterval: 0.8,
  logisticsConvoyRoutes: 1,
  exchangeNexusValue: 1.15,
  exchangeConvoyRoutes: 2,
  salvageHullRate: SALVAGE_HULL_RECOVERY_RATE,
  salvageCarrierRate: SALVAGE_CARRIER_CRAFT_RECOVERY_RATE,
  observatoryChargeRate: 1.25,
  archiveResearch: 1.15,
  archiveQueueSlots: 1,
  embassyTreatyCost: 0.8,
  embassyTreatyEffect: 1.1,
});

// Index is the stored level. Level 0 is unused but kept neutral for direct lookup.
export const STRUCTURE_LEVEL_EFFECT_MULTIPLIERS = Object.freeze([1, 1, 1.5, 2]);
export const STRUCTURE_LEVEL_HP_MULTIPLIERS = Object.freeze([1, 1, 1.5, 2]);
export const STRUCTURE_UPGRADE_COST_MULTIPLIERS = Object.freeze({ 2: 0.75, 3: 1.25 });
export const OUTPOST_LEVEL_CARGO_MULTIPLIERS = Object.freeze([1, 1, 1.25, 1.6]);
export const OUTPOST_LEVEL_STOCK_CAPACITY = Object.freeze([120, 120, 160, 220]);
export const SHIPYARD_LEVEL_BUILD_TIME_MULTIPLIERS = Object.freeze([1, 1, 0.9, 0.8]);
export const SHIPYARD_LEVEL_EXTRA_SLOTS = Object.freeze([0, 0, 1, 1]);

export const SHELL_TRADE_BONUS = 1.25;
export const SHELL_RESEARCH_BONUS = 1.2;
export const AI_STARTING_CREDITS = 1200;
export const AI_STARTING_SYSTEMS = 4;
export const AI_TICK_INTERVAL_TICKS = 20;
export const AI_BUILD_OUTPOST_COST = 300;
export const AI_PERSONALITY_NAMES = {
  expansionist: 'Dominion of Helix',
  economic: 'Veridian Compact',
  megastructure: 'Solar Architects',
  wormhole: 'Void Runners',
};
export const AI_FACTION_COUNT = 4;
export const AI_LANE_SPEED = 90;
export const AI_LANE_MIN_LEG_MS = 2500;

// --- Phase 6: Late game ---
export const SHELL_SHIELD_BONUS = 1.25;
export const SHELL_REPAIR_BONUS = 1.2;
export const DYSON_SHIELD_TECH_MULT = 1.15;
export const DYSON_SHIELD_COOLDOWN_MS = 180000;
export const SUPERWEAPON_CRADLE_COST = 5000;
export const SUPERWEAPON_CRADLE_SOLARII = 10;
export const SUPERWEAPON_CREATE_SOLARII = 25;
export const SUPERWEAPON_DESTROY_SOLARII = 30;
export const SUPERWEAPON_JUMP_SOLARII = 15;
export const SUPERWEAPON_COOLDOWN_MS = 120000;
export const SUPERWEAPON_JUMP_COOLDOWN_MS = 90000;
export const HERO_FLAGSHIP_COST_CREDITS = 2000;
export const HERO_FLAGSHIP_COST_SOLARII = 5;
export const HERO_FLAGSHIP_HP = 800;
export const HERO_FLAGSHIP_DPS = 15;
export const HERO_FLAGSHIP_CAPTURE_FORCE = 2;
export const HERO_FLAGSHIP_BUILD_MS = 45000;
export const HERO_FLAGSHIP_LANE_SPEED = 110;
export const DIPLOMACY_TRUCE_COST = 500;
export const DIPLOMACY_TRADE_TREATY_COST = 800;
export const DIPLOMACY_ALLIANCE_COST = 1500;
export const DIPLOMACY_ALLIANCE_SOLARII = 3;
export const DIPLOMACY_TRADE_INCOME_BONUS = 0.2;
export const AI_PANIC_DURATION_MS = 120000;
export const LISTENING_POST_COST = 600;
export const LANE_RELAY_COST = 750;
export const BLOCKADE_FORT_COST = 900;
export const FORWARD_BASE_COST = 700;
export const SUPPLY_CACHE_COST = 500;
export const COMMAND_POST_COST = 850;
export const LANE_RELAY_SPEED_BONUS = 0.15;
export const BLOCKADE_TRADE_PENALTY = 0.35;
export const FORWARD_BASE_CAPTURE_BONUS = 1;
export const SUPPLY_CACHE_REPAIR_BONUS = 1.15;
export const COMMAND_POST_CAPTURE_REDUCTION = 1;
export const LISTENING_POST_INTEL_BONUS = 1;
export const VICTORY_DOMINION_THRESHOLD = 0.35;
export const VICTORY_ECONOMIC_CREDITS = 50000;
export const VICTORY_ECONOMIC_SOLARII = 50;
export const VICTORY_SCULPTOR_ACTIONS = 3;

// --- Rendering ---
export const STARFIELD_COUNT = 320;
export const STARFIELD_SPREAD = 10500;         // half-extent of background starfield
export const CELESTIAL_VISUAL_SCALE = 1.35;    // render-only body size multiplier
export const SELECTION_PULSE_MS = 1600;
export const BATTLE_RENDER_LOD_UNITS = 64;
export const BATTLE_RENDER_SWARM_UNITS = 140;
export const BATTLE_TRACER_LIMIT = 96;
export const STAR_BLOOM_SCALE = 1.0;           // bloom FBO resolution fraction (full res avoids blocky upscale)
export const STAR_BLOOM_THRESHOLD = 0.38;      // luminance threshold for HDR bloom
export const STAR_GL_QUALITY = 'high';        // 'high' | 'medium' | 'low'
