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

---

## Session 2026-07-04 — Flagship orbit + Sail Foundry ring station

**Task claimed:** Stable flagship orbit (O key); Sail Foundry as animated three-ring megastructure on host planet; develop-web-game verification
**Status:** complete

### Done
- `src/js/flagship.js` — stable orbit mode (`toggleFlagshipOrbit`, keep-out disabled while orbiting, heading follows velocity); orbit state serialized on `flagship.orbit`
- `src/js/foundry-render.js` — three intersecting solid rings with amber emissive edges
- `src/js/sail-shuttles.js` — foundry anchored to host planet `bodyId`; ring radius computed inside innermost moon orbit with planet clearance; lazy cage + counter-rotating ring animation
- `src/js/dyson.js` — foundry build requires planet selection (`bodyId` on structure)
- `src/js/ui.js` — foundry lore notes in build + Dyson panels
- `src/js/main.js` — orbit/foundry observables in `render_game_to_text()`; hooks `__toggleOrbit`, `__buildFoundry(planetId)`
- `output/verify_foundry_orbit.mjs` — 12/12 pass (orbit enter/move/heading/exit, foundry sizing, animation, KeyO, zero console errors)
- Screenshots inspected: `output/web-game/foundry-orbit/` (rings inside moon orbit on Boreas; UI notes visible)

### Decisions
- Foundry is one per system but **orbits the planet it was built on** (not the star)
- Ring center radius = midpoint of `[planetSurface + pad, firstMoonOrbit × 0.68 − bandHalf]`
- Orbit keep-out fully off while `flagship.orbit` set (manual flight unchanged)
- Playwright client + `advanceTime` used for deterministic verification per develop-web-game skill

### Known issues
- Planets with zero moons use `MOON_ORBIT_BASE` as outer sizing reference (still safe, less precise)
- `progress.md` Phase 3 note says foundry `bodyId: null` — superseded by this session

### Suggested next
- Optional: draw foundry only when intel + zoom threshold; moon collision pass for shuttles through ring band
- Phase 4 per prior roadmap

## Session 2026-07-04 — Outpost landing pads & moon mining rigs

**Task claimed:** Physical landing pads on shuttle route endpoints; mining rigs on moons with outposts
**Status:** complete

### Done
- `src/js/surface-structures.js` — shared `surfacePoint()`; `outpostSurfaceSites()` for planet pads, moon pads, and rigs (active flags tied to shuttle cycle)
- `src/js/surface-structures-render.js` — `drawLandingPad()` (octagonal pad, cyan when active) and `drawMiningRig()` (drill tower + spark when active)
- `src/js/shuttles.js` — imports shared `surfacePoint` (same touchdown coords as visuals)
- `src/js/render.js` — draws moon pads/rigs after moons, planet pad after planet disk
- `src/js/main.js` — `surfaceSites` counts in `render_game_to_text()`
- `output/verify_foundry_orbit.mjs` — 20/20 pass including outpost pad/rig checks; screenshot `04-surface-pads-rigs.png`

### Decisions
- Pads/rigs only appear when intel + outpost on a planet with moons (same gate as shuttle traffic)
- Rig placed offset from moon landing pad; animates drill + spark while shuttle is on moon or in flight
- Planet pad lights during dwell/outbound; moon pad during dwell/inbound

## Session 2026-07-04 — Orbital shipyard + sail launcher models

**Task claimed:** Physical structure models for shipyard (ring station) and sail launcher (orbital rail); both in fixed orbit around host body; launcher always faces star
**Status:** complete

