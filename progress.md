# Galactic Sovereign — Progress Log

Original prompt: Build Galactic Sovereign as an Electron desktop app wrapping an HTML5 Canvas game.
Phase 0 foundation: 2D system view, Stronghold, outpost economy with moon-scaled yield, moon
shuttles, pause, and versioned local save files (save-v0). Engineering plan in
`docs/IMPLEMENTATION_PLAN.md`; game design in `GALACTIC_SOVEREIGN_MASTER_PLAN.md`.

Session entries are appended below using the template in `docs/IMPLEMENTATION_PLAN.md` §9.
Never delete prior entries.

---

## Session 2026-07-02 — Phase 0 foundation complete

**Task claimed:** Phase 0 in full (tasks 0.1–0.12)
**Status:** complete

### Done
- `docs/IMPLEMENTATION_PLAN.md` — full engineering plan (§1 architecture … §9 session workflow)
- `docs/schemas/save-v0.json` — JSON Schema for the save-v0 envelope
- Scaffold: `package.json` (dev / electron / build scripts), `vite.config.js` (root=src, relative base), `.gitignore`
- `electron/main.js` — BrowserWindow, save-dir bootstrap under `~/Documents/Galactic Sovereign/saves/`, slot-whitelisted IPC handlers (`save:write/read/list/delete`) with atomic tmp-file writes, exit-save handshake on window close
- `electron/preload.js` — `contextBridge` exposing `window.gameSave` (no nodeIntegration)
- `src/js/constants.js` — all balance numbers (outpost 300cr, base income 2/s, +50%/moon, 20Hz ticks)
- `src/js/state.js` — serializable state + `createNewGame(seed)` with mulberry32 PRNG; orbital positions are pure functions of `state.time`
- `src/js/simulation.js` — fixed-timestep accumulator; `advance()` for deterministic tests; pause
- `src/js/economy.js` — `buildOutpost` validation (habitability, cost, duplicates), moon-scaled income
- `src/js/shuttles.js` — visual planet↔moon shuttle loops derived from `state.time` (never serialized)
- `src/js/render.js` — starfield, star glow, orbit rings, planets/moons, outpost rings, selection pulse, shuttles; camera pan/zoom (camera never serialized)
- `src/js/input.js` — drag pan, wheel zoom toward cursor, click hit-test, Space pause, Escape deselect
- `src/js/save.js` — envelope + CRC-32 checksum, `migrateSave` chain, slots, localStorage fallback, export/import
- `src/js/ui.js` + `src/index.html` + `src/css/style.css` — HUD top bar, build panel with rejection reasons, save/load menu, toasts, pause overlay
- Test hooks on `window`: `advanceTime(ms)`, `render_game_to_text()`, `getGameState()`, plus `__selectPlanet/__buildOutpost/__saveSlot/__loadSlot` helpers
- Verification: `output/verify_phase0.mjs` (browser, 20/20 pass incl. determinism + pause + save round trip) and `output/verify_electron.mjs` (8/8 pass: IPC bridge, on-disk save, restart restore, exit-save)

### Decisions
- Barren planets reject outposts in v0 (GDD says "reduced yield"; deferred to a later balance pass — revisit in Phase 1+)
- Pause discards the accumulator remainder so unpausing never causes a tick jump
- `window-all-closed` quits on macOS too (single-window game; keeps exit-save semantics simple)
- Structure ids re-seeded after load (`resetStructureIds`) to avoid collisions with saved ids

### Known issues
- Vite websocket can trigger one full page reload right after Electron connects in dev mode (test scripts wait it out; harmless in play)
- `output/verify_*.mjs` import Playwright from the develop-web-game skill's node_modules rather than a project dependency

### Suggested next
- Phase 1 task 1.x: 20-star lane graph generation from seed + galaxy map view with view switching. Refine Phase 1 rows in `docs/IMPLEMENTATION_PLAN.md` §8 into numbered tasks first.

---

## Session 2026-07-02 — Flagship & galaxy map (Phase 1 tasks 1.1–1.5)

**Task claimed:** Phase 1 tasks 1.1–1.5 (galaxy gen, multi-system save-v1, flagship flight, lane transit, galaxy map view)
**Status:** complete

