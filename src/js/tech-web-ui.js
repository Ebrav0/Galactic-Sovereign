// Technology web UI — horizontal DSP-style tree with icon tiles and path highlighting.

import {
  allTechNodes,
  derivedTier,
  isTechUnlocked,
  techNode,
  techPrereqsMet,
  isSpineTech,
} from './tech-web.js';
import {
  layoutHorizontalTree,
  ancestorChain,
  NODE_SIZE,
  SPINE_NODE_SIZE,
  TECH_LANE_ORDER,
  TECH_LANE_LABELS,
  LANE_BAND,
} from './tech-web-layout.js';
import { attachTechWebViewport } from './tech-web-viewport.js';

export const TECH_CLUSTERS = {
  spine: { label: 'Main Path', color: '#ffb44a', icon: '☀' },
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
  if (filters.cluster === 'spine') {
    if (!isSpineTech(node) && !node?.tags?.includes('spine')) return false;
  } else if (filters.cluster && node.cluster !== filters.cluster) {
    return false;
  }
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
  const fromHalf = (from.size ?? NODE_SIZE) / 2;
  const toHalf = (to.size ?? NODE_SIZE) / 2;
  const sx = from.x + fromHalf;
  const sy = from.y;
  const tx = to.x - toHalf;
  const ty = to.y;
  const mx = (sx + tx) / 2;
  return `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ty}, ${tx} ${ty}`;
}

