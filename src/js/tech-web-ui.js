// Technology web UI — horizontal DSP-style tree with icon tiles and path highlighting.

import {
  allTechNodes,
  derivedTier,
  isTechUnlocked,
  techNode,
  techPrereqsMet,
} from './tech-web.js';
import {
  layoutHorizontalTree,
  ancestorChain,
  NODE_SIZE,
  CLUSTER_BAND,
  TECH_CLUSTER_ORDER,
} from './tech-web-layout.js';
import { attachTechWebViewport } from './tech-web-viewport.js';

export const TECH_CLUSTERS = {
  economy: { label: 'Economy', color: '#ffd27a', icon: '◈' },
  military: { label: 'Military', color: '#ff7a7a', icon: '✦' },
  megastructure: { label: 'Dyson', color: '#ff9a4a', icon: '☀' },
  trade: { label: 'Trade', color: '#7aff9e', icon: '⇄' },
  wormhole: { label: 'Wormhole', color: '#b07adb', icon: '◎' },
  research: { label: 'Research', color: '#7ad0ff', icon: '⚗' },
  diplomacy: { label: 'Diplomacy', color: '#9ae6ff', icon: '☮' },
  superweapon: { label: 'Superweapon', color: '#ff4a6a', icon: '✸' },
  flagship: { label: 'Flagship', color: '#ffe08a', icon: '★' },
};

/** Infer display icon from node effect/category. */
function nodeIcon(node) {
  const fx = [node.effect, ...(node.effects ?? []).map((effect) => effect.type ?? effect.effect ?? '')]
    .filter(Boolean)
    .join(' ');
  if (fx.includes('frigate') || fx.includes('corvette') || fx.includes('carrier') || fx.includes('cruiser') || fx.includes('battleship') || fx.includes('dreadnought') || fx.includes('patrol') || fx.includes('sensor') || fx.includes('builder_ship') || fx.includes('command') || fx.includes('healer') || fx.includes('miner_hull')) return '▲';
  if (fx.includes('foundry') || fx.includes('launcher') || fx.includes('solarii') || fx.includes('shell')) return '☀';
  if (fx.includes('trade') || fx.includes('hauler') || fx.includes('freighter') || fx.includes('convoy')) return '⇄';
  if (fx.includes('research') || fx.includes('lab')) return '⚗';
  if (fx.includes('wormhole') || fx.includes('anchor') || fx.includes('intel')) return '◎';
  if (fx.includes('unlock_trade') || fx.includes('outpost') || fx.includes('credit')) return '◈';
  return TECH_CLUSTERS[node.cluster]?.icon ?? '●';
}

function nodeState(state, nodeId, summary) {
  if (isTechUnlocked(state, nodeId)) return 'unlocked';
  if (summary.activeNodeId === nodeId) return 'active';
  if (summary.queue.includes(nodeId)) return 'queued';
  if (techPrereqsMet(state, nodeId)) return 'available';
  return 'locked';
}

function isNodeHidden(state, nodeId) {
  const node = techNode(nodeId);
  if (!node || node.id === 'eco_baseline') return false;
  if (isTechUnlocked(state, nodeId)) return false;
  if (techPrereqsMet(state, nodeId)) return false;
  for (const p of node.prereqs) {
    if (!isTechUnlocked(state, p) && !techPrereqsMet(state, p)) return true;
  }
  return false;
}

function nodeSearchText(node) {
  return [
    node.id,
    node.name,
    node.description,
    node.cluster,
    node.effect,
    ...(node.tags ?? []),
    ...(node.unlocks ?? []),
    ...(node.effects ?? []).flatMap((effect) => [effect.type, effect.target, effect.label]),
  ].filter(Boolean).join(' ').toLowerCase();
}

