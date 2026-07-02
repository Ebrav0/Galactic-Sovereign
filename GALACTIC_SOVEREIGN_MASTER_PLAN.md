# Galactic Sovereign — Master Planning Document

**Version:** 1.0  
**Status:** Pre-production / Design complete (conceptual)  
**Code:** Not started — planning artifact only

---

## Table of Contents

1. [Vision & Elevator Pitch](#1-vision--elevator-pitch)
2. [Design Pillars & Inspirations](#2-design-pillars--inspirations)
3. [Core Gameplay Loop](#3-core-gameplay-loop)
4. [World Scale & Procedural Generation](#4-world-scale--procedural-generation)
5. [Galaxy Layer — Lanes, Movement & Wormholes](#5-galaxy-layer--lanes-movement--wormholes)
6. [System Layer — Planets, Structures & Economy](#6-system-layer--planets-structures--economy)
7. [Dyson Sphere Megastructure](#7-dyson-sphere-megastructure)
8. [Military — Fleets, Ships & Combat](#8-military--fleets-ships--combat)
9. [Scouting, Capture & Conquest](#9-scouting-capture--conquest)
10. [Research & Technology Web](#10-research--technology-web)
11. [Superweapon & Hero Flagships](#11-superweapon--hero-flagships)
12. [Diplomacy & Factions](#12-diplomacy--factions)
13. [Trade & Logistics](#13-trade--logistics)
14. [Victory, Defeat & Campaign Structure](#14-victory-defeat--campaign-structure)
15. [Simulation, Performance & Save System](#15-simulation-performance--save-system)
16. [Presentation & UX](#16-presentation--ux)
17. [Ship & Structure Reference](#17-ship--structure-reference)
18. [Milestone & Unlock Gates](#18-milestone--unlock-gates)
19. [Development Phases](#19-development-phases)
20. [Open Tuning Parameters (Balance Pass)](#20-open-tuning-parameters-balance-pass)

---

## 1. Vision & Elevator Pitch

**Galactic Sovereign** is a lane-based galactic strategy game blending territorial logistics, staged megastructure construction, and Empire at War–style fleet combat. The player begins with a single flagship and a home **Stronghold**, expands across procedurally generated galaxies via lane networks and chaotic wormholes, builds **Dyson spheres** star-by-star for the premium currency **Solarii**, and ultimately constructs a **Superweapon** capable of creating or annihilating star systems—while commanding unlimited fleets anchored by **hero flagships** against AI empires.

**Player fantasy:** Lone operator → industrial power → megastructure architect → galactic sovereign.

**Session model:** Real-time with pause. Long-form campaign with **local save files** (no cloud required). Player-paced length—no hard time limit.

---

## 2. Design Pillars & Inspirations

### Pillars

| Pillar | Meaning |
|--------|---------|
| **Constrained expansion** | Lanes limit galactic travel; systems are open sandboxes. |
| **Visible logistics** | Moon shuttles, sail convoys, lane traffic, and fleet transits are readable and animated. |
| **Persistent war** | Captured systems keep all structures and Dyson progress—defense matters as much as offense. |
| **Flagship hero moments** | When the player flagship enters a system, combat becomes full tactical warfare. |
| **Megastructure payoff** | Eight Dyson shells per star, escalating visuals, bonuses, and Solarii. |
| **Risky connectivity** | Unanchored wormholes can dump fleets anywhere in the universe. |

### Inspirations — What We Take From Each

| Source | Borrow |
|--------|--------|
| **Kiomet.io** | Lane/node strategic map; fleet movement between connected stars; territory control (movement logic only—not visual style). |
| **Dyson Sphere Program** | Staged megastructures; sail production chains; tech-driven efficiency; satisfying construction phases. |
| **Empire at War** | Strategic map vs. tactical system battles; multiple fleet theaters; AI faction conflict; flagship presence matters in combat. |
| **Foundation (Novacula)** | Superweapon that creates, destroys, and jumps between systems at galactic scale. |

### Explicit Non-Goals (v1)

- Multiplayer (design for AI first; multiplayer is a future layer).
- Kiomet-style minimal art (this game is **detailed and sophisticated** visually).
- 3D system view ( **2D top-down** with rich animation).

---

## 3. Core Gameplay Loop

```
EARLY     Stronghold → Outpost → Moon shuttles → Credits
          → Shipyard → Lane expansion → Scout intel

MID       Fleets (lane-by-lane) → Capture systems (20s hold)
          → Foundry → Sail shuttles → Launchers → Shell progress
          → Research stations → Tech web → Carriers & healers

LATE      Shell #8 → Diplomacy | Shell #8 ×3 → Superweapon
          → Hero flagships → Multi-galaxy war via wormholes
          → System create/destroy → Victory condition
```

### Dual Currency Summary

| Currency | Earned | Spent on |
|----------|--------|----------|
| **Credits** | Outposts, trade stations, missions, salvage | Ships, structures, sails, early research, most upkeep |
| **Solarii** | Dyson shells (scaling per tier; starts Shell #1) | Flagship upgrades, hero flagships, late research, Superweapon actions, premium Dyson/trade upgrades |

**Solarii passive spend:** Light ongoing drain (flagship/hero upkeep, minor Dyson overhead)—never punitive.

---

## 4. World Scale & Procedural Generation

### Per Save (Seed)

| Layer | Count | Notes |
|-------|-------|-------|
| **Galaxies** | 10–12 | Separate strategic theaters linked by wormholes. |
| **Stars per galaxy** | 400–500 | Each star is a node on the lane graph. |
| **Planets per star** | 0–9 | Procedural; affects capture weight and build capacity. |
| **Moons per planet** | 0–8 | Boost outpost credit yield; host launchers/orbitals. |

### Galaxy Graph Generation

Each galaxy is a **connected lane graph**:

- **Spine lanes** — main highways (3–5 per galaxy).
- **Branch lanes** — dead ends, often richer systems.
- **Chokepoint stars** — high connectivity; natural battle zones.
- **Dead stars** — 0 planets; forward bases, relays, asteroid harvesters.

**Target graph feel:** Average 2–4 connections per star; diameter ~15–25 hops across 400+ nodes.

### Galactic Center

Every galaxy has a **central supermassive black hole** node:

- Not colonizable in the normal sense.
- Hosts the **wormhole phenomenon** (see §5).
- Environment hazards for unprepared fleets.

### Planet Types

| Type | Rules |
|------|-------|
| **Rocky / habitable** | Full outposts and surface + orbital slots. |
| **Barren** | Reduced yield; mostly orbitals. |
| **Gas giant** | **Orbital-only** structures—no surface outpost. |
| **Special systems** | Nebula (sensor penalty), binary stars, rich asteroid belts—generation modifiers. |

---

## 5. Galaxy Layer — Lanes, Movement & Wormholes

### Lane Travel

- Movement between stars is **only along lane edges**.
- Fleets and individual ships route on the graph—**no free galactic flight**.
- Lane types (optional depth): standard, hazardous (slower), relay (faster if both ends controlled).

### Ship Routing to Fleets

Ships are **not teleported** to their fleet. When built or reassigned:

1. Ship enters lane network at its shipyard star.
2. Jumps **lane → lane** along shortest (or player-preferred) path.
3. Arrives at rally star (player flagship, hero flagship, or designated system).
4. Joins assigned battle group.

**Strategic implication:** Reinforcements arrive over time; convoys can be intercepted on lanes.

### Wormholes

Each galaxy's black hole connects to the **wormhole network**.

| Wormhole State | Behavior |
|----------------|----------|
| **Unanchored** | Entering exits at a **random wormhole anywhere in the entire save**—any galaxy, anchored or not. High risk, high reward. |
| **Anchored** | A **Wormhole Anchor** built by player or AI creates a **fixed pairwise link** between two specific wormholes. Stable inter-galactic (or intra-galactic) travel. |

**Rules:**

- Travel is **in/out of wormholes only**—galaxies are not connected by normal lanes across meta-space.
- AI uses the same rules and can anchor wormholes competitively.
- Optional late tech: "Wormhole beacon" narrows unanchored random pool to **discovered** holes only (tips/balance valve).

### Inter-Galaxy Play

- Player begins in one galaxy; discovers others via unanchored jumps or anchors.
- **Active galaxy** runs full simulation; others run abstract (see §15).

---

## 6. System Layer — Planets, Structures & Economy

### Two Views

| View | Movement | Purpose |
|------|----------|---------|
| **Galaxy map** | Lane-based | Strategy, fleet orders, wormhole travel, trade lanes |
| **System view** | Free roam (2D top-down) | Building, tactical combat (when flagship present), shuttles, Dyson visuals |

### Stronghold

- Player's **home system**—designated at campaign start (or first system).
- Bonuses: repair speed, build speed, last-stand defenses (tune in balance pass).
- **Loss if totally destroyed** (see §14).

### Outposts & Early Economy

- Built on habitable planets (not gas giant surfaces).
- Generate **Credits**.
- **Yield scales with moon count** on the same planet (more moons → higher yield).
- **Visual feedback:** Small shuttles automatically fly **planet ↔ moons** (player does not build these).

### Structure Placement

- **Slot limits** per planet and per moon.
- Gas giants: **orbital slots only**.
- Enemies can **target specific structures** in combat; **jump-in vector** is randomized and affects which structures are threatened first.

### Buildable Structures

#### Per Body (Slot-Limited)

| Structure | Function |
|-----------|----------|
| **Outpost** | Credit income; prerequisite for most development |
| **Mining complex** | Local extraction boost (optional if folded into outpost tiers) |
| **Refinery** | Higher-value trade goods |
| **Storage depot** | Buffers production during blockades |
| **Trade station** | Hub for automatic (and optional manual) trade routes |
| **Shipyard** | Builds ships from empire queue; slots expanded via tech |
| **Fighter factory** | Replenishes carrier fighter wings |
| **Drydock** | Faster/cheaper ship repair |
| **Orbital defense platform** | Auto-resolve and tactical defense bonus |
| **Planetary shield generator** | Protects structures; extends siege time |
| **Ion battery** | Anti-capital / anti-bomber defense |
| **Dyson launcher** | Up to **3 per planet/moon**; launches sail batches toward star |
| **Asteroid harvester** | Income on belt-rich / 0-planet systems |

#### Per System (Not Body Slots)

| Structure | Cap | Function |
|-----------|-----|----------|
| **Sail foundry** | **1 per system** | Produces Dyson sails; feeds all launchers in that star |
| **Research station** | **3 per system** | Incremental research speed (see §10) |
| **Command post** | 1 (optional) | Fleet/coordination bonuses in-system |

#### Strategic / Special

| Structure | Location |
|-----------|----------|
| **Wormhole anchor** | Galactic black hole |
| **Listening post** | Star node — extended intel |
| **Lane relay beacon** | Star node — faster lane travel |
| **Blockade fort** | Star node — lane control, transit penalty |
| **Supply cache** | Star node — fleet endurance |
| **Forward base** | 0-planet stars — minimal presence |
| **Superweapon cradle** | Stronghold or designated megastructure system |
| **Salvage yard** | Optional — post-battle hull recovery |

### Empire-Wide Build Queue

- **Single empire queue** for ships (and applicable structures).
- Dispatcher sends jobs to the **nearest capable shipyard** with the **shortest queue**.
- Player can **pin** a specific shipyard override per queue item.
- Tech web unlocks **additional concurrent shipyard build slots**.

### Dyson Sail Production Chain

```
Credits → Sail Foundry (1/system) → Auto shuttles → Launchers (≤3/body) → Star shell progress
```

- **Sails are physical goods** produced at the foundry.
- **Cost:** ~**2.5–5 Credits per sail** (varies by foundry tier, tech, planet modifiers).
- **Player does not build sail shuttles**—automatic traffic between foundry and launchers scales with launcher count.
- **5,000 sails = 1 shell layer.**

---

## 7. Dyson Sphere Megastructure

### One Dyson Project Per Star

Each star system has **one unified Dyson project**. All controlled bodies contribute launch capacity; all launchers feed **one shell counter** for that star.

### Construction Pipeline

| Stage | Description |
|-------|-------------|
| Site prep | Credits + builder ships (if required by tech) |
| Foundry online | Sail production begins |
| Launchers online | Batch launch toward star |
| Shells 1–8 | 5,000 sails each; visual + bonus per shell |
| Complete (Shell #8) | Counts as **one Completed Dyson Sphere** for empire milestones |

### Eight Shells — Bonuses & Visuals

Each shell grants **system-wide bonuses** and a **major visual upgrade** on the star.

| Shell | Gameplay (conceptual) | Visual |
|-------|----------------------|--------|
| **1** | **Solarii income begins** (base rate) | First arc / lattice segment |
| **2** | Credit production bonus | Denser lattice |
| **3** | Sail efficiency / launcher throughput | Visible band |
| **4** | System shield strength (anti-Superweapon) | Partial stellar glow |
| **5** | Trade output multiplier | Radiance pulses |
| **6** | Research station efficiency in system | Interference patterns |
| **7** | Fleet repair rate in system | Near-complete envelope |
| **8** | **Completed sphere** — max bonuses | Full sphere — signature moment |

### Solarii Scaling

Solarii income **scales per shell tier** (not flat after Shell #1).

**Example curve (tune in balance):**

| Shell | Relative Solarii rate |
|-------|----------------------|
| 1 | 1.0× (base) |
| 2 | 1.25× |
| 3 | 1.5× |
| 4 | 2.0× |
| 5 | 2.5× |
| 6 | 3.25× |
| 7 | 4.0× |
| 8 | 5.0× (peak for that system) |

Empire Solarii = sum across all systems with active shells.

### Persistence on Capture

**All shell progress, launchers, foundry state, and partial spheres persist** when ownership changes. Capturing a 6-shell system is strategically huge; losing one is catastrophic.

### Dyson Shield (Anti-Superweapon)

If a system with a **completed Dyson (Shell #8)** is targeted by a Superweapon **destroy** action:

- It may **draw power from one adjacent star** that also has a **completed Dyson (Shell #8)**.
- Projects a **system shield** that blocks or mitigates the destroy attempt.
- Both contributing spheres suffer temporary drain/cooldown (exact values: balance pass).

---

## 8. Military — Fleets, Ships & Combat

### Fleet Organization

- **No cap on fleet size.**
- **Unlimited hero flagships** → effectively **unlimited fleet groups**.
- Each fleet anchors on:
  - **Player flagship**, or
  - A **hero flagship** (mini-flagship built at Superweapon cradle).
- Player flagship **not required** in every fleet late game.

### Flagship (Player)

- **Separate upgrade track** (Solarii-heavy).
- **Very high HP** — losing it is possible but rare.
- **Excellent at combat** and **command** (auras, stance bonuses, repair priority).
- Upgrades independent of general tech web (cross-links allowed).

### Hero Flagships

- Built at **Superweapon cradle** after unlock.
- Cost: **Solarii + Credits**.
- Function as **mini-flagships**—fleets rally and fight around them.
- **Unlimited count** (soft-limited by economy and UI).

### Ship Classes (Target: 15–20)

| Category | Classes |
|----------|---------|
| **Transports** | Light hauler, bulk freighter, armored convoy |
| **Escorts** | Corvette, frigate, patrol cutter |
| **Line warships** | Destroyer, cruiser, battleship, dreadnought |
| **Carriers** | Light, fleet, super carrier |
| **Fighters** (carrier-based) | Interceptor, fighter, heavy fighter, bomber |
| **Support** | **Healer** (repair drones), sensor ship, builder ship |
| **Command** | Command cruiser |
| **Special** | Scout, miner |

#### Fighters

| Class | Role |
|-------|------|
| **Interceptor** | Anti-fighter; fast response |
| **Fighter** | General purpose |
| **Heavy fighter** | Anti-escort; sustained DPS |
| **Bomber** | Anti-capital; structure damage |

Fighters replenished via **fighter factories** and carrier supply—not individual shipyard queues.

#### Healers (Key Class)

- Deploy **repair drones** on friendly ships.
- **Tactical mode:** visible drone streams; prioritize capitals / flagships.
- **Auto-resolve:** HP restoration over time; strong in sustained fights.

### Armaments & Modules

- Ships equipped via tech web: kinetic, missile, beam, point-defense.
- Modules: engines, shields, ECM, cargo, command suites.
- Hull tiers gated by tech and shipyard tier.

### Hybrid Combat System

| Condition | Mode |
|-----------|------|
| **Player flagship inside system boundary** | **Empire at War–style real-time tactical combat** — **all ships in the system** (friendly, enemy, ally) fight in 2D top-down view. Pause works fully. |
| **Player flagship not in that system** | **Auto-resolve** using composition, stance, healers, defenses, entry vector, and tech. Optional animated replay summary. |

**Hard rule:** Tactical mode triggers **in system only**—no partial bubbles at lane edges.

#### Tactical Combat (Flagship Present)

- Full system battlefield: orbitals, capitals, fighters, structures targetable.
- Carriers launch fighters in real time.
- **Randomized enemy jump-in vector** affects initial engagements and structure targeting.
- Healers active with visible drones.
- Retreat possible (jump to lane) if not blockaded—risky under fire.
- Structures (launchers, foundry, shipyards) can be prioritized by both sides.

#### Auto-Resolve (Flagship Absent)

**Inputs:** fleet composition, fighter wings, armaments, stance (aggressive/balanced/defensive/raid), healers, orbital defenses, entry vector, commander/hero bonuses.

**Outputs:** casualties by class, structure damage, lane control shifts, replay animation.

**Rock-paper-scissors spine:**

| Strong vs | Weak vs |
|-----------|---------|
| Interceptors | Unescorted bombers |
| Bombers | Capitals, structures |
| Heavy fighters | Escorts, interceptors |
| Capitals | Bombers + sustained DPS |
| Transports | Everything (must escort) |
| Healers | Focus fire, alpha strikes |

### Speed Controls

- **Pause** — full stop; AI frozen; capture timers frozen.
- **Normal** — 1×
- **Fast** — 2× / 4× for travel and construction (combat optional restriction)

---

## 9. Scouting, Capture & Conquest

### Scouting

- Send **one ship** (typically scout class) into a system.
- Grants **intel overlay** in system view:
  - Planets, moons, slot usage
  - Visible structures and types
  - Partial fleet/disposition data
  - **Capture Requirement** estimate (see below)
- **Scouting alone does not transfer ownership.**
- **Scouts do not contest** capture timers—yours or theirs.

### Capture (Ownership Transfer)

**Requirements (all must be met):**

1. Hostile **combat ships** eliminated or driven off.
2. Hostile **structures actively engaging** neutralized.
3. Friendly **capture force** in system ≥ **Capture Requirement** for that system.
4. System **uncontested by enemy combat ships** for **20 continuous seconds** (real-time; **pauses when game is paused**).

**On capture:**

- Ownership flips to captor.
- **All buildings, Dyson shell progress, spheres, and infrastructure persist.**

### Capture Requirement (Dynamic)

Minimum force depends on **system makeup**—shown on scout overlay after intel gathered.

**Conceptual formula:**

```
CaptureRequirement = Base
                   + PlanetMoonWeight
                   + StructureCountAndTier
                   + RemainingGarrison
                   + DysonProgressWeight
```

| System profile | Illustrative force |
|----------------|-------------------|
| Empty rim, 1 barren planet | Very small (1–2 combat hulls) |
| Developed colony + shipyard + defenses | Escort squad + capital |
| Mid-Dyson (multiple shells, launchers) | Large fleet |
| Heavily fortified former capital | Major invasion |

**Transports:** May be required for high planet-weight systems (surface garrison delivery)—design detail for implementation; **only combat ships affect the 20s uncontested timer.**

### Alternative Entry: Combat Victory

Defeating a defending fleet is typically a **prerequisite** to holding capture—but conquest always resolves through the **20s uncontested hold** with sufficient capture force (unless a mission scripted exception).

### Contested Timer Rules

| Entity | Contests 20s hold? |
|--------|-------------------|
| Enemy **combat ships** | **Yes** — timer resets |
| Enemy **scouts** | **No** |
| Transports / builders / sail shuttles | **No** |
| Hostile structures actively firing | **Yes** |

---

## 10. Research & Technology Web

### Research Stations

- **3 per star system** (system cap—not per planet).
- Each station adds a **fixed incremental bonus** to active and queued research.
- Best built in secure, developed systems.

### Research Costs

| Phase | Cost |
|-------|------|
| Before any Shell #1 completes | **Credits only** |
| After Shell #1 completes (any star) | **Credits + Solarii** |

### Tech Tree Shape

- **Interconnected web**—not a straight 15-level ladder.
- Nodes include: upgrades, unlocks (ship classes, structures, abilities), gates tied to Dyson shells, missions, Superweapon.
- **Suggested clusters:** Economy, Military, Megastructure, Diplomacy, Flagship, Superweapon, Wormhole.

### Original 15-Level Concept

The design originated around **15 tech tiers**—now expressed as **depth in the web** rather than a single linear track. Balance and UI can still show "Tier I–XV" as a derived display from web position.

---

## 11. Superweapon & Hero Flagships

### Unlock Gate

Requires **3 Completed Dyson Spheres** (Shell #8 on three separate stars) + **Superweapon cradle** construction + relevant tech web nodes.

### Superweapon Capabilities

| Action | Effect |
|--------|--------|
| **Create star system** | Adds a new star + system sandbox to a galaxy graph (new branch node + lanes—rules tuned in balance) |
| **Destroy star system** | **Everything erased**—all structures, all ships, all progress in that system |
| **Jump** | Flagship + attached fleets transit via Superweapon; Solarii cost + cooldown |

### Hero Flagship Production

- Built at **Superweapon cradle**.
- Cost: **Solarii + Credits**.
- **Unlimited production** — anchors unlimited fleets.
- Weaker than player flagship but provides command/rally function and partial combat auras.

### Dyson Shield Counterplay

Documented in §7 — adjacent completed Dyson can defend against one destroy attempt.

---

## 12. Diplomacy & Factions

### Mode

- **Vs AI first** — all factions are AI-driven.
- **2–4 major AI personalities per galaxy** (expansionist, economic, megastructure rival, wormhole rusher, etc.).
- AI runs full economy in abstract galaxies; full logic in active galaxy.

### Diplomacy Unlock

**Available after 1 Completed Dyson Sphere (Shell #8 on any star):**

- Truce
- Trade treaties
- Alliances

Before that milestone: pure war / neutral relations only.

### AI Behavior Notes

- Contests lanes and chokepoints.
- Builds outposts, shipyards, foundries, launchers.
- Anchors wormholes competitively.
- Harasses Dyson systems under construction.
- **Superweapon panic:** coordinated hostile response after system destruction events.
- Inherits **persistent infrastructure** on capture—same rules as player.

---

## 13. Trade & Logistics

### Automatic Trade (Default)

- Trade flows between systems with **trade stations**.
- Income scales with stations, lane security, shell trade bonuses, and tech.
- Visible trader traffic on galaxy map and in-system (2D animation).

### Manual Trade (Optional)

- Player may **draw custom trade routes** for optimization.
- Most players rely on automatic routing.

### Blockades

- Holding a lane star can starve or reduce trade throughput (implementation detail for balance).

---

## 14. Victory, Defeat & Campaign Structure

### Victory Condition

- Player **selects victory condition at campaign start** (fixed for that run).
- Options (offer multiple):

| Victory type | Conceptual goal |
|--------------|-----------------|
| **Dominion** | Control threshold of systems / anchored wormholes |
| **Megastructure** | 3 completed Dysons + operational Superweapon cradle |
| **Annihilation** | Eliminate all major AI factions |
| **Economic** | Credit + Solarii + trade network thresholds |
| **Sculptor** | Create/destroy N systems with Superweapon |
| **Sandbox** | No win state—play until loss or retire |

### Defeat Conditions (Either Triggers Loss)

| Condition | Definition |
|-----------|------------|
| **Stronghold destroyed** | **Every structure destroyed AND every ship destroyed** in the Stronghold system—total annihilation, not partial damage |
| **Flagship destroyed** | Player flagship hull reaches zero |

### Campaign Format

| Element | Spec |
|---------|------|
| **Sandbox** | Primary open-ended campaign |
| **Scripted missions** | **5–6 missions** integrated or selectable (wormhole race, Dyson defense, first hero flagship, etc.) |
| **Tutorial** | **Required** — step-by-step introduction |
| **Tips** | Contextual, pause-friendly help tied to milestones |
| **Length** | **Player-paced** — no enforced 10h cap; scale by victory choice and ambition |

### Tutorial Beats (Recommended)

1. Stronghold, outpost, moon shuttles, credits
2. Shipyard + first lane hop
3. Scout overlay vs **Capture Requirement** + **20s hold**
4. Foundry → sail shuttles → launcher → Shell #1 → Solarii
5. Flagship enters system — **first tactical battle** (pause, focus fire, healers)
6. Same battle without flagship — auto-resolve comparison
7. Unanchored wormhole gamble vs building anchor
8. Diplomacy unlock after first completed sphere (if campaign reaches that point)

---

## 15. Simulation, Performance & Save System

### Simulation Fidelity

| Region | Simulation level |
|--------|-------------------|
| **Active galaxy** | Full: lanes, transits, economy, combat, capture timers, Dyson production |
| **System with player flagship** | Full **tactical combat** |
| **Inactive galaxies** | **Abstract:** AI credits/Solarii, fleet power scores, Dyson progress ticks, anchor ownership |
| **On wormhole entry** | Target galaxy **hydrates** to full simulation |

**Principle:** Never simulate 12 × 500 stars at full detail simultaneously. **Active region full; everything else tracked.**

**AI resources:** Always modeled—no off-screen cheating (exact fairness tune TBD).

### Save System (Hard Requirement)

| Feature | Requirement |
|---------|-------------|
| **Storage** | **Local files only** — fully offline, player-owned |
| **Campaign type** | Long persistent save — one continuous timeline |
| **Slots** | Manual slots + rotating autosave + exit-save |
| **Format** | Versioned (`saveVersion`) with checksum; migration path for patches |
| **Contents** | Seed, all galaxy graphs, system states, fleets in transit, capture timers, tech web, AI diplomacy, Dyson/shell progress, wormhole network |
| **Determinism** | Same seed + same actions → same procedural results |
| **Mutations** | Superweapon create/destroy permanently alters saved graph |

---

## 16. Presentation & UX

### Visual Direction

- **2D top-down** — strategic clarity.
- **NOT Kiomet-style minimalism** — **detailed, sophisticated** art direction.
- **Heavy animation budget** on:
  - Moon shuttles (planet ↔ moons)
  - Sail shuttles (foundry ↔ launchers)
  - Sail launch bursts and **8 shell formation phases**
  - Fleet lane transit
  - Tactical battles (beams, drones, explosions, fighter swarms)
  - Wormhole transit and Superweapon events

### Galaxy Map

- Stars as nodes; lanes as animated curves (traffic pulses show trade volume).
- Fleet icons move along lanes (not teleport).
- Black hole: distortion, accretion disk, wormhole swirl when active.
- Fog of war with sensor/listening post range.

### System View

- Orbital rings; rotating planets/moons.
- Structure construction states (scaffolding → active).
- **Scout overlay:** fog peel, unknown slots, Capture Requirement display.
- Tactical mode: full battlefield zoom; follow-flagship camera default.

### UI Requirements

- Real-time with **pause** on all order screens.
- **Empire-wide build queue** panel with shipyard routing visibility.
- Galaxy / System / Fleet / Tech / Dyson tabs.
- Notification log: raids, shell completions, wormhole events, capture timers.
- Tooltips exposing auto-resolve factors (transparency).

---

## 17. Ship & Structure Reference

### Ships to Implement (Checklist)

- [ ] Transports (3)
- [ ] Escorts (3)
- [ ] Line ships (4)
- [ ] Carriers (3)
- [ ] Fighters (4 types)
- [ ] Healer
- [ ] Scout
- [ ] Builder
- [ ] Sensor
- [ ] Miner
- [ ] Command cruiser
- [ ] Player flagship (unique)
- [ ] Hero flagship (buildable class)

**Target total hull classes:** 15–20 (excluding fighter sub-types and unique flagship).

### Structures to Implement (Checklist)

**Per body:** Outpost, Mining, Refinery, Storage, Trade station, Shipyard, Fighter factory, Drydock, Orbital defense, Shield generator, Ion battery, Dyson launcher (×3 cap), Asteroid harvester.

**Per system:** Sail foundry (×1), Research station (×3 cap), Command post.

**Strategic:** Wormhole anchor, Listening post, Lane relay, Blockade fort, Supply cache, Forward base, Superweapon cradle, Salvage yard (optional).

---

## 18. Milestone & Unlock Gates

| Milestone | Unlock |
|-----------|--------|
| First outpost + credits | Basic expansion |
| First shipyard | Military production |
| First scout intel | Capture Requirement visible |
| Shell #1 (any star) | **Solarii income**; research costs **Credits + Solarii** |
| Shell #8 (any star) | **Diplomacy** (truce, trade, ally) |
| Shell #8 × **3 stars** | **Superweapon cradle**; create/destroy/jump; **hero flagships** |
| Superweapon online | System sculpting; endgame victory paths |
| Wormhole anchor | Stable paired travel vs random anywhere |

---

## 19. Development Phases

Recommended vertical slices—adjust scope during production.

| Phase | Deliverable |
|-------|-------------|
| **0 — Foundation** | 2D system view: Stronghold, outpost, moon shuttles, credits, pause, **local save v0** |
| **1 — Galaxy slice** | 20-star lane graph; lane-by-lane movement; scout overlay; dynamic capture + 20s hold |
| **2 — Combat hybrid** | Tactical mode (flagship in system); auto-resolve elsewhere; healers; 8–10 ship classes |
| **3 — Dyson loop** | Foundry, auto sail shuttles, launchers, 8 shells, Solarii scaling, visuals |
| **4 — Scale & wormholes** | 400-star gen; black hole; unanchored (random anywhere) + anchored wormholes; abstract inactive galaxies |
| **5 — Empire layer** | Empire build queue; research stations + tech web; trade stations; 1 AI faction |
| **6 — Late game** | 3-sphere Superweapon; hero flagships; diplomacy; 5–6 missions; tutorial; full content roster |

---

## 20. Open Tuning Parameters (Balance Pass)

These are **design-approved** but need numeric tuning during implementation:

- Exact sail credit cost curve (2.5–5 base band).
- Solarii per-shell multiplier table (§7 example is illustrative).
- Capture Requirement weights per structure/shell tier.
- Auto-resolve coefficients per ship class.
- Flagship HP pool and hero flagship stats.
- Superweapon Solarii costs and cooldowns.
- Wormhole transit time and hazard damage.
- AI difficulty scaling (income modifiers vs intel cheats).
- Passive Solarii drain rates.
- Shipyard slot counts per tech node.
- Mission-specific overrides.

---

## Appendix A — Design Decision Log

| # | Decision | Resolution |
|---|----------|------------|
| 1 | Time model | Real-time with pause |
| 2 | Multiplayer | Vs AI first |
| 3 | Combat | Hybrid: EAW tactical when flagship **in system**; auto-resolve otherwise |
| 4 | Dyson scope | One project per **star**; ≤3 launchers per body; **1 foundry per system** |
| 5 | Inter-galaxy travel | Black hole wormholes; unanchored = **random anywhere**; anchored = fixed pair |
| 6 | Save | Long campaign; **local only** |
| 7 | Visuals | 2D top-down; detailed/sophisticated; **not** Kiomet-like |
| 8 | Economy | Credits primary; Solarii premium; sails physical at foundry |
| 9 | Dyson completion | **8 shells** × 5,000 sails; Shell #1 starts Solarii |
| 10 | Victory | Player picks at **campaign start** |
| 11 | Loss | Stronghold **total wipe** OR flagship destroyed |
| 12 | Fleet size | **No cap**; unlimited hero flagships |
| 13 | Fleet movement | **Lane-by-lane** to rally points |
| 14 | Capture | Scout = intel; **20s uncontested hold**; dynamic capture force |
| 15 | Contest rules | **Combat ships only** contest timer |
| 16 | Persistence | All infra + Dyson progress survives conquest |
| 17 | Research | 3 stations/system; web tech; dual currency after Shell #1 |
| 18 | Diplomacy | After **1 completed sphere** (Shell #8) |
| 19 | Superweapon | After **3 completed spheres**; destroy erases all; Dyson shield counter |
| 20 | Trade | Auto default; manual optional; traders → trade stations |
| 21 | Build queue | Empire-wide → nearest available shipyard |
| 22 | Simulation | Active galaxy full; other galaxies abstract |
| 23 | Campaign | Sandbox + 5–6 missions + tutorial + tips |
| 24 | Length | Player-paced |

---

## Appendix B — Glossary

| Term | Definition |
|------|------------|
| **Stronghold** | Player home system; loss if totally annihilated |
| **Shell** | Dyson construction layer; 5,000 sails; 8 shells = complete sphere |
| **Solarii** | Premium currency from Dyson shells |
| **Capture Requirement** | Minimum combat force to begin 20s capture hold |
| **Hero flagship** | Buildable mini-flagship fleet anchor |
| **Anchored wormhole** | Fixed two-way wormhole link |
| **Unanchored wormhole** | Random exit anywhere in the save |
| **Active galaxy** | Fully simulated galaxy region |
| **Foundry** | System-wide sail producer (one per star) |

---

*End of Master Planning Document*
