# Galactic Sovereign — Progress Log

Original prompt: Build Galactic Sovereign as an Electron desktop app wrapping an HTML5 Canvas game.
Phase 0 foundation: 2D system view, Stronghold, outpost economy with moon-scaled yield, moon
shuttles, pause, and versioned local save files (save-v0). Engineering plan in
`docs/IMPLEMENTATION_PLAN.md`; game design in `GALACTIC_SOVEREIGN_MASTER_PLAN.md`.

Session entries are appended below using the template in `docs/IMPLEMENTATION_PLAN.md` §9.
Never delete prior entries.

---

## Session 2026-07-14 — Flagship interpolation boundary stutter

**Task claimed:** Flagship and flagship-launched fighters still stutter after tactical interpolation was restored.

### Diagnosis
- `getFlagshipDisplayPose` special-cased a zero render accumulator by returning the current physics pose. The next animation frame resumed interpolation from the previous pose, producing a backward snap at every 50 ms simulation boundary.
- The ambient flagship sprite, follow camera, and flagship-wing home pose all consume this display pose, so the same discontinuity appeared on the flagship and its carrier-based fighters.

### Done
- Zero accumulator now correctly renders the previous fixed-tick pose, matching tactical ship interpolation and preserving continuity across tick boundaries.
- Added a regression check that samples the first milliseconds after a flagship physics tick and rejects any backward display movement.

### Verification
- `output/verify_combat_steering.mjs`: 29/29, including the new zero-accumulator flagship boundary regression.
- `output/verify_flagship_wing.mjs`: 16/16; `output/verify_directed_combat.mjs`: 25/25, both with zero browser console errors.
- Required web-game client completed with valid flagship/wing text state and no error artifact; its headless warp capture was black, so the visible `04-wing-wander.png` gameplay capture from the focused verifier was opened and visually inspected instead.
- `npm run build` passes.

---

## Session 2026-07-14 — Tactical ship stutter regression

**Task claimed:** Ships are visibly stuttering again after directed tactical combat landed.

### Diagnosis
- Tactical units are simulated on the fixed 50 ms combat tick but `drawCombatLayer` renders their raw tick positions and headings every animation frame.
- Ambient/flagship paths already use display-time interpolation; commanded combat movement made the unsmoothed 20 Hz tactical pose updates newly obvious.

### Done
- Captured a transient pre-tick pose for every tactical unit and interpolate position plus shortest-arc heading across the 50 ms tick in the renderer.
- Applied the same display pose to ship sprites, selection/firing arcs, focus-fire endpoints, FX heading lookup, and move-path origins so overlays stay attached to ships.
- Interpolation metadata is non-enumerable and never enters saves; combat simulation, collision, targeting, and damage remain fixed-tick and unchanged.
- Stabilized the combat UI browser fixture by pausing between deterministic phases; its focus-fire assertion now correctly accepts ships already holding inside weapon range.

### Verification
- `output/verify_combat_steering.mjs`: 28/28, including evenly spaced between-tick positions, short-arc heading continuity, and save-transience checks.
- `output/verify_flagship_wing.mjs`: 16/16; `output/verify_directed_combat.mjs`: 25/25; `output/verify_combat_ui.mjs`: 20/20; `output/verify_sts_combat_fx.mjs`: 14/14.
- `npm run build` passes. Required web-game client completed with no error artifact; final directed-combat screenshots were visually inspected.

---

## Session 2026-07-14 — Directed tactical combat, threat targeting, and destroyer AA

**Task claimed:** Implement contextual/HUD tactical move and attack orders, move-and-defend anchors, threat-then-HP targeting, weapon firing arcs, and Point Defense Grid-gated destroyer AA.

### Done
- Added contextual right-click and armed HUD Move/Attack commands, including invalid-click persistence and Escape cancellation.
- Added deterministic formation-slot move-and-defend anchors with turn-limited hull steering, approach braking, 420-unit interception leash, and return-to-slot behavior.
- Added one threat board per side/tick: designated and immediate/recent threats outrank strike craft/in-range targets, then current absolute HP, distance, and stable ID.
- Added enforced 360/240/70-degree weapon arcs plus 100-degree port/starboard flagship broadside arcs; flagship PD and destroyer AA target independently.
- Point Defense Grid now unlocks a 30%-base-DPS destroyer AA battery while retaining the 20% PD multiplier, torpedo primary, and AI research parity.
- Added move rings, slot ghosts/lines, selected-ship arc overlays, focus lines, HUD feedback, and expanded combat text state (command mode, directive, threat board, headings, anchors, recent threats, weapon/mount targets, arcs, AA state).
- Existing tactical-order persistence stores/hydrates the move order without a feature-specific save bump; the concurrently updated worktree currently serializes v16.

### Verification
- `output/verify_directed_combat.mjs`: 25/25 (right-click + HUD, turn limits, slots, leash intercept/return, save/load, AI AA parity, dual target fire, destroyed-focus fallback, zero console errors).
- `output/verify_combat_orders_unit.mjs`: 43/43; `output/verify_combat_steering.mjs`: 25/25; `output/verify_combat_ui.mjs`: 20/20; `output/verify_sts_combat_fx.mjs`: 14/14.
- `output/verify_combat_doctrine_unit.mjs`: 9/9; `output/verify_v13_tech.mjs`: 92/92; `output/verify_save_v12.mjs`: 11/11.
- `npm run build` passes. Web-game client state had no error artifact; visually inspected `directed-combat-move.png`, `directed-combat-aa.png`, and the final client capture.

### Suggested next
- Optional: add drag-box selection and waypoint/control-group queues in the deferred follow-up pass.

---

## Session 2026-07-14 — Ship stutter (face-motion follow-up)

**Task claimed:** Ships are stuttering again after facing-direction-of-motion work.

### Done
- Flagship keep-out stays velocity-only (no position snap fighting display interpolation).
- Ambient/pirate poses keep analytical patrol headings (no second softKeepOut look-ahead).
- Wing heading uses local analytical delta + flagship velocity (no double keep-out resolve).
- Softened wing hull clear to a single light pass; celestial keep-out capped + body-cached once per pose batch.

### Verification
- `output/verify_flagship_wing.mjs` including continuity check `4g`.

### Suggested next
- If hitching remains with Fleet panel open, profile panel rebuilds next.

---

## Session 2026-07-14 — Flagship hangar recall button

**Task claimed:** Add a little button so escort fighters fly into the flagship hangar.

### Done
- Wing hangar modes: `deployed` / `recalling` / `stowed` / `launching` with fly-in/out animation.
- HUD **Hangar** button (toggles to **Launch** when stowed) beside the flagship chip.
- `toggleFlagshipWingHangar` + test hook `__toggleFlagshipWingHangar`.

### Verification
- `output/verify_flagship_wing.mjs`: 14/14
- Screenshots: `05-wing-recalling.png`, `05-wing-stowed.png`

### Suggested next
- Optional: hotkey (e.g. H) for hangar toggle.

---

## Session 2026-07-14 — Construction drones stowed when idle

**Task claimed:** Hide construction drones around the flagship unless they are out on a build job.

### Done
- Idle/paused/complete drones return no pose (stowed aboard); only outbound/working/returning sorties render.
- Launch stagger holds craft docked/hidden until their sortie slot; removed ambient escort patrol.
- `verify_drones.mjs` now asserts idle count=0 near flagship.

### Verification
- `output/verify_drones.mjs`: 27/27
- Screenshot: `output/web-game/construction-drone-stowed.png`

### Suggested next
- Optional: hide mid-cycle return legs when within a few units of the hangar so reload looks instantaneous.

---

## Session 2026-07-14 — Soft keep-out + proportional fighter zoom

**Task claimed:** Gradual flagship keep-out, slightly slower escorts, and fix fighters not scaling with zoom-out.

### Done
- Ambient wing keep-out is a soft quadratic bubble with tangential swirl + heading lookahead (no hard sphere snap).
- Slower motion: wander speed 2.05; combat wing tier ~2.35; flagship combat mult 1.25.
- Removed readability floors on ambient/combat fighter draw radii so size tracks `z` (ratio matches zoom 4.00).

### Verification
- `output/verify_flagship_wing.mjs`: 11/11 (`4c` far/near ratio=4.00)
- Screenshots: `02-wing-zoom-out.png`, `03-wing-zoom-in.png`, `01-wing-escort.png`

