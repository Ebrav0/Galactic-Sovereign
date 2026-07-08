// Surface structure draw helpers (landing pads, mining rigs).

export function drawLandingPad(ctx, x, y, heading, zoom, { active, time }) {
  const r = 6 * zoom;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  ctx.strokeStyle = active ? 'rgba(255, 200, 80, 0.85)' : 'rgba(120, 130, 150, 0.5)';
  ctx.lineWidth = Math.max(1, 1.2 * zoom);
  ctx.beginPath();
  ctx.rect(-r, -r * 0.6, r * 2, r * 1.2);
  ctx.stroke();
  if (active) {
    ctx.fillStyle = `rgba(255, 200, 80, ${0.15 + 0.1 * Math.sin(time / 400)})`;
    ctx.fill();
  }
  ctx.restore();
}

export function drawMiningRig(ctx, x, y, heading, zoom, { active, time, seed = 0 }) {
  const r = 5 * zoom;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  ctx.strokeStyle = active ? 'rgba(100, 200, 255, 0.9)' : 'rgba(100, 120, 140, 0.5)';
  ctx.lineWidth = Math.max(1, zoom);
  ctx.beginPath();
  ctx.moveTo(-r, r);
  ctx.lineTo(0, -r);
  ctx.lineTo(r, r);
  ctx.closePath();
  ctx.stroke();
  if (active) {
    ctx.fillStyle = `rgba(100, 200, 255, ${0.12 + 0.08 * Math.sin((time + seed) / 500)})`;
    ctx.fill();
  }
  ctx.restore();
}

const SURFACE_COLORS = {
  mining_complex: '#8bd3ff',
  refinery: '#ffb25f',
  storage_depot: '#8ea0b8',
  fighter_factory: '#6fd6ff',
  planetary_shield: '#75f2b0',
  ion_battery: '#b07cff',
};

export function drawSurfaceBuilding(ctx, x, y, heading, zoom, { type, active, time, seed = 0 }) {
  const color = SURFACE_COLORS[type] ?? '#d8e2ff';
  const r = Math.max(2.5, 5.2 * zoom);
  const pulse = active ? 0.55 + 0.45 * Math.sin((time + seed * 31) / 520) : 0.25;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  ctx.globalAlpha = active ? 1 : 0.55;
  ctx.strokeStyle = color;
  ctx.fillStyle = `rgba(12, 18, 28, ${active ? 0.9 : 0.72})`;
  ctx.lineWidth = Math.max(0.8, 1.1 * zoom);

  if (type === 'planetary_shield') {
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.95, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = `rgba(117, 242, 176, ${0.18 + pulse * 0.16})`;
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.8, Math.PI * 1.05, Math.PI * 1.95);
    ctx.stroke();
  } else if (type === 'ion_battery') {
    ctx.beginPath();
    ctx.moveTo(-r, r * 0.8);
    ctx.lineTo(0, -r * 1.1);
    ctx.lineTo(r, r * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = `rgba(176, 124, 255, ${0.25 + pulse * 0.4})`;
    ctx.beginPath();
    ctx.arc(0, -r * 0.25, r * 0.32, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === 'fighter_factory') {
    ctx.fillRect(-r * 1.3, -r * 0.45, r * 2.6, r * 0.9);
    ctx.strokeRect(-r * 1.3, -r * 0.45, r * 2.6, r * 0.9);
    ctx.fillStyle = `rgba(111, 214, 255, ${0.2 + pulse * 0.35})`;
    ctx.fillRect(-r * 1.05, -r * 0.18, r * 0.62, r * 0.36);
    ctx.fillRect(r * 0.42, -r * 0.18, r * 0.62, r * 0.36);
  } else {
    ctx.fillRect(-r, -r * 0.7, r * 2, r * 1.4);
    ctx.strokeRect(-r, -r * 0.7, r * 2, r * 1.4);
    ctx.fillStyle = `${color}${active ? '99' : '55'}`;
    if (type === 'refinery') {
      ctx.fillRect(-r * 0.65, -r * 1.35, r * 0.35, r * 0.75);
      ctx.fillRect(r * 0.25, -r * 1.15, r * 0.32, r * 0.55);
    } else if (type === 'storage_depot') {
      ctx.beginPath();
      ctx.arc(-r * 0.42, 0, r * 0.32, 0, Math.PI * 2);
      ctx.arc(r * 0.42, 0, r * 0.32, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(-r * 0.6, -r * 0.22, r * 1.2, r * 0.44);
    }
  }
  ctx.restore();
}
