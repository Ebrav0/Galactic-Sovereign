# Galactic Sovereign — Implementation Plan

**Version:** 1.0
**Companion to:** `GALACTIC_SOVEREIGN_MASTER_PLAN.md` (the GDD — *what* to build)
**This document:** the engineering plan — *how* to build it.

If this document and the GDD conflict, **the GDD wins**; update this document to match.

---

## §1 Architecture Overview

### Process model

Electron three-process split:

| Process | File(s) | Responsibility |
|---------|---------|----------------|
| **Main** | `electron/main.js` | Creates the `BrowserWindow`, bootstraps the save directory, handles all filesystem I/O via IPC handlers. Never contains game logic. |
| **Preload** | `electron/preload.js` | `contextBridge` exposing a minimal, promise-based `window.gameSave` API to the renderer. No `nodeIntegration` in the renderer. |
| **Renderer** | `src/**` | The entire game: simulation, rendering, input, UI. Written as browser-compatible ES modules so it also runs in a plain browser via Vite dev server (`npm run dev`) with a `localStorage` save fallback. |

### Game loop

- **Fixed-timestep simulation:** 20 ticks/second (`TICK_MS = 50`). The simulation advances only in whole ticks; an accumulator converts wall-clock time (or `advanceTime` calls) into ticks.
- **Rendering:** `requestAnimationFrame`, decoupled from the tick rate. Rendering reads state; it never mutates it.
- **Pause:** a `paused` flag checked at the accumulator level. When paused, no ticks execute, but rendering, UI, and save/load continue to work.

### Determinism principle (hard rule)

All positions that matter — planet orbits, moon orbits, shuttle motion — are **pure functions of `state.time`** (total simulated milliseconds) plus static orbital parameters generated from the seed. Never accumulate positions per frame. Consequences:

- Save files only need `state.time`, not any positions.
- `advanceTime(ms)` in a test produces the exact same world as real elapsed play.
- Same seed + same action sequence ⇒ identical `render_game_to_text()` output.

### Data flow

```
input.js ──orders──▶ economy.js / simulation.js ──mutates──▶ state
state ──read-only──▶ render.js + shuttles.js ──draws──▶ canvas
state ──serialize──▶ save.js ──IPC──▶ electron/main.js ──▶ disk
```

---

## §2 Repository Layout

```
Galactic Soverign/
  package.json              # scripts + devDependencies (electron, vite, electron-builder)
  vite.config.js            # root = src/, relative base for packaged builds
  .gitignore
  progress.md               # session handoff log (§9)
  AGENTS.md                 # agent quick-start (read order, rules, hooks)
  GALACTIC_SOVEREIGN_MASTER_PLAN.md   # the GDD
  docs/
    IMPLEMENTATION_PLAN.md  # this file
    schemas/
      save-v0.json          # save schema reference, one file per version
  electron/
    main.js                 # window lifecycle, save-dir bootstrap, IPC handlers
    preload.js              # contextBridge: window.gameSave
  src/
    index.html              # single canvas + HUD containers
    css/
      style.css             # HUD, panels, pause overlay
    js/
      main.js               # boot, loop wiring, view state, test hooks — wiring only
      constants.js          # ALL balance numbers (§3)
      state.js              # serializable state shapes + createNewGame(seed)
      galaxy.js             # star layout, lane graph (MST + extras), BFS routing
      flagship.js           # flagship flight (tick-driven) + lane transit
      simulation.js         # fixed-timestep tick driver; pause
      economy.js            # outposts, credit income
      shuttles.js           # visual shuttle animation (never saved)
      render.js             # Canvas 2D drawing; system + galaxy cameras live here
      input.js              # pointer/keyboard: hit-testing, pan/zoom, thrust keys
      save.js               # serialize/deserialize, slots, checksum, migration, fallback
      ui.js                 # HUD, build panel, save menu, notifications
```

---

## §3 Conventions

1. **All balance numbers live in `src/js/constants.js`.** Costs, rates, multipliers, tick length, autosave interval, orbital speed factors. Logic files import from `constants.js`; grep for numeric literals in logic files during review.
2. **Authoritative state lives in `src/js/state.js` shapes.** Anything in `state` is serializable, JSON-safe (no functions, no class instances, no `Infinity`/`NaN`), and belongs in the save file. Visual-only data — camera, shuttle sprites, particles, hover/selection UI state — must never enter `state`.
3. **ES modules everywhere** in the renderer (`type: "module"`); CommonJS in `electron/` (main process).
4. **Naming:** `camelCase` functions/variables, `SCREAMING_SNAKE` constants, `kebab-case` files avoided — single-word lowercase module names.
5. **Error posture:** validate at boundaries (save-file loads, IPC payloads, user build orders). Internal module-to-module calls trust their inputs. Corrupt saves are refused, never "repaired" silently, and never deleted.
6. **No frameworks in the renderer** for Phase 0–2. Canvas 2D + vanilla JS. Revisit (Pixi) only if profiling demands it.

