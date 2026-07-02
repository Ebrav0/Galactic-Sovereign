// Shared visual palette for Canvas 2D — keep in sync with src/css/tokens.css

export const THEME = {
  bgDeep: '#05070f',
  bgGalaxy: '#04060d',
  bgBlackHole: '#02030a',

  textPrimary: '#cfe0ff',
  textSecondary: 'rgba(207, 224, 255, 0.75)',
  textMuted: 'rgba(122, 141, 181, 0.85)',
  textLabel: 'rgba(207, 224, 255, 0.85)',

  accentGold: '#ffd27a',
  accentCyan: '#7ad0ff',
  accentGreen: '#7aff9e',
  danger: '#ff7a7a',

  starfield: '#cfe0ff',
  moon: '#a8b4cc',
  hull: '#dfe9ff',
  trafficPulse: '#9fc7ff',

  planet: {
    habitable: '#4f9e6b',
    barren: '#9e8a72',
    gas: '#b07adb',
  },

  fog: {
    moon: 'rgba(80, 90, 110, 0.5)',
    planet: 'rgba(55, 65, 85, 0.55)',
    label: 'rgba(100, 110, 130, 0.6)',
    star: 'rgba(80, 90, 110, 0.6)',
    galaxyNode: 'rgba(20, 25, 40, 0.75)',
  },

  orbit: 'rgba(120, 160, 255, 0.14)',
  orbitMoon: 'rgba(120, 160, 255, 0.10)',

  lane: 'rgba(110, 150, 255, 0.22)',
  laneRoute: 'rgba(255, 210, 122, 0.55)',
  laneScout: 'rgba(122, 255, 158, 0.45)',

  scout: { normal: '#9fc7ff', selected: '#b8ffb8' },

  fontUi: '"IBM Plex Sans", sans-serif',
};

/** @param {string} hex @param {number} alpha */
export function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Radial gradient fill for a celestial body sphere. */
export function fillPlanetSphere(ctx, x, y, r, baseColor, intel = true) {
  if (!intel) {
    ctx.fillStyle = THEME.fog.planet;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  const grad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  grad.addColorStop(0, hexToRgba(baseColor, 1));
  grad.addColorStop(0.7, baseColor);
  grad.addColorStop(1, hexToRgba(baseColor, 0.55));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = hexToRgba(baseColor, 0.35);
  ctx.lineWidth = Math.max(0.5, r * 0.08);
  ctx.beginPath();
  ctx.arc(x, y, r + r * 0.12, 0, Math.PI * 2);
  ctx.stroke();
}

/** Draw a quadratic bezier curve with a precomputed control point. */
export function drawQuadraticCurve(ctx, sx, sy, cx, cy, ex, ey) {
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.quadraticCurveTo(cx, cy, ex, ey);
  ctx.stroke();
}

/** Point on quadratic bezier at t ∈ [0,1]. */
export function bezierPoint(sx, sy, cx, cy, ex, ey, t) {
  const u = 1 - t;
  return {
    x: u * u * sx + 2 * u * t * cx + t * t * ex,
    y: u * u * sy + 2 * u * t * cy + t * t * ey,
  };
}