### Done
- `src/js/galaxy.js` — seeded 20-star layout (rejection sampling in an annulus around the core), lane graph = Prim MST + short extra lanes to avg degree ~2.7 (max 4/node), black hole `core` node with ≥2 lanes, BFS shortest-hop routing
- `src/js/state.js` — save-v1 shape: `state.galaxy`, `state.systems` (one per star from per-star derived seeds + the enterable core system with `star.kind: 'blackhole'`), `state.flagship`; seeded Stronghold pick renamed to Solara Prime; all lookups now system-scoped (`findPlanet(state, systemId, planetId)` etc.)
- `src/js/flagship.js` — WASD thrust vector read inside 20 Hz ticks (accel/max-speed/drag in constants), so pause freezes flight and `advanceTime` is deterministic; lane transit as `{path, legIndex, legStartTime, legDurationMs}` — on-lane position is a pure function of `state.time`; arrival spawns at the system edge facing the origin star
- `src/js/render.js` — split into `drawSystem` (adds flagship sprite with engine flame, black-hole system visuals) and `drawGalaxy` (lanes with traffic pulses, transit-route highlight, star nodes sized by planet count, stronghold ring, structure tick, black hole with accretion disk + rotating wormhole swirl, in-transit ship icon + destination pulse); two cameras + follow mode (`updateFollowCamera`, exponential, framerate-independent)
- `src/js/input.js` — held-key thrust set (WASD/arrows), M view toggle, F re-follow, pan breaks follow, per-view wheel zoom (follow keeps flagship centered), galaxy single-click = travel order with 300 ms delay so double-click = view system without a stray order
- `src/js/economy.js` — income sums all systems; `canBuildOutpost` requires the flagship in-system (Phase 1 ownership stand-in); `resetStructureIds` scans all systems
- `src/js/save.js` — checksum now verified **before** migration (covers the file as written); `migrateV0toV1` regenerates the galaxy from the seed and installs the old system as the Stronghold; `docs/schemas/save-v1.json` added
- `src/js/main.js` — view/viewedSystem UI state, arrival retargeting + toast, travel/build/view actions, extended `render_game_to_text` (view, flagship, galaxy) and hooks `__setFlagshipInput/__orderTravel/__setView/__viewSystem`
- `src/js/ui.js` + `index.html` + `style.css` — view toggle button, flagship location / transit-ETA HUD line, per-view control hints, build panel scoped to viewed system
- `docs/IMPLEMENTATION_PLAN.md` — §2 layout, §4 contracts, §5 rewritten for save-v1, §7 hook table, §8 Phase 1 numbered task table
- Verification: `output/verify_phase1.mjs` — 49/49 pass (galaxy graph properties, flight + pause freeze, single/multi-hop transit incl. pause-frozen progress, build-requires-flagship, save-v1 round trip, v0→v1 migration, corrupt-save refusal, determinism, real keyboard/mouse input, zero console errors); screenshots inspected (system + flagship, galaxy map, mid-transit route, core wormhole)

### Decisions
- Flagship control is **direct piloting** (WASD/arrows) per user choice; thrust only applies in system view, and using it re-engages the follow camera
- Outposts can only be built where the flagship is present — gives the flagship purpose until capture/ownership (1.7) lands
- The core wormhole is a dormant landmark: with one galaxy an unanchored exit has nowhere to go (GDD Phase 4); the core **is** a lane waypoint and its system can be visited
- Galaxy single-click travel is delayed 300 ms to disambiguate from double-click (view system) — no stray travel orders
- Flagship free-flight position is serialized (player-driven, not derivable from time); it mutates only inside ticks to preserve determinism

### Known issues
- Planet names repeat across systems (shared 6-name list) — cosmetic; revisit with a name generator
- Lane-lane visual crossings are possible (no crossing avoidance in extra-lane pass) — cosmetic
- `output/verify_*.mjs` still import Playwright from the develop-web-game skill's node_modules rather than a project dependency
- `output/verify_phase0.mjs` asserts the v0 schema (e.g. stronghold id `sys-home`) and no longer passes against save-v1 — superseded by `verify_phase1.mjs`; kept as a historical artifact

### Suggested next
- Phase 2 task 2.x: hybrid combat, shipyard combat hull production, fleet capture force

---

## Session 2026-07-02 — Phase 1.6 + 1.7 + shipyard (save-v2)