---

## §4 Module Contracts

| Module | May read | May mutate | Must never |
|--------|----------|------------|------------|
| `constants.js` | — | — (frozen data) | contain logic |
| `state.js` | constants, galaxy | creates state objects | touch DOM/canvas |
| `galaxy.js` | constants | nothing (pure generation + graph queries) | touch DOM/canvas; hold live state |
| `flagship.js` | state, constants, galaxy | `state.flagship` (inside ticks/orders); its own thrust-input vector | touch DOM/canvas; serialize the input vector |
| `simulation.js` | state, constants | `state.time`, delegates tick work | touch DOM/canvas |
| `economy.js` | state, constants | `state.credits`, system structures | touch DOM/canvas |
| `render.js` | state, cameras, constants | canvas pixels, cameras, follow flag | mutate game state |
| `shuttles.js` | state, constants | its own visual sprite list | mutate game state; be serialized |
| `input.js` | state, cameras | cameras; calls into economy/simulation/flagship APIs | mutate state fields directly |
| `save.js` | state, constants | nothing live (pure serialize/deserialize + I/O calls) | hold references into live state after load |
| `ui.js` | state, constants | DOM inside HUD containers; calls exported APIs | mutate state fields directly; draw on canvas |
| `main.js` | everything | wiring, loop bookkeeping | contain balance or game logic |

Enforcement is by convention + review; there is no runtime guard. When a change would violate a contract, change the design, not the contract.

---

## §5 State & Save Schema (save-v2, current)

### Live state shape (authoritative, in `state.js`)

```js
{
  meta: {
    seed: 123456789,          // integer; drives all procedural generation
    createdAt: 1751470000000, // epoch ms
    playTimeMs: 0             // accumulated real play time (informational)
  },
  time: 0,                    // simulated ms; the determinism clock
  credits: 900,               // starting credits from constants
  paused: false,              // serialized so a save reopens paused
  stronghold: "sys-19",       // star id of the Stronghold
  galaxy: {                   // 20-star lane graph, all from the seed
    stars: [ { id: "sys-0", name: "...", x: 412, y: -305 } ],
    blackHole: { id: "core", name: "Galactic Core", x: 0, y: 0 },
    lanes: [ ["sys-0", "sys-7"], ["sys-7", "core"] ]  // undirected edges
  },
  systems: {                  // one system per star + the black-hole core
    "sys-0": {
      id: "sys-0",
      name: "...",
      owner: "player" | "neutral",
      star: { radius: 40, color: "#ffd27a" },   // core adds kind: "blackhole"
      bodies: [               // planets; moons nested under their planet
        {
          id: "p1",
          kind: "planet",
          type: "habitable" | "barren" | "gas",
          name: "...",
          orbitRadius: 220,     // world units from star
          orbitPeriodMs: 240000,// full revolution time
          orbitPhase: 0.37,     // 0..1 offset from seed
          radius: 12,           // draw/hit radius
          moons: [
            { id: "p1m1", name: "...", orbitRadius: 30,
              orbitPeriodMs: 30000, orbitPhase: 0.1, radius: 4 }
          ]
        }
      ],
      structures: [           // flat list; body linkage by bodyId
        { id: "st1", type: "outpost", bodyId: "p1", builtAtTime: 12345 },
        { id: "st2", type: "shipyard", bodyId: "p1", builtAtTime: 5000,
          build: null | { hull: "scout", startedAt: 12000, durationMs: 18000 } }
      ]
    }
  },
  scouts: [
    { id: "scout-1", systemId: "sys-19", transit: null }
  ],
  intel: { "sys-19": { gatheredAt: 0 } },   // Stronghold pre-populated
  capture: { "sys-3": { progressMs: 4000 } },
  flagship: {
    systemId: "sys-19",       // node id occupied; null while in lane transit
    x: 0, y: -130,            // system-view world coords (player-driven, so stored)
    vx: 0, vy: 0,
    heading: 0,               // radians
    transit: null             // or { path: [nodeIds], legIndex,
                              //      legStartTime, legDurationMs }
  }
}
```