### Done
- `src/js/structure-sites.js` — fixed orbital slots from structure id; star-facing launcher heading; dock/muzzle positions
- `src/js/structure-render.js` — `drawShipyardStation`, `drawSailLauncher`, `drawLaunchMuzzleFlash`
- `src/js/render.js` — orbital draw order; softened shipyard glow ring; rail-aligned launch flashes
- `src/js/sail-shuttles.js` — convoys dock at orbital launcher platforms
- `src/js/constants.js` — `SHIPYARD_ORBIT_PAD`, `LAUNCHER_ORBIT_PAD`, rail/burst tuning
- `src/js/main.js` — `structureVisuals` in `render_game_to_text()`
- `output/verify_foundry_orbit.mjs` — 35/35 pass; screenshot `05-shipyard-launcher.png`

### Decisions
- Shipyard: cyan tiered ring hub + drydock arms; scaffold + hull silhouette while `shipyard.build` active; hub mesh spin only
- Launcher: fixed orbital slot; heading `atan2(-y,-x)` toward star; no platform rotation
- Launch bursts originate at rail muzzle along star heading

## Session 2026-07-04 — Dyson sail particles + foundry supply ties

**Task claimed:** Foundry-to-launcher supply ties, sail launch particles, hybrid Dyson rendering (dots while building, solid rings when complete)
**Status:** complete

### Done
- `src/js/constants.js` — `SAIL_LAUNCH_FLIGHT_MS`, `SAIL_LAUNCH_STAGGER_MS`, `SAIL_DOT_*` LOD tuning
- `src/js/dyson-visuals.js` — `foundryRingClosestPoint`, supply lines, settled/in-flight sail dot derivation, `dysonVisualSummary`
- `src/js/dyson-render.js` — `drawFoundrySupplyTie`, `drawCompletedShellRings`, `drawInProgressSailDots` with zoom LOD
- `src/js/sail-shuttles.js` — shuttles route from closest foundry ring point to launcher dock
- `src/js/render.js` — hybrid star draw after GL pass; supply ties after foundry rings; trimmed `drawStarOverlays` tier arcs
- `src/js/celestial-render.js` — completed-shell arcs removed (radial glow + shell-8 stroke only)
- `src/js/main.js` — `dysonVisuals` observables; `__sailShuttleInfo`, `__pointNearSupplySegment` test hooks
- `output/verify_dyson_sails.mjs` — 27/27 checks + foundry orbit regression; screenshot `06-hybrid-rings-dots.png`

### Decisions
- **In-progress shell only:** up to 5000 gold dots on the next ring radius; completed shells 1..8 render as solid amber rings (no per-sail dots)
- In-flight particles: 8 per launcher fire, staggered 35 ms, 900 ms flight from muzzle to target slot; all derived from `state.time` + dyson counters (never serialized)
- Supply tie: dashed amber line from closest equatorial foundry ring point to each launcher dock
- Zoom LOD: stride to ~400 visible settled dots below `SAIL_DOT_LOD_ZOOM` (0.35); always draw all in-flight sparks

---

## Session 2026-07-04 — Phase 4 scale & wormholes

**Task claimed:** Phase 4 tasks 4.1–4.12
**Status:** complete

### Done
- `src/js/constants.js` — `SAVE_VERSION=6`, 400 stars / 10 galaxies, wormhole/abstract/stronghold constants, scaled spatial params
- `docs/schemas/save-v6.json` — multi-galaxy + wormhole registry schema
- `src/js/galaxy.js` — 400-star BFS-from-core graph + backbone/small-world shortcuts; `graphStats()`, `galaxyGraphFingerprint()`; spatial-bucket lane candidates
- `src/js/state.js` — `generateStrongholdSystem()` (5 habitable / 1 barren / 2 gas); multi-galaxy `createNewGame()`
- `src/js/galaxy-scope.js`, `hydration.js`, `abstract-galaxy.js`, `wormholes.js` — scoped accessors, hydrate/dehydrate, abstract tick, wormhole travel + anchors
- Refactored Phase 1–3 modules for galaxy scope (`flagship`, `scout`, `fleets`, `pirates`, `economy`, `intel`, `capture`, `combat`, `production`, `dyson`, `simulation`, `render`, `ui`, `save`)
- `src/js/render.js` + `src/index.html` + `src/js/ui.js` — viewport culling, lane LOD, wormhole panel, galaxy name HUD
- `src/js/main.js` — extended `render_game_to_text()` + Phase 4 test hooks (`__enterWormhole`, `__completeWormholeTransit`, etc.)
- `output/verify_phase4.mjs` — 39/39 checks; `output/verify_phase3.mjs` updated for save-v6 shape (34/34); `output/verify_phase1.mjs` star count → 400
- `docs/IMPLEMENTATION_PLAN.md` — §5 save-v6, §7 hooks, §8 Phase 4 table

