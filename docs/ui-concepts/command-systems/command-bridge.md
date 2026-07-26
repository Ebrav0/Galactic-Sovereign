# Command Bridge

## Design Goal

Make the galaxy itself feel like the player's command table. Persistent chrome is limited to empire state, selection, urgent attention, and map controls; everything else appears because the player selected something or deliberately opened a workspace.

## Stable Shell

- **Top ribbon:** empire identity; Credits, Outpost Income, Solarii, Influence, and Fleet Power; co-op pilots; pause, audio, and saves.
- **Center canvas:** galaxy or system map with territorial, threat, sensor, and blockade overlays.
- **Bottom-left inspector:** selected object identity, ownership, stability/readiness, threat, and compact subviews.
- **Right attention queue:** battles, blocked operations, completed research, construction problems, diplomacy deadlines, and tutorial prompts ordered by urgency.
- **Bottom controls:** time scale, overlay toggles, view level, and command launcher.

## Context Ring

The ring contains at most four actions. The available set comes from the selected object:

| Selection | Ring actions |
| --- | --- |
| Galaxy system | View System, Fleet Command, Build/Operations, Issue Order |
| Planet or moon | Inspect, Build, Production, Plan Construction |
| Fleet or flagship | Follow, Formation/Doctrine, Move, Attack/Order |
| Scout or builder drone | Follow, Dispatch, Assign/Plan, Cancel |
| Convoy | Follow, Reroute, Escort, Pause/Resume |
| Faction system | Inspect Intel, Diplomacy, Claim/War Goal, Issue Order |
| Helioclast | Inspect, Assign, Target, Fire/Jump |

Selecting a ring action never executes a consequential command immediately. It enters targeting or opens a compact preview containing target, cost, ETA, risk, prerequisites, and one confirm action.

## Management Workspaces

Fleet, Logistics, Technology, Dyson, Diplomacy, Operations, Campaign, Saves, Audio, and Help open as slide-overs that preserve a visible map strip and current target. Workspaces may expand to full screen for the technology web or complex negotiation, but the breadcrumb always returns to the previous map context.

## Combat Mode

Combat replaces the strategic ring with a bottom tactical dock. Selection stays left; doctrine, priority, wings, formation, command assist, and retreat stay right; battle counts and system identity remain at the top. Move, Attack, Hold, and Retreat are always visible. Cinematic mode hides supporting chrome but leaves pause and an exit affordance.

## Responsive Rules

- At 1440×1024 and above, inspector and attention queue may remain open together.
- Below 1440 px width, only the focused side surface stays open; alerts collapse to a badge.
- Below 820 px height, the context ring tightens and inspector detail becomes scrollable without covering the selected object.
- The map always retains at least 60% of viewport width and 62% of viewport height outside full-screen workspaces.