### Suggested next
- Optional: combat capital ships still use `Math.max(6, 11*z)` readability floors — leave unless requested.

---

## Session 2026-07-14 — Fighter size, keep-out, drone sorties

**Task claimed:** Slightly enlarge fighters; apply celestial keep-out to flagship + wing; make construction drones launch from the ship to build sites.

### Done
- Fighter draw mid-size: `FLAGSHIP_WING_DRAW_SCALE` 0.72; wing hull scales ~0.65–0.82; combat `wingBaseR` raised.
- Ambient wing uses `softKeepOut` + flagship hull clearance (min dist 25); flagship keep-out adds soft position proof vs deep clipping.
- Local drones start mission clock on assign → outbound from flagship; builder drones fly bezier sortie to worksite (no static orbit pip).

### Verification
- `output/verify_flagship_wing.mjs`: 11/11 (containment min=25)
- `output/verify_drones.mjs`: 27/27 including launch-from-flagship check

### Suggested next
- Optional: brief thruster streaks on builder-drone outbound legs for readability at far zoom.

---

## Session 2026-07-14 — Compact fast fighters

**Task claimed:** Make fighters much smaller/compact and much faster, especially flagship escorts.

### Done
- Shrunk wing draw: `FLAGSHIP_WING_DRAW_SCALE` 1.55→0.38; fighter/interceptor/HF/bomber `HULL_RENDER` scales ~0.4; combat layer uses smaller `wingBaseR`.
- Tighter ambient cloud: patrol 95 / wander 42; `FLAGSHIP_WING_WANDER_SPEED` 2.85 for darty motion; tighter combat launch rings + wing separation.
- Combat wing tier maxSpeed 2.85 (≈63 wu/s); flagship-launched wings get ×1.4 via `FLAGSHIP_WING_COMBAT_SPEED_MULT` (≈88 wu/s).

### Verification
- `output/verify_flagship_wing.mjs`: 11/11
- `output/verify_combat_steering.mjs`: 25/25
- Screenshots: `output/web-game/flagship-wing/01-wing-escort.png`, `03-wing-zoom-in.png`, `04-wing-wander.png`

### Suggested next
- Optional: brief engine trail streaks on fast wing craft so speed reads better at a glance.

---

## Session 2026-07-14 — Flagship wing wander + zoom scale fix

**Task claimed:** Replace circular flagship escort orbit with contained wander; fix fighter sprites not resizing with camera zoom.

### Done
- `flagship-wing.js`: Lissajous pocket wander with soft containment (no shared orbital sweep); headings follow local wander velocity.
- Tuned `FLAGSHIP_WING_PATROL_RADIUS` / `WANDER_RADIUS` for a tighter irregular cloud.
- `ship-sprites.js` hull bitmap cache: half-pixel buckets (min 1.5) + scale-to-requested-radius so fighters shrink/grow with zoom instead of flooring to 4px.

### Verification
- `output/verify_flagship_wing.mjs`: 10/10 (containment, non-orbit motion, zoom scale ratio, combat launch)
- Screenshots: `output/web-game/flagship-wing/01-wing-escort.png`, `02-wing-zoom-out.png`, `03-wing-zoom-in.png`, `04-wing-wander.png`

### Suggested next
- Optional: soft min screen size for far-zoom wing readability without breaking proportional zoom.

---

## Session 2026-07-14 — Flagship arsenal + Novacula superweapon

**Task claimed:** Multi-battery flagship weapons + ambient fighter wing; deferred Novacula cradle fire cinema with v13 tech multipliers.

### Done
- `FLAGSHIP_WEAPON_SUITE` (beam/kinetic/torpedo/PD/ion), `HULL_STATS.flagship`, persist `flagship.weapons`; multi-hardpoint tactical fire + hardpoint pulse sprites.
- `flagship-wing.js`: 13-craft escort wander/follow; combat launch via carrier-wing path; Stronghold replenish; hide in transit.
- `superweapon-render.js` Novacula gimbal cradle + cyan/white beam + flare; galaxy corridor/impact VFX.
- Deferred `fireSequence` phases in `superweapon.js` (mutate at impact); shield block at impact with partial refund; v13 power/genesis/gate/sovereign cost+timing multipliers; richer galaxy Superweapon panel.
- `SAVE_VERSION=15` + `migrateV14toV15`.

### Verification
- `output/verify_flagship_arsenal.mjs`: 11/11
- `output/verify_flagship_wing.mjs`: 7/7
- `output/verify_superweapon_novacula.mjs`: 12/12 (screenshots under `output/web-game/superweapon-novacula/`)
- `output/verify_sts_combat_fx.mjs`: 14/14
- `output/verify_phase6.mjs`: 40/42 (2 pre-existing tutorial coach step mismatches unrelated to this work)

### Suggested next
- Further polish cradle silhouette vs Dyson shell-8 cage at Stronghold; optional camera soft-pan along galaxy beam.

---

## Session 2026-07-14 — Combat shield + hull bars

**Task claimed:** Show shield and health bars on player and pirate ships during combat.

### Done
- Replaced single damaged-only HP pip with stacked combat status bars in `ship-sprites.js`: cyan shield (top) + green/red hull (bottom).
- Combat layer always draws both bars for live units in detail/lite LOD (hidden only in swarm LOD); passes facing-shield totals via `unitShieldTotals`.
- Combat HUD selection rows now show `S cur/max · H cur/max` when shields exist.

### Verification
- `output/verify_combat_status_bars.mjs`: 8/8 (shield data on both fleets; cyan+green canvas pixels).
- `output/verify_combat_ui.mjs`: 20/20 regression.
- Screenshots: `output/visuals/combat-status-bars.png`, `output/visuals/combat-status-bars-zoom.png` show stacked cyan/green bars above player and pirate ships.

### Suggested next
- Optional: facing-arc shield wedges for capital ships; hide bars until first damage if clutter becomes an issue at high unit counts.

---

## Session 2026-07-14 — Balance pass + coach-mark tutorial

**Task claimed:** Progressive income / Solarii drain / cost retune, and replace the top tutorial panel with button-anchored coach marks covering the full early-game loop.

### Done
- Progressive outpost income: base × moons × shell credit bonus × tech `outpostIncomeMult` / `creditIncomeMult` in `economy.js` (`OUTPOST_BASE_INCOME = 10`).
- Solarii passive drain (`SOLARII_DRAIN_PER_SHELL`) applied as net income in `dyson.js`.
- Retuned sail burn (2.5×5), capture weights, V13/strategic costs, hero flagship HP/DPS; wing readiness shown as whole craft in Fleet rows.
- Wired dead tech effects: `hero_combat_bonus`, `diplomacy_trade_bonus`, `dysonShellSync`, `dysonShellBonus`.
- Tutorial: removed `#tutorial-guide` panel; `#tutorial-coach` floats beside HUD anchors (13 steps through logistics, combat escort, capture, foundry teaser).

### Verification
- `output/verify_balance_pass.mjs`: 14/14
- `output/verify_v13_income_save.mjs`: 20/20
- `output/verify_tutorial_coach.mjs`: 20/20
- `output/verify_tutorial_browser.mjs`: 9/9; screenshot `output/web-game/tutorial-coach.png` shows compact tip at Build Outpost

### Suggested next
- Broader playtest of early-game pace with progressive income; optional salvage yard.

---

## Session 2026-07-10 — Ctrl/Cmd-click construction planner (save v14)

**Task claimed:** Replace manual trade routes with owned-system construction-drone dispatch and an unlimited multi-world arrival planner.

### Done
- Ctrl/Cmd-click on a claimed galaxy star dispatches exactly one idle builder drone and never orders flagship travel; repeat clicks send additional drones.
- Drone arrival pauses play and opens a modal planner; deferred modal arrivals remain pending, and stationed drones can reopen planning from the Fleet panel.
- Planner catalogs researched outpost, shipyard, research/trade, Dyson, body, strategic, and star-node buildings using canonical validators, with disabled reasons and bulk “all eligible” actions.
- Confirmed plans reserve credits, persist dependency-aware orders, run independent worlds across multiple drones in parallel, allow full-refund cancellation while queued, and survive save/load.
- Ownership loss refunds queued work, aborts active work without refund, and returns drones to origin.
- Manual trade routes were fully removed from input, UI, rendering, economy, state, tips, hooks, and runtime modules; former capacity bonuses now improve convoy/logistics capacity.
- `SAVE_VERSION=14`; v13→v14 migration removes `manualTradeRoutes` and initializes persistent planner/order fields; `docs/schemas/save-v14.json` added.

