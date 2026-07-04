// Technology web graph UI — cluster layout, tier labels, prerequisite edges (GDD §10).

import {
  allTechNodes,
  derivedTier,
  isTechUnlocked,
  techNode,
  techPrereqsMet,
} from './tech-web.js';

export const TECH_CLUSTERS = {
  economy: { label: 'Economy', color: '#ffd27a' },
  military: { label: 'Military', color: '#ff7a7a' },
  megastructure: { label: 'Megastructure', color: '#ff9a4a' },
  trade: { label: 'Trade', color: '#7aff9e' },
  wormhole: { label: 'Wormhole', color: '#b07adb' },
  research: { label: 'Research', color: '#7ad0ff' },
};

const ROMAN = [
  [15, 'XV'], [14, 'XIV'], [13, 'XIII'], [12, 'XII'], [11, 'XI'], [10, 'X'],
  [9, 'IX'], [8, 'VIII'], [7, 'VII'], [6, 'VI'], [5, 'V'], [4, 'IV'],
  [3, 'III'], [2, 'II'], [1, 'I'],
];

export function tierRoman(nodeId) {
  const tier = derivedTier(nodeId);
  for (const [n, label] of ROMAN) {
    if (tier === n) return label;
  }
  return String(tier);
}

/** Cluster anchor positions in graph space (viewBox 0 0 1200 720). */
const CLUSTER_ANCHORS = {
  economy: { x: 180, y: 160 },
  military: { x: 600, y: 80 },
  megastructure: { x: 1020, y: 160 },
  trade: { x: 180, y: 560 },
  wormhole: { x: 600, y: 640 },
  research: { x: 1020, y: 560 },
};

const HUB = { x: 600, y: 360 };
const NODE_R = 28;

function layoutByCluster(nodes) {
  const positions = new Map();
  positions.set('eco_baseline', { ...HUB });

  const byCluster = {};
  for (const node of nodes) {
    if (node.id === 'eco_baseline') continue;
    if (!byCluster[node.cluster]) byCluster[node.cluster] = [];
    byCluster[node.cluster].push(node);
  }

  for (const [cluster, clusterNodes] of Object.entries(byCluster)) {
    const anchor = CLUSTER_ANCHORS[cluster] ?? { x: 600, y: 360 };
    const byTier = {};
    for (const node of clusterNodes) {
      const tier = derivedTier(node.id);
      if (!byTier[tier]) byTier[tier] = [];
      byTier[tier].push(node);
    }

    for (const [tierStr, tierNodes] of Object.entries(byTier)) {
      const tier = Number(tierStr);
      tierNodes.sort((a, b) => a.id.localeCompare(b.id));
      const count = tierNodes.length;
      tierNodes.forEach((node, idx) => {
        const spreadX = (idx - (count - 1) / 2) * (NODE_R * 2.4 + 12);
        positions.set(node.id, {
          x: anchor.x + spreadX,
          y: anchor.y + (tier - 2) * (NODE_R * 2.2 + 16),
        });
      });
    }
  }

  return positions;
}

function nodeState(state, nodeId, summary) {
  if (isTechUnlocked(state, nodeId)) return 'unlocked';
  if (summary.activeNodeId === nodeId) return 'active';
  if (summary.queue.includes(nodeId)) return 'queued';
  if (techPrereqsMet(state, nodeId)) return 'available';
  return 'locked';
}

function costLabel(node) {
  const parts = [];
  if (node.creditCost) parts.push(`${node.creditCost} cr`);
  if (node.solariiCost) parts.push(`${node.solariiCost} SO`);
  return parts.length ? parts.join(' + ') : 'Free';
}

/**
 * Mount an SVG tech web into `container`.
 * @param {HTMLElement} container
 * @param {object} state
 * @param {{ onResearch?: (nodeId: string) => void, summary?: object }} opts
 */
