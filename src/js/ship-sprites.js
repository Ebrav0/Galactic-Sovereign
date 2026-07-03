// Distinct Canvas 2D silhouettes per hull type (Phase 2 render).

import { THEME, hexToRgba } from './theme.js';

const HULL_RENDER = {
  scout: { scale: 0.75, role: 'escort' },
  corvette: { scale: 0.85, role: 'escort' },
  frigate: { scale: 1.0, role: 'escort' },
  destroyer: { scale: 1.15, role: 'line' },
  cruiser: { scale: 1.35, role: 'line' },
  light_carrier: { scale: 1.25, role: 'carrier' },
  fighter: { scale: 0.55, role: 'fighter' },
  bomber: { scale: 0.65, role: 'fighter' },
  healer: { scale: 0.95, role: 'support' },
  flagship: { scale: 1.5, role: 'command' },
};

function hullColors(hull, side) {
  const enemy = side === 'enemy';
  if (hull === 'healer') {
    return {
      fill: enemy ? '#8a5555' : '#5a9e78',
      stroke: enemy ? '#ff8888' : '#7affb8',
      glow: enemy ? '#ff5555' : '#7aff9e',
    };
  }
  if (hull === 'destroyer' || hull === 'cruiser') {
    return {
      fill: enemy ? '#5a3030' : '#3a4a62',
      stroke: enemy ? '#ff6666' : '#9fc7ff',
      glow: enemy ? '#ff4444' : THEME.accentCyan,
    };
  }
  if (hull === 'light_carrier') {
    return {
      fill: enemy ? '#4a3535' : '#2e4055',
      stroke: enemy ? '#ff7777' : '#8ec8ff',
      glow: enemy ? '#ff5555' : '#7ad0ff',
    };
  }
  return {
    fill: enemy ? '#4a2828' : '#2a3548',
    stroke: enemy ? '#ff6666' : THEME.accentCyan,
    glow: enemy ? '#ff4444' : THEME.accentCyan,
  };
}

function drawHpBar(ctx, x, y, r, hp, maxHp) {
  if (maxHp <= 0 || hp >= maxHp) return;
  const barW = r * 2.8;
  const pct = hp / maxHp;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x - barW / 2, y - r - 10, barW, 4);
  ctx.fillStyle = pct > 0.35 ? THEME.accentGreen : THEME.danger;
  ctx.fillRect(x - barW / 2, y - r - 10, barW * pct, 4);
}

function drawEscort(ctx, r, colors) {
  ctx.beginPath();
  ctx.moveTo(r * 1.5, 0);
  ctx.lineTo(-r * 0.95, r * 0.72);
  ctx.lineTo(-r * 0.55, 0);
  ctx.lineTo(-r * 0.95, -r * 0.72);
  ctx.closePath();
  ctx.fillStyle = colors.fill;
  ctx.fill();
  ctx.strokeStyle = colors.stroke;
  ctx.lineWidth = Math.max(1, r * 0.14);
  ctx.stroke();
  ctx.fillStyle = colors.glow;
  ctx.beginPath();
  ctx.arc(r * 0.45, 0, Math.max(0.8, r * 0.22), 0, Math.PI * 2);
  ctx.fill();
}

function drawFrigate(ctx, r, colors) {
  ctx.beginPath();
  ctx.moveTo(r * 1.65, 0);
  ctx.lineTo(r * 0.2, r * 0.35);
  ctx.lineTo(-r * 1.1, r * 0.85);
  ctx.lineTo(-r * 0.55, 0);
  ctx.lineTo(-r * 1.1, -r * 0.85);
  ctx.lineTo(r * 0.2, -r * 0.35);
  ctx.closePath();
  ctx.fillStyle = colors.fill;
  ctx.fill();
  ctx.strokeStyle = colors.stroke;
  ctx.lineWidth = Math.max(1, r * 0.12);
  ctx.stroke();
}

function drawDestroyer(ctx, r, colors) {
  ctx.beginPath();
  ctx.moveTo(r * 1.8, 0);
  ctx.lineTo(r * 0.35, r * 0.28);
  ctx.lineTo(-r * 0.5, r * 0.35);
  ctx.lineTo(-r * 1.25, r * 0.95);
  ctx.lineTo(-r * 0.75, 0);
  ctx.lineTo(-r * 1.25, -r * 0.95);
  ctx.lineTo(-r * 0.5, -r * 0.35);
  ctx.lineTo(r * 0.35, -r * 0.28);
  ctx.closePath();
  ctx.fillStyle = colors.fill;
  ctx.fill();
  ctx.strokeStyle = colors.stroke;
  ctx.lineWidth = Math.max(1, r * 0.11);
  ctx.stroke();
  ctx.fillStyle = colors.stroke;
  ctx.fillRect(-r * 0.15, -r * 0.55, r * 0.35, r * 1.1);
}

function drawCruiser(ctx, r, colors) {
  ctx.beginPath();
  ctx.moveTo(r * 1.5, 0);
  ctx.lineTo(r * 0.6, r * 0.55);
  ctx.lineTo(-r * 0.4, r * 0.75);
  ctx.lineTo(-r * 1.35, r * 0.55);
  ctx.lineTo(-r * 1.35, -r * 0.55);
  ctx.lineTo(-r * 0.4, -r * 0.75);
  ctx.lineTo(r * 0.6, -r * 0.55);
  ctx.closePath();
  ctx.fillStyle = colors.fill;
  ctx.fill();
  ctx.strokeStyle = colors.stroke;
  ctx.lineWidth = Math.max(1, r * 0.1);
  ctx.stroke();
}