### Decisions
- One hydrated galaxy at a time; dehydrate outgoing galaxy on wormhole departure, merge player overlays into abstract blob
- BFS spanning tree from core (not greedy MST) keeps lane-graph diameter in the 10–35 hop band at 400 stars
- Stronghold star picked randomly per galaxy sub-seed; home galaxy stronghold uses fixed planet roster with shuffled orbit slots
- Verify scripts use `state.paused` and `__completeWormholeTransit()` instead of keyboard / long `advanceTime` during wormhole tests

### Known issues
- Full galaxy hydration (~400 systems) has a noticeable one-time hitch on wormhole entry (acceptable per plan)
- `graphDiameter()` is O(n²) — fine for tests; not called in the live loop

### Suggested next
- Phase 6: Superweapon, hero flagships, diplomacy, missions

---

## Session 2026-07-04 — Phase 5 empire layer

**Task claimed:** Phase 5 tasks 5.1–5.38
**Status:** complete

### Done
- `SAVE_VERSION=7`; `docs/schemas/save-v7.json`; `migrateV6toV7`
- New modules: `empire-queue.js`, `tech-web.js`, `research.js`, `trade.js`, `ai-faction.js`, `ai-ships.js`
- Empire-wide build queue with stronghold-based dispatcher, pin, cancel/refund, multi-slot shipyards (`mil_parallel_dock`)
- 18-node tech web; research stations (3/system); dual-currency research after Shell #1
- Trade stations + connected-component income; shell #5/#6 bonuses wired in `dyson.js`
- AI faction (Dominion of Helix): rim cluster seed, economy tick, expansion, capture contest, hydration overlays
- UI: empire queue panel, Tech tab, trade HUD chip, build buttons
- Test hooks + `render_game_to_text()` blocks for queue/research/trade/factions/aiShips
- `output/verify_phase5.mjs` — 24/24; `verify_phase3.mjs` + `verify_phase4.mjs` updated for save-v7

### Decisions
- Dispatcher reference point: stronghold (not flagship)
- `aiShips[]` parallel fleet model; pirates remain non-territorial
- AI contests player capture but does not capture player systems in Phase 5
- Credits deducted on empire enqueue; 100% refund on cancel before assignment

### Known issues
- Tech web UI is list-first (no force-directed graph)
- Manual trade routes deferred to Phase 6

### Suggested next
- Phase 6 tasks: Superweapon cradle, hero flagships, diplomacy unlock

---

## Session 2026-07-06 — Cinematic visuals + large battle performance pass

**Task claimed:** Visual overhaul for a more cinematic presentation; system-view battle rendering and tactical tick performance for large fights
**Status:** complete

### Done
- Added cinematic palette hooks and tactical battle LOD constants.
- Added a system-view cinematic backdrop/grade layer with nebula wash, dust bands, vignette, and battle-alert tint.
- Added lightweight ship glyph rendering for high-density battles and ambient fleet clusters.
- Added pooled tactical resolution for large battles, with individual unit drift/tracer cues preserved for the system view.
- Updated medium tactical combat to reuse live-unit buckets and spatial target lookup.
- Replaced all-system capture and AI neutral-capture tick scans with candidate-driven checks to keep large ship counts from slowing every fixed tick.
- Strengthened HUD tokens, panel surfaces, button states, and viewport frame lighting.
- Added `output/verify_cinematic_battle.mjs` for a 176-unit system-view stress scenario and screenshot capture.