function createBandLabels(svg, bandCenters) {
  const bandsG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  bandsG.setAttribute('class', 'tech-web-bands');
  const laneColors = {
    mil_capital: '#ff8a7a',
    mil_carrier: '#ff6a9a',
    mil_screen: '#ffb07a',
    mil_defense: '#ff7070',
    economy: '#ffd27a',
    trade: '#7aff9e',
    spine: '#ffb44a',
    research: '#7ad0ff',
    wormhole: '#b07adb',
    diplomacy: '#9ae6ff',
    flagship: '#ffe08a',
    sw_modes: '#ff4a6a',
  };
  for (const laneId of TECH_LANE_ORDER) {
    const band = LANE_BAND[laneId];
    const y = bandCenters.get(band) ?? 0;
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('class', `tech-web-band-label${laneId === 'spine' ? ' tech-web-band-label--spine' : ''}`);
    label.setAttribute('x', '12');
    label.setAttribute('y', String(y + 4));
    label.setAttribute('fill', laneColors[laneId] ?? '#888');
    label.textContent = TECH_LANE_LABELS[laneId] ?? laneId;
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
      const spineEdge = isSpineTech(prereqId) && isSpineTech(node.id);
      path.setAttribute('class', spineEdge ? 'tech-web-edge tech-web-edge--spine' : 'tech-web-edge');
      path.dataset.fromId = prereqId;
      path.dataset.toId = node.id;
      if (spineEdge) path.dataset.spine = '1';
      edgesG.appendChild(path);
    }
  }
  svg.appendChild(edgesG);

  const nodesG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  nodesG.setAttribute('class', 'tech-web-nodes');

  for (const node of nodes) {
    const pos = positions.get(node.id);
    if (!pos) continue;
    const cluster = TECH_CLUSTERS[node.cluster] ?? TECH_CLUSTERS.economy;
    const hidden = isNodeHidden(state, node.id);
    const filtered = !nodeMatchesFilters(state, node, summary, filters);
    const spine = isSpineTech(node);
    const size = pos.size ?? (spine ? SPINE_NODE_SIZE : NODE_SIZE);
    const half = size / 2;

    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', `tech-web-node tech-web-node--locked${spine ? ' tech-web-node--spine' : ''}`);
    g.setAttribute('transform', `translate(${pos.x}, ${pos.y})`);
    g.dataset.nodeId = node.id;
    g.dataset.cluster = node.cluster;
    if (spine) g.dataset.spine = '1';
    if (filtered) g.classList.add('tech-web-node--filtered');
    if (hidden) g.classList.add('tech-web-node--hidden');

    const tile = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    tile.setAttribute('class', 'tech-web-node__tile');
    tile.setAttribute('x', String(-half));
    tile.setAttribute('y', String(-half));
    tile.setAttribute('width', String(size));
    tile.setAttribute('height', String(size));
    tile.setAttribute('rx', spine ? '8' : '6');
    tile.setAttribute('stroke', spine ? '#ffb44a' : cluster.color);
    tile.setAttribute('stroke-width', spine ? '3' : '2');
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
    icon.textContent = hidden ? '?' : (spine ? '☀' : nodeIcon(node));
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
      : `${spine ? 'Main Path · ' : ''}${node.name} · ${costLabel(node)}`;
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
  const tracedId = opts.tracedNodeId ?? null;
  const focusId = tracedId || hoverId;
  const filters = opts.filters ?? { cluster: opts.clusterFilter ?? null };
  const tracing = !!focusId;
  const pathIds = tracing
    ? new Set(ancestorChain(focusId, techNode))
    : new Set(
      (state.research?.unlocked ?? []).filter((id) => id !== 'eco_baseline'),
    );

  const pathEdges = new Set();
  if (tracing) {
    const chain = ancestorChain(focusId, techNode);
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
    const isFocus = node.id === focusId;
    const filtered = !nodeMatchesFilters(state, node, summarySafe, filters);
    const dimmed = tracing && !onPath;

    g.setAttribute('class', [
      'tech-web-node',
      `tech-web-node--${status}`,
      isSpineTech(node) ? 'tech-web-node--spine' : '',
      onPath && tracing ? 'tech-web-node--path' : '',
      isFocus ? 'tech-web-node--traced' : '',
      dimmed ? 'tech-web-node--dimmed' : '',
      filtered ? 'tech-web-node--filtered' : '',
    ].filter(Boolean).join(' '));

    const tile = g.querySelector('.tech-web-node__tile');
    if (tile) {
      const spine = isSpineTech(node);
      if (isFocus) {
        tile.setAttribute('fill', '#3a2818');
        tile.setAttribute('stroke', '#ffe08a');
        tile.setAttribute('stroke-width', '4');
        tile.setAttribute('filter', 'url(#tech-glow)');
      } else if (onPath && tracing) {
        tile.setAttribute('fill', spine ? '#4a3018' : '#3a2818');
        tile.setAttribute('stroke', '#ff9a4a');
        tile.setAttribute('stroke-width', '3');
        tile.removeAttribute('filter');
      } else if (status === 'unlocked') {
        tile.setAttribute('fill', spine ? '#4a3018' : '#3a2818');
        tile.setAttribute('stroke', tracing ? '#6a5030' : '#ff9a4a');
        tile.setAttribute('stroke-width', spine ? '3' : '2');
        tile.removeAttribute('filter');
      } else if (status === 'active' || status === 'available' || status === 'queued') {
        tile.setAttribute('fill', '#142838');
        tile.setAttribute('stroke', spine ? '#ffb44a' : '#7ad0ff');
        tile.setAttribute('stroke-width', status === 'active' || spine ? '3' : '2');
        if (status === 'active') tile.setAttribute('filter', 'url(#tech-glow)');
        else tile.removeAttribute('filter');
      } else if (status === 'hidden') {
        tile.setAttribute('fill', '#121620');
        tile.setAttribute('stroke', '#3a4050');
        tile.removeAttribute('filter');
      } else {
        tile.setAttribute('fill', spine ? '#1a1810' : '#141820');
        tile.setAttribute('stroke', spine ? '#6a5030' : '#3a4555');
        if (spine) tile.setAttribute('stroke-width', '3');
        tile.removeAttribute('filter');
      }
    }

    const icon = g.querySelector('.tech-web-node__icon');
    if (icon) {
      icon.textContent = hidden ? '?' : nodeIcon(node);
      icon.setAttribute(
        'fill',
        isFocus || (onPath && tracing) || status === 'unlocked'
          ? '#ffb86a'
          : cluster.color,
      );
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

    g.style.cursor = 'pointer';
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
    let cls = path.dataset.spine === '1' ? 'tech-web-edge tech-web-edge--spine' : 'tech-web-edge';
    if (filtered) cls += ' tech-web-edge--filtered';
    if (onPath && tracing) cls += ' tech-web-edge--path tech-web-edge--traced';
    else if (onPath) cls += ' tech-web-edge--path';
    else if (tracing) cls += ' tech-web-edge--dimmed';
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
  let tracedNodeId = null;
  opts.filters = { cluster: opts.clusterFilter ?? null, ...(opts.filters ?? {}) };
  const graphOpts = () => ({
    filters: opts.filters,
    hoverNodeId,
    tracedNodeId,
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
      opts.onHoverNode?.(nodeId, { tracedNodeId });
    },
    onSelectNode: (nodeId) => {
      tracedNodeId = nodeId;
      updateTechWebGraph(svg, currentState, currentSummary, graphOpts());
      opts.onSelectNode?.(nodeId);
      opts.onHoverNode?.(nodeId ?? hoverNodeId, { tracedNodeId });
    },
  });
  createTechMinimap(graphHost, positions, nodes, width, height, () => {
    tracedNodeId = null;
    hoverNodeId = null;
    viewport.fitView();
    updateTechWebGraph(svg, currentState, currentSummary, graphOpts());
    opts.onHoverNode?.(null, { tracedNodeId: null });
  });

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
      tracedNodeId = nodeId;
      updateTechWebGraph(svg, currentState, currentSummary, graphOpts());
      viewport.fitBounds(nodeBounds(positions, nodeId), 90);
      opts.onSelectNode?.(nodeId);
      opts.onHoverNode?.(nodeId, { tracedNodeId });
      return true;
    },
    resetView: () => {
      hoverNodeId = null;
      tracedNodeId = null;
      viewport.fitView();
      updateTechWebGraph(svg, currentState, currentSummary, graphOpts());
      opts.onHoverNode?.(null, { tracedNodeId: null });
      opts.onSelectNode?.(null);
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