function nodeMatchesFilters(state, node, summary, filters = {}) {
  if (filters.cluster && node.cluster !== filters.cluster) return false;
  if (filters.tier && derivedTier(node.id) !== Number(filters.tier)) return false;
  const status = isNodeHidden(state, node.id) ? 'hidden' : nodeState(state, node.id, summary);
  if (filters.state && status !== filters.state) return false;
  const query = String(filters.query ?? '').trim().toLowerCase();
  return !query || nodeSearchText(node).includes(query);
}

function costLabel(node) {
  const parts = [];
  if (node.creditCost) parts.push(`${node.creditCost} cr`);
  if (node.solariiCost) parts.push(`${node.solariiCost} SO`);
  return parts.length ? parts.join(' + ') : 'Free';
}

function edgeCurve(from, to) {
  const half = NODE_SIZE / 2;
  const sx = from.x + half;
  const sy = from.y;
  const tx = to.x - half;
  const ty = to.y;
  const mx = (sx + tx) / 2;
  return `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ty}, ${tx} ${ty}`;
}

function createBandLabels(svg, bandCenters) {
  const bandsG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  bandsG.setAttribute('class', 'tech-web-bands');
  for (const clusterId of TECH_CLUSTER_ORDER) {
    const band = CLUSTER_BAND[clusterId];
    const y = bandCenters.get(band) ?? 0;
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('class', 'tech-web-band-label');
    label.setAttribute('x', '12');
    label.setAttribute('y', String(y + 4));
    const meta = TECH_CLUSTERS[clusterId] ?? null;
    label.setAttribute('fill', meta?.color ?? '#888');
    label.textContent = meta?.label ?? '';
    bandsG.appendChild(label);
  }
  svg.appendChild(bandsG);
}

function buildSvgGraph(state, summary, opts = {}) {
  const nodes = allTechNodes();
  const { positions, width, height, bandCenters } = layoutHorizontalTree(nodes);
  const filters = opts.filters ?? { cluster: opts.clusterFilter ?? null };

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'tech-web-graph');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Technology tree');
  svg.dataset.graphWidth = String(width);
  svg.dataset.graphHeight = String(height);

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const glow = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
  glow.setAttribute('id', 'tech-glow');
  glow.innerHTML = '<feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>';
  defs.appendChild(glow);
  svg.appendChild(defs);

  createBandLabels(svg, bandCenters);

  const edgesG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  edgesG.setAttribute('class', 'tech-web-edges');

  for (const node of nodes) {
    const to = positions.get(node.id);
    if (!to) continue;
    for (const prereqId of node.prereqs) {
      const from = positions.get(prereqId);
      if (!from) continue;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', edgeCurve(from, to));
      path.setAttribute('class', 'tech-web-edge');
      path.dataset.fromId = prereqId;
      path.dataset.toId = node.id;
      edgesG.appendChild(path);
    }
  }
  svg.appendChild(edgesG);

  const nodesG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  nodesG.setAttribute('class', 'tech-web-nodes');

  const half = NODE_SIZE / 2;

  for (const node of nodes) {
    const pos = positions.get(node.id);
    if (!pos) continue;
    const cluster = TECH_CLUSTERS[node.cluster] ?? TECH_CLUSTERS.economy;
    const hidden = isNodeHidden(state, node.id);
    const filtered = !nodeMatchesFilters(state, node, summary, filters);

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'tech-web-node tech-web-node--locked');
    g.setAttribute('transform', `translate(${pos.x}, ${pos.y})`);
    g.dataset.nodeId = node.id;
    g.dataset.cluster = node.cluster;
    if (filtered) g.classList.add('tech-web-node--filtered');
    if (hidden) g.classList.add('tech-web-node--hidden');

    const tile = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    tile.setAttribute('class', 'tech-web-node__tile');
    tile.setAttribute('x', String(-half));
    tile.setAttribute('y', String(-half));
    tile.setAttribute('width', String(NODE_SIZE));
    tile.setAttribute('height', String(NODE_SIZE));
    tile.setAttribute('rx', '6');
    tile.setAttribute('stroke', cluster.color);
    tile.setAttribute('stroke-width', '2');
    g.appendChild(tile);

    const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    ring.setAttribute('class', 'tech-web-node__progress');
    ring.setAttribute('r', String(half + 4));
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', '#7ad0ff');
    ring.setAttribute('stroke-width', '3');
    ring.setAttribute('stroke-dasharray', '0 999');
    ring.setAttribute('transform', 'rotate(-90)');
    ring.style.display = 'none';
    g.appendChild(ring);

    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    icon.setAttribute('class', 'tech-web-node__icon');
    icon.setAttribute('y', '5');
    icon.setAttribute('text-anchor', 'middle');
    icon.textContent = hidden ? '?' : nodeIcon(node);
    g.appendChild(icon);

    const pct = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    pct.setAttribute('class', 'tech-web-node__pct');
    pct.setAttribute('y', '18');
    pct.setAttribute('text-anchor', 'middle');
    pct.style.display = 'none';
    g.appendChild(pct);

    const name = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    name.setAttribute('class', 'tech-web-node__name');
    name.setAttribute('y', String(half + 14));
    name.setAttribute('text-anchor', 'middle');
    const shortName = node.name.length > 16 ? `${node.name.slice(0, 14)}…` : node.name;
    name.textContent = hidden ? 'Unknown' : shortName;
    g.appendChild(name);

    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = hidden
      ? 'Unknown technology'
      : `${node.name} · ${costLabel(node)}`;
    g.appendChild(title);

    nodesG.appendChild(g);
  }
  svg.appendChild(nodesG);

  updateTechWebGraph(svg, state, summary, opts);
  return { svg, positions, width, height };
}

