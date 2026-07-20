import { techEffects } from './tech-web.js';
import { persistentSystemRecords } from './galaxy-scope.js';

function ownedSystemCount(state) {
  return persistentSystemRecords(state).filter(({ system }) => system.owner === 'player').length;
}

export const FIELD_MANUAL_ENTRIES = Object.freeze([
  {
    id: 'research_tech',
    title: 'Research and the Technology Web',
    summary: 'Research stations generate progress for the Technology Web. Follow prerequisites outward and inspect each node before committing credits.',
    steps: ['Build a Research Station.', 'Open Tech.', 'Choose a reachable node and begin research.'],
    targetId: 'tab-tech',
    unlocked: (state) => techEffects(state).unlockResearchStation || (state.research?.unlocked?.length ?? 0) > 1,
  },
  {
    id: 'fleet_command',
    title: 'Fleet Command',
    summary: 'Organize combat ships into groups, choose doctrines, and anchor escorts to the flagship for coordinated travel.',
    steps: ['Open Fleet.', 'Create or select a battle group.', 'Assign ships and choose a doctrine.'],
    targetId: 'tab-fleet',
    unlocked: (state) => (state.playerShips?.length ?? 0) >= 2,
  },
  {
    id: 'advanced_combat',
    title: 'Advanced Tactical Combat',
    summary: 'Flagship-present battles support focus fire, move, hold, formations, retreat, carrier priorities, and manual advanced tactics. Distant battles auto-resolve.',
    steps: ['Pause when a battle alert appears.', 'Drag to box-select ships (Space+drag or middle-mouse to pan).', 'Right-click to move or focus fire — Command Assist is on by default.'],
    targetId: 'combat-hud-advanced-toggle',
    unlocked: (state) => (state.battleReports?.length ?? 0) > 0,
  },
  {
    id: 'construction_automation',
    title: 'Construction and Bulk Production',
    summary: 'Construction drones build remotely, while bulk production and delivery orders scale repeated ship and structure work across the empire.',
    steps: ['Unlock construction drones.', 'Open Operations or the Construction Planner.', 'Review capacity, routes, and delivery status.'],
    targetId: 'tab-operations',
    unlocked: (state) => techEffects(state).unlockConstructionDrones || (state.builderDrones?.length ?? 0) > 0,
  },
  {
    id: 'strategic_operations',
    title: 'Strategic Operations',
    summary: 'Templates and expansion campaigns coordinate scouting, fleets, capture, construction, and logistics over multiple systems.',
    steps: ['Open Operations.', 'Choose targets and a template.', 'Preview requirements before launching.'],
    targetId: 'tab-operations',
    unlocked: (state) => ownedSystemCount(state) >= 3,
  },
  {
    id: 'dyson_solarii',
    title: 'Dyson Spheres and Solarii',
    summary: 'Sail Foundries supply launchers. Completed shells grant empire bonuses, and the first shell brings Solarii online.',
    steps: ['Build one Sail Foundry in a system.', 'Build launchers on eligible bodies.', 'Protect the system while shells assemble.'],
    targetId: 'tab-dyson',
    unlocked: (state) => techEffects(state).unlockFoundry || state.solariiUnlocked === true,
  },
  {
    id: 'trade_blockades',
    title: 'Trade Routes and Blockades',
    summary: 'Export depots route cargo to Trade Nexuses for credits. Hostile fleets and blockades can interrupt those lanes.',
    steps: ['Discover a Trade Nexus.', 'Open Logistics and assign a destination.', 'Protect or reroute threatened convoys.'],
    targetId: 'tab-logistics',
    unlocked: (state) => (state.logistics?.convoys?.length ?? 0) > 0 || techEffects(state).unlockTradeStation,
  },
  {
    id: 'diplomacy',
    title: 'Diplomacy and the Galactic Council',
    summary: 'Exploration opens first contact. Intelligence narrows acceptance forecasts; a completed Dyson establishes legitimacy for advanced treaties and council politics.',
    steps: ['Detect a major faction through scouting or a border encounter.', 'Open communications and compare known agendas, grievances, and acceptance ranges.', 'After Galactic Legitimacy, research trade, embassies, alliances, and the Council.'],
    targetId: 'tab-diplomacy',
    unlocked: (state) => state.milestones?.diplomacyUnlocked === true
      || Object.values(state.diplomacy?.contacts ?? {}).some((contact) => contact?.stage !== 'unknown'),
  },
  {
    id: 'wormholes',
    title: 'Wormholes and Intergalactic Travel',
    summary: 'Unanchored jumps choose uncertain exits. Paired anchors create reliable routes between galactic cores.',
    steps: ['Reach the Galactic Core.', 'Enter an unanchored wormhole or build an anchor.', 'Secure both ends of important routes.'],
    targetId: 'enter-wormhole-btn',
    unlocked: (state) => (state.wormholeJumpCounter ?? 0) > 0
      || Object.values(state.wormholes ?? {}).some((wormhole) => wormhole.anchor),
  },
  {
    id: 'heroes_superweapon',
    title: 'Hero Flagships and the Superweapon',
    summary: 'Three completed Dyson spheres unlock the Helioclast shipyard, hero flagships, stellar creation and destruction, and strategic Helioclast jumps.',
    steps: [
      'The main path is the longest route — every step after Surveyor needs a side-line tech.',
      'Side lines finish into the spine: Sphere → Maturity, Industry → Capitals, War → Containment, Empire → Gate, Lattice → Live-Fire, Sovereignty + Modes → Online.',
      'Build the shipyard, assemble construction parts, run live-fire, then go Online.',
    ],
    targetId: 'tab-campaign',
    unlocked: (state) => state.milestones?.superweaponUnlocked === true,
  },
  {
    id: 'victory_defeat',
    title: 'Victory and Defeat',
    summary: 'Your selected victory goal defines success. Losing the flagship or the Stronghold ends the campaign.',
    steps: ['Track the selected goal in Campaign.', 'Protect the flagship and Stronghold.', 'Use the Field Manual whenever a system needs a refresher.'],
    targetId: 'tab-campaign',
    unlocked: (state) => state.campaign?.mode !== 'tutorial',
  },
  {
    id: 'sol_commander',
    title: 'Sol Commander (Optional)',
    summary: 'Sol Commander can explain state and propose validated actions. It is optional and never required for progression.',
    steps: ['Open the commander panel.', 'Use offline advice or configure the optional provider.', 'Review and confirm every proposed action.'],
    targetId: 'tab-campaign',
    optional: true,
    unlocked: () => false,
  },
  {
    id: 'save_tools',
    title: 'Save, Import, and Export (Optional)',
    summary: 'Use manual slots for milestones and export portable JSON saves. Imports are validated and migrated before loading.',
    steps: ['Open Save / Load.', 'Choose a manual slot or Export.', 'Keep exported files outside the game folder.'],
    targetId: 'save-menu-btn',
    optional: true,
    unlocked: () => false,
  },
]);

export function fieldManualEntry(id) {
  return FIELD_MANUAL_ENTRIES.find((entry) => entry.id === id) ?? null;
}

export function newlyUnlockedBriefings(state, seenIds = []) {
  const seen = new Set(seenIds);
  if (state.campaign?.mode === 'tutorial' || state.campaign?.tutorial?.graduationPending) return [];
  return FIELD_MANUAL_ENTRIES.filter((entry) => !entry.optional && !seen.has(entry.id) && entry.unlocked(state));
}
