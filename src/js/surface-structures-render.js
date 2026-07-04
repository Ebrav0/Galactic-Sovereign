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
