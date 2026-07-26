# Canonical Player Control Matrix

This matrix is the implementation contract. Static IDs come from `src/index.html`; dynamic controls are identified by their rendered label or family. Repeated generated controls such as ship hulls, structures, factions, proposals, save slots, and fleets are represented as one family because every instance follows the same placement and state rules.

## Entry, Account, and Session Controls

| Feature and current controls | Command Bridge | War Room | Adaptive Command Deck | Required behavior |
| --- | --- | --- | --- | --- |
| Account sign-in, password change, persistent-universe join, account chip | Full-screen identity gate; account chip moves into top ribbon | Full-screen identity gate; pilot identity remains beside the theater header | Full-screen identity gate; pilot identity remains in the top ribbon | Preserve validation, loading, error, password-change, and offline/local-import states |
| Solo and multiplayer doors (`title-singleplayer-door`, `title-multiplayer-door`) | Two command-door choices over a restrained starfield | Two operational deployment cards | Two large mode choices inside the stable shell | Keyboard focus, Enter activation, and clear back navigation |
| Title settings and back controls (`title-audio-btn`, `data-title-back`) | Top-right utility and text back action | Utility strip and breadcrumb back action | Global utility and shell breadcrumb | Back never discards entered data without warning |
| Continue, Academy, custom campaign, missions, sandbox, load (`title-continue-btn`, `title-new-campaign-btn`, `title-custom-campaign-btn`, `title-missions-btn`, `title-sandbox-btn`, `title-load-btn`) | Focused solo-operation list | Deployment manifest | Mode cards in the adaptive action deck | Continue appears only with a valid save; locked modes explain prerequisites |
| Multiplayer server and docking (`title-mp-server-card`, `title-mp-join-btn`) | Fleet Uplink slide-over | Server roster in left theater rail | Session context in main canvas with join action in inspector | Show endpoint, availability, password/error state, joining progress, and reconnect path |
| New-game modes and start (`new-game-pick-*`, `new-game-start-btn`, `close-new-game-btn`) | Centered campaign planner | Two-pane deployment configuration | Context inspector plus action deck | Preserve sandbox, campaign, mission, tutorial, rival, and victory choices |

## Global Shell and Navigation

| Feature and current controls | Command Bridge | War Room | Adaptive Command Deck | Required behavior |
| --- | --- | --- | --- | --- |
| Empire identity and resource chips | Compact top ribbon | Compact top status strip | Compact top ribbon | Credits, income, Solarii, influence, flagship/fleet power, scouts/drones, and deltas remain readable |
| Galaxy/system switch (`view-toggle-btn`) | Map-level toggle beside the breadcrumb | `GALAXY MAP` in top strip | First breadcrumb segment and `M` shortcut | Preserve camera context when practical; label the destination, not the current view |
| Pause/resume (`pause-btn`, `combat-hud-pause`) | Top ribbon plus bottom time controls | Top strip | Top ribbon | Space remains the shortcut; paused state is unmistakable without hiding the screen |
| Audio (`audio-settings-btn`, `title-audio-btn`) | Top utility icon | Top utility icon | Top utility icon | Icon has text tooltip and accessible name |
| Saves (`save-menu-btn`) | Top gold utility | Top utility | Top gold utility | Disabled during unsafe transitions; explain why |
| Notification log (`notification-toggle`) | Right attention queue | Urgent-alert section | Activity rail badge and slide-over | Preserve unread count, collapse, timestamps, severity, and focus movement |
| Primary views (`tab-galaxy`, `tab-system`, `tab-fleet`, `tab-logistics`, `tab-tech`, `tab-dyson`, `tab-diplomacy`, `tab-operations`, `tab-campaign`) | Compact command launcher opening slide-overs | Theater categories and ledger lanes | Persistent activity rail | Current location and return-to-map action remain visible |
| Galaxy overlays (`overlay-threat`, `overlay-sensor`, `overlay-blockade`) | Bottom-center map toggles | Map toolbar | Canvas toolbar near breadcrumb | Active state uses icon, label, and color; combinations remain possible |
| Command palette | `Ctrl/Cmd+K` search from top ribbon | Search field above theater map | Persistent command-palette field | Searches views, systems, fleets, factions, technologies, and available actions; unavailable results explain prerequisites |

## Selection, Map, and Context