/**
 * Patch node/edge visual state on an existing SVG graph.
 */
export function updateTechWebGraph(svg, state, summary, opts = {}) {
  const nodes = allTechNodes();
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const summarySafe = summary ?? { activeNodeId: null, queue: [], progress: 0 };
  const hoverId = opts.hoverNodeId ?? null;
  const filters = opts.filters ?? { cluster: opts.clusterFilter ?? null };
  const pathIds = hoverId
    ? new Set(ancestorChain(hoverId, techNode))
    : new Set(
      (state.research?.unlocked ?? []).filter((id) => id !== 'eco_baseline'),
    );

  const pathEdges = new Set();
  if (hoverId) {
    const chain = ancestorChain(hoverId, techNode);
    for (let i = 1; i < chain.length; i++) {
      pathEdges.add(`${chain[i - 1]}->${chain[i]}`);
    }
  } else {
    for (const node of nodes) {
      if (!isTechUnlocked(state, node.id)) continue;
      for (const p of node.prereqs) {
        if (isTechUnlocked(state, p)) pathEdges.add(`${p}->${node.id}`);
      }
    }
  }

  const circumference = 2 * Math.PI * (NODE_SIZE / 2 + 4);

  for (const node of nodes) {
    const g = svg.querySelector(`.tech-web-node[data-node-id="${node.id}"]`);
    if (!g) continue;
    const cluster = TECH_CLUSTERS[node.cluster] ?? TECH_CLUSTERS.economy;
    const hidden = isNodeHidden(state, node.id);
    const status = hidden ? 'hidden' : nodeState(state, node.id, summarySafe);
    const onPath = pathIds.has(node.id);
    const filtered = !nodeMatchesFilters(state, node, summarySafe, filters);

    g.setAttribute('class', [
      'tech-web-node',
      `tech-web-node--${status}`,
      onPath ? 'tech-web-node--path' : '',
      filtered ? 'tech-web-node--filtered' : '',
    ].filter(Boolean).join(' '));

    const tile = g.querySelector('.tech-web-node__tile');
    if (tile) {
      if (status === 'unlocked' || onPath) {
        tile.setAttribute('fill', '#3a2818');
        tile.setAttribute('stroke', '#ff9a4a');
        tile.setAttribute('stroke-width', onPath ? '3' : '2');
      } else if (status === 'active' || status === 'available' || status === 'queued') {
        tile.setAttribute('fill', '#142838');
        tile.setAttribute('stroke', '#7ad0ff');
        tile.setAttribute('stroke-width', status === 'active' ? '3' : '2');
      } else if (status === 'hidden') {
        tile.setAttribute('fill', '#121620');
        tile.setAttribute('stroke', '#3a4050');
      } else {
        tile.setAttribute('fill', '#141820');
        tile.setAttribute('stroke', '#3a4555');
      }
      if (status === 'active') tile.setAttribute('filter', 'url(#tech-glow)');
      else tile.removeAttribute('filter');
    }

    const icon = g.querySelector('.tech-web-node__icon');
    if (icon) {
      icon.textContent = hidden ? '?' : nodeIcon(node);
      icon.setAttribute('fill', status === 'unlocked' || onPath ? '#ffb86a' : cluster.color);
    }

    const ring = g.querySelector('.tech-web-node__progress');
    const pct = g.querySelector('.tech-web-node__pct');
    if (status === 'active' && ring && pct) {
      const prog = summarySafe.progress ?? 0;
      ring.style.display = '';
      pct.style.display = '';
      ring.setAttribute('stroke-dasharray', `${prog * circumference} ${circumference}`);
      pct.textContent = `${Math.round(prog * 100)}%`;
    } else if (ring && pct) {
      ring.style.display = 'none';
      pct.style.display = 'none';
    }

    const nameEl = g.querySelector('.tech-web-node__name');
    if (nameEl && !hidden) {
      const shortName = node.name.length > 16 ? `${node.name.slice(0, 14)}…` : node.name;
      nameEl.textContent = shortName;
    }

    if (status === 'available') g.style.cursor = 'pointer';
    else g.style.cursor = '';
  }

  for (const path of svg.querySelectorAll('.tech-web-edge')) {
    const fromId = path.dataset.fromId;
    const toId = path.dataset.toId;
    const fromNode = nodeById.get(fromId);
    const toNode = nodeById.get(toId);
    const key = `${fromId}->${toId}`;
    const bothUnlocked = isTechUnlocked(state, fromId) && isTechUnlocked(state, toId);
    const onPath = pathEdges.has(key);
    const filtered = !nodeMatchesFilters(state, fromNode, summarySafe, filters)
      && !nodeMatchesFilters(state, toNode, summarySafe, filters);
    let cls = 'tech-web-edge';
    if (filtered) cls += ' tech-web-edge--filtered';
    if (onPath) cls += ' tech-web-edge--path';
    else if (bothUnlocked) cls += ' tech-web-edge--lit';
    path.setAttribute('class', cls);
  }
}

