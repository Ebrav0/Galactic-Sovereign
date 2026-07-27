/**
 * Adaptive Command Deck — context resolver and layout benchmarks.
 * Shell chrome only; does not change gameplay commands or IDs.
 */

export const DECK_CONTEXTS = Object.freeze({
  systemMap: 'systemMap',
  body: 'body',
  fleet: 'fleet',
  scoutDroneConvoy: 'scoutDroneConvoy',
  combat: 'combat',
  activity: 'activity',
});

/** Layout acceptance constants (see Adaptive Command Deck plan). */
export const DECK_LAYOUT = Object.freeze({
  wide: Object.freeze({
    minWidth: 1440,
    minHeight: 1024,
    activityRail: Object.freeze([150, 170]),
    inspector: Object.freeze([280, 320]),
    actionDeckExpanded: Object.freeze([250, 300]),
    canvasHeightCollapsedMinRatio: 0.64,
  }),
  compact: Object.freeze({
    width: 1280,
    height: 720,
    activityRailMax: 72,
    actionDeckCollapsedMax: 96,
    actionDeckExpandedMax: 280,
    canvasHeightCollapsedMinRatio: 0.64,
    canvasHeightExpandedMinRatio: 0.48,
  }),
  systemPlay: Object.freeze({
    canvasWidthFreeMinRatio: 0.6,
  }),
  slideOverMapStripMinPx: 80,
  slideOverMapStripMinRatio: 0.12,
  maxPrimaryActions: 6,
});

const ACTIVITY_PANELS = new Set([
  'tech',
  'diplomacy',
  'operations',
  'campaign',
  'fleet',
  'logistics',
  'dyson',
]);

/**
 * Primary action labels shown in the action deck (excluding flight pad / More).
 * Used for density checks and deck chrome labeling — live buttons keep existing IDs.
 */
export const DECK_PRIMARY_ACTIONS = Object.freeze({
  [DECK_CONTEXTS.systemMap]: Object.freeze(['Navigate', 'Overlays', 'Operations', 'Intel']),
  [DECK_CONTEXTS.body]: Object.freeze(['Build', 'Production', 'Automation', 'Inspect']),
  [DECK_CONTEXTS.fleet]: Object.freeze(['Follow', 'Doctrine', 'Assign', 'Move']),
  [DECK_CONTEXTS.scoutDroneConvoy]: Object.freeze(['Follow', 'Dispatch', 'Reroute', 'Cancel']),
  [DECK_CONTEXTS.combat]: Object.freeze(['Move', 'Attack', 'Hold', 'Doctrine', 'Retreat']),
  [DECK_CONTEXTS.activity]: Object.freeze(['Confirm', 'Close']),
});

/**
 * @param {{
 *   view?: string,
 *   sidePanel?: string | null,
 *   selection?: string | null,
 *   combatActive?: boolean,
 *   selectedScoutId?: string | null,
 *   selectedBuilderDroneId?: string | null,
 *   selectedBattleGroupId?: string | null,
 *   selectedConvoyId?: string | null,
 * }} input
 */
export function resolveDeckContext(input = {}) {
  const {
    view = 'system',
    sidePanel = null,
    selection = null,
    combatActive = false,
    selectedScoutId = null,
    selectedBuilderDroneId = null,
    selectedBattleGroupId = null,
    selectedConvoyId = null,
  } = input;

  if (combatActive) return DECK_CONTEXTS.combat;
  if (sidePanel && ACTIVITY_PANELS.has(sidePanel)) return DECK_CONTEXTS.activity;

  if (selectedScoutId || selectedBuilderDroneId || selectedConvoyId) {
    return DECK_CONTEXTS.scoutDroneConvoy;
  }
  if (selectedBattleGroupId) return DECK_CONTEXTS.fleet;

  if (view === 'system' && selection && selection !== 'star') {
    return DECK_CONTEXTS.body;
  }

  return DECK_CONTEXTS.systemMap;
}

export function primaryActionsForContext(context) {
  return DECK_PRIMARY_ACTIONS[context] ?? DECK_PRIMARY_ACTIONS[DECK_CONTEXTS.systemMap];
}

export function deckContextLabel(context) {
  switch (context) {
    case DECK_CONTEXTS.body: return 'Body';
    case DECK_CONTEXTS.fleet: return 'Fleet';
    case DECK_CONTEXTS.scoutDroneConvoy: return 'Asset';
    case DECK_CONTEXTS.combat: return 'Combat';
    case DECK_CONTEXTS.activity: return 'Workspace';
    default: return 'Map';
  }
}

/**
 * Apply context marker and breadcrumb on the HUD shell.
 * @param {HTMLElement | null} hud
 * @param {string} context
 * @param {{ view?: string, sidePanel?: string | null, systemName?: string }} meta
 */
export function applyDeckChrome(hud, context, meta = {}) {
  if (!hud) return;
  hud.dataset.deckContext = context;
  hud.classList.toggle('hud--deck-combat', context === DECK_CONTEXTS.combat);
  hud.classList.toggle('hud--deck-activity', context === DECK_CONTEXTS.activity);
  hud.classList.toggle('hud--deck-expanded', context === DECK_CONTEXTS.body
    || context === DECK_CONTEXTS.fleet
    || context === DECK_CONTEXTS.scoutDroneConvoy);

  const crumb = hud.querySelector('#deck-breadcrumb');
  if (crumb) {
    const viewLabel = meta.view === 'galaxy' ? 'Galaxy' : 'System';
    const sys = meta.systemName ? ` · ${meta.systemName}` : '';
    const panel = meta.sidePanel ? ` · ${String(meta.sidePanel)}` : '';
    crumb.textContent = `${viewLabel}${sys} · ${deckContextLabel(context)}${panel}`;
  }

  const mode = hud.querySelector('#command-mode');
  if (mode) mode.textContent = `Command Deck · ${deckContextLabel(context)}`;
}