| Feature and current controls | Command Bridge | War Room | Adaptive Command Deck | Required behavior |
| --- | --- | --- | --- | --- |
| Select star/body/fleet/convoy/structure | Context ring plus selected-object inspector | Left roster selection plus command brief | Context inspector plus adaptive action deck | Selection is visible on map and in text; Escape clears selection |
| Scout dispatch (Shift-click when no drone is selected) | `SCOUT` contextual action with destination preview | Scout row then route on map | Scout context then `DISPATCH` in action deck | Show ETA, sensor value, route validity, and current assignment |
| Builder-drone dispatch (select drone, Shift-click destination) | Drone contextual action and build preview | Builder-drone roster and command brief | Drone context and construction action deck | Show ownership, capacity, destination, cost, prerequisites, and reservation state |
| Fleet dispatch (selected battle group, Tab-click destination) | Fleet command ring and route preview | Fleet roster, route alternatives, and command brief | Fleet context and movement action deck | Show anchor, travel path, ETA, threat, legality, and conflict consequence |
| Contextual tactical order (right-click) | Small order fan at cursor | Order strip in command brief | Context action deck | Invalid targets provide immediate explanation; right-click also cancels targeting |
| System intel and capture requirement | Selected-system inspector | Command brief intelligence section | Context inspector | Unknown, partial, current, contested, and capture-ready states are distinct |

## System Construction and Infrastructure

| Feature and current controls | Command Bridge | War Room | Adaptive Command Deck | Required behavior |
| --- | --- | --- | --- | --- |
| Outpost, shipyard, Sail Foundry, Dyson Launcher, Export Depot, Research Station (`build-outpost-btn`, `build-shipyard-btn`, `build-foundry-btn`, `build-launcher-btn`, `build-trade-btn`, `build-research-btn`) | `BUILD` segment opens contextual catalog | Construction workbench from command brief | `BUILD` group in adaptive action deck | Every action shows cost, ETA, placement, prerequisite, existing level, and unavailable reason |
| Body structures and upgrades (`Build/Upgrade [structure]`) | Body inspector catalog | Construction workbench | Inspector structure list plus action deck | Generated structure rows inherit the same states; upgrades show before/after effect |
| Strategic buildings (`Build [strategic structure]`) | System build slide-over | Construction workbench | System context deck | Map target and system ownership remain visible during configuration |
| Empire scout queue (`queue-scout-btn`, `Queue [hull]`) | Production slide-over | Shipyard/production lane | `PRODUCTION` group | Show physical shipyard assignment, queue capacity, cost, build time, rally, and cancel state |
| Builder drone (`builder-drone-deploy-btn`, `Plan Builds`, `Cancel`) | Drone card and construction planner | Drone roster and planner workbench | `AUTOMATION` group and plan preview | Draft plans show targets, order, total cost, reservations, and conflicts |
| Construction planner (`drone-planner-confirm`, `drone-planner-close`, add/remove draft actions) | Modal-sized slide-over tied to map target | Workbench tied to selected drone/system | Plan preview above action deck | Confirm is disabled until plan is valid; closing preserves or explicitly discards the draft |
| Wormhole (`enter-wormhole-btn`, `build-anchor-btn`) | Selected anomaly ring | Navigation workbench | Wormhole context deck | Show destination galaxy, anchor state, cost, eligibility, and irreversible travel warning |

## Fleet, Shipyard, Flagship, and Helioclast

| Feature and current controls | Command Bridge | War Room | Adaptive Command Deck | Required behavior |
| --- | --- | --- | --- | --- |
| Create/delete fleet, auto-assign, drag ships, choose anchor | Fleet slide-over | Fleet Groups rail and command brief | Fleet context deck | Preserve unassigned ships, valid drop targets, empty fleet handling, and deletion confirmation |
| Ship and scout selection/follow/dispatch | Fleet/scout slide-over | Theater rail | Context inspector | Show location, transit, damage, assignment, and destination |
| Shipyard queue, routing, and cancel | Production slide-over | Production ledger | Production action deck | Auto-route and explicit shipyard choices remain available; cancellation shows refund consequences |
| Formation and target priorities (`Formation`, `Attack [class]`, doctrine actions) | Fleet/tactical slide-over | Command brief doctrine section | Fleet action deck | Current choice is persistent and readable outside combat |
| Hero flagship (`Build Hero Flagship`, dispatch destination) | Flagship command slide-over | Capital-assets roster | Flagship context deck | Show unlock, cost, location, transit, damage, and assignment |
| Fighter wing (`Launch`, `Hangar`) | Flagship quick action | Capital-assets row | Flagship action deck | Launching, active, recalling, docking, ready, and depleted states |
| Helioclast shipyard, parts, `Run live-fire test`, assignment, weapon actions | Dedicated Helioclast slide-over; targeting returns to map | Capital-assets workbench and command brief | Helioclast context deck | Explicit target lock, legality, Solarii cost, cooldown, charge, cinematic phase, and cancel path |
| Strategic Helioclast actions (`sw-create-btn`, `sw-destroy-btn`, `sw-jump-btn`) | Armed action replaces map ring and names target | Command brief with destructive confirmation | Action deck with target preview | Create, annihilate, and jump use distinct verbs, target names, costs, and second confirmation |