### Notes
- Detailed ship sprites remain the close-up/default path; large fights switch to lighter glyph rendering by zoom and unit count.
- Verification: `npm run build`; `node output/verify_cinematic_battle.mjs` (5/5, 5s large-battle sim in 538ms); `node output/verify_phase6.mjs` (41/41); `node output/verify_battle_groups.mjs` (19/19); targeted player/AI capture smoke tests.
- Older `verify_phase1.mjs` and `verify_phase2.mjs` still reference pre-v9 direct state fields such as `state.galaxy`/`state.systems`; they fail before reaching current combat/capture coverage.

---

## Session 2026-07-06 — Detailed stars + working flares

**Task claimed:** Make stars look more realistic/detailed and make stellar flares visibly work
**Status:** complete

### Done
- `src/glsl/star.frag` — richer photosphere shader with layered convection cells, faculae, deterministic sunspot fields, warmer/broader solar flare jets, and stronger flare visibility at normal system zooms.
- `src/js/star-types.js` — enabled `flareBursts` on active stellar profiles and added granulation/prominence coverage for flare stars and red dwarfs.
- `src/js/celestial-render-canvas2d.js` — fixed fallback draw order so granulation is drawn over the core instead of hidden beneath it; wired the previously unused flare-burst fallback renderer.
- `output/verify_star_visuals.mjs` — new Playwright visual check that captures yellow-dwarf and flare-star closeups and verifies corona/plume/detail pixels plus shader console health.

### Verification
- `npm run build`
- Required `develop-web-game` Playwright client completed and produced `output/web-game/shot-0.png`
- `node output/verify_star_visuals.mjs` — 4/4 pass
- `node output/verify_phase6.mjs` — 41/41 pass
- `node output/verify_cinematic_battle.mjs` — 5/5 pass

### Notes
- `output/verify_visuals.mjs` is still an older direct-state fixture and fails on `state.systems[...]` before exercising current visuals.

---

## Session 2026-07-05 — Phase 6 late game complete

**Task claimed:** Phase 6 tasks 6.0–6.50
**Status:** complete

### Done
- `SAVE_VERSION=9`; `docs/schemas/save-v9.json`; `migrateV8toV9`
- New modules: `milestones.js`, `superweapon.js`, `hero-flagships.js`, `diplomacy.js`, `trade-routes.js`, `campaign.js`, `missions.js`, `tutorial.js`, `strategic-structures.js`
- Milestone gates: diplomacy at 1× Shell #8, superweapon at 3× distinct completed spheres
- Wired shell #4 shield and #7 repair bonuses in `dyson.js`
- 14 Phase 6 tech nodes (diplomacy, superweapon, flagship clusters) + UI cluster labels
- Superweapon cradle, create/destroy/jump, Dyson shield counterplay, graph mutation
- Hero flagships: build at cradle, lane transit, tactical anchor via `heroInSystem`
- Diplomacy: truce/trade/alliance treaties; 3 AI factions; superweapon panic
- Manual trade routes with income bonus; campaign victory/defeat; 6 missions; 8-step tutorial
- Strategic structures module (listening post, lane relay, blockade fort, forward base, supply cache, command post)
- UI: Diplomacy + Campaign tabs; extended `render_game_to_text()` Phase 6 blocks
- `output/verify_phase6.mjs` — 28/28 pass; phase3/4/5/battle_groups regression updated for save-v9
- `docs/IMPLEMENTATION_PLAN.md` §8 Phase 6 task table populated

### Decisions
- `factions.list[]` array for multi-AI with `factions.ai` alias to primary
- Diplomacy trade bonus stacks with manual route bonus
- Superweapon destroy triggers diplomacy panic (war with non-allies)
- Campaign defeat on flagship HP = 0 via `__destroyFlagship` test hook

