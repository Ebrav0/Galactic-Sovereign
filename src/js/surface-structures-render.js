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
  power_grid: '#ffd55f',
  nanoforge: '#ff8f66',
  fleet_academy: '#f4e29a',
  missile_silo: '#ff776f',
  quantum_archive: '#82a8ff',
  embassy_complex: '#f1d3ff',
};

export const SURFACE_BUILDING_VISUAL_TYPES = Object.freeze(Object.keys(SURFACE_COLORS));

function drawTierPips(ctx, r, level, color, zoom) {
  if (level <= 1) return;
  ctx.fillStyle = color;
  for (let i = 0; i < level; i++) {
    ctx.beginPath();
    ctx.arc((i - (level - 1) / 2) * r * 0.38, r * 1.08, Math.max(0.55, 0.7 * zoom), 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawSurfaceBuilding(ctx, x, y, heading, zoom, {
  type,
  active,
  time,
  seed = 0,
  level = 1,
}) {
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
  } else if (type === 'power_grid') {
    ctx.strokeRect(-r, -r * 0.7, r * 2, r * 1.4);
    ctx.strokeStyle = `${color}${active ? 'bb' : '66'}`;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(i * r * 0.45, -r * 0.58);
      ctx.lineTo(i * r * 0.45, r * 0.58);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r * 0.88, i * r * 0.28);
      ctx.lineTo(r * 0.88, i * r * 0.28);
      ctx.stroke();
    }
    ctx.fillStyle = `rgba(255, 213, 95, ${0.18 + pulse * 0.35})`;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.28, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === 'nanoforge') {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
      const px = Math.cos(a) * r;
      const py = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = `rgba(255, 143, 102, ${0.3 + pulse * 0.45})`;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.42, 0, Math.PI * 2);
    ctx.stroke();
  } else if (type === 'fleet_academy') {
    ctx.fillRect(-r, -r * 0.55, r * 2, r * 1.1);
    ctx.strokeRect(-r, -r * 0.55, r * 2, r * 1.1);
    ctx.fillStyle = `${color}${active ? 'cc' : '66'}`;
    ctx.beginPath();
    ctx.moveTo(-r * 0.72, -r * 0.72);
    ctx.lineTo(0, -r * 1.2);
    ctx.lineTo(r * 0.72, -r * 0.72);
    ctx.closePath();
    ctx.fill();
  } else if (type === 'missile_silo') {
    ctx.fillRect(-r, -r * 0.55, r * 2, r * 1.1);
    ctx.strokeRect(-r, -r * 0.55, r * 2, r * 1.1);
    ctx.fillStyle = `${color}${active ? 'aa' : '55'}`;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.arc(i * r * 0.52, 0, r * 0.22, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (type === 'quantum_archive') {
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.15);
    ctx.lineTo(r, 0);
    ctx.lineTo(0, r * 1.15);
    ctx.lineTo(-r, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = `rgba(130, 168, 255, ${0.2 + pulse * 0.45})`;
    ctx.fillRect(-r * 0.18, -r * 0.65, r * 0.36, r * 1.3);
  } else if (type === 'embassy_complex') {
    ctx.fillRect(-r, -r * 0.62, r * 2, r * 1.24);
    ctx.strokeRect(-r, -r * 0.62, r * 2, r * 1.24);
    ctx.fillStyle = `${color}${active ? 'aa' : '55'}`;
    for (let i = -1; i <= 1; i++) ctx.fillRect(i * r * 0.55 - r * 0.1, -r * 0.45, r * 0.2, r * 0.9);
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
  drawTierPips(ctx, r, level, color, zoom);
  ctx.restore();
}
