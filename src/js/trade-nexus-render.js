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
      drawConvoyFreighter(ctx, shipX, shipY, heading, Math.max(3.5, r * 0.075), {
        side: entry.ownerId === 'player' ? 'player' : 'ai',
        cargoRatio: entry.cargoRatio,
        time,
      });
    }
  }
  ctx.restore();
}

export function drawExportDepot(ctx, x, y, r, time, {
  active = true,
  level = 1,
  storedRatio = 0,
  assemblyBays = 1,
} = {}) {
  const tier = Math.max(1, Math.min(3, Math.round(level)));
  const fill = Math.max(0, Math.min(1, storedRatio));
  const spin = time / (18000 - tier * 1400);
  const hull = active ? '#1a2b40' : '#171d27';
  const cyan = active ? '#76ddff' : '#7e91a7';
  const amber = active ? '#ffce7a' : '#7d786d';

  ctx.save();
  ctx.translate(x, y);

  // A fixed command spine gives the installation a readable orientation while
  // the cargo wheel rotates independently around it.
  ctx.fillStyle = hull;
  ctx.strokeStyle = hexToRgba(cyan, 0.72);
  ctx.lineWidth = Math.max(0.8, r * 0.07);
  ctx.beginPath();
  ctx.moveTo(-r * 1.18, -r * 0.24);
  ctx.lineTo(r * 0.78, -r * 0.24);
  ctx.lineTo(r * 1.15, 0);
  ctx.lineTo(r * 0.78, r * 0.24);
  ctx.lineTo(-r * 1.18, r * 0.24);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.save();
  ctx.rotate(spin);
  ctx.strokeStyle = hexToRgba(cyan, 0.58);
  ctx.lineWidth = Math.max(1, r * 0.11);
  ctx.beginPath();
  ctx.arc(0, 0, r * (0.78 + tier * 0.12), 0, Math.PI * 2);
  ctx.stroke();
  const podCount = 6 + tier * 2;
  for (let i = 0; i < podCount; i++) {
    const angle = (i / podCount) * Math.PI * 2;
    const orbit = r * (0.78 + tier * 0.12);
    const loaded = i / podCount < fill;
    ctx.save();
    ctx.translate(Math.cos(angle) * orbit, Math.sin(angle) * orbit);
    ctx.rotate(angle);
    ctx.fillStyle = loaded ? hexToRgba(amber, 0.9) : '#25364a';
    ctx.strokeStyle = loaded ? hexToRgba(amber, 0.7) : hexToRgba(cyan, 0.36);
    ctx.lineWidth = Math.max(0.6, r * 0.035);
    ctx.fillRect(-r * 0.17, -r * 0.1, r * 0.34, r * 0.2);
    ctx.strokeRect(-r * 0.17, -r * 0.1, r * 0.34, r * 0.2);
    ctx.restore();
  }
  ctx.restore();

  // Docking prongs communicate convoy throughput at a glance.
  const bayCount = Math.max(1, Math.min(4, Math.round(assemblyBays)));
  ctx.strokeStyle = hexToRgba(cyan, 0.56);
  ctx.lineWidth = Math.max(0.9, r * 0.07);
  for (let i = 0; i < bayCount; i++) {
    const offset = (i - (bayCount - 1) / 2) * r * 0.34;
    ctx.beginPath();
    ctx.moveTo(r * 0.58, offset);
    ctx.lineTo(r * 1.42, offset);
    ctx.lineTo(r * 1.6, offset + (i % 2 ? r * 0.1 : -r * 0.1));
    ctx.stroke();
  }

  const pulse = active ? 0.65 + 0.35 * Math.sin(time / 420) : 0.25;
  ctx.fillStyle = hexToRgba(amber, pulse);
  ctx.shadowColor = amber;
  ctx.shadowBlur = active ? r * 0.55 : 0;
  ctx.beginPath();
  ctx.arc(-r * 0.82, 0, Math.max(1.2, r * 0.1), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Purpose-built convoy silhouette: armored command prow, modular cargo train,
 * paired compression drives, and threat-state running lights.
 */
export function drawConvoyFreighter(ctx, x, y, heading, size, {
  side = 'player',
  threat = 0,
  cargoRatio = 1,
  paused = false,
  time = 0,
  compact = false,
} = {}) {
  const r = Math.max(2, size);
  const danger = Math.max(0, Math.min(100, Number(threat) || 0));
  const load = Math.max(0, Math.min(1, Number(cargoRatio) || 0));
  const friendly = side === 'player';
  const trim = paused ? '#8492a6' : danger >= 70 ? '#ff5c72' : danger >= 35 ? '#ffc760' : friendly ? '#76ddff' : '#c878ff';
  const podCount = compact ? 2 : 4;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);

  if (!paused) {
    const engine = ctx.createLinearGradient(-r * 2.4, 0, -r * 0.7, 0);
    engine.addColorStop(0, hexToRgba(trim, 0));
    engine.addColorStop(1, hexToRgba(trim, 0.78));
    ctx.fillStyle = engine;
    for (const offset of [-0.28, 0.28]) {
      ctx.beginPath();
      ctx.moveTo(-r * 2.35, offset * r);
      ctx.lineTo(-r * 0.72, offset * r - r * 0.1);
      ctx.lineTo(-r * 0.72, offset * r + r * 0.1);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Modular cargo pods remain legible even at galaxy zoom.
  for (let i = 0; i < podCount; i++) {
    const px = -r * (0.15 + i * 0.52);
    const loaded = (i + 0.5) / podCount <= load;
    ctx.fillStyle = loaded ? '#33475d' : '#1a2635';
    ctx.strokeStyle = loaded ? hexToRgba('#ffce7a', 0.72) : hexToRgba(trim, 0.36);
    ctx.lineWidth = Math.max(0.65, r * 0.055);
    ctx.beginPath();
    ctx.roundRect(px - r * 0.22, -r * 0.38, r * 0.38, r * 0.76, r * 0.08);
    ctx.fill();
    ctx.stroke();
  }

  // Armored prow.
  const hullGradient = ctx.createLinearGradient(-r, -r, r * 1.4, r);
  hullGradient.addColorStop(0, '#101a27');
  hullGradient.addColorStop(0.55, friendly ? '#24455b' : '#412b55');
  hullGradient.addColorStop(1, '#09101a');
  ctx.fillStyle = hullGradient;
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

  const pulse = 0.55 + 0.45 * Math.sin(time / 260);
  ctx.fillStyle = hexToRgba(trim, danger >= 70 ? pulse : 0.82);
  ctx.shadowColor = trim;
  ctx.shadowBlur = Math.max(2, r * 0.45);
  ctx.beginPath();
  ctx.arc(r * 0.62, 0, Math.max(1, r * 0.09), 0, Math.PI * 2);
  ctx.fill();
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
