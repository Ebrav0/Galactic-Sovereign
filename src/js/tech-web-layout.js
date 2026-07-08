// Horizontal left-to-right tech tree layout (DSP-inspired DAG columns).

import { derivedTier } from './tech-web.js';

/** Vertical band per cluster — branches spread horizontally by tier. */
export const TECH_CLUSTER_ORDER = [
  'economy',
  'military',
  'megastructure',
  'trade',
  'wormhole',
  'research',
  'diplomacy',
  'superweapon',
  'flagship',
];

export const CLUSTER_BAND = Object.fromEntries(
  TECH_CLUSTER_ORDER.map((clusterId, index) => [clusterId, index]),
);

export const NODE_SIZE = 52;
export const COL_WIDTH = 220;
export const BAND_HEIGHT = 120;
export const NODE_GAP = 12;
export const PADDING_X = 120;
export const PADDING_Y = 64;

/**
 * Lay out nodes in tier columns left-to-right, grouped vertically by cluster band.
 * @param {Array<{ id: string, cluster: string }>} nodes
 * @returns {{ positions: Map<string, {x:number,y:number}>, width: number, height: number, bandCenters: Map<number, number> }}
 */
export function layoutHorizontalTree(nodes) {
  const positions = new Map();
  const byCol = new Map();

  for (const node of nodes) {
    const col = Math.max(0, derivedTier(node.id) - 1);
    if (!byCol.has(col)) byCol.set(col, []);
    byCol.get(col).push(node);
  }

  let maxCol = 0;
  const bandMaxStack = {};

  for (const [col, colNodes] of byCol.entries()) {
    maxCol = Math.max(maxCol, col);
    for (const node of colNodes) {
      const band = CLUSTER_BAND[node.cluster] ?? 0;
      const key = `${col}:${band}`;
      bandMaxStack[key] = (bandMaxStack[key] ?? 0) + 1;
    }
  }

  const bandHeights = {};
  for (const band of TECH_CLUSTER_ORDER.map((clusterId) => CLUSTER_BAND[clusterId])) {
    let maxStack = 1;
    for (const [key, count] of Object.entries(bandMaxStack)) {
      if (Number(key.split(':')[1]) === band) maxStack = Math.max(maxStack, count);
    }
    bandHeights[band] = Math.max(BAND_HEIGHT, maxStack * (NODE_SIZE + NODE_GAP) + 28);
  }

  const bandCenters = new Map();
  let accY = PADDING_Y;
  for (const band of TECH_CLUSTER_ORDER.map((clusterId) => CLUSTER_BAND[clusterId])) {
    bandCenters.set(band, accY + bandHeights[band] / 2);
    accY += bandHeights[band];
  }
  const totalHeight = accY + PADDING_Y;

  for (const [col, colNodes] of [...byCol.entries()].sort((a, b) => a[0] - b[0])) {
    colNodes.sort((a, b) => {
      const ba = CLUSTER_BAND[a.cluster] ?? 0;
      const bb = CLUSTER_BAND[b.cluster] ?? 0;
      if (ba !== bb) return ba - bb;
      return a.id.localeCompare(b.id);
    });

    const bandCount = {};
    for (const node of colNodes) {
      const band = CLUSTER_BAND[node.cluster] ?? 0;
      bandCount[band] = (bandCount[band] ?? 0) + 1;
    }

    const bandIdx = {};
    for (const node of colNodes) {
      const band = CLUSTER_BAND[node.cluster] ?? 0;
      const idx = bandIdx[band] ?? 0;
      bandIdx[band] = idx + 1;
      const count = bandCount[band];
      const x = PADDING_X + col * COL_WIDTH + NODE_SIZE / 2;
      const spread = (idx - (count - 1) / 2) * (NODE_SIZE + NODE_GAP);
      const y = bandCenters.get(band) + spread;
      positions.set(node.id, { x, y });
    }
  }

  const width = PADDING_X * 2 + maxCol * COL_WIDTH + NODE_SIZE;
  return { positions, width, height: totalHeight, bandCenters };
}

/** All ancestor node ids from root toward `nodeId`. */
export function ancestorChain(nodeId, getNode) {
  const chain = [];
  const seen = new Set();
  function walk(id) {
    if (!id || seen.has(id)) return;
    seen.add(id);
    const node = getNode(id);
    if (!node) return;
    for (const p of node.prereqs) walk(p);
    chain.push(id);
  }
  walk(nodeId);
  return chain;
}