function nodeBounds(positions, nodeId, padding = 38) {
  const pos = positions.get(nodeId);
  if (!pos) return null;
  const half = NODE_SIZE / 2 + padding;
  return { x1: pos.x - half, y1: pos.y - half, x2: pos.x + half, y2: pos.y + half };
}

function createTechMinimap(host, positions, nodes, width, height, onReset) {
  const mini = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  mini.setAttribute('class', 'tech-web-minimap');
  mini.setAttribute('viewBox', `0 0 ${width} ${height}`);
  mini.setAttribute('role', 'button');
  mini.setAttribute('aria-label', 'Technology web minimap; click to fit the full web');
  mini.tabIndex = 0;
  const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  background.setAttribute('width', String(width));
  background.setAttribute('height', String(height));
  background.setAttribute('rx', '18');
  background.setAttribute('class', 'tech-web-minimap__background');
  mini.appendChild(background);
  for (const node of nodes) {
    const pos = positions.get(node.id);
    if (!pos) continue;
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('cx', String(pos.x));
    dot.setAttribute('cy', String(pos.y));
    dot.setAttribute('r', String(Math.max(8, NODE_SIZE * 0.16)));
    dot.setAttribute('fill', TECH_CLUSTERS[node.cluster]?.color ?? '#7ad0ff');
    dot.setAttribute('class', 'tech-web-minimap__node');
    mini.appendChild(dot);
  }
  mini.addEventListener('click', onReset);
  mini.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onReset();
    }
  });
  host.appendChild(mini);
  return mini;
}