export function mountTechWebGraph(container, state, opts = {}) {
  const summary = opts.summary ?? { activeNodeId: null, queue: [], progress: 0 };
  const nodes = allTechNodes();
  const positions = layoutByCluster(nodes);

  container.innerHTML = '';
  container.className = 'tech-web-mount';

  const wrap = document.createElement('div');
  wrap.className = 'tech-web-scroll';

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'tech-web-graph');
  svg.setAttribute('viewBox', '0 0 1200 720');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Technology web');

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const glow = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
  glow.setAttribute('id', 'tech-glow');
  glow.innerHTML = '<feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>';
  defs.appendChild(glow);
  svg.appendChild(defs);

  // Cluster region labels
  for (const [clusterId, meta] of Object.entries(TECH_CLUSTERS)) {
    const anchor = CLUSTER_ANCHORS[clusterId];
    if (!anchor) continue;
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('class', 'tech-web-cluster-label');
    label.setAttribute('x', String(anchor.x));
    label.setAttribute('y', String(anchor.y - 52));
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('fill', meta.color);
    label.textContent = meta.label;
    svg.appendChild(label);
  }

  const edgesG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  edgesG.setAttribute('class', 'tech-web-edges');

  for (const node of nodes) {
    const to = positions.get(node.id);
    if (!to) continue;
    for (const prereqId of node.prereqs) {
      const from = positions.get(prereqId);
      if (!from) continue;
      const unlocked = isTechUnlocked(state, node.id) && isTechUnlocked(state, prereqId);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(from.x));
      line.setAttribute('y1', String(from.y));
      line.setAttribute('x2', String(to.x));
      line.setAttribute('y2', String(to.y));
      line.setAttribute('class', `tech-web-edge${unlocked ? ' tech-web-edge--lit' : ''}`);
      edgesG.appendChild(line);
    }
  }
  svg.appendChild(edgesG);

  const nodesG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  nodesG.setAttribute('class', 'tech-web-nodes');

  for (const node of nodes) {
    const pos = positions.get(node.id);
    if (!pos) continue;
    const cluster = TECH_CLUSTERS[node.cluster] ?? TECH_CLUSTERS.economy;
    const status = nodeState(state, node.id, summary);
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', `tech-web-node tech-web-node--${status}`);
    g.setAttribute('transform', `translate(${pos.x}, ${pos.y})`);
    g.dataset.nodeId = node.id;

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('r', String(NODE_R));
    circle.setAttribute('class', 'tech-web-node__circle');
    circle.setAttribute('fill', status === 'locked' ? 'rgba(18, 24, 38, 0.92)' : `${cluster.color}22`);
    circle.setAttribute('stroke', cluster.color);
    circle.setAttribute('stroke-width', status === 'active' ? '3' : '2');
    if (status === 'active') circle.setAttribute('filter', 'url(#tech-glow)');
    g.appendChild(circle);

    const tier = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    tier.setAttribute('class', 'tech-web-node__tier');
    tier.setAttribute('y', '-4');
    tier.setAttribute('text-anchor', 'middle');
    tier.textContent = tierRoman(node.id);
    g.appendChild(tier);

    const name = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    name.setAttribute('class', 'tech-web-node__name');
    name.setAttribute('y', '10');
    name.setAttribute('text-anchor', 'middle');
    const shortName = node.name.length > 14 ? `${node.name.slice(0, 12)}…` : node.name;
    name.textContent = shortName;
    g.appendChild(name);

    if (status === 'unlocked') {
      const mark = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      mark.setAttribute('class', 'tech-web-node__done');
      mark.setAttribute('y', '22');
      mark.setAttribute('text-anchor', 'middle');
      mark.textContent = '✓';
      g.appendChild(mark);
    }

    if (status === 'available' && opts.onResearch) {
      g.style.cursor = 'pointer';
      g.addEventListener('click', () => opts.onResearch(node.id));
    }

    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = `${node.name} · Tier ${tierRoman(node.id)} · ${costLabel(node)}`;
    g.appendChild(title);

    nodesG.appendChild(g);
  }
  svg.appendChild(nodesG);

  wrap.appendChild(svg);
  container.appendChild(wrap);

  return { positions, svg };
}