### Verification
- `npm run build` passes.
- `output/verify_v14_drone_planner.mjs`: 23/23 pass, including real Ctrl-click, actual modal buttons, dependent batching, parallel drones, refunds, ownership loss, pending-planner save/load, migration, manual-route removal, relative frame cadence, and zero console errors.
- `output/verify_v13_tech.mjs`: 92/92 pass.
- `output/verify_save_v12.mjs`: 11/11 pass through current v14 migration.
- `output/verify_phase6.mjs`: updated v14/manual-route expectations pass in the affected sections.
- Planner screenshot inspected: `output/web-game/v14-drone-planner.png`; final web-game smoke screenshot inspected with no browser error artifact.

### Suggested next
- If construction types are added later, register them through the canonical planner catalog rather than adding modal-only build rules.

---

## Session 2026-07-10 — Progressable building tech + assigned construction drones

**Task claimed:** Make building unlocks progressable; deploy construction drones to claimed systems; verify real UI buttons; remove the resulting ship stutter.

### Done
- Added early Economy tech `Construction Drones` after `Surveyor Drones`; late `mil_builder_ship` remains the separate Construction Tender hull unlock.
- Removed the hidden Builder-Drones gate from Sail Foundry and Dyson Launcher construction: their named techs now control their availability.
- Builder drones now deploy to a selected, player-claimed galaxy system, remain assigned there, and take construction jobs from that system's planet panel.
- Remote drone jobs support outposts, shipyards, body structures, Sail Foundries, and Dyson Launchers; unclaimed systems reject deployment and construction.
- Added the galaxy-map Construction Drones panel and verified the real Deploy, Assign Sail Foundry, and Assign Dyson Launcher button handlers.
- Fixed construction-button detachment by refreshing on affordability thresholds instead of every small income change.
- Fixed a ship/map stutter introduced by the new panel: route validation is now cached by target/ownership/credits/drone state instead of running a 400-star path search every animation frame.

### Verification
- `npm run build` passes.
- `output/verify_dev_unlock_all_perf.mjs`: 6/6 passes; no console errors; post-unlock frame cadence remains baseline-relative.
- `output/verify_progressable_tech_drones.mjs` covers tech separation, claimed-system deployment, stationing, and actual construction buttons.
- Web-game client screenshot inspected at `output/web-game/stutter-check/shot-0.png`; no browser error artifact was produced.

### Suggested next
- Re-run the assigned-drone verifier after future construction-panel changes; it specifically catches DOM replacement during button clicks.

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

## Session 2026-07-04 — Construction drones (Phase 6)

**Task claimed:** System construction drones — timed builds, flying drone visuals, save-v8
**Status:** complete

### Done
- `SAVE_VERSION=8`; `docs/schemas/save-v8.json`; `migrateV7toV8`
- New modules: `drones.js`, `drone-motion.js`, `drone-render.js`, `flagship-presence.js`
- Structure builds (outpost, shipyard, foundry, launcher, trade, research) queue construction jobs; credits spent upfront; drones complete work while flagship is in-system
- Hybrid drone capacity: base 2 + builder ships + `mil_builder_ship` tech bonus; `eco_surveyor` build speed bonus
- Scaffolding on orbital structures under construction; drone sprites in system view
- HUD drone strip + build progress/ETA; completion toasts
- Test hooks: `__queueOutpost`, `__droneSummary`, `__forceResearch`, `__spawnBuilderShip`
- `output/verify_drones.mjs` — 22/22; phase0/3/4/5 verify scripts updated for timed builds + save-v8

### Decisions
- Sim work rate uses assigned drone count per tick (visual working phase is render-only)
- Jobs pause when flagship leaves the system; resume on return
- Foundry/launcher require `mil_builder_ship` researched (GDD site prep)

### Known issues
- None blocking

### Suggested next
- Dehydration overlay for pending construction jobs in abstract galaxies
- Combat repair drone streams (healer tactical — GDD §2.7)

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

## Session 2026-07-07 — Real tech-tree sections

**Task claimed:** Make every top tech-tree ticker represent a real section
**Status:** complete

### Done
- `src/js/tech-web-layout.js` — added a canonical nine-section cluster order and unique layout bands for Economy, Military, Dyson, Trade, Wormhole, Research, Diplomacy, Superweapon, and Flagship.
- `src/js/tech-web-ui.js` — band labels now render from the real cluster order; section chips update node and connector filtering, and focus the viewport on the selected section.
- `src/js/tech-web-viewport.js` — added `fitBounds()` so category chips can zoom/pan to their section instead of only dimming the full tree.
- `src/css/style.css` — added filtered-edge styling for unrelated connector lanes.
- `output/verify_tech_tree_sections.mjs` — static contract check for advertised chips, node clusters, and unique layout bands.
- `output/verify_tech_tree_ui.mjs` — browser check that starts a sandbox game, opens Tech, clicks every section chip, verifies filtering/focus, and captures screenshots.

### Verification
- `node output/verify_tech_tree_sections.mjs` — 15/15 pass
- `npm run build` — pass
- develop-web-game Playwright client — title/game capture completed with no browser error artifact at `output/web-game/tech-tree-sections-client/`
- `node output/verify_tech_tree_ui.mjs http://127.0.0.1:5173` — 58/58 pass; screenshots inspected at `output/web-game/tech-tree-sections-ui/tech-all.png` and `output/web-game/tech-tree-sections-ui/tech-superweapon.png`

### Suggested next
- Optional readability pass: when a late-game section is selected in a fresh save, most nodes are intentionally hidden as Unknown; a future UI pass could show locked late-game names after milestone discovery.

---

## Session 2026-07-07 — Fleet power markers, pirate raids, and lane interdictions

**Task claimed:** Enemy fleets with icons/power levels; wandering attacking pirates; galaxy lane travel gameplay meaning
**Status:** complete

### Done
- `src/js/fleet-power.js` — shared combat-power helper for player and pirate fleet marker numbers.
- `src/js/pirates.js` — pirate fleets now carry `intent`, pick reachable player-held/defended raid targets over lanes, expose stationed/transit marker payloads, and trigger same-lane interdictions against player ships.
- `src/js/simulation.js` — pirate interdictions run after transit movement and before combat, so lane dropouts can immediately start normal battles.
- `src/js/render.js` + `src/js/ship-sprites.js` — galaxy map draws red pirate fleet badges with a raider glyph and `shipCount/power`; pirate transit lanes render as danger dashed lanes; raid destinations pulse.
- `src/js/main.js` — toasts for pirate sightings/interdictions and `render_game_to_text()` now includes pirate power, intent, ETA, and marker payloads.
- `output/verify_pirate_lanes.mjs` — focused Playwright verification for raid routing, power markers, lane interdiction, galaxy perf marker counts, and console errors.

### Verification
- `npm run build` — pass.
- develop-web-game client — pass; latest gameplay state shows pirate `galaxyMarkers`/`transitMarkers` with power values.
- `node output/verify_pirate_lanes.mjs` — 7/7 pass; screenshot: `output/visuals/pirate-raid-lanes.png`.

### Known issues
- `output/verify_phase2.mjs` is stale against the current state shape and fails early on `st.systems[...]`; current game state uses `st.galaxies[activeGalaxyId].systems[...]`.

---

## Session 2026-07-10 — Flagship twin engine stalks

**Task claimed:** Add two USS Enterprise-inspired engine stalks to the flagship without losing the grounded capital-ship redesign
**Status:** complete

### Done
- `src/js/ship-sprites.js` — added two swept armored pylons behind the flagship's main hull.
- Each pylon carries a long outboard nacelle with a recessed cyan energy channel, forward status light, hot exhaust cap, and thrust-dependent ion wake.
- Preserved the four central recessed drives, armored asymmetry, batteries, sensor island, navigation lights, and damage rendering.
- Expanded the flagship visual inspection framing in `output/verify_unified_overhaul.mjs` so the complete hull and both nacelles are visible at review scale.