### Suggested next
- Post–Phase 6 polish: balance pass on strategic structure costs, additional mission chains

---

## Session 2026-07-06 — Phase 6 polish & complete plan

**Task claimed:** Finish remaining Phase 6 gaps (UI wiring, strategic structure effects, hero anchoring, verify expansion)
**Status:** complete

### Done
- `src/js/tips.js` — contextual milestone toasts (diplomacy, superweapon, manual trade routes)
- Strategic structure effects wired: listening post intel extension, lane relay transit speed, blockade trade penalty, forward base/command post capture bonuses, supply cache repair multiplier
- `trade.js` — `trade_lane_secured` bridge logic; blockade multiplier in trade graph
- Hero battle-group anchoring: `anchorHeroId`, capture force from anchored groups, combat presence, fleet tab UI + rally picker
- Galaxy UI: manual trade route drawing (Ctrl+click), superweapon panel, new-game modal, hero flagship sprites, superweapon cinematic glow placeholder
- `constants.js` — `AI_FACTION_COUNT = 4`; per-faction AI diplomacy contest in `ai-faction.js`
- `tutorial.js` — step 8 diplomacy beat; `output/verify_phase6.mjs` — **41/41** checks (jump, manual trade, treaties, tech gates, hero anchor, structures, missions, tutorial, 4 AI factions)

### Decisions
- New-game modal auto-shown on boot; `__newGame` closes it for headless verify
- Strategic structure build buttons on planet panel when intel + selection present
- Hero anchor contributes capture force via `captureForceFromAnchoredGroups` without duplicating hero tactical bonus

### Known issues
- Full regression suite (`verify_phase3`–`5`) is slow (~30+ min sequential); phase 6 verify is the Phase 6 exit gate

### Suggested next
- Electron packaging smoke test; optional Pixi migration if canvas profiling demands it

---

## Session 2026-07-07 — Tech unlock enforcement

**Task claimed:** Ensure tech tree lock/unlock nodes enforce the behavior they describe
**Status:** complete

### Done
- `src/js/tech-web.js` — added a shared `isEmpireHullUnlocked()` helper and tracked the Hero Flagship unlock flag without putting hero hulls into ordinary shipyard queues
- `src/js/production.js` — local/direct shipyard hull queues now reject locked hulls, matching the empire queue UI
- `src/js/diplomacy.js` — treaty actions now require their matching tech nodes before charging credits/Solarii: Truce Protocol, Trade Charter, Alliance Pact; Embassy Network now contributes its trade bonus
- `output/verify_tech_unlocks.mjs` — focused unlock contract checks for hull gates, treaty gates, and hero queue separation
- Updated affected verification setup in `output/verify_phase2.mjs` and `output/verify_phase6.mjs` so tests unlock tech before using gated actions

### Verification
- `node output/verify_tech_unlocks.mjs` — 13/13 pass
- `npm run build` — pass
- Web-game Playwright client — gameplay screenshot inspected at `output/web-game/tech-unlocks-client/shot-1.png`; no captured browser errors
- `node output/verify_phase6.mjs` — 41/41 pass

### Suggested next
- Optional broader balance pass: several non-unlock tech effects, such as wormhole anchor discounts and generic credit modifiers, should be audited separately if the goal expands from unlock enforcement to every numeric tech bonus.

---

## Session 2026-07-07 — Buildings, carrier wings, and weapon profiles

**Task claimed:** Implement post-Phase-6 building roster slice, carrier-deployed fighters, anti-fighter/specialized combat, and low-clutter visuals
**Status:** partial

