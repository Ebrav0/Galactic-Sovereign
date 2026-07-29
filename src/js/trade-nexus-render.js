// Grounded artificial-commerce visuals for Trade Nexus systems and export depots.
// Rendering only: callers provide world/screen positions and authoritative state.

import { hexToRgba } from './theme.js';

/** Stable world-space depot orbit used by rendering and convoy jump staging. */
export function exportDepotWorldPose(system, time = 0) {
  const key = String(system?.id ?? 'depot');
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const baseAngle = ((hash >>> 0) / 0xffffffff) * Math.PI * 2;
  const radius = Math.max(430, (system?.star?.radius ?? 180) + 285);
  const angle = baseAngle + time / 90000;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
    heading: angle + Math.PI / 2,
    orbitRadius: radius,
  };
}

export function tradeNexusDockPortPose(index, r, time = 0, portCount = 6) {
  const count = Math.max(1, Math.round(portCount));
  const angle = -Math.PI / 2 + (Math.max(0, index) % count) / count * Math.PI * 2 + time / 60000;
  const radius = r * 1.5;
  return {
    index: Math.max(0, index) % count,
    angle,
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
    heading: angle + Math.PI,
    radius,
  };
}

function smoothStep(value) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

export function drawTradeNexus(ctx, x, y, r, time, {
  intel = true,
  compact = false,
  traffic = [],
} = {}) {
  ctx.save();
  ctx.translate(x, y);
  if (!intel) {
    ctx.fillStyle = 'rgba(70, 82, 104, 0.78)';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  const pulse = 0.72 + 0.28 * Math.sin(time / 520);
  const outer = r * (compact ? 0.92 : 1.08);
  const portCount = compact ? 4 : 6;
  const activePorts = new Set(traffic.map((entry) => entry.portIndex));

  // The exchange sits inside a broad commerce haze, brighter along occupied
  // approach corridors.
  ctx.globalCompositeOperation = 'lighter';
  const halo = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, outer * 2.4);
  halo.addColorStop(0, `rgba(118, 221, 255, ${0.22 + pulse * 0.12})`);
  halo.addColorStop(0.38, 'rgba(158, 140, 255, 0.13)');
  halo.addColorStop(1, 'rgba(40, 65, 105, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(0, 0, outer * 2.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  if (!compact) {
    for (let i = 0; i < portCount; i++) {
      const port = tradeNexusDockPortPose(i, r, time, portCount);
      const occupied = activePorts.has(i);
      const farX = Math.cos(port.angle) * r * 3.15;
      const farY = Math.sin(port.angle) * r * 3.15;
      const lane = ctx.createLinearGradient(port.x, port.y, farX, farY);
      lane.addColorStop(0, hexToRgba(occupied ? '#ffce7a' : '#76ddff', occupied ? 0.38 : 0.12));
      lane.addColorStop(1, 'rgba(118, 221, 255, 0)');
      ctx.strokeStyle = lane;
      ctx.lineWidth = Math.max(0.7, r * (occupied ? 0.022 : 0.012));
      ctx.setLineDash([r * 0.09, r * 0.12]);
      ctx.beginPath();
      ctx.moveTo(port.x, port.y);
      ctx.lineTo(farX, farY);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // Counter-rotating habitation, cargo, and customs rings.
  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.rotate(time / (12500 + i * 4500) * (i % 2 ? -1 : 1) + i * Math.PI / 3);
    ctx.strokeStyle = i === 1
      ? hexToRgba('#ffce7a', 0.5)
      : hexToRgba('#76ddff', 0.45);
    ctx.lineWidth = Math.max(1, r * (compact ? 0.045 : 0.055));
    ctx.beginPath();
    ctx.ellipse(0, 0, outer * (0.54 + i * 0.19), outer * (0.31 + i * 0.08), 0, 0, Math.PI * 2);
    ctx.stroke();
    if (!compact && i === 2) {
      for (let pod = 0; pod < 14; pod++) {
        const angle = pod / 14 * Math.PI * 2;
        const px = Math.cos(angle) * outer * 0.92;
        const py = Math.sin(angle) * outer * 0.47;
        ctx.fillStyle = pod % 3 === 0 ? '#ffce7a' : '#344b64';
        ctx.fillRect(px - r * 0.035, py - r * 0.022, r * 0.07, r * 0.044);
      }
    }
    ctx.restore();
  }

  // Six armored docking arms terminate in independent customs ports.
  ctx.lineCap = 'round';
  for (let i = 0; i < portCount; i++) {
    const port = tradeNexusDockPortPose(i, r, time, portCount);
    const occupied = activePorts.has(i);
    const innerX = Math.cos(port.angle) * r * 0.48;
    const innerY = Math.sin(port.angle) * r * 0.48;
    ctx.strokeStyle = hexToRgba(occupied ? '#ffce7a' : '#76ddff', occupied ? 0.78 : 0.46);
    ctx.lineWidth = Math.max(1.2, r * 0.075);
    ctx.beginPath();
    ctx.moveTo(innerX, innerY);
    ctx.lineTo(port.x, port.y);
    ctx.stroke();

    ctx.save();
    ctx.translate(port.x, port.y);
    ctx.rotate(port.angle);
    ctx.fillStyle = occupied ? '#3d3a32' : '#15283b';
    ctx.strokeStyle = hexToRgba(occupied ? '#ffce7a' : '#76ddff', 0.85);
    ctx.lineWidth = Math.max(0.8, r * 0.025);
    ctx.beginPath();
    ctx.moveTo(r * 0.18, -r * 0.16);
    ctx.lineTo(r * 0.35, -r * 0.16);
    ctx.lineTo(r * 0.42, -r * 0.06);
    ctx.lineTo(r * 0.42, r * 0.06);
    ctx.lineTo(r * 0.35, r * 0.16);
    ctx.lineTo(r * 0.18, r * 0.16);
    ctx.lineTo(r * 0.25, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = hexToRgba(occupied ? '#ffce7a' : '#76ddff', 0.92);
    ctx.beginPath();
    ctx.arc(r * 0.33, 0, Math.max(1, r * 0.025), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Armored central exchange citadel.
  const core = ctx.createLinearGradient(-r, -r, r, r);
  core.addColorStop(0, '#5c7891');
  core.addColorStop(0.38, '#1c2c40');
  core.addColorStop(1, '#080d17');
  ctx.fillStyle = core;
  ctx.strokeStyle = 'rgba(186, 224, 244, 0.72)';
  ctx.lineWidth = Math.max(0.8, r * 0.035);
  ctx.beginPath();
  for (let i = 0; i <= 8; i++) {
    const angle = -Math.PI / 2 + i / 8 * Math.PI * 2;
    const px = Math.cos(angle) * r * (i % 2 ? 0.5 : 0.62);
    const py = Math.sin(angle) * r * (i % 2 ? 0.5 : 0.62);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.save();
  ctx.rotate(-time / 10500);
  ctx.strokeStyle = hexToRgba('#9e8cff', 0.72);
  ctx.lineWidth = Math.max(1, r * 0.045);
  for (let i = 0; i < 8; i += 2) {
    const a = i / 8 * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.72, a, a + Math.PI / 7);
    ctx.stroke();
  }
  ctx.restore();

  const exchangeGlow = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.34);
  exchangeGlow.addColorStop(0, `rgba(255, 244, 205, ${0.85 + pulse * 0.15})`);
  exchangeGlow.addColorStop(0.35, `rgba(255, 206, 122, ${0.55 + pulse * 0.2})`);
  exchangeGlow.addColorStop(1, 'rgba(118, 221, 255, 0)');
  ctx.fillStyle = exchangeGlow;
  ctx.shadowColor = '#ffce7a';
  ctx.shadowBlur = r * 0.5;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.34, 0, Math.PI * 2);
  ctx.fill();

  if (!compact) {
    // Cargo ships are real completed convoys. They approach a stable hashed
    // port, visibly unload their credit pods, then depart empty.
    for (const entry of traffic.slice(0, portCount)) {
      const port = tradeNexusDockPortPose(entry.portIndex, r, time, portCount);
      const progress = smoothStep(entry.progress);
      const dockRadius = r * 1.68;
      const outerRadius = r * 3.05;
      let distance = dockRadius;
      let heading = port.angle + Math.PI;
      if (entry.phase === 'approach') distance = outerRadius + (dockRadius - outerRadius) * progress;
      if (entry.phase === 'departing') {
        distance = dockRadius + (outerRadius - dockRadius) * progress;
        heading = port.angle;
      }
      const shipX = Math.cos(port.angle) * distance;
      const shipY = Math.sin(port.angle) * distance;
      if (entry.phase === 'unloading') {
        const receiverX = Math.cos(port.angle) * r * 0.72;
        const receiverY = Math.sin(port.angle) * r * 0.72;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = hexToRgba('#ffce7a', 0.55);
        ctx.lineWidth = Math.max(1, r * 0.018);
        ctx.beginPath();
        ctx.moveTo(shipX, shipY);
        ctx.lineTo(receiverX, receiverY);
        ctx.stroke();
        for (let packet = 0; packet < 4; packet++) {
          const packetProgress = (entry.progress * 4 + packet / 4) % 1;
          ctx.fillStyle = hexToRgba('#ffce7a', 0.95 - packetProgress * 0.35);
          ctx.beginPath();
          ctx.arc(
            shipX + (receiverX - shipX) * packetProgress,
            shipY + (receiverY - shipY) * packetProgress,
            Math.max(1.2, r * 0.018),
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
        ctx.restore();
      }
      drawNexusCargoShip(ctx, shipX, shipY, heading, Math.max(3.5, r * 0.075), {
        side: entry.ownerId === 'player' ? 'player' : 'ai',
        cargoRatio: entry.cargoRatio,
        time,
      });
    }
  }
  ctx.restore();
}

/**
 * Compact station-traffic freighter used by Nexus service and empty returns.
 */
export function drawNexusCargoShip(ctx, x, y, heading, size, {
  side = 'player',
  cargoRatio = 1,
  time = 0,
} = {}) {
  const r = Math.max(2, size);
  const load = Math.max(0, Math.min(1, Number(cargoRatio) || 0));
  const trim = side === 'player' ? '#76ddff' : '#c878ff';
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);

  const engine = ctx.createLinearGradient(-r * 2.25, 0, -r * 0.6, 0);
  engine.addColorStop(0, hexToRgba(trim, 0));
  engine.addColorStop(1, hexToRgba(trim, 0.78));
  ctx.fillStyle = engine;
  for (const offset of [-0.26, 0.26]) {
    ctx.beginPath();
    ctx.moveTo(-r * 2.2, offset * r);
    ctx.lineTo(-r * 0.58, offset * r - r * 0.1);
    ctx.lineTo(-r * 0.58, offset * r + r * 0.1);
    ctx.closePath();
    ctx.fill();
  }

  for (let i = 0; i < 4; i++) {
    const px = -r * (0.12 + i * 0.5);
    const loaded = (i + 0.5) / 4 <= load;
    ctx.fillStyle = loaded ? '#33475d' : '#1a2635';
    ctx.strokeStyle = loaded ? hexToRgba('#ffce7a', 0.72) : hexToRgba(trim, 0.36);
    ctx.lineWidth = Math.max(0.65, r * 0.055);
    ctx.beginPath();
    ctx.roundRect(px - r * 0.22, -r * 0.36, r * 0.38, r * 0.72, r * 0.08);
    ctx.fill();
    ctx.stroke();
  }

  const hull = ctx.createLinearGradient(-r, -r, r * 1.4, r);
  hull.addColorStop(0, '#101a27');
  hull.addColorStop(0.55, side === 'player' ? '#24455b' : '#412b55');
  hull.addColorStop(1, '#09101a');
  ctx.fillStyle = hull;
  ctx.strokeStyle = hexToRgba(trim, 0.82);
  ctx.lineWidth = Math.max(0.8, r * 0.07);
  ctx.beginPath();
  ctx.moveTo(r * 1.35, 0);
  ctx.lineTo(r * 0.55, -r * 0.46);
  ctx.lineTo(-r * 0.48, -r * 0.34);
  ctx.lineTo(-r * 0.78, 0);
  ctx.lineTo(-r * 0.48, r * 0.34);
  ctx.lineTo(r * 0.55, r * 0.46);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  const pulse = 0.7 + 0.3 * Math.sin(time / 260);
  ctx.fillStyle = hexToRgba(trim, pulse);
  ctx.shadowColor = trim;
  ctx.shadowBlur = Math.max(2, r * 0.45);
  ctx.beginPath();
  ctx.arc(r * 0.62, 0, Math.max(1, r * 0.09), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawExportDepot(ctx, x, y, r, time, { active = true } = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(time / 14000);
  ctx.fillStyle = '#172335';
  ctx.strokeStyle = active ? 'rgba(118, 221, 255, 0.72)' : 'rgba(126, 145, 186, 0.4)';
  ctx.lineWidth = Math.max(0.8, r * 0.08);
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    const rr = i % 2 ? r * 0.72 : r;
    const px = Math.cos(a) * rr;
    const py = Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.rotate(-time / 9000);
  ctx.strokeStyle = 'rgba(255, 206, 122, 0.58)';
  ctx.beginPath();
  ctx.arc(0, 0, r * 1.25, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

export function drawSpaceCompressionJump(ctx, x, y, heading, size, progress, color = '#76ddff') {
  const p = Math.max(0, Math.min(1, progress));
  const squeeze = 1 - Math.sin(p * Math.PI) * 0.82;
  const flash = Math.sin(Math.min(1, p * 1.25) * Math.PI);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = hexToRgba(color, 0.22 + flash * 0.62);
  ctx.shadowColor = color;
  ctx.shadowBlur = size * (1 + flash * 2.8);
  for (let i = 0; i < 5; i++) {
    const lane = (i - 2) * size * 0.24;
    ctx.beginPath();
    ctx.moveTo(-size * (2.2 + flash), lane * squeeze);
    ctx.lineTo(size * (1.4 + flash * 0.5), lane * squeeze);
    ctx.stroke();
  }
  ctx.fillStyle = hexToRgba('#ffffff', flash * 0.7);
  ctx.beginPath();
  ctx.ellipse(0, 0, size * (0.2 + flash * 1.6), size * 0.12 * squeeze, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
