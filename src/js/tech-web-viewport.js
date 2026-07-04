// Pan/zoom viewport for the full-screen technology web SVG.

export const GRAPH_WIDTH = 1200;
export const GRAPH_HEIGHT = 720;

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 1.12;
const DRAG_THRESHOLD_PX = 5;

function clampZoom(z) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/**
 * Attach pan/zoom interaction to an SVG inside `container`.
 * @param {HTMLElement} container
 * @param {SVGSVGElement} svg
 * @param {{ onResearch?: (nodeId: string) => void, onHoverNode?: (nodeId: string | null) => void }} opts
 */
export function attachTechWebViewport(container, svg, opts = {}) {
  const viewport = document.createElement('div');
  viewport.className = 'tech-web-viewport';
  container.innerHTML = '';
  container.appendChild(viewport);
  viewport.appendChild(svg);

  let panX = 0;
  let panY = 0;
  let zoom = 1;

  let pointerDown = false;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;
  let pendingNodeId = null;

  function applyViewBox() {
    const w = GRAPH_WIDTH / zoom;
    const h = GRAPH_HEIGHT / zoom;
    svg.setAttribute('viewBox', `${panX} ${panY} ${w} ${h}`);
  }

  function fitView() {
    panX = 0;
    panY = 0;
    zoom = 1;
    applyViewBox();
  }

  function clientToGraph(clientX, clientY) {
    const rect = svg.getBoundingClientRect();
    const w = GRAPH_WIDTH / zoom;
    const h = GRAPH_HEIGHT / zoom;
    const gx = panX + ((clientX - rect.left) / rect.width) * w;
    const gy = panY + ((clientY - rect.top) / rect.height) * h;
    return { gx, gy };
  }

  function nodeAt(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    const nodeG = el?.closest?.('.tech-web-node');
    return nodeG?.dataset?.nodeId ?? null;
  }

  viewport.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    pointerDown = true;
    dragging = false;
    startX = lastX = e.clientX;
    startY = lastY = e.clientY;
    pendingNodeId = nodeAt(e.clientX, e.clientY);
    viewport.setPointerCapture(e.pointerId);
  });

  viewport.addEventListener('pointermove', (e) => {
    if (!pointerDown) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    if (!dragging) {
      const totalDx = e.clientX - startX;
      const totalDy = e.clientY - startY;
      if (Math.abs(totalDx) > DRAG_THRESHOLD_PX || Math.abs(totalDy) > DRAG_THRESHOLD_PX) {
        dragging = true;
        pendingNodeId = null;
        viewport.classList.add('tech-web-viewport--panning');
      }
    }
    if (dragging) {
      const rect = svg.getBoundingClientRect();
      const w = GRAPH_WIDTH / zoom;
      const h = GRAPH_HEIGHT / zoom;
      panX -= (dx / rect.width) * w;
      panY -= (dy / rect.height) * h;
      applyViewBox();
    }
    lastX = e.clientX;
    lastY = e.clientY;

    if (!dragging && opts.onHoverNode) {
      opts.onHoverNode(nodeAt(e.clientX, e.clientY));
    }
  });

  viewport.addEventListener('pointerup', (e) => {
    if (!dragging && pendingNodeId) {
      const g = svg.querySelector(`.tech-web-node[data-node-id="${pendingNodeId}"]`);
      if (g?.classList.contains('tech-web-node--available') && opts.onResearch) {
        opts.onResearch(pendingNodeId);
      }
    }
    pointerDown = false;
    dragging = false;
    pendingNodeId = null;
    viewport.classList.remove('tech-web-viewport--panning');
    try { viewport.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  });

  viewport.addEventListener('pointerleave', () => {
    if (opts.onHoverNode) opts.onHoverNode(null);
  });

  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    const nextZoom = clampZoom(zoom * factor);
    if (nextZoom === zoom) return;

    const rect = svg.getBoundingClientRect();
    const w = GRAPH_WIDTH / zoom;
    const h = GRAPH_HEIGHT / zoom;
    const mx = panX + ((e.clientX - rect.left) / rect.width) * w;
    const my = panY + ((e.clientY - rect.top) / rect.height) * h;

    zoom = nextZoom;
    const nw = GRAPH_WIDTH / zoom;
    const nh = GRAPH_HEIGHT / zoom;
    panX = mx - ((e.clientX - rect.left) / rect.width) * nw;
    panY = my - ((e.clientY - rect.top) / rect.height) * nh;
    applyViewBox();
  }, { passive: false });

  fitView();

  return { fitView, applyViewBox };
}