function drawCarrier(ctx, r, colors) {
  ctx.beginPath();
  ctx.moveTo(r * 1.2, -r * 0.95);
  ctx.lineTo(r * 1.2, r * 0.95);
  ctx.lineTo(-r * 1.3, r * 0.75);
  ctx.lineTo(-r * 1.3, -r * 0.75);
  ctx.closePath();
  ctx.fillStyle = colors.fill;
  ctx.fill();
  ctx.strokeStyle = colors.stroke;
  ctx.lineWidth = Math.max(1, r * 0.1);
  ctx.stroke();
  ctx.fillStyle = hexToRgba(colors.glow, 0.35);
  ctx.fillRect(-r * 0.9, -r * 0.15, r * 1.5, r * 0.3);
}

function drawFighter(ctx, r, colors) {
  ctx.beginPath();
  ctx.moveTo(r * 1.3, 0);
  ctx.lineTo(-r * 0.7, r * 0.55);
  ctx.lineTo(-r * 0.35, 0);
  ctx.lineTo(-r * 0.7, -r * 0.55);
  ctx.closePath();
  ctx.fillStyle = colors.fill;
  ctx.fill();
  ctx.strokeStyle = colors.stroke;
  ctx.lineWidth = Math.max(0.8, r * 0.16);
  ctx.stroke();
}

function drawBomber(ctx, r, colors) {
  ctx.beginPath();
  ctx.moveTo(r * 1.1, 0);
  ctx.lineTo(-r * 0.2, r * 0.75);
  ctx.lineTo(-r * 0.85, r * 0.55);
  ctx.lineTo(-r * 0.55, 0);
  ctx.lineTo(-r * 0.85, -r * 0.55);
  ctx.lineTo(-r * 0.2, -r * 0.75);
  ctx.closePath();
  ctx.fillStyle = colors.fill;
  ctx.fill();
  ctx.strokeStyle = colors.stroke;
  ctx.lineWidth = Math.max(0.8, r * 0.14);
  ctx.stroke();
}

function drawHealer(ctx, r, colors) {
  const pulse = 0.65 + 0.35 * Math.sin(performance.now() / 420);
  ctx.strokeStyle = hexToRgba(colors.glow, 0.35 + 0.25 * pulse);
  ctx.lineWidth = Math.max(1, r * 0.18);
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.15, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = colors.fill;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = colors.stroke;
  ctx.lineWidth = Math.max(1, r * 0.12);
  ctx.beginPath();
  ctx.moveTo(-r * 0.85, 0);
  ctx.lineTo(r * 0.85, 0);
  ctx.moveTo(0, -r * 0.85);
  ctx.lineTo(0, r * 0.85);
  ctx.stroke();
}

function drawFlagshipHull(ctx, r, colors) {
  ctx.beginPath();
  ctx.moveTo(r * 1.7, 0);
  ctx.lineTo(-r * 1.1, r * 0.95);
  ctx.lineTo(-r * 0.65, 0);
  ctx.lineTo(-r * 1.1, -r * 0.95);
  ctx.closePath();
  ctx.fillStyle = colors.fill;
  ctx.fill();
  ctx.strokeStyle = colors.stroke;
  ctx.lineWidth = Math.max(1, r * 0.14);
  ctx.stroke();
  ctx.fillStyle = colors.glow;
  ctx.shadowColor = colors.glow;
  ctx.shadowBlur = r * 0.45;
  ctx.beginPath();
  ctx.arc(r * 0.55, 0, Math.max(1, r * 0.28), 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawHullShape(ctx, hull, r, colors) {
  switch (hull) {
    case 'frigate': drawFrigate(ctx, r, colors); break;
    case 'destroyer': drawDestroyer(ctx, r, colors); break;
    case 'cruiser': drawCruiser(ctx, r, colors); break;
    case 'light_carrier': drawCarrier(ctx, r, colors); break;
    case 'fighter': drawFighter(ctx, r, colors); break;
    case 'bomber': drawBomber(ctx, r, colors); break;
    case 'healer': drawHealer(ctx, r, colors); break;
    case 'flagship': drawFlagshipHull(ctx, r, colors); break;
    case 'scout':
    case 'corvette':
    default:
      drawEscort(ctx, r, colors);
      break;
  }
}

export function hullRenderScale(hull) {
  return HULL_RENDER[hull]?.scale ?? 1;
}

export function drawHullSprite(ctx, x, y, hull, baseR, opts = {}) {
  const {
    heading = 0,
    side = 'player',
    hp = 1,
    maxHp = 1,
    showHp = true,
  } = opts;

  const scale = hullRenderScale(hull);
  const r = baseR * scale;
  const colors = hullColors(hull, side);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  ctx.shadowColor = hexToRgba(colors.glow, 0.45);
  ctx.shadowBlur = r * 0.35;
  drawHullShape(ctx, hull, r, colors);
  ctx.shadowBlur = 0;
  ctx.restore();

  if (showHp) drawHpBar(ctx, x, y, r, hp, maxHp);
}