Orbital positions are **not stored**: `angle = 2π * (orbitPhase + time / orbitPeriodMs)`.
Lane-transit positions are **not stored** either: they interpolate from
`legStartTime`/`legDurationMs` against `state.time`. The flagship's free-flight
position is player-driven and therefore serialized — but it only mutates inside
simulation ticks, so `advanceTime` stays deterministic.

### Save file envelope (on disk / in localStorage)

```json
{
  "saveVersion": 1,
  "checksum": "<crc32 hex of the JSON-stringified state field>",
  "savedAt": 1751470000000,
  "state": { }
}
```

### Migration 0 → 1

`migrateSave` regenerates the galaxy from the saved seed via `createNewGame`,
installs the old single `state.system` (structures intact) as the Stronghold
system, and spawns the flagship there. The checksum is verified **before**
migration — it always covers the file as written.

### Migration 1 → 2

Adds `owner` per system, `scouts[]`, `intel`, `capture`, shipyard `build` queues,
and re-seeds neutral outposts/shipyards deterministically from `meta.seed`.

### Migration 2 → 3

Star type backfill for cinematic multi-type stars (`star-types.js`).

### Migration 3 → 4

Adds `playerShips[]`, `pirates` (wandering test faction), `systemBattles`, and `battleStance` for Phase 2 combat.

### Schema evolution rules

Any change to the state shape requires, in the same change:

1. Bump `SAVE_VERSION` in `constants.js`.
2. Add a `case` to `migrateSave(envelope)` in `save.js` that upgrades version *n−1* → *n*.
3. Add `docs/schemas/save-v<n>.json` describing the new shape. Never edit old schema files.

---

## §6 Save I/O Contract

### Slots

| Slot | Written by | When |
|------|------------|------|
| `autosave` | game loop | every `AUTOSAVE_INTERVAL_MS` (default 120 s) while unpaused |
| `slot-1` … `slot-3` | player | manual save from HUD menu |
| `exit-save` | Electron main window `close` | app quit (Electron only) |

Files live in `<Documents>/Galactic Sovereign/saves/<slot>.json`.

### IPC channels (main process handlers)

| Channel | Args | Returns |
|---------|------|---------|
| `save:write` | `(slot, envelopeJsonString)` | `{ok}` or `{ok:false, error}` |
| `save:read` | `(slot)` | `{ok, data}` or `{ok:false, error}` |
| `save:list` | — | `{ok, saves: [{slot, savedAt, saveVersion, sizeBytes}]}` |
| `save:delete` | `(slot)` | `{ok}` |

Slot names are validated against the whitelist above in the **main process** (never trust the renderer). The preload exposes these as `window.gameSave.{write,read,list,delete}` returning promises.

### Checksum

CRC-32 of `JSON.stringify(state)`, hex-encoded, implemented in `save.js` (shared by write and verify). On load: version check → migrate if needed → checksum verify → hydrate. A failed checksum or unknown version **refuses the load with a UI message and leaves the file untouched**.

### Browser fallback

When `window.gameSave` is undefined (Vite dev in a plain browser), `save.js` transparently uses `localStorage` keys `gs-save-<slot>` with identical envelope semantics, plus **Export** (JSON download) / **Import** (file picker) in the save menu.

---

## §7 Test Hooks Specification

Exposed on `window` by `src/js/main.js`. **Every new feature must be observable through `render_game_to_text()` — unobservable features are not done.**

| Hook | Signature | Contract |
|------|-----------|----------|
| `advanceTime` | `(ms: number) => void` | Synchronously runs `floor(ms / TICK_MS)` fixed ticks. Bypasses rAF entirely. **Respects pause** (no-op while paused). Deterministic. |
| `render_game_to_text` | `() => string` | JSON string of observable state: `{ time, paused, credits, view, currentSystem, systemName, strongholdSystem, selection, incomePerSec, flagship: {systemId, x, y, vx, vy, heading, inTransit, destination, transitProgress, etaMs}, galaxy: {starCount, laneCount, blackHole}, bodies: [{id, kind, type, name, moonCount, hasOutpost, canBuildOutpost}], structures: [{id, type, bodyId}], shuttles: {active, count} }` — bodies/structures/shuttles are scoped to the viewed system |
| `getGameState` | `() => object` | Live state reference. Dev/test only; never used by game code. |
| `__setFlagshipInput` | `(x, y) => void` | Sets the thrust vector ticks read (−1..1 each axis). Bypasses the view gate so tests stay deterministic. |
| `__orderTravel` | `(starId) => result` | Issues a lane-travel order; returns `{ok, path, etaMs}` or `{ok:false, reason}`. |
| `__setView` | `('system'\|'galaxy') => void` | Switches the active view. |
| `__viewSystem` | `(systemId) => void` | Opens a system's view (any node, including `core`). |

