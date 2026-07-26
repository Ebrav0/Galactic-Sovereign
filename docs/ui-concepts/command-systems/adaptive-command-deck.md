# Adaptive Command Deck

## Design Goal

Use one learnable shell across every strategic context. Navigation landmarks never move, while the inspector and action deck adapt to the selected object and current task.

## Stable Shell

- **Top ribbon:** empire identity, resources, co-op pilots, pause, audio, and saves.
- **Activity rail:** Empire, Fleets, Logistics, Technology, Diplomacy, Operations, and Campaign, each with status/attention count.
- **Breadcrumb and command palette:** current hierarchy plus searchable navigation and actions.
- **Primary canvas:** galaxy, system, technology web, negotiation, operations map, or tactical battle.
- **Context inspector:** identity, ownership, state, statistics, prerequisites, current work, and collaboration controls.
- **Action deck:** shallow bottom surface containing only actions valid for the current context.

## Context Recipes

| Context | Inspector emphasis | Action-deck groups |
| --- | --- | --- |
| Galaxy/system | Ownership, intel, threat, traffic | Navigate, Overlay, Operations |
| Planet/body | Environment, capacity, structures, resources | Build, Production, Automation |
| Fleet/flagship | Composition, readiness, location, doctrine | Move, Combat, Formation, Assignment |
| Scout/drone/convoy | Mission, route, ETA, capacity, blockers | Follow, Dispatch/Reroute, Support, Cancel |
| Technology | Prerequisites, effects, unlocks, progress | Research, Queue, Trace Path, View Unlocks |
| Faction/diplomacy | Trust, threat, treaties, claims, wars | Contact, Negotiate, Claim, Conflict, Council |
| Operation/campaign | Target set, budget, reserve, progress, blockers | Edit, Preview, Launch, Pause/Resume, Cancel |
| Helioclast/Dyson | Assembly, charge, cooldown, milestone | Build/Assemble, Assign, Target, Fire/Jump |
| Tactical combat | Selection, shields/hull, focus target | Move, Attack, Hold, Doctrine, Retreat |

## Progressive Disclosure

- The action deck shows four to six primary actions at most.
- `More` reveals advanced structures, doctrines, priorities, assignment choices, or treaty terms inside the same group.
- Locked actions remain visible when they teach progression; irrelevant actions are omitted.
- Multi-action construction and production choices accumulate in a plan preview with total cost, ETA, prerequisites, conflicts, and a single confirmation.
- The command palette can reach every mapped action, but results follow the same availability and confirmation rules as visible controls.

## Context Transitions

Changing selection animates the inspector content and action groups without moving the shell. Breadcrumb text, selected-map highlight, and a short context label update together. Drafts remain attached to their original target and display a return link rather than silently transferring to the new selection.

## Responsive Rules

- At 1440×1024 and above, the activity rail is 150–170 px, inspector is 280–320 px, and action deck is 250–300 px high.
- Below 1440 px width, the activity rail becomes icon-first and the inspector overlays the canvas when opened.
- Below 820 px height, action cards become compact rows and the deck shows one group at a time.
- The primary canvas retains at least 64% of viewport height when the deck is collapsed.