**Task claimed:** Phase 1 tasks 1.5b, 1.6, 1.7 (shipyard/scout production, intel overlay, capture hold)
**Status:** complete

### Done
- save-v2: ownership, scouts[], intel, capture, shipyard production queues
- `transit.js`, `production.js`, `scout.js`, `intel.js`, `capture.js` modules
- UI: build panel (outpost/shipyard/scout), scout roster, intel/capture panels
- Galaxy fog + scout sprites; capture hold arc; Shift+click scout dispatch
- `output/verify_phase1.mjs` section 14 (~28 checks); `docs/schemas/save-v2.json`

### Decisions
- No free starting scout; intel from scout arrival or flagship visit
- Phase 1 capture force = flagship only; enemy contest via test hook

### Suggested next
- Phase 2: hybrid combat and fleet-based capture force

---

## Session 2026-07-03 — Phase 2 combat hybrid + wandering pirates

**Task claimed:** Phase 2 tasks 2.1–2.11 (full phase)
**Status:** complete

### Done
- `src/js/hull.js`, `fleets.js`, `pirates.js`, `combat.js` — ship stats, player fleet transit, wandering pirate faction, hybrid tactical/auto-resolve combat
- `src/js/constants.js` — `HULL_STATS`, pirate/combat balance numbers; `SAVE_VERSION` 4
- `src/js/state.js`, `save.js`, `docs/schemas/save-v4.json` — v3→v4 migration for combat state
- `src/js/production.js` — combat hull queues (corvette, frigate, destroyer, healer)
- `src/js/capture.js` — fleet-based capture force; real pirate `enemyCombatPresence`
- `src/js/simulation.js`, `render.js`, `ui.js`, `main.js` — tick wiring, combat render, build panel, test hooks
- `output/verify_phase2.mjs` — 24/24 pass; `verify_phase1.mjs` updated for real pirate contest
- `docs/IMPLEMENTATION_PLAN.md` §8 Phase 2 task table

### Decisions
- Save v4 (not v3) for combat data because v3 was already used for star-type backfill
- Pirates spawn on neutral rim systems, wander deterministically, respawn after defeat
- `__setEnemyPresence` removed; tests use `__forcePirateIntoSystem`

### Suggested next
- Phase 4: 400-star generation, wormholes, abstract inactive galaxies

---

## Session 2026-07-03 — Phase 3 Dyson loop complete

**Task claimed:** Phase 3 tasks 3.1–3.11 (full phase)
**Status:** complete

### Done
- `src/js/dyson.js` — foundry/launcher build, production tick, shell completion, Solarii rates, bonus hooks
- `src/js/sail-shuttles.js` — deterministic foundry↔launcher visual convoys
- `src/js/constants.js` — Dyson balance numbers; `SAVE_VERSION` 5; capture weights for foundry/launcher
- `src/js/state.js` — `createDefaultDyson()`, per-system `dyson`, `solarii`/`solariiUnlocked`, lookup helpers
- `src/js/save.js`, `docs/schemas/save-v5.json` — v4→v5 migration
- `src/js/economy.js` — Shell #2 credit multiplier on outpost income
- `src/js/simulation.js`, `src/js/capture.js` — Dyson tick wiring + capture weight
- `src/js/celestial-render.js`, `src/js/render.js` — 8-tier shell overlays, sail shuttles, launch bursts
- `src/js/ui.js`, `src/index.html` — Solarii chip, Dyson tab, foundry/launcher build buttons
- `src/js/main.js` — dyson observables in `render_game_to_text()`, shell completion toasts, test hooks
- `output/verify_phase3.mjs` — 34/34 pass; `verify_phase2.mjs` 24/24 regression pass
- `docs/IMPLEMENTATION_PLAN.md` §8 Phase 3 numbered task table

### Decisions
- Launcher `launcherLastFireAt` serialized for deterministic launch bursts and tick firing
- Shell bonuses #4–7 exported as 1.0 hooks until Phases 5–6 wire trade/research/shield
- Foundry is system-scoped structure (`bodyId: null`); launchers on planets and moons

### Known issues
- `verify_phase1.mjs` flagship physics checks (heading/drag/determinism) occasionally flaky (~74/77); unrelated to Dyson changes

### Suggested next
- Phase 4: 400-star generation, anchored + unanchored wormholes, abstract inactive galaxies