### Done
- `src/js/body-structures.js` — added tech-gated surface/orbital/star-node building definitions, build validation, costs/caps, HP defaults, economy/trade/defense effects, drydock repair, and fighter-factory wing replenishment.
- `SAVE_VERSION=10`; `docs/schemas/save-v10.json`; `migrateV9toV10` backfills structure HP, ship weapon profiles, and carrier wing state.
- Tech tree now includes mining, refinery, storage, asteroid harvesting, fighter factories, drydocks, orbital defenses, shields, ion batteries, carrier launch doctrine, point defense, beam/kinetic/ion/bomber upgrades.
- Tactical combat now launches real carrier-derived fighter wing units, tracks wing losses, supports point-defense/torpedo/beam/ion/kinetic profiles, and exposes anti-fighter/bomber/defense summaries.
- Build panel groups new Surface and Orbital building buttons ahead of Strategic buildings; `render_game_to_text()` reports body structures, build locks, wing state, weapon summaries, structure HP, and new visual-site counts.
- Surface buildings draw as compact planet landmarks; drydock and orbital defense draw as small orbital structures to avoid orbit clutter.

### Verification
- `npm run build` — pass
- `node output/verify_buildings_carriers.mjs` — 24/24 pass; screenshot inspected at `output/visuals/buildings-carriers.png`
- `node output/verify_phase6.mjs` — 41/41 pass
- `node output/verify_tech_unlocks.mjs` — 13/13 pass
- `node output/verify_battle_groups.mjs` — 19/19 pass
- develop-web-game Playwright client screenshots inspected under `output/web-game/buildings-carriers-*`

### Known issues
- Salvage yard remains deferred.
- New numeric balance is first-pass only; wing replenishment currently supports fractional ready/lost values internally.
- Phase 3–5 regression scripts were updated to expect save-v10 but were not rerun in this session due runtime cost.

### Suggested next
- Balance the new building costs/effects and clean up carrier wing readiness to display whole craft counts in UI.

---

## Session 2026-07-07 — Galaxy performance, fleet map commands, and builder drones

**Task claimed:** Implement v11 Galaxy view performance pass, direct fleet selection/Tab+click dispatch, and flagship-launched reusable builder drones
**Status:** complete

### Done
- `SAVE_VERSION=11`; `docs/schemas/save-v11.json`; v10→v11 migration initializes `state.builderDrones`.
- `src/js/builder-drones.js` — reusable two-drone roster unlocked by Builder Drones tech, lane transit, remote construction timers, return travel, cancellation, summaries, and test hooks.
- Local construction rules remain unchanged by default; remote drone construction can build neutral outposts and owned-system shipyards/body structures while still enforcing tech/body/ownership gates.
- Galaxy view now uses far/mid/close LOD, samples non-critical far-zoom stars/lanes, avoids WebGL black-hole bloom at far zoom, precomputes route/fleet/pirate sets, and exposes `__galaxyPerfSummary()`.
- Fleet markers are directly clickable on the Galaxy map; selected fleets dispatch with `Tab+click` while `Alt+click` remains a compatibility fallback.
- Builder drones render as small amber lane pips in Galaxy view and compact construction skiffs over target bodies in system view.
- Fleet Command shows Builder Drones status, active build progress, ETA, and cancel buttons; build panels show Send Drone actions where remote construction is valid.

### Verification
- `npm run build` — pass
- `git diff --check` — pass
- `node output/verify_galaxy_fleets_drones.mjs` — 13/13 pass; screenshot inspected at `output/visuals/galaxy-fleets-drones.png`
- `node output/verify_phase6.mjs` — 41/41 pass
- `node output/verify_battle_groups.mjs` — 19/19 pass
- `node output/verify_buildings_carriers.mjs` — 24/24 pass
- develop-web-game Playwright client gameplay screenshot inspected at `output/web-game/galaxy-fleets-drones-gameplay3/shot-0.png`

### Known issues
- Headless first-frame Galaxy timing can still report a high warmup value, but the v11 summary confirms far-zoom drawn stars/lanes are bounded and the map no longer draws the full graph at widest zoom.
- Carrier wing ready/lost values can still be fractional from the prior v10 building/carrier slice.