### Verification
- `npm run build` — pass.
- Develop-web-game Playwright client — completed with final state/screenshot artifacts under `output/web-game/flagship-engine-stalks-final/` and no browser error artifact.
- `node output/verify_unified_overhaul.mjs` — 18/18 checks passed with no browser console errors.
- Final close-up inspected at `output/visuals/unified-overhaul/flagship-closeup.png`; both separated nacelles, swept stalks, hull silhouette, and central drives remain readable.

### Decision
- The new engines borrow the Enterprise's recognizable twin-stalk proportion, but use heavy military pylons and armored nacelles so the flagship still belongs to Galactic Sovereign rather than reading as a direct franchise copy.

---

## Session 2026-07-10 — v13 expansive technology web and infrastructure

**Task claimed:** Implement the 164-node interconnected tech web, 15 new buildings, tiered infrastructure, exact 40 cr/s passive outposts, searchable tech navigation, faction AI parity, and save-v13.
**Status:** in progress

### Completed so far
- Restored passive income as a flat 40 Credits/second per operational player outpost; construction, damage, disablement, pause, and mothball state are respected while cargo delivery remains additive.
- Extended text/HUD reporting to separate passive outpost income, recent cargo-delivery throughput, and projected total income.
- Added save-v13 schema and migration scaffolding for structure levels, faction IDs, per-faction research/resources/queues, AI difficulty, and deterministic personality-based research backfill.
- Added tech-web search, result focus, cluster/tier/state filters, reset/fit controls, persistent details, and a compact minimap.
- Reconciled the pre-existing textual merge conflict by preserving both construction-drone and unified-overhaul logistics/Sol state paths in `main.js`, `simulation.js`, and `trade.js`; the unmerged binary screenshot remains untouched.

### Verification so far
- Focused deterministic income check: one level-III operational outpost still yields exactly 40 Credits over one simulated second.
- `node --check` passes for the touched save, economy, drone, simulation, trade, main, UI, and tech-web UI modules.

### In progress
- Sixty-node content/effect registry, 15-building roster/upgrades/visuals, and faction AI parity are being implemented in parallel before shared integration and browser QA.

### Focused fleet and shipyard integrity verification
- Added `output/verify_fleet_shipyard_integrity.mjs` covering operational-yard eligibility, rejection of under-construction/disabled/destroyed/mothballed/offline yards, physical-yard dispatch assignment, completion spawning at the assigned system/body, live-ship auto-assignment, and player-flagship fleet anchoring/follow behavior.
- `node output/verify_fleet_shipyard_integrity.mjs` — 28/28 pass.
- Follow-up: the older `output/verify_battle_groups.mjs` still encodes the former skipped ordinal sequence (`1, 3, 5`) and should be updated to the corrected contiguous fleet ordinals.

---

## Session 2026-07-12 — Construction drone swarm and assembly visuals

**Task claimed:** Increase and refine the flagship construction-drone swarm, make drones smaller and more detailed, keep them visibly working longer at distinct building sites, and prevent follow lag.

### Done
- Expanded the flagship/system construction-drone pool from 2 to 6, with a 12-drone system ceiling; the per-job worker cap remains 2 so a larger escort does not multiply single-job completion speed.
- Reduced drone size and redesigned the sprite with an armored hex chassis, side panels, reactor eye, sensor mast, articulated fabrication arms, and twin maneuvering thrusters.
- Increased worksite dwell from 0.8s to 3.2s; simultaneous workers now orbit separate assembly points instead of overlapping, face the work target, emit fabrication beams, and produce bounded weld flashes.
- Added progress-driven, type-specific construction assemblies for outposts, shipyards, research stations, Sail Foundries, Dyson launchers, and generic structures. Existing structure sprites fade in with real job progress.
- Bound render-time drone motion to the flagship's interpolated display pose, cached deterministic per-drone motion parameters in a `WeakMap`, and culled offscreen drones/sites to keep following smooth.
- Refreshed `output/verify_drones.mjs` for current v14 economy/tech rules and added capacity, work-dwell, moving-cadence, formation-distance, screenshot, save, and console checks.

### Verification
- `npm run build` — pass.
- `git diff --check` — pass for all touched drone/render/test files.
- Develop-web-game client smoke state confirmed six idle drones around the moving flagship.
- `node output/verify_drones.mjs` — 25/25 pass with no browser console errors; moving cadence remained baseline-relative and all six drones stayed within 46.5 world units of the flagship.
- Screenshots inspected: `output/web-game/construction-drone-follow.png` and `output/web-game/construction-drones-build.png`.

### Suggested next
- If future tech raises the system ceiling beyond 12, add a distance/zoom LOD that collapses far-away idle drones into a lightweight swarm marker.

### Follow-up 2026-07-12 — Flagship lag regression fixed
- Player-reported flagship lag after the swarm pass was traced to rebuilding every detailed drone's multi-path Canvas sprite on every frame; CPU profiling did not identify simulation or AI work as the movement-window bottleneck.
- Added a bounded raster cache in `src/js/drone-render.js`, keyed by quantized zoom, working state, and transit-thrust state. Escort rendering now uses rotated cached `drawImage` calls while preserving lightweight live reactor pulses, work sparks, trails, and fabrication beams.
- Direct six-drone render benchmark: `0.076 ms/frame` in the final verification run.
- `node output/verify_drones.mjs` — 26/26 pass, including movement cadence, six-drone formation distance, cached-render budget, save behavior, construction behavior, and zero console errors.
- Develop-web-game client completed a post-fix gameplay capture at `output/web-game/flagship-drone-cache-fix/`; final close-up re-inspected at `output/web-game/construction-drone-follow.png` with no clipping or loss of drone detail.

## Session 2026-07-12 — GitHub ZIP direct-file launch

**Task claimed:** Make the game interactive when `src/index.html` is opened directly from a downloaded GitHub ZIP.

### Done
- Reproduced the issue in Chromium: the source module graph was blocked by `file://` CORS before `main.js` could attach any button listeners.
- Added a checked-in IIFE bundle at `src/js/main.standalone.js` and a `build:standalone` script to regenerate it.
- Added a protocol-aware entry loader: direct file launches use the standalone bundle; Vite development keeps the source module graph.
- Added a Vite production transform so `dist`/Electron builds still receive the hashed module entry instead of the file-launch loader.
- Documented the ZIP launch path in `README.md`.

### Verification
- Direct `file://` launch exposes `render_game_to_text`, has no module/CORS errors, and clicking **New Campaign** hides the title screen and enters the warp intro.
- Direct `file://` **Custom Campaign** opens the custom-campaign modal.
- `npm run build` — pass; `dist/assets/index-D9S0Df_c.js` is emitted and referenced by `dist/index.html`.
- `git diff --check` — pass.

---

## Session 2026-07-14 — Advanced StS combat animations

**Task claimed:** Replace shared heading tracers with aimed, per-weapon ship-to-ship combat FX.

### Done
- Combat emits ring-buffered `battle.fxEvents` on shots, heals, kills, and sparse large-battle LOD pulses (`BATTLE_FX_EVENT_CAP=128`); events are not saved.
- Added `src/js/combat-fx.js` with profile-specific draw styles: kinetic streaks, PD micro-bursts, torpedo projectiles, beam holds, ion arcs, repair ribbons, shield-facing flashes, and kill blooms.
- `drawCombatLayer` now uses LOD-aware `drawCombatFx` plus hit-feedback rims on recently struck ships.
- Theme/constants extended for FX colors, durations, and draw caps; `__combatFxSummary` test hook wired in `main.js`.

### Verification
- `npm run build` — pass.
- `node output/verify_sts_combat_fx.mjs` — 14/14 pass (all six weapon profiles present; screenshot at `output/visuals/sts-combat-fx.png`).
- `git diff --check` — pass.

---

## Session 2026-07-14 — Diplomacy, strategic expansion, and bulk production overhaul

**Task claimed:** Implement the approved v16 grand-strategy diplomacy, Auto-Route & Build campaigns, construction templates, and aggregate late-game production orders.

### In progress
- Preserving the existing directed-combat work while adding isolated diplomacy, bulk-production, and strategic-operations cores before shared UI/simulation integration.
- Baseline checks: combat orders 43/43 pass; fleet/shipyard integrity 28/28 pass.
- The pre-existing directed-combat browser verifier currently has two baseline failures: move-slot convergence and concurrent capital/fighter damage; these are being tracked separately from overhaul regressions.

