// Canvas draw helpers for orbital shipyard stations and sail launcher platforms.

import { LAUNCHER_BURST_MS, LAUNCHER_WORLD_RADIUS, SHIPYARD_WORLD_RADIUS } from './constants.js';
import { THEME, hexToRgba } from './theme.js';

function drawHubRing(ctx, radius, stroke, fill, lineW) {
  ctx.strokeStyle = stroke;
  ctx.fillStyle = fill;
  ctx.lineWidth = lineW;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

export function drawShipyardStation(ctx, x, y, scale, site, time = 0) {
  const r = SHIPYARD_WORLD_RADIUS * scale;
  const pulse = 0.6 + 0.4 * Math.sin(time / 640 + site.seed);
  const building = site.building;
  const prog = site.buildProgress ?? 0;
  const alpha = building ? 0.75 + 0.25 * prog : 1;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(site.hubHeading);
  ctx.globalAlpha = alpha;

  // Tiered hub decks (concentric circles)
  drawHubRing(
    ctx,
    r * 1.05,
    hexToRgba(THEME.accentCyan, 0.55),
    'rgba(14, 20, 32, 0.94)',
    Math.max(0.8, 1.2 * scale),
  );
  drawHubRing(
    ctx,
    r * 0.82,
    hexToRgba(THEME.textSecondary, 0.45),
    'rgba(22, 30, 46, 0.92)',
    Math.max(0.6, 1 * scale),
  );
  drawHubRing(
    ctx,
    r * 0.58,
    hexToRgba(THEME.accentCyan, 0.35),
    'rgba(28, 38, 56, 0.9)',
    Math.max(0.5, 0.85 * scale),
  );

  // Blue window band on inner ring
  ctx.fillStyle = hexToRgba('#6ec8ff', 0.25 + 0.35 * pulse);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const wx = Math.cos(a) * r * 0.68;
    const wy = Math.sin(a) * r * 0.68;
    ctx.save();
    ctx.translate(wx, wy);
    ctx.rotate(a);
    ctx.fillRect(-scale * 1.2, -scale * 0.8, scale * 2.4, scale * 1.6);
    ctx.restore();
  }

  // Radial drydock arms
  const armCount = 5 + (site.seed % 2);
  for (let i = 0; i < armCount; i++) {
    const a = (i / armCount) * Math.PI * 2 + site.seed * 0.04;
    const accent = i === 0 || i === 2;
    const armLen = r * (1.15 + (i % 3) * 0.12);
    const inner = r * 0.55;
    ctx.strokeStyle = accent ? hexToRgba('#c94444', 0.75) : hexToRgba(THEME.textSecondary, 0.6);
    ctx.lineWidth = Math.max(0.7, (accent ? 1.4 : 1.1) * scale);
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
    ctx.lineTo(Math.cos(a) * armLen, Math.sin(a) * armLen);
    ctx.stroke();

    if (building && i === 0) {
      const end = inner + (armLen - inner) * (0.55 + prog * 0.45);
      ctx.setLineDash([3 * scale, 3 * scale]);
      ctx.strokeStyle = hexToRgba(THEME.accentCyan, 0.5 + 0.4 * pulse);
      ctx.lineWidth = Math.max(0.8, 1.3 * scale);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
      ctx.lineTo(Math.cos(a) * end, Math.sin(a) * end);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.save();
      ctx.translate(Math.cos(a) * armLen * 0.72, Math.sin(a) * armLen * 0.72);
      ctx.rotate(a);
      const hullW = r * 0.22 * prog;
      const hullH = r * 0.08 * prog;
      ctx.fillStyle = hexToRgba(THEME.accentCyan, 0.35 + 0.45 * prog);
      ctx.fillRect(-hullW * 0.5, -hullH, hullW, hullH * 2);
      if (prog > 0.2) {
        ctx.fillStyle = hexToRgba('#dff0ff', 0.25 * pulse);
        ctx.fillRect(hullW * 0.15, -hullH * 0.35, hullW * 0.35, hullH * 0.7);
      }
      ctx.restore();

      if (prog > 0.05) {
        const sparkR = inner + (armLen - inner) * (0.5 + prog * 0.4);
        ctx.fillStyle = hexToRgba('#fff4a8', 0.4 * pulse);
        ctx.beginPath();
        ctx.arc(Math.cos(a) * sparkR, Math.sin(a) * sparkR, Math.max(1, 1.8 * scale), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Dish antenna
  ctx.strokeStyle = hexToRgba(THEME.textMuted, 0.55);
  ctx.lineWidth = Math.max(0.5, 0.75 * scale);
  ctx.beginPath();
  ctx.moveTo(0, -r * 0.15);
  ctx.lineTo(0, -r * 0.55);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, -r * 0.62, r * 0.12, Math.PI * 0.15, Math.PI * 0.85);
  ctx.stroke();

  ctx.globalAlpha = 1;
  ctx.restore();
}

export function drawSailLauncher(ctx, x, y, scale, site, time = 0) {
  const r = LAUNCHER_WORLD_RADIUS * scale;
  const railLen = r;
  const spineW = r * 0.14;
  const spineH = r * 0.11;
  const blink = 0.45 + 0.55 * Math.sin(time / 420 + site.seed);
  const firing = site.firing;
  const fireT = site.fireAge != null ? 1 - site.fireAge / LAUNCHER_BURST_MS : 0;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(site.heading);

  // Stabilization ring (perpendicular to rail)
  ctx.strokeStyle = hexToRgba(THEME.textSecondary, 0.55);
  ctx.lineWidth = Math.max(0.5, 0.8 * scale);
  ctx.beginPath();
  ctx.ellipse(-spineW * 0.3, 0, spineW * 1.6, spineH * 1.8, 0, 0, Math.PI * 2);
  ctx.stroke();

  // Main spine hull
  ctx.fillStyle = 'rgba(18, 22, 32, 0.96)';
  ctx.strokeStyle = hexToRgba(THEME.textMuted, 0.65);
  ctx.lineWidth = Math.max(0.6, 0.9 * scale);
  ctx.fillRect(0, -spineH * 0.5, railLen, spineH);
  ctx.strokeRect(0, -spineH * 0.5, railLen, spineH);

  // Rail channel toward star (+x in local space)
  ctx.strokeStyle = hexToRgba(THEME.accentGold, 0.45);
  ctx.lineWidth = Math.max(0.4, 0.65 * scale);
  ctx.beginPath();
  ctx.moveTo(spineW * 0.4, 0);
  ctx.lineTo(railLen - spineW * 0.3, 0);
  ctx.stroke();

  // Hazard modules along spine
  const moduleCount = 4;
  for (let i = 0; i < moduleCount; i++) {
    const mx = spineW * 0.8 + (i / (moduleCount - 1)) * (railLen * 0.55);
    const side = i % 2 === 0 ? 1 : -1;
    const my = side * spineH * 0.85;
    const modW = r * 0.07;
    const modH = r * 0.085;
    ctx.fillStyle = 'rgba(32, 36, 48, 0.95)';
    ctx.fillRect(mx - modW, my - modH, modW * 2, modH * 2);
    ctx.strokeStyle = '#d4a017';
    ctx.lineWidth = Math.max(0.45, 0.65 * scale);
    ctx.strokeRect(mx - modW, my - modH, modW * 2, modH * 2);
    ctx.fillStyle = '#d4a017';
    ctx.fillRect(mx - modW * 0.95, my - modH * 0.2, modW * 1.9, modH * 0.4);
    ctx.fillStyle = hexToRgba('#ff9a3c', (firing ? 0.9 : 0.35) * blink);
    ctx.beginPath();
    ctx.arc(mx, my + side * modH * 0.55, modW * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }

  // Checker calibration marker
  ctx.fillStyle = 'rgba(240, 240, 240, 0.85)';
  const cx = railLen * 0.35;
  const cs = r * 0.035;
  ctx.fillRect(cx, -cs, cs, cs);
  ctx.fillStyle = 'rgba(20, 20, 24, 0.9)';
  ctx.fillRect(cx + cs, -cs, cs, cs);
  ctx.fillRect(cx, 0, cs, cs);
  ctx.fillRect(cx + cs, 0, cs, cs);

  ctx.restore();
}

export function drawLaunchMuzzleFlash(ctx, site, scale, camera, canvas, worldToScreen) {
  if (!site.firing) return;
  const fade = 1 - (site.fireAge ?? 0) / LAUNCHER_BURST_MS;
  if (fade <= 0) return;

  const ms = worldToScreen(camera, site.muzzleX, site.muzzleY, canvas);
  const z = scale;

  ctx.save();
  ctx.translate(ms.x, ms.y);
  ctx.rotate(site.heading);

  ctx.shadowColor = '#ffd080';
  ctx.shadowBlur = 12 * fade * z;
  ctx.strokeStyle = `rgba(255, 220, 140, ${0.85 * fade})`;
  ctx.lineWidth = Math.max(1.5, 2.5 * z);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(LAUNCHER_WORLD_RADIUS * z * 1.15 * fade, 0);
  ctx.stroke();

  ctx.fillStyle = `rgba(255, 240, 180, ${0.7 * fade})`;
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(2, LAUNCHER_WORLD_RADIUS * z * 0.11 * fade), 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();
}
