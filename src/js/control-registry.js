// One source of truth for gameplay controls and their platform-facing labels.
// Keyboard matching uses KeyboardEvent.code so movement remains stable across
// keyboard layouts; platform detection changes presentation only.

export const CONTROL_ACTIONS = Object.freeze({
  move_up: {
    label: 'Thrust up',
    codes: ['KeyW', 'ArrowUp'],
    display: ['W', '↑'],
    contexts: ['system'],
  },
  move_down: {
    label: 'Thrust down',
    codes: ['KeyS', 'ArrowDown'],
    display: ['S', '↓'],
    contexts: ['system'],
  },
  move_left: {
    label: 'Thrust left',
    codes: ['KeyA', 'ArrowLeft'],
    display: ['A', '←'],
    contexts: ['system'],
  },
  move_right: {
    label: 'Thrust right',
    codes: ['KeyD', 'ArrowRight'],
    display: ['D', '→'],
    contexts: ['system'],
  },
  pause: { label: 'Pause or resume', codes: ['Space'], display: ['Space'], contexts: ['global'] },
  cancel: { label: 'Cancel or close', codes: ['Escape'], display: ['Esc'], contexts: ['global'] },
  toggle_view: { label: 'System / Galaxy map', codes: ['KeyM'], display: ['M'], contexts: ['global'] },
  follow: { label: 'Follow your flagship', codes: ['KeyF'], display: ['F'], contexts: ['system'] },
  orbit: { label: 'Enter or leave orbit', codes: ['KeyO'], display: ['O'], contexts: ['system'] },
  ping: { label: 'Team map ping', codes: ['KeyP'], display: ['P'], contexts: ['global'] },
  pan: { label: 'Pan camera', pointer: 'Drag or middle-drag', contexts: ['system', 'galaxy'] },
  zoom: { label: 'Zoom camera', pointer: 'Mouse wheel', contexts: ['system', 'galaxy'] },
  select: { label: 'Select', pointer: 'Left-click', contexts: ['system', 'galaxy'] },
  travel: { label: 'Order flagship travel', pointer: 'Click a star', contexts: ['galaxy'] },
  inspect_star: { label: 'Inspect without travelling', pointer: 'Double-click a star', contexts: ['galaxy'] },
  scout_dispatch: {
    label: 'Dispatch selected scout',
    modifier: 'shift',
    pointer: 'Click a star',
    contexts: ['galaxy'],
  },
  drone_dispatch: {
    label: 'Deploy construction drone',
    modifier: 'primary',
    pointer: 'Click a star',
    contexts: ['galaxy'],
  },
  fleet_dispatch: {
    label: 'Dispatch selected fleet',
    modifier: 'alt',
    alternateModifier: 'tab',
    pointer: 'Click a star',
    contexts: ['galaxy'],
  },
  combat_order: {
    label: 'Contextual move / attack order',
    pointer: 'Right-click',
    contexts: ['combat'],
  },
});

const CODE_TO_ACTION = new Map();
for (const [actionId, action] of Object.entries(CONTROL_ACTIONS)) {
  for (const code of action.codes ?? []) CODE_TO_ACTION.set(code, actionId);
}

export function controlActionForCode(code) {
  return CODE_TO_ACTION.get(code) ?? null;
}

export function matchesControlAction(event, actionId) {
  return !!CONTROL_ACTIONS[actionId]?.codes?.includes(event?.code);
}

export function isEditableControlTarget(target) {
  // Only true text/form fields. HUD buttons (Join, Command Deck, etc.) often
  // keep focus after click — treating them as "editable" swallows WASD and
  // freezes the flagship, especially after multiplayer join.
  if (!target || typeof target !== 'object') return false;
  if (typeof HTMLInputElement !== 'undefined' && target instanceof HTMLInputElement) return true;
  if (typeof HTMLTextAreaElement !== 'undefined' && target instanceof HTMLTextAreaElement) return true;
  if (typeof HTMLSelectElement !== 'undefined' && target instanceof HTMLSelectElement) return true;
  return target.isContentEditable === true;
}

/** Drop focus from HUD chrome so gameplay keys reach the canvas again. */
export function releaseGameplayKeyboardFocus() {
  if (typeof document === 'undefined') return;
  const active = document.activeElement;
  if (!active || active === document.body || active === document.documentElement) return;
  if (isEditableControlTarget(active)) return;
  active.blur?.();
}

export function detectControlPlatform(nav = globalThis.navigator) {
  const raw = String(
    nav?.userAgentData?.platform
      ?? nav?.platform
      ?? nav?.userAgent
      ?? '',
  ).toLowerCase();
  if (raw.includes('mac') || raw.includes('iphone') || raw.includes('ipad')) return 'macos';
  if (raw.includes('win')) return 'windows';
  if (raw.includes('linux') || raw.includes('x11')) return 'linux';
  return 'unknown';
}

export function modifierLabel(modifier, platform = detectControlPlatform()) {
  if (modifier === 'primary') return platform === 'macos' ? '⌘ Command' : 'Ctrl';
  if (modifier === 'alt') return platform === 'macos' ? '⌥ Option' : 'Alt';
  if (modifier === 'shift') return 'Shift';
  if (modifier === 'tab') return 'Tab';
  return '';
}

export function formatControlAction(actionId, platform = detectControlPlatform()) {
  const action = CONTROL_ACTIONS[actionId];
  if (!action) return '';
  const keyboard = (action.display ?? []).join(' / ');
  const modifiers = [action.modifier, action.alternateModifier]
    .filter(Boolean)
    .map((value) => modifierLabel(value, platform))
    .filter(Boolean);
  const modifiedPointer = action.pointer && modifiers.length
    ? `${modifiers.join(' or ')} + ${action.pointer}`
    : action.pointer;
  return [keyboard, modifiedPointer].filter(Boolean).join(' · ');
}

export function controlReferenceRows(platform = detectControlPlatform()) {
  return Object.entries(CONTROL_ACTIONS).map(([id, action]) => ({
    id,
    label: action.label,
    input: formatControlAction(id, platform),
    contexts: [...(action.contexts ?? [])],
  }));
}

export function emitControlAction(actionId, detail = {}) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent('gs-control-action', {
    detail: { actionId, ...detail },
  }));
}