## Logistics and Persistent Operations

| Feature and current controls | Command Bridge | War Room | Adaptive Command Deck | Required behavior |
| --- | --- | --- | --- | --- |
| Depot destination, automatic route, pause/resume, dispatch now | Logistics slide-over | Convoy section and logistics lane | Logistics context deck | Show stored cargo, capacity, active convoy count, route, pause reason, and destination availability |
| Convoy follow, reroute, and escort (`Follow`, `Reroute`, `+ Escort`) | Convoy map context | Convoy roster and command brief | Convoy context deck | Preserve cargo, ETA, escort strength, route threat, and paused/blocked state |
| Bulk production (`Add product`, `Remove`, `Use selected star`, `Preview`, `Issue order`) | Operations slide-over with map visible | Operations workbench and bottom ledger | Operations context deck | Products are compressed quantities; preview shows budget cap, reserve, rally, packaging, shipyards, and delivery plan |
| Expansion campaign (`Add selected star`, `Preview routes`, `Launch campaign`) | Map-painted targets plus operations slide-over | Theater routes plus operations workbench | Campaign context deck | Show target filter/count, doctrine, concurrency, budget, reserve, threat/intel rules, war authorization, and partial-target behavior |
| Persistent order controls (`Pause`, `Resume`, `Cancel`) | Attention queue and operations slide-over | Bottom ledger rows | Activity rail and context inspector | Never create hundreds of ordinary queue rows; show aggregate progress, blockers, spend, and next step |

## Technology, Dyson, Diplomacy, and Campaign

| Feature and current controls | Command Bridge | War Room | Adaptive Command Deck | Required behavior |
| --- | --- | --- | --- | --- |
| Technology filters, search, node selection/research, `Fit View`, `Reset` | Full-screen slide-over web | Strategic workbench | Technology activity context | Preserve lane filters, path tracing, queue, capacity, prerequisites, unlocks, progress, pan, and zoom |
| Dyson status and shell progression | Dyson slide-over tied to selected system | Megastructure workbench | Dyson system context | Show system eligibility, sail count, completion, Solarii unlock, progress, and blocked state |
| Diplomacy views (`overview`, `relations`, `negotiation`, `conflicts`, `council`, `history`) | Diplomacy slide-over | Diplomacy lane and full workbench | Diplomacy activity context | Preserve selected faction and selected map system when switching views |
| Contact/proposals (`Open Communications`, proposal choices, `Accept`, `Reject`) | Faction inspector | Diplomatic inbox/workbench | Faction context deck | Show trust, threat, intelligence, acceptance forecast, costs, duration, and incoming expiry |
| Deals (`Preview Deal`, `Send Deal`) | Negotiation builder with map behind | Negotiation workbench | Deal action deck | Terms remain editable after preview; invalid or empty deals explain the problem |
| Claims and war (`Claim Selected System`, `Withdraw`, `Declare Formal War`, `Offer White Peace`) | Selected-system/faction context | Conflict command brief | Conflict context deck | Claims and war goals name systems; war and peace show allies, treaties, exhaustion, and consequences |
| Council and calls (`Propose`, vote choices, `Join Defense`, `Refuse`) | Council slide-over and attention queue | Diplomacy lane | Council context deck | Show voting window, influence cost, current support, obligation, and outcome |
| Campaign status, parts, briefings, victory/defeat controls | Campaign slide-over | Campaign ledger | Campaign context | Preserve milestones, mission state, Helioclast parts, briefings, victory progress, and completion actions |

## Tactical Combat, Alerts, Saves, Audio, and Help