### Verification planned
- Focused diplomacy, bulk-production, strategic-operations, v16 save migration, AI/route legality, scale, browser interaction, direct-file, production build, and existing regression checks.

### Bulk production order input update
- Replaced the typed manifest textarea with repeatable ship rows: an unlocked-hull dropdown, a positive whole-number quantity input, and add/remove controls.
- Kept mixed-fleet orders aggregate by merging duplicate dropdown selections before preview/creation.
- Verification: operations UI 10/10, bulk production 37/37, v16 browser 16/16, production build pass, and screenshot inspection pass (`output/visuals/overhaul-operations.png`).

---

## Session 2026-07-14 — Command-first in-system combat overhaul

**Task claimed:** Make tactical combat autonomous by default, repair fighter attacks and volley pacing, preserve optional advanced orders, and add command-first HUD/save/alert support.

### Done
- Added a pure combat-autonomy policy layer with doctrine intent, target, flagship positioning, fleet-priority, Advanced Tactics, and role-based withdrawal policies.
- Added two-second flagship manual override plus a 500 ms return-to-auto blend and `AUTO` / `MANUAL` / `RETURNING TO AUTO` state reporting.
- Fixed cooldown-normalized volley damage, interceptor fallback to the fleet strike, repeated launch/approach/attack/return/rearm sorties, carrier fallback, and orphaned-wing exhaustion behavior.
- Repositioned opening battle lines onto the same side of the star to eliminate multi-minute stellar circumnavigation; the deterministic balanced fixture now resolves in 82.95 seconds.
- Added launch/recovery FX cues, command-first HUD controls, fleet priority, wing status, a persistent non-pausing View Battle alert, save v17 migration/schema, hooks, and expanded text-render autonomy state.

### Verification
- `node output/verify_combat_autonomy_unit.mjs` — 8/8 pass.
- `node output/verify_command_combat_pacing.mjs` — pass at 82.95 seconds.
- `node output/verify_command_first_combat.mjs` — 19/19 pass; fighter damage at 4.15 seconds and zero console errors.
- Combat orders 43/43, doctrine 9/9, save v17 5/5, combat UI 20/20, flagship wing 16/16, steering pure checks, and combat FX 14/14 pass.
- `npm run build` — pass.
- Inspected `output/visuals/command-first-battle-alert.png`; the alert is compact, readable, and does not obscure strategic play.

---

## Session 2026-07-15 — Operation presets and manufacturable construction drones

**Task claimed:** Upgrade Auto-Route & Build presets into complete operation doctrines and make Construction Drones real shipyard products with campaign embark, construction, recovery, and replacement behavior.

### Completed
- Added the v2 doctrine catalog for all six built-in presets plus Generalist compatibility defaults and immutable doctrine snapshots on new campaigns.
- Added a generic production-product contract while preserving legacy `{ hull, quantity }` bulk manifests and API callers.
- Added the 120-credit, 18-second Construction Drone product, 96-unit owned-plus-queued cap, one-time two-drone technology grant, and manual mixed ship/drone bulk orders.
- Replaced single-hull campaign requisitions with deterministic mixed role manifests that reuse eligible ships, warn and redistribute locked roles, enforce both force margins, and package groups at 40 ships or fewer.
- Added dedicated target drone teams plus a reusable campaign reserve, local embark/disembark, parallel construction, re-embark for sequential targets, per-group drone losses, automatic replacements, and Hold/Return/cancellation handling.
- Added compact Operations preview and active-card reporting for doctrine, manifest, substitutions, thresholds, drone lifecycle counts, production shortage, construction queue, and combined cost.
- Added strategic/template schema v2 and save v18 migration, including legacy in-flight execution preservation and v1 Generalist conversion.
- Extended `render_game_to_text` and browser-facing product/strategic hooks with the new product, doctrine, manifest, and assignment state.

### Verification
- `node output/verify_v18_operation_drones.mjs` — 11/11 pass, including the full stage → embark → travel → capture → parallel build → re-embark lifecycle and v17 migration.
- `node output/verify_v18_operations_browser.mjs` — 10/10 pass across all six presets and one compact 50-target campaign; zero console/page errors.
- Bulk production 37/37, strategic operations 21/21, Operations UI 10/10, fleet/shipyard 28/28, v16 integration 23/23, v18 save 5/5, diplomacy 39/39, and diplomacy runtime edges 27/27 pass.
- Existing drone renderer/planner checks pass, including idle-drone stowing and the construction planner lifecycle.
- Late-game overhaul performance passes 5/5 and the unlock-all performance guard passes 6/6 with zero console errors.
- The supplied web-game Playwright client completed against `http://127.0.0.1:5173`; its text state reports save v18, strategic schema v2, six doctrine snapshots, and the expanded drone summary.
- `npm run build` and `git diff --check` pass. Vite reports only its existing large-chunk advisory.
- Inspected `output/visuals/v18-operation-presets.png` and `output/visuals/v18-operation-preview.png`; the Operations layout is readable and the 50-target preview remains aggregate rather than rendering target rows.

---

## Session 2026-07-15 — Detached fleets not firing in viewed battles

**Task claimed:** Fix player ships, pirates, and enemy ships appearing in-system without exchanging fire.

### Diagnosis
- Battles without the player flagship started in the three-second offscreen resolver. Opening the system only moved the camera; it did not create tactical units, targets, weapon ticks, or combat FX, so operation fleets looked inert when watched.
- Autonomous doctrine targeting used a hard focus-fire target. Ordinary ships could acquire a preferred capital outside weapon range while ignoring closer valid targets, extending the apparent no-fire period.

### Completed
- Added an offscreen-to-tactical promotion path and invoke it whenever an active battle is opened or starts in the currently viewed system.
- Reused the normal tactical initializer so promoted battles receive formations, enemy orders, objectives, wings, shields, targeting, damage, and FX without resetting campaign or fleet state.
- Autonomous doctrine ships now fire opportunistically at an in-range hostile while continuing to prefer their doctrine target; explicit player focus-fire remains strict.
- Tuned opening line separation to 580–650 units, bringing detached-fleet first fire under ten seconds while keeping the balanced battle inside its intended 60–120 second duration.

### Verification
- `output/verify_command_first_combat.mjs` — 22/22 pass. New detached-fleet case starts in `auto`, promotes to `tactical`, then records player fire at 9.65 seconds and pirate return fire at 9.30 seconds with targets on both sides.
- Balanced combat pacing passes at 66.25 seconds; combat orders 43/43, doctrine 9/9, steering 29/29, directed combat 25/25, and combat FX 14/14 pass.
- `npm run build` and `git diff --check` pass; zero focused-browser console errors.
- Inspected `output/visuals/detached-fleet-return-fire.png`; the live 3-vs-3 system view shows both formations, health bars, and an active aimed tracer without the pause overlay.
- The supplied web-game Playwright client completed and returned valid save-v18 text state. Its generic SwiftShader screenshot remains visually distorted, so the focused combat screenshot is the visual source of truth.

---

## Session 2026-07-15 — Post-battle return flights, faster ships, and multi-mount combat

**Task claimed:** Stop surviving ships from snapping back to their old orbit after in-system combat, make tactical ships faster, and give ordinary hulls more weapons.

### Diagnosis
- Tactical positions disappeared with the resolved battle object, leaving persistent ships with only their system and orbit anchor; the next render therefore placed them directly back at that orbit.
- Ordinary tactical ships used one primary weapon timer even when their class should visually and mechanically support several batteries.

### Completed
- Persist the exact final tactical pose for every surviving player and pirate ship, then fly it along a fast curved recovery path to its currently assigned star or planet orbit over 1.4–5.2 seconds.
- Blend heading out of the final combat orientation, follow moving planet anchors, block strategic travel while recovering, and clear the trajectory only on arrival.
- Preserve in-progress recovery trajectories through save/load without a save-version bump.
- Increased tactical speed, acceleration, and turn-rate tiers by roughly 20–30%, with escorts remaining faster than line and capital hulls.
- Added independent standard weapon mounts: two on escorts, three on line ships, and four on capital/carrier hulls. Each mount has its own target, firing arc, cooldown, hardpoint, and FX event while total hull DPS remains distributed across the batteries.
- Increased the combat-FX telemetry ring buffer to retain the denser multi-mount volleys without raising the per-frame FX draw limit.
- Extended text state, selected-unit firing arcs, and browser hooks with standard mount and post-battle-return state.