Assertion pattern (Playwright client or console):

```js
const before = JSON.parse(window.render_game_to_text()).credits;
window.advanceTime(60000);
const after = JSON.parse(window.render_game_to_text()).credits;
// after > before  ⇔  an outpost is producing
```

---

## §8 Phase Task Breakdown

Phases follow GDD §19. One task per agent session; do not skip phases.

### Phase 0 — Foundation (current)

| # | Task | Acceptance criteria |
|---|------|---------------------|
| 0.1 | Project scaffold: `package.json`, `vite.config.js`, `.gitignore`, `progress.md`, docs tree | `npm run dev` serves; `npm run electron` opens a window |
| 0.2 | Electron shell: window, save-dir bootstrap, IPC save handlers, preload bridge | `window.gameSave` defined in Electron; saves dir created under Documents |
| 0.3 | Renderer skeleton: canvas, HUD containers, boot, fixed 20 Hz loop + rAF render | blank system renders; loop verified via `advanceTime` |
| 0.4 | `constants.js` + `state.js` with `createNewGame(seed)` | state is JSON-round-trippable; all numbers in constants |
| 0.5 | System view render: star, orbit rings, planets/moons from `state.time`, starfield, selection highlight; camera pan/zoom | same `time` ⇒ same positions; camera not in state |
| 0.6 | Input: click hit-test, planet selection, Escape deselect, Space pause, hover cursor | selection visible in `render_game_to_text()` |
| 0.7 | Economy: `buildOutpost` validation + cost; per-tick income with moon scaling; Stronghold flag | credits rise only with outpost; habitability enforced; income matches `OUTPOST_BASE_INCOME * (1 + MOON_YIELD_BONUS * moons)` |
| 0.8 | Moon shuttles: visual loops planet↔moons when outpost exists | shuttle count reflects moons; nothing serialized |
| 0.9 | Pause wiring: overlay, both toggles, `advanceTime` no-op while paused | paused sim produces zero credit change |
| 0.10 | Save v0: envelope + checksum + slots + fallback; `docs/schemas/save-v0.json` | save→restart→load restores credits/structures/time in Electron; fallback works in browser |
| 0.11 | HUD: top bar, build panel, save/load menu, toasts | all actions reachable by mouse only |
| 0.12 | Test hooks complete + Playwright verification + `progress.md` entry | §7 hooks pass the assertion pattern; screenshots inspected; zero console errors |

**Phase 0 exit criteria:** all of the above, plus determinism spot check (same seed + same `advanceTime` sequence ⇒ identical `render_game_to_text()`).

### Phase 1 — Galaxy slice

| # | Task | Acceptance criteria |
|---|------|---------------------|
| 1.1 | Galaxy generation: 20-star seeded layout, MST + extra lanes, black hole core node (`galaxy.js`) | graph fully connected; avg degree 2–4; black hole reachable; deterministic from seed |
| 1.2 | Multi-system state: one system per star + core system; save-v1 + 0→1 migration + schema doc | v0 saves load with structures intact at the Stronghold; corrupt saves still refused |
| 1.3 | Flagship free flight: WASD/arrow thrust integrated in ticks; follow camera (pan breaks, thrust/F re-engage) | pause freezes flight; `advanceTime` + `__setFlagshipInput` deterministic |
| 1.4 | Lane transit: click star to order travel; BFS multi-hop routing; ETA HUD; arrival at system edge retargets view | transit position pure function of `state.time`; pause freezes progress; build requires flagship presence |
| 1.5 | Galaxy map view: lanes + traffic pulses, star nodes, stronghold ring, black hole/wormhole visuals, transit icon; M view toggle; double-click opens system | all observable via `render_game_to_text()`; verified in `output/verify_phase1.mjs` |
| 1.5b | Shipyard + scout production: build shipyard, queue scout hulls, multi-scout fleet | local 1-slot queue per shipyard; scouts travel lanes independently; no free starting scout |
| 1.6 | Scout intel overlay (scout ship, fog peel, per-system intel) | **done** — Shift+click dispatch; intel on scout arrival or flagship visit |
| 1.7 | Dynamic capture requirement + 20 s uncontested hold | **done** — owner gate on build; contest via `__setEnemyPresence` test hook |