| Feature and current controls | Command Bridge | War Room | Adaptive Command Deck | Required behavior |
| --- | --- | --- | --- | --- |
| Battle alert (`battle-alert-view`) | Priority attention card | Urgent alert with `VIEW BATTLE` | Activity rail interrupt | Show system, forces, threat, and whether player control is required |
| Combat selection and doctrines | Dedicated sparse combat HUD | Tactical War Room mode | Combat context shell | Preserve box select, Shift multi-select, unit chips, four doctrines, priority selector, wings, formation, focus target, and order timeline |
| Combat actions (`combat-hud-move`, `combat-hud-attack`, `combat-hud-hold`, `combat-hud-retreat`, `combat-hud-advanced-toggle`, `combat-hud-cinema`, `combat-hud-pause`, `combat-hud-galaxy`) | Bottom tactical dock and small side inspectors | Right command brief and tactical toolbar | Combat action deck | Retreat is destructive/confirmable; command assist and cinema show persistent on/off state |
| Save slots (`Save`, `Load`), export/import/close (`export-save-btn`, `import-save-btn`, `close-save-menu-btn`) | Save slide-over | Save workbench | Save context sheet | Slot metadata, overwrite confirmation, import validation, export success, and errors remain visible |
| Pause return to title (`pause-return-title-btn`) | Pause overlay utility | Pause overlay utility | Pause context action | Confirm when unsaved progress exists |
| Audio sliders, mute/preferences, test buttons (`audio-test-ui`, `audio-test-combat`, `audio-test-cinematic`, `audio-settings-close`) | Audio slide-over | Audio workbench | Settings context | Preserve master/music/ambience/SFX/UI levels, mute, reduced-dynamics/cinematic preferences, device unlock, and test feedback |
| Field manual (`field-manual-show`, `field-manual-ack`, `field-manual-close`), tutorial coach | Contextual teaching card | Briefing card beside relevant workbench | Inspector coach with action-deck highlight | `Show me` moves focus to the real control; `Understood` advances without performing the action |
| Co-op roster/invite/leave (`coop-roster-close`, `coop-copy-invite`, `coop-leave-btn`) | Pilot cluster in top ribbon | Pilot cluster in top strip | Pilot cluster in top ribbon | Copy provides success feedback; leave confirms and explains save/session effect |
| Co-op control ownership (`Request control`, `Release control`, grant/revoke pilot, transfer ownership) | Selection inspector collaboration section | Command brief collaboration section | Context inspector collaboration section | Show owner, shared pilots, pending request, denial, transfer confirmation, and disconnected owner recovery |

## State Vocabulary

Every control uses the same state model in all three directions:

| State | Presentation | Required feedback |
| --- | --- | --- |
| Available | Cyan/neutral action | Label, shortcut, cost or target when relevant |
| Selected | Gold outline or fill | Selected target/action named in text |
| Locked | Muted with lock marker | Exact missing technology, milestone, ownership, or permission |
| Unaffordable | Visible but disabled | Current amount, required amount, and protected reserve impact |
| Targeting | Gold targeting marker | Valid targets highlighted; Escape/right-click cancels |
| Preview | Read-only summary | Target, cost, ETA, risk, prerequisites, diplomacy consequence |
| Confirmed/queued | Blue progress treatment | Queue/order ID, location, ETA, and cancel behavior |
| In progress | Progress bar and active marker | Percent, elapsed/remaining time, current phase, assigned asset |
| Paused/blocked | Amber | Pause reason, blocker, and valid recovery action |
| Dangerous/destructive | Rose | Named target and second confirmation |
| Complete | Green | Result summary and next relevant action |
| Failed/disconnected | Rose plus text | Cause, retained state, retry/reconnect path |

## Keyboard and Accessibility Contract

- Preserve `M` for galaxy/system navigation and Space for pause.
- Preserve map gestures documented by the game: Shift-click scouts/drones, Tab-click fleets, right-click contextual orders, drag to pan/select, and scroll to zoom.
- Add `Ctrl/Cmd+K` for the command palette without replacing visible navigation.
- Every icon-only control requires an accessible name and tooltip.
- Focus order follows visual order; opening a slide-over or context sheet moves focus inside it and closing returns focus to its trigger.
- Color is never the only status channel. Icons, labels, line styles, and text accompany cyan, gold, violet, green, amber, and rose states.
