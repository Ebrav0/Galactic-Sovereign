# War Room

## Design Goal

Optimize high-frequency empire operations without losing the spatial map. Fleets, alerts, routes, risks, and long-running work remain simultaneously scannable.

## Stable Shell

- **Top strip:** empire identity, resources, capacity, drones, map switch, co-op pilots, pause, audio, and saves.
- **Left theater rail:** urgent alerts, fleet groups, scouts, convoys, builder drones, reserves, and capital assets.
- **Center theater map:** systems, faction borders, overlays, selected route, and threat markers.
- **Right command brief:** selected object's status, composition, objective, readiness, costs, risks, and primary action.
- **Bottom ledger:** Operations, Diplomacy, Research, and Construction lanes with aggregate progress rows.

## Command Brief Contract

The brief always answers five questions in order:

1. What is selected and who controls it?
2. What is it doing now?
3. What target or objective is proposed?
4. What will it cost and what can go wrong?
5. What action confirms, pauses, resumes, reroutes, or cancels it?

Route previews compare no more than three alternatives. Each alternative shows ETA, distance, threat/risk, cost, and diplomatic consequence. Selecting a route updates the map before `ISSUE ORDER` becomes available.

## Workbenches

Selecting a theater category or ledger header replaces the right brief and lower part of the map with a focused workbench:

- Fleet composition, anchors, ship assignment, flagship/wing management.
- Logistics depots, destinations, convoys, escorting, and rerouting.
- Production and construction queues with physical shipyard/drone assignments.
- Technology web, Dyson projects, diplomacy, strategic operations, and campaign milestones.

The selected system, fleet, or faction remains highlighted on the map while the workbench is open.

## Combat Mode

The same shell becomes a tactical War Room: the left rail lists selected/available units, the center map becomes the battle, the right brief holds doctrine, priority, wings, formation, command assist, retreat, and target focus, and the bottom ledger becomes the order timeline. Management lanes disappear until combat ends or the player returns to the galaxy.

## Responsive Rules

- At 1440×1024 and above, the theater rail is 280–310 px and the command brief is 340–380 px.
- Below 1440 px width, non-selected theater groups collapse and the bottom ledger shows one active lane at a time.
- Below 820 px height, route cards become compact rows and the ledger height is capped at 18%.
- The central theater keeps at least 48% of viewport width at the minimum supported desktop size.
