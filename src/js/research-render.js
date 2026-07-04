// Research station orbital visuals — dish antenna on planet orbit.

import { THEME, hexToRgba } from './theme.js';

const DISH_R = 1;

/**
 * Draw a compact research orbital with rotating dish and data pulse.
 */
export function drawResearchStation(ctx, x, y, scale, site, time = 0) {
  const r = Math.max(5, 9 * scale);
  const pulse = 0.65 + 0.35 * Math.sin(time / 900 + site.seed * 0.1);
  const spin = (time / 2400 + site.seed * 0.02) % (Math.PI * 2);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(site.hubHeading);

  // Orbit ring footprint
  ctx.strokeStyle = hexToRgba('#9a6bff', 0.35);
  ctx.lineWidth = Math.max(0.6, 0.9 * scale);
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.35, 0, Math.PI * 2);
  ctx.stroke();

  // Core module
  ctx.fillStyle = 'rgba(14, 20, 32, 0.94)';
  ctx.strokeStyle = hexToRgba(THEME.accentCyan, 0.55);
  ctx.lineWidth = Math.max(0.7, 1 * scale);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Rotating dish arm
  ctx.save();
  ctx.rotate(spin);
  ctx.strokeStyle = hexToRgba('#b07adb', 0.75);
  ctx.lineWidth = Math.max(0.6, 0.85 * scale);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(r * 0.95, 0);
  ctx.stroke();

  ctx.fillStyle = `rgba(122, 208, 255, ${0.25 + 0.35 * pulse})`;
  ctx.strokeStyle = hexToRgba(THEME.accentCyan, 0.65);
  ctx.lineWidth = Math.max(0.5, 0.7 * scale);
  ctx.beginPath();
  ctx.arc(r * 0.95, 0, r * DISH_R * 0.55, -Math.PI * 0.55, Math.PI * 0.55);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // Sensor blink
  ctx.fillStyle = hexToRgba(THEME.accentCyan, 0.35 + 0.45 * pulse);
  ctx.beginPath();
  ctx.arc(0, -r * 0.18, Math.max(1, 1.2 * scale), 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

export function researchStationLabelAnchor(x, y, scale) {
  return {
    x,
    y,
    labelX: x,
    labelY: y - Math.max(10, 12 * scale),
    color: '#b07adb',
  };
}

export function drawResearchStationLabel(ctx, anchor, scale) {
  const size = Math.max(8, 9 * scale);
  ctx.save();
  ctx.font = `${size}px ${THEME.fontUi}`;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(5, 7, 15, 0.8)';
  ctx.fillText('Research Lab', anchor.labelX + 1, anchor.labelY + 1);
  ctx.fillStyle = hexToRgba(anchor.color, 0.92);
  ctx.fillText('Research Lab', anchor.labelX, anchor.labelY);
  ctx.restore();
}
