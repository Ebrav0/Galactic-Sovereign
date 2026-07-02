// Shared Phase 2 visual metadata for canvas + HUD (hull colors, roles, icons).

export const HULL_VISUAL = {
  scout: { color: '#9fc7ff', role: 'Intel', category: 'special', short: 'SC' },
  corvette: { color: '#7ad0ff', role: 'Escort', category: 'escort', short: 'CV' },
  frigate: { color: '#6a9fd4', role: 'Escort', category: 'escort', short: 'FG' },
  destroyer: { color: '#5b8cff', role: 'Line', category: 'line', short: 'DD' },
  cruiser: { color: '#8b7aff', role: 'Capital', category: 'capital', short: 'CR' },
  light_carrier: { color: '#b07adb', role: 'Carrier', category: 'carrier', short: 'CVL' },
  healer: { color: '#7aff9e', role: 'Support', category: 'support', short: 'HL' },
  light_hauler: { color: '#c8b48a', role: 'Transport', category: 'transport', short: 'TR' },
  interceptor_wing: { color: '#a8e6ff', role: 'Fighter', category: 'wing', short: 'INT' },
  bomber_wing: { color: '#ff9d7a', role: 'Bomber', category: 'wing', short: 'BMB' },
  flagship: { color: '#ffd27a', role: 'Command', category: 'flagship', short: '★' },
};

export function hullVisual(hull) {
  return HULL_VISUAL[hull] ?? { color: '#dfe9ff', role: 'Ship', category: 'line', short: '?' };
}

export function hullCssClass(hull) {
  return `hull-badge--${hullVisual(hull).category}`;
}

export function formatHullName(hull) {
  return hull.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
