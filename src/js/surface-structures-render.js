// Canvas draw helpers for surface landing pads and moon mining rigs.

export function drawLandingPad(ctx, x, y, heading, scale, opts = {}) {
  const r = 6 * scale;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  ctx.strokeStyle = opts.active ? 'rgba(111, 214, 255, 0.85)' : 'rgba(126, 145, 186, 0.45)';
  ctx.lineWidth = Math.max(0.8, 1.2 * scale);
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

export function drawMiningRig(ctx, x, y, heading, scale, opts = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(heading);
  ctx.strokeStyle = opts.active ? 'rgba(255, 207, 122, 0.8)' : 'rgba(126, 145, 186, 0.5)';
  ctx.lineWidth = Math.max(0.8, 1.1 * scale);
  ctx.beginPath();
  ctx.moveTo(0, 4 * scale);
  ctx.lineTo(0, -8 * scale);
  ctx.stroke();
  if (opts.active) {
    ctx.fillStyle = 'rgba(255, 180, 80, 0.7)';
    ctx.beginPath();
    ctx.arc(0, -8 * scale, 1.5 * scale, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