### Verification
- `node output/verify_command_first_combat.mjs` — 26/26 pass, including exact no-snap continuity, visible mid-flight movement, heading recovery, save/load during flight, final orbit arrival, and multiple mounts firing from one ordinary ship.
- Combat pacing passes at 76.8 seconds with 1,480 real mount events; combat FX 14/14, combat orders 43/43, steering 29/29, directed combat 25/25, v16 save 5/5, and fleet/shipyard integrity 28/28 pass.
- `npm run build` and `git diff --check` pass. The supplied web-game client completed with valid save-v18 text state and no error artifact.
- Inspected `output/visuals/post-battle-return-flight.png` and `output/visuals/detached-fleet-return-fire.png`; the focused frames show survivors crossing the system and ordinary ships exchanging multi-mount fire without a pause overlay.
- The broad overhaul performance verifier passes its 150+ unit battle checks with a 6.8 ms p95 and no console errors. Its unrelated convoy-render comparison remained noisy at 15.8% versus a 15% threshold in an isolated SwiftShader rerun; none of the changed combat/recovery paths execute in that galaxy convoy fixture.

---

## Session 2026-07-15 — New-campaign cinematic intro overhaul

**Task claimed:** Completely enhance the intro animation shown when starting a new campaign.

### Completed
- Rebuilt the opening as a staged fourteen-second cinematic: Sovereign-core awakening, flagship drive ignition, hyperspace breach, interstellar translation, and stronghold acquisition.
- Added a hero flagship flyby, escort formation, layered drive plumes, perspective launch grid, portal shockwaves/tendrils/rings, impact shake, anamorphic flares, film texture, letterboxing, and a live-system arrival crossfade.
- Added campaign-aware telemetry for mode, victory objective, rival difficulty, and the actual home-system name, ending on an `A NEW REIGN BEGINS` system title card.
- Extended the fully resolved home-system establishing shot from a brief transition to a 4.7-second hold (8.5–13.2 seconds), followed by a short title fade; the portal exit timing remains unchanged.
- Repaired the portal rush easing, added a gated 850 ms skip transition, and added a shorter reduced-motion sequence.
- Exposed deterministic intro phase/timestamp state in `render_game_to_text` plus focused browser hooks without advancing campaign simulation.
- Added `output/verify_campaign_intro.mjs` and rebuilt the direct-file standalone bundle.

### Verification
- `node output/verify_campaign_intro.mjs` — 21/21 pass against Vite: all seven cinematic timestamps, extended reveal hold, default/custom campaign context, full completion, gated skip, reduced motion, unpaused handoff, and zero console/page errors.
- `INTRO_TARGET=file node output/verify_campaign_intro.mjs` — 21/21 pass against `src/index.html` opened directly from disk.
- `npm run build` and `git diff --check` pass; Vite reports only the existing large-chunk advisory.
- Visually inspected all seven timestamp captures under `output/visuals/campaign-intro/`, including flagship ignition, full-frame breach/translation, the initial Solara Prime reveal, and the new eleven-second hold frame.
- The supplied web-game client completed with valid awakening-phase intro text state and a visually correct opening-frame capture; the focused Chrome verifier remains the full-timeline visual source of truth.

---

## Session 2026-07-15 — Cinematic stellar catalog and phased wormholes

**Task claimed:** Add visually distinct binary stars, supergiants, pulsars, quasars, and a complete cinematic wormhole travel sequence without changing gameplay balance.

### Completed
- Added deterministic visual-only `stellarOverride` assignments: 6% binary, 2% red supergiant, 1% blue supergiant, 1% pulsar, plus at most one quasar in 35% of galaxies; Strongholds, cores, and Trade Nexuses are excluded.
- Added five specialized WebGL silhouettes, per-class bloom/exposure metadata, bounded scissor rendering, quality-scaled shader work, and matching Canvas2D fallbacks.
- Added discovered stellar class/description to System Intel and stellar renderer identity to `render_game_to_text`.
- Added dormant, anchored, charging, opening, transit, collapse, and 1.4-second arrival wormhole visual states while leaving routing, timing, pause behavior, and controls unchanged.
- Advanced saves to v19 with deterministic v18 migration and a save-v19 schema.

### Verification
- `output/verify_celestial_cinema.mjs`: 69/69 deterministic generation, v18 migration/v19 round-trip, UI/text, Canvas2D fallback, wormhole-phase, shader, console, screenshot, and performance checks. Same-environment median frame cost was 7.00 ms for the close-galaxy baseline and 7.30 ms for the representative exotic system.
- `output/verify_phase4.mjs`: 39/39 wormhole routing, pause, completion, and save checks.
- `output/verify_v16_overhaul_save.mjs`: 5/5; `output/verify_v18_operation_drones.mjs`: 11/11; `output/verify_v18_operations_browser.mjs`: 10/10; `output/verify_star_visuals.mjs`: 4/4.
- Visually inspected the five exotic system views plus dormant, anchored, charging, transit, collapse, and arrival wormhole captures; the specialized silhouettes are distinct and unclipped behind the HUD.
- The required web-game client reached `bootPhase: playing` with save v19 and valid stellar/wormhole text state. Its raw-canvas capture selected the transparent WebGL layer; the corresponding composited frame at `output/web-game-celestial-gameplay/shot-composited.png` was inspected and renders correctly.
- Final `npm run build`, `git diff --check`, and syntax checks for every changed JavaScript module pass. The production build reports only the existing large-chunk advisory.

---

## Session 2026-07-15 — Make stellar overhaul visible in normal play

**Task claimed:** The cinematic stellar changes were not visibly different from the ordinary opening game path.

### Diagnosis and fixes
- Confirmed the new-campaign Stronghold is correctly excluded from exotic assignment, so it always opened on the unchanged legacy yellow-sphere presentation; undiscovered exotic nodes were also flattened into identical fog circles.
- Applied the catalog exposure/chromatic metadata to legacy sphere shaders and added visible anamorphic lens streaks, spectral halos, and camera-axis optical ghosts so the protected opening star now shows the upgrade immediately.
- Added muted class-shaped anomaly signatures for undiscovered binary, supergiant, pulsar, and quasar nodes. They remain unlabeled until Intel is earned, preserving discovery while making the expanded catalog visible on the default Galaxy Map.
- Enlarged the close-map Galactic Core/wormhole presentation and retained the phase-specific travel sequence.
- Added a final avalanche mix to the deterministic visual hash. Real 4,000-node generation now follows the intended rarity bands instead of correlating against sequential system IDs.
- Extended the focused verifier with a real-galaxy rarity-band assertion.

### Verification
- `output/verify_celestial_cinema.mjs`: 71/71, including an explicit-v19-null no-reroll check; final close-map medians were 4.90 ms baseline and 5.10 ms exotic.
- `output/verify_phase4.mjs`: 39/39; `output/verify_v16_overhaul_save.mjs`: 5/5; `output/verify_star_visuals.mjs`: 4/4.
- The required web-game client reached ordinary Stronghold gameplay with save v19, Yellow Dwarf sphere metadata, dormant wormhole state, no error artifact, and a visibly upgraded stellar capture at `output/web-game-celestial-visible/shot-0.png`.
- Visually inspected the ordinary system and default galaxy-map paths at `output/visuals/celestial-cinema/normal-path-system-visible.png` and `normal-path-galaxy-visible.png`.
- Final production build, syntax checks, and `git diff --check` pass; only the existing large-chunk advisory remains.

---

## Session 2026-07-15 — Replace legacy stars and resting wormholes

**Task claimed:** Replace the legacy ordinary-star and resting-wormhole presentations with the new cinematic renderers.

### Completed
- Routed all ten ordinary stellar classes away from the legacy sphere path and through distinct cinematic shader families: convective dwarfs, hot white/blue stars, irregular giants, compact white dwarfs, and eruptive flare stars.
- Added class-specific surface motion, silhouettes, coronae, winds, diffraction structures, magnetosphere rings, eruption plumes, bloom/exposure behavior, and matching Canvas2D fallbacks while retaining the five exotic renderers.
- Replaced dormant and anchored wormhole pinpoints with persistent gateway geometry: a dark aperture, continuous photon rings, counter-rotating segmented rails, curved spokes, lens echoes, and distinct violet dormant versus cyan anchored motion.
- Added a deterministic post-bloom resting-gateway layer so the replacement is visible on the first visit even before any anchored/transit state has initialized.
- Kept all star mechanics, orbital layouts, Dyson rules, wormhole routes, costs, timing, pause behavior, controls, and camera behavior unchanged.

