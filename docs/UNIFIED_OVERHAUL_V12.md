# Unified Overhaul — v12 Architecture and Release Contract

This release replaces passive trade credits with deterministic physical cargo, expands tactical combat, introduces artificial Trade Nexus systems, and adds an optional GPT-5.6 Sol commander. Core gameplay remains deterministic and fully offline.

## Authoritative module boundaries

| Boundary | Owner | Contract |
|---|---|---|
| Galaxy and save identity | `state.js`, `save.js` | Four deterministic Trade Nexuses per galaxy; the stronghold and existing Dyson projects are never replaced; v11 migrates once to v12. |
| Physical logistics | `logistics.js` | Owns cargo, depot inventories, local transports, convoy routes, blockades, delivery credits, rerouting, and logistics events. It has no DOM or renderer dependency. |
| Tactical command | `combat-orders.js` | Validates and records serializable fleet orders; owns fighter lifecycle helpers, shield facings, damage states, LOD aggregation, and report contracts. |
| Combat simulation | `combat.js` | Consumes orders and advances battles. Only this layer applies tactical damage or persists casualties. |
| Presentation | `render.js`, `trade-nexus-render.js`, `ui.js` | Read-only rendering plus existing command callbacks. Canvas code never awards credits or advances combat. |
| Sol reasoning contract | `sol-commander.js` | Builds allowlisted snapshots, validates strict recommendations twice, and supplies deterministic offline advice. It performs no network or game mutation. |
| Sol credential/network boundary | `electron/main.js`, `electron/preload.js` | Electron main owns `safeStorage`, the fixed Responses endpoint, rate/cost gates, and the API key. Renderer receives only bounded IPC methods and validated response text. |

## Deterministic state flow

1. Outposts produce raw materials, fuel, and manufactured goods on the fixed 50 ms simulation tick.
2. Local transports visibly carry cargo to the system export depot.
3. A depot creates a space-compression jump and dispatches a convoy over deterministic weighted shortest lanes.
4. Blocked or missing routes pause or reroute without deleting cargo. Interception can destroy cargo and pauses the source route until recovery.
5. Credits are mutated only by successful Trade Nexus delivery.
6. A save/load round trip retains manifests, convoy phase, route path, fighter wing state, tactical reports, and Sol preferences.

## Sol execution protocol

1. The renderer creates a compact allowlisted snapshot and optionally previews its byte size.
2. Electron main sends it to the fixed `gpt-5.6-sol` model only after explicit enablement and only when a secure key is available.
3. Structured response text is parsed against the local strict schema.
4. Every recommendation is validated against current ownership, tech, costs, targets, and route legality before display.
5. Proposed mutations require player confirmation and are validated again immediately before an existing authoritative game command executes.
6. Network, key, access, rate-limit, cost, parsing, or validation failure falls back to the deterministic local advisor without disabling gameplay.

No key is placed in a renderer global, request snapshot, save, log, screenshot, or packaged asset. The save serializer also removes credential-shaped fields and token strings as a defensive final boundary.

## Release gates

- `npm run build`
- `node output/verify_logistics_unit.mjs`
- `node output/verify_combat_orders_unit.mjs`
- `node output/verify_sol_commander_unit.mjs`
- `node output/verify_save_v12.mjs`
- `node output/verify_sol_security.mjs`
- `node output/verify_unified_overhaul.mjs` while Vite is running
- Existing phase and Electron smoke suites
- Visual inspection of galaxy, system combat, Logistics Command, and minimum-resolution screenshots

The GPT-5.6 Sol remote path is an optional preview integration. A successful local build does not imply that a player's OpenAI organization has model access.
