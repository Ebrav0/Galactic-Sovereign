/** Shared Hull Forge morph params + weapon mount anchors (local draw-radius units). */

export function clampFlagshipHullStage(hullStage = 0) {
  return Math.max(0, Math.min(5, Math.round(Number(hullStage) || 0)));
}

export function flagshipHullMorph(hullStage = 0) {
  const stage = clampFlagshipHullStage(hullStage);
  const len = [1, 1.01, 1.02, 1.04, 1.06, 1.08][stage];
  const wid = [1, 1.01, 1.02, 1.03, 1.04, 1.05][stage];
  const noseLen = [1, 1.18, 1.4, 1.7, 2.05, 2.45][stage];
  const noseWid = [1, 1.04, 1.08, 1.12, 1.16, 1.22][stage];
  return {
    stage,
    len,
    wid,
    noseLen,
    noseWid,
    tipX: 2.35 * noseLen,
    aftX: -1.95 * len,
    beamY: 0.95 * wid,
  };
}

/** Upper half-width of the wedge hull at local x (draw-radius units). */
export function flagshipHullEdgeHalf(x, morph) {
  const m = morph ?? flagshipHullMorph(0);
  const pts = [
    [m.tipX, 0],
    [m.tipX - 0.55 * m.noseLen, 0.12 * m.noseWid],
    [1.55 * m.noseLen, 0.28 * m.noseWid],
    [0.55 * m.noseLen, 0.68 * m.noseWid],
    [-0.35 * m.len, m.beamY],
    [m.aftX, m.beamY * 0.92],
  ];
  if (x >= pts[0][0]) return pts[0][1];
  if (x <= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    if (x <= x0 && x >= x1) {
      const t = (x0 - x) / Math.max(1e-6, x0 - x1);
      return y0 + (y1 - y0) * t;
    }
  }
  return m.beamY;
}

/**
 * One mount per FLAGSHIP_WEAPON_SUITE id, seated on the hull for the given stage.
 * Coords are local draw-radius units (multiply by FLAGSHIP_RADIUS for world).
 */
export function flagshipHardpointAnchors(hullStage = 0) {
  const m = flagshipHullMorph(hullStage);
  const edge = (x) => flagshipHullEdgeHalf(x, m);
  const onEdge = (x, sideSign, inset = 0.88) => ({
    x,
    y: sideSign * edge(x) * inset,
  });

  const lanceX = m.tipX * 0.9;
  const torpedoX = Math.min(1.45 * m.noseLen, m.tipX * 0.68);
  const midX = 0.12 * m.len;
  const forePdX = 0.75 * Math.min(m.noseLen, 1.35);
  const aftPdX = -0.85 * m.len;
  const ionX = -0.15 * m.len;

  return [
    { id: 'primary_lance', ...{ x: lanceX, y: 0 }, scale: stageScale(m.stage, 1.05, 1.25), aim: 1 },
    { id: 'prow_torpedo', x: torpedoX, y: edge(torpedoX) * 0.22, scale: stageScale(m.stage, 0.95, 1.1), aim: 1 },
    { id: 'broadside_starboard', ...onEdge(midX, 1, 0.9), scale: stageScale(m.stage, 0.9, 1.05), aim: 0.55 },
    { id: 'broadside_port', ...onEdge(midX, -1, 0.9), scale: stageScale(m.stage, 0.9, 1.05), aim: 0.55 },
    { id: 'pd_grid_fore', ...onEdge(forePdX, -1, 0.82), scale: 0.8, aim: 0.45 },
    { id: 'pd_grid_aft', ...onEdge(aftPdX, 1, 0.85), scale: 0.8, aim: 0.45 },
    { id: 'ion_array', x: ionX, y: 0, scale: stageScale(m.stage, 0.85, 1), aim: 0.5 },
  ];
}

/** Extra trench/deck batteries for late Hull Forge stages — decorative + fire pulse only. */
export function flagshipDecorativeBatteries(hullStage = 0) {
  const m = flagshipHullMorph(hullStage);
  if (m.stage < 3) return [];
  const edge = (x) => flagshipHullEdgeHalf(x, m);
  const bats = [];
  const trenchXs = [0.9 * m.noseLen, 0.35 * m.len, -0.45 * m.len];
  for (const x of trenchXs) {
    for (const side of [-1, 1]) {
      bats.push({
        x,
        y: side * edge(x) * 0.72,
        scale: 0.7,
        ids: side > 0 ? ['broadside_starboard', 'pd_grid_fore'] : ['broadside_port', 'pd_grid_aft'],
        aim: 0.4,
      });
    }
  }
  if (m.stage >= 4) {
    const noseBatX = Math.min(1.9 * m.noseLen, m.tipX * 0.78);
    bats.push({
      x: noseBatX,
      y: 0,
      scale: 1.05,
      ids: ['primary_lance', 'prow_torpedo'],
      aim: 0.85,
    });
  }
  if (m.stage >= 5) {
    for (const side of [-1, 1]) {
      const x = -1.35 * m.len;
      bats.push({
        x,
        y: side * edge(x) * 0.78,
        scale: 0.85,
        ids: ['ion_array'],
        aim: 0.45,
      });
    }
  }
  return bats;
}

function stageScale(stage, lo, hi) {
  return lo + (hi - lo) * (stage / 5);
}