Tasks 1.1–1.7 shipped in the 2026-07-02 Phase 1 sessions. The wormhole
at the galactic core is a **dormant landmark** until Phase 4 (a single galaxy
gives an unanchored exit nowhere to go).

### Phase 2 — Combat hybrid + wandering pirates

| # | Task | Acceptance criteria |
|---|------|---------------------|
| 2.1 | Hull defs + player ships + save-v4 | `HULL_STATS` for 8+ classes; `playerShips[]`, `pirates`, `systemBattles` serializable; v3→v4 migration preserves scouts/ownership |
| 2.2 | Shipyard combat queues | Queue corvette/frigate/destroyer/healer; observable in `render_game_to_text().production` |
| 2.3 | Player fleet transit | `fleets.js`; ships dispatch along lanes; pause freezes transit |
| 2.10 | Wandering pirate faction | `pirates.js`; 2 rim fleets wander deterministically; galaxy markers |
| 2.4 | Auto-resolve engine | Same inputs → same casualties; stance via test hook |
| 2.5 | Tactical combat sim | Positions, weapons, pause, entry vector |
| 2.6 | Combat render layer | Ship sprites, HP bars, shots in `render.js` |
| 2.7 | Healers | Repair drones tactical + auto-resolve heal rate |
| 2.8 | Fleet capture + enemy presence | Combat ships count for capture; pirates contest timer; no `__setEnemyPresence` |
| 2.11 | Combat UI | Battle panel, pirate warning, stance selector |
| 2.9 | Verification + handoff | `output/verify_phase2.mjs`; `progress.md` entry |

**Phase 2 exit criteria:** hybrid combat works with wandering pirates; fleet-based capture; all verify sections pass.

### Phase 3 — Dyson loop

| # | Task | Acceptance criteria |
|---|------|---------------------|
| 3.1 | Constants + state + save-v5 | `solarii`, `solariiUnlocked`, per-system `dyson`; v4→v5 migration; `docs/schemas/save-v5.json` |
| 3.2 | Foundry + launcher build | 1 foundry/system, ≤3 launchers/body; flagship gate; test hooks |
| 3.3 | Production tick | foundry → auto logistics → launchers → shell progress; pause-safe; deterministic |
| 3.4 | Solarii + shell bonuses | Shell #1 unlocks Solarii; Shell #2 credit bonus; Shell #3 sail efficiency |
| 3.5 | Capture weight + persistence | Dyson structures/shells increase capture req; progress survives conquest |
| 3.6 | Sail shuttle visuals | Deterministic foundry↔launcher sprites; `sailShuttles.count` observable |
| 3.7 | Shell tier visuals | `drawStarOverlays` tiers 1–8 + launch bursts |
| 3.8 | Dyson UI | Solarii top bar, build buttons, Dyson tab panel, shell toasts |
| 3.9 | Test hooks | Full `render_game_to_text()` dyson block; `__buildFoundry`, `__buildLauncher`, etc. |
| 3.10 | Verification | `output/verify_phase3.mjs`; phase1/2 regression |
| 3.11 | Docs + handoff | This table + `progress.md` entry |

**Phase 3 exit criteria:** full production chain; Solarii after Shell #1; shell visuals; save-v5; verify scripts pass.

### Phase 4 — Scale & wormholes
400-star generation; black hole node; anchored + unanchored wormholes; abstract simulation of inactive galaxies; hydration on entry.

### Phase 5 — Empire layer
Empire-wide build queue with shipyard routing; research stations + tech web; trade stations; first AI faction.

### Phase 6 — Late game
Superweapon (3 completed spheres); hero flagships; diplomacy; 5–6 missions; tutorial; content roster completion.

---

## §9 Session Workflow

Every working session (human or agent) ends by **appending** an entry to `progress.md`. Never delete or rewrite prior entries.

### Template

```markdown
## Session YYYY-MM-DD — <short title>

**Task claimed:** <phase.task, e.g. 0.7 Economy>
**Status:** complete | partial | blocked

### Done
- <bullet list of concrete changes, with file paths>

### Decisions
- <non-obvious choices made and why>

### Known issues
- <bugs, deferred edge cases, tech debt introduced>

### Suggested next
- <the single best next task and any prep notes>
```

### Session rules

1. Read `AGENTS.md`, the GDD, this plan, and `progress.md` before writing code.
2. Claim **one task** from the current phase table (§8).
3. Verify with the test hooks and the Playwright client before marking complete.
4. Fix the first new console error before continuing work.
5. Save schema changes follow §5 evolution rules — no exceptions.