### Verification
- `node output/verify_celestial_cinema.mjs` — 72/72 pass across every ordinary and exotic stellar class, all seven wormhole states, shader compilation, Intel/text exposure, saves, deterministic rarity, screenshots, and performance. The first-visit dormant portal now records 513 chromatic center pixels; final close-map medians were 5.00 ms baseline and 4.00 ms exotic.
- `node output/verify_phase4.mjs` — 39/39 wormhole routing/pause checks; `node output/verify_v16_overhaul_save.mjs` — 5/5 migration/round-trip checks; `node output/verify_star_visuals.mjs` — 4/4 legacy-star pixel checks.
- The required web-game client reached ordinary gameplay with `saveVersion: 19`, `stellarRendererKind: convective`, and `wormholeVisualPhase: dormant`; `output/web-game-cinematic-replacement/shot-0.png` was visually inspected and shows the replacement Yellow Dwarf renderer.
- Visually inspected the new ordinary-star catalog and the first-visit dormant gateway under `output/visuals/celestial-cinema/`.
- `npm run build`, JavaScript syntax checks, and `git diff --check` pass; the production build reports only the existing large-chunk advisory.

---

## Session 2026-07-15 — Stable 16-class catalog, coordinate naming, and Reveal All repair

**Task claimed:** Replace the mixed catalog with 16 stable classes, add persistent galaxy/system/body coordinate names, widen binary systems, apply light class properties, and repair Reveal All across ten galaxies.

### Completed
- Advanced saves to v20. Graph nodes now persist authoritative `stellarClass`, shuffled `catalogNumber`, formatted catalog IDs, aliases, and a monotonic `nextCatalogNumber`; v19 maps retired types without changing planets or system state.
- Added the complete 16-class generation table, per-galaxy class floors, exact planet/environment biases, deterministic physical Intel, and completed-Dyson Solarii multipliers.
- Added Brown Dwarf, Neutron Star, Magnetar, Wolf–Rayet, Hypergiant, and Black-Hole System WebGL/Canvas2D silhouettes; retained specialized cinematic renderers for the remaining ten classes.
- Binary separation is now 1.45–1.75 stellar radii with seeded projected inclination. The reference sample has a visible gap for 77% of its orbit and a brief 11% edge-on eclipse interval.
- Applied `G001-S042`, planet, moon, and Core naming throughout stored display names while retaining internal IDs and aliases; extended text rendering with catalog IDs, aliases, physical properties, renderer kind, and moon records.
- Repaired Reveal All to populate each galaxy's Intel map, reveal all 4,010 nodes and ten wormholes without hydrating abstract galaxies, invalidate Intel caches, refresh the UI, and report exact counts.
- Superweapon-created stars receive persistent S401+ numbers; deleted numbers are not reused.

### Verification
- `output/verify_stellar_catalog_v20.mjs`: 50/50 generation, distributions, hydration, Reveal All, created-star numbering, and Dyson multiplier checks.
- `output/verify_celestial_cinema.mjs`: 100/100 across all 16 WebGL system renderers, compact galaxy silhouettes, all 16 Canvas2D fallbacks, v19 migration, binary phases, seven wormhole states, no shader/console errors, and render-cost guard. Final close-map medians were 5.40 ms baseline and 5.80 ms catalog.
- `output/verify_phase4.mjs`: 39/39 save, hydration, unanchored/anchored routing, and pause checks; `output/verify_v16_overhaul_save.mjs`: 5/5; `output/verify_save_v12.mjs`: 11/11; `output/verify_v18_operation_drones.mjs`: 11/11.
- Required web-game client exposes save v20, system/body/moon catalog IDs, aliases, physical properties, and dormant wormhole state with no error artifact.
- Visually inspected representative WebGL classes, the all-class galaxy gallery, representative Canvas2D fallbacks, and the final client frame.
- Final production build passes; Vite reports only the existing large-chunk advisory.

---

## Session 2026-07-15 — Galaxy-map wormhole monument

**Task claimed:** Make the galaxy-view wormhole dramatically more cinematic and visually important.

### Completed
- Replaced the compact galaxy-map gateway treatment with a large phase-aware monument layered around the existing WebGL aperture.
- Added a broad gravitational aura, bent-light caustic arcs, six counter-rotating segmented megastructure rails, inward-curving energy filaments, orbiting runic pylons, spiral sparks, an anamorphic flare, and a localized collapse shock ring.
- Gave dormant, anchored, charging, opening, transit, and collapse states distinct energy levels and violet/pink versus cyan/violet color identities while preserving existing travel behavior.
- Increased the close-map core silhouette and scaled detail by galaxy LOD to keep far views readable and close views cinematic.
- Moved the galaxy, Core, and wormhole-phase labels beyond the outer pylon extent so they no longer cross the portal geometry.
- Extended the celestial verifier with screenshots and large-structure pixel assertions for every galaxy-map wormhole phase; also made its repeated Intel sampling explicitly re-enter the system to prevent stale-panel flakes.

### Verification
- `node output/verify_celestial_cinema.mjs` — 112/112 pass. Galaxy gateway phases record 11,928–21,172 chromatic pixels and 11,130–18,946 bright outer-structure pixels, with no shader or browser-console errors.
- Close-galaxy render medians remain inside the 20% guard: 4.70 ms baseline and 5.00 ms cinematic catalog.
- `node output/verify_phase4.mjs` — 39/39 wormhole routing, anchoring, hydration, save, and pause checks.
- The required web-game client produced valid save-v20 text state and a correct intro frame; the focused verifier supplied the actual galaxy-map phase captures.
- Visually inspected dormant, anchored, transit, and collapse galaxy frames; the monument is clearly readable as the map's central landmark and its labels remain unobstructed.
- `npm run build`, `node --check src/js/render.js`, and `git diff --check` pass. Vite reports only the existing large-chunk advisory.

---

## Session 2026-07-15 — Streamline galaxy-map wormhole

**Task claimed:** The galaxy-view wormhole is too complex and causes lag.

### Completed
- Reduced the close-map gateway footprint by roughly one-third and tightened its aura from 3.3 to 2.1 local radii.
- Replaced more than one hundred individually stroked rail segments with one to three dashed-ring strokes depending on LOD.
- Removed the 26-particle spark swarm, reduced twelve-to-sixteen filaments to four batched active-phase filaments, and reduced eight-to-twelve independently transformed pylons to four anchors in one path.
- Removed the full turbulent black-hole shader from galaxy view and replaced it with a compact radial aperture plus photon ring; the detailed shader remains available in System view.
- Reduced close-view shadow blur and core rendering extent while keeping dormant purple, anchored cyan, active vortex, and collapse silhouettes distinct.
- Updated the visual verifier to assert the cleaner compact gateway signature rather than the superseded monument-scale density.

### Verification
- `node output/verify_celestial_cinema.mjs` — 112/112 pass with all six galaxy-map wormhole phases, all stellar renderers/fallbacks, and no shader or browser-console errors.
- Phase signatures now occupy 4,131–5,577 chromatic pixels instead of roughly 11,928–21,172, substantially reducing animated visual density while remaining clearly readable.
- Close-galaxy median render cost is 4.80 ms against a 4.90 ms same-environment baseline and inside the 20% guard.
- The required web-game client completed successfully and generated valid screenshot/text artifacts.
- Visually inspected dormant, anchored, transit, and collapse frames; the gateway is smaller, cleaner, and its labels remain readable.

---

## Session 2026-07-15 — Required Academy tutorial and Field Manual

**Task claimed:** Replace the short coach tutorial with a required profile-level onboarding campaign, progressive feature locks, graduation flow, contextual unlock briefings, and developer overrides.

### Completed
- Added stable tutorial step IDs, centralized access gates, tutorial-only pacing, a controlled battle checkpoint contract, and save-v21 migration/schema.
- Added browser/Electron profile persistence for graduation and one-time Field Manual briefings.
- Added the Field Manual registry, Campaign-panel archive, unlock briefing modal, title-mode locks, graduation reuse of campaign setup, and developer tutorial controls.
- Reworked the required Academy into the first expansion loop: command controls, outpost/logistics/shipyard/scout, deterministic frontier intel, escort travel, scripted tactical battle, five-second capture, and same-empire graduation.
- Kept Save/Load, pause, Help, and accessibility controls available; normal/imported saves bypass tutorial restrictions, and only the permanent developer graduation action writes profile completion.