function clusterBounds(positions, nodes, clusterId) {
  if (!clusterId) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  const half = NODE_SIZE / 2;
  for (const node of nodes) {
    if (node.cluster !== clusterId) continue;
    const pos = positions.get(node.id);
    if (!pos) continue;
    x1 = Math.min(x1, pos.x - half);
    y1 = Math.min(y1, pos.y - half);
    x2 = Math.max(x2, pos.x + half);
    y2 = Math.max(y2, pos.y + half);
  }
  return Number.isFinite(x1) ? { x1, y1, x2, y2 } : null;
}

export function researchSnapshotKey(summary) {
  const unlocked = (summary.unlocked ?? []).slice().sort().join(',');
  const queue = (summary.queue ?? []).slice().join(',');
  return `${unlocked}|${summary.activeNodeId ?? ''}|${queue}|${Math.round((summary.progress ?? 0) * 1000)}`;
}

/**
 * Mount an SVG tech web into `container` with pan/zoom viewport.
 */
export function mountTechWebGraph(container, state, opts = {}) {
  const summary = opts.summary ?? { activeNodeId: null, queue: [], progress: 0 };
  container.innerHTML = '';
  container.className = 'tech-web-mount';

  const graphHost = document.createElement('div');
  graphHost.className = 'tech-web-graph-host';
  container.appendChild(graphHost);

  let hoverNodeId = null;
  opts.filters = { cluster: opts.clusterFilter ?? null, ...(opts.filters ?? {}) };
  const graphOpts = () => ({
    filters: opts.filters,
    hoverNodeId,
  });

  const { svg, positions, width, height } = buildSvgGraph(state, summary, graphOpts());
  const nodes = allTechNodes();
  let currentState = state;
  let currentSummary = summary;

  const viewport = attachTechWebViewport(graphHost, svg, {
    graphWidth: width,
    graphHeight: height,
    onResearch: opts.onResearch,
    onHoverNode: (nodeId) => {
      hoverNodeId = nodeId;
      updateTechWebGraph(svg, currentState, currentSummary, graphOpts());
      opts.onHoverNode?.(nodeId);
    },
  });
  createTechMinimap(graphHost, positions, nodes, width, height, viewport.fitView);

  return {
    svg,
    viewport,
    fitView: viewport.fitView,
    setClusterFilter: (filter) => {
      opts.clusterFilter = filter;
      opts.filters = { ...opts.filters, cluster: filter };
      updateTechWebGraph(svg, currentState, currentSummary, graphOpts());
      if (filter) viewport.fitBounds(clusterBounds(positions, nodes, filter));
      else viewport.fitView();
    },
    setFilters: (filters = {}) => {
      opts.filters = { ...opts.filters, ...filters };
      opts.clusterFilter = opts.filters.cluster ?? null;
      updateTechWebGraph(svg, currentState, currentSummary, graphOpts());
    },
    focusNode: (nodeId) => {
      if (!positions.has(nodeId)) return false;
      hoverNodeId = nodeId;
      updateTechWebGraph(svg, currentState, currentSummary, graphOpts());
      viewport.fitBounds(nodeBounds(positions, nodeId), 90);
      opts.onHoverNode?.(nodeId);
      return true;
    },
    resetView: () => {
      hoverNodeId = null;
      viewport.fitView();
      updateTechWebGraph(svg, currentState, currentSummary, graphOpts());
      opts.onHoverNode?.(null);
    },
    refresh: (st, sum) => {
      currentState = st;
      currentSummary = sum;
      updateTechWebGraph(svg, st, sum, graphOpts());
    },
  };
}

/** Tier label for detail panel. */
export function tierRoman(nodeId) {
  return String(derivedTier(nodeId));
}