### Verification
- `output/verify_tutorial_coach.mjs` — 26/26 stable curriculum, completion predicates, access gates, override/relock, pacing, and capture checks.
- `output/verify_tutorial_profile_manual.mjs` — 10/10 profile, one-time briefing, v20-to-v21 migration, exact checkpoint restore, and checkpoint cleanup checks.
- `output/verify_tutorial_browser.mjs` — 20/20 title locks, `aria-disabled`/reason state, coach anchors, shared access rejection, developer override, profile graduation, contextual briefing, pause restoration, and zero page-error checks.
- `output/verify_phase6.mjs` — 42/42; `output/verify_v16_overhaul_save.mjs` — 5/5; `output/verify_save_v12.mjs` — 11/11; campaign intro/custom routing — 21/21.
- Required web-game client completed two iterations against the production preview with save v21 and an active `command_basics` tutorial; the title locks, outpost coach, galaxy coach, Field Manual modal, and intro frame were visually inspected.
- Both standalone and normal Vite builds pass. Vite reports only the existing large-chunk advisory.

---

## Session 2026-07-15 — Hull Forge flagship + fleet upgrades

**Task claimed:** Add a Hull Forge tech-tree lane with 5 progressive flagship stages (visual morph + real effects) and wire fleet hull-refits to matching visual accents.

### Done
- Added `hull_mods` / “Hull Forge” layout lane between Defense and Economy with five mid-game stages: Reinforced Frame → Drive Lattice → Arsenal Hardpoints → Command Lattice → Sovereign Hull.
- Stages set `flagshipHullStage` (0–5) plus HP/DPS/speed/command/fleet multipliers; late Flagship/hero nodes now cross-link from stage 3+ / Sovereign Hull without double-counting core flagship mults.
- Progressive morph layers in `drawFlagshipModel`; fleet refit accents + empire marks in hull sprites; bitmap cache keys include refit/stage.
- Research completion and save load rescale flagship max HP (preserve ratio); HUD shows Mk I–V on flagship location.

### Verification
- `validateTechGraph()` passes; Hull Forge nodes route to `hull_mods`.
- Effects fold check: stage 5 → HP mult 1.344, DPS 1.15, speed 1.12, command 1.15, display `flagship · Mk V`.
- `npm run build` passes (standalone + Vite).

---

## Session 2026-07-15 — Dev Panel Hull Forge cheats

**Task claimed:** Add Dev Panel cheats/hacks for Hull Forge, fleet refits, late flagship cluster, and Field Manual briefings.

### Done
- New **Hull Forge & Flagship** section: Mk 0–V stage setter (strips higher stages for visual testing), Unlock Hull Forge / Fleet Refits / Late Flagship, Max Flagship Kit, Damage 50%/25%, Heal Flagship, Mark All Briefings Seen.
- `devSetHullForgeStage`, `devUnlockFleetRefits`, `devUnlockLateFlagship`, `devDamageFlagship`, `devMaxFlagshipKit` + `devAction` dispatch; unlock-all/unlock-tech/complete-research refresh flagship max HP.
- Context line shows current Hull Mk; stage label shows Mk + HP.

### Verification
- Node cheat smoke: stage 3 → Mk III / 2240 HP; fleet refits unlock 9 hulls; damage/heal; max kit → stage 5 + late cluster.
- `npm run build` passes.

---

## Session 2026-07-15 — Dramatic Hull Forge flagship morphs

**Task claimed:** Make Hull Forge visual upgrades much more stunning — early stages subtle, late stages a longer/thicker powerhouse with more engines and weapons.

### Done
- Reworked `drawFlagshipModel` with stage-driven length/width morphs, expanding drive banks (4→9), nacelle stalks (2→6), bristling battery grids, spinal lance, command citadel, and Mk V energy spine / hangar / sovereign crest.
- Added `flagshipVisualScale` (1.0 → ~1.88 at Mk V) applied in `drawFlagshipSprite` and combat hull draw path.

### Verification
- Scale helper: Mk0=1 … Mk5=1.88; `npm run build` passes.

---

## Session 2026-07-16 — Helioclast siege ship + cleaner tech links

**Task claimed:** Turn Helioclast into a 6-stage movable siege capital with live-fire gate and Fleet sub-tab; collapse Online/Armada fan-in into doctrine hubs.

### Done
- Tech hubs: Online ≤6 prereqs via Modes / Empire / War / Lattice-Hegemony / Sovereignty hubs; Armada split into capital/carrier/escort hubs.
- Helioclast ship entity: stages 1–6, live-fire calibration, pose/transit, flagship follow or battle-group assign, slow lane speed (42 vs fleet 100).
- Staged wedge siege draw + beams from ship pose; combat spawn when mobile.
- Fleet Command sub-tabs Ships / Fleets / Helioclast; Dev Mark Live-Fire; save v23 hydrate/migrate.

### Verification
- Online prereqs = 6, no tech cycles; stage 5 blocks travel until live-fire → stage 6 mobile; save roundtrip + v22→v23 migrate; `npm run build` passes.

---

## Session 2026-07-16 — Fix View Battle defeat toast loop

**Task claimed:** Clicking View Battle flooded the screen with Battle started / Defeat toasts at 0s.

### Diagnosis
- Player-owned systems with hostiles but **no friendly combatants** still started battles.
- View Battle promoted those empty fights to tactical; one tick later they resolved as Defeat and immediately restarted while the system stayed in view.

### Done
- `shouldBattle` now requires at least one friendly combatant (ships / flagship / hero / Helioclast / defense structures).
- Unified Helioclast presence checks; promote refuses empty ghost fights; wipeouts with no initial friendlies ceasefire instead of defeat.

### Verification
- Empty stronghold + pirates: no battle loop; flagship + pirates: stable tactical fight; helioclast-only promote spawns the siege ship; `npm run build` passes.

---

## Session 2026-07-16 — Helioclast shipyard + reference siege ship

**Task claimed:** Build a Helioclast shipyard first, assemble the reference wedge at the berth with timed parts, fix zoom floor, slow in-system flagship chase.

### Done
- Replaced instant cradle with drone-built `helioclast_shipyard` (save v24 migrate).
- Timed berth `buildJob` part installs with partial silhouette layers + Fleet ETA.
- Rewrote Canvas wedge to reference (blunt aperture bow, T-wings, spine, tower+domes); removed `Math.max(22)` zoom floor; beams from aperture.
- In-system chase at `HELIOCLAST_SYSTEM_SPEED` instead of snap follow.

### Verification
- Instant yard → staged parts → live-fire → mobile; chase closes distance; v23 cradle migrates to shipyard; `npm run build` passes.

---

## Session 2026-07-16 — Detangle Helioclast tech spine

**Task claimed:** Main path = construction + live-fire; strategy modes on a separate lane; cut doctrine fan-ins.

### Done
- Spine: Dyson → Frame → Power → Focus → Containment → Gate Cap → Live-Fire Protocol → Online.
- Strategy lane (`sw_modes`): Create → Destroy → Jump → Relay → Modes Doctrine (branches from Focus).
- Removed Online fan-in (sovereignty / empire / war / lattice hubs) and early merges into Maturity / Sector Capitals / Cradle.
- Build stages no longer require mode parts; containment/gate install after Focus; live-fire yard test gated by `sw_live_fire`.

### Verification
- No tech cycles; Online prereqs = `sw_live_fire` only; `npm run build` passes.

---

## Session 2026-07-16 — Spine weaves + detangle cross-links

**Task claimed:** Let certain side lines weave back into the main path for progression, and cut the spiderweb of connections.

### Done
- Weave-backs: Parallel Dock → Maturity, Trade Hub → Capitals, Research Station → Cradle (Online stays linear).
- Trimmed long-span / multi-lane prereqs (sovereignty hub, fortress package, hero/diplomacy/wormhole flavor gates, redundant Lab II pulls).
- Cross-lane multi-prereq nodes down substantially; lanes stay clearer within themselves.

### Verification
- No tech cycles; `npm run build` passes.
