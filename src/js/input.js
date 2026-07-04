// Pointer + keyboard input. Mutates the cameras and calls exported APIs;
// never mutates game state fields directly (IMPLEMENTATION_PLAN §4).

import { CAMERA_ZOOM_STEP } from './constants.js';
import {
  camera,
  galaxyCamera,
  follow,
  clampZoom,
  clampGalaxyZoom,
  screenToWorld,
  hitTestPlanet,
  hitTestStar,
  hitTestScout,
} from './render.js';

const DRAG_THRESHOLD_PX = 5;
const DOUBLE_CLICK_MS = 300;

const THRUST_KEYS = {
  KeyW: [0, -1], ArrowUp: [0, -1],
  KeyS: [0, 1], ArrowDown: [0, 1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};

export function attachInput(canvas, ctx) {
  const {
    getState,
    getView,
    getViewedSystemId,
    onSelect,
    onTogglePause,
    onToggleView,
    onFlagshipInput,
    onStarTravel,
    onScoutTravel,
    onBattleGroupTravel,
    onStarView,
    onScoutSelect,
    onFollowRequest,
    onToggleOrbit,
    onCloseSidePanel,
  } = ctx;

  const activeCamera = () => (getView() === 'galaxy' ? galaxyCamera : camera);

  const held = new Set();

  function emitThrust() {
    let x = 0;
    let y = 0;
    for (const code of held) {
      const [dx, dy] = THRUST_KEYS[code];
      x += dx;
      y += dy;
    }
    onFlagshipInput(Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y)));
  }

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (THRUST_KEYS[e.code]) {
      e.preventDefault();
      if (!e.repeat) {
        held.add(e.code);
        emitThrust();
      }
      return;
    }
    if (e.code === 'Space') {
      e.preventDefault();
      onTogglePause();
    } else if (e.code === 'Escape') {
      if (onCloseSidePanel) onCloseSidePanel();
      onSelect(null);
    } else if (e.code === 'KeyM') {
      onToggleView();
    } else if (e.code === 'KeyF') {
      onFollowRequest();
    } else if (e.code === 'KeyO') {
      e.preventDefault();
      onToggleOrbit();
    }
  });

  window.addEventListener('keyup', (e) => {
    if (THRUST_KEYS[e.code] && held.delete(e.code)) emitThrust();
  });

  window.addEventListener('blur', () => {
    if (held.size > 0) {
      held.clear();
      emitThrust();
    }
  });

  let pointerDown = false;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let pendingStarClick = null;
  let shiftHeld = false;

  window.addEventListener('keydown', (e) => {
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') shiftHeld = true;
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') shiftHeld = false;
  });

  canvas.addEventListener('mousedown', (e) => {
    pointerDown = true;
    dragging = false;
    lastX = e.clientX;
    lastY = e.clientY;
    shiftHeld = e.shiftKey;
  });

  window.addEventListener('mousemove', (e) => {
    if (pointerDown) {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      if (dragging || Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX) {
        dragging = true;
        const cam = activeCamera();
        cam.x -= dx / cam.zoom;
        cam.y -= dy / cam.zoom;
        if (getView() === 'system') follow.enabled = false;
        canvas.classList.add('panning');
      }
      lastX = e.clientX;
      lastY = e.clientY;
    } else {
      const w = screenToWorld(activeCamera(), e.clientX, e.clientY, canvas);
      const hit = getView() === 'galaxy'
        ? hitTestStar(getState(), w.x, w.y) ?? hitTestScout(getState(), w.x, w.y)
        : hitTestPlanet(getState(), getViewedSystemId(), w.x, w.y);
      canvas.classList.toggle('hover-body', hit !== null);
    }
  });

  window.addEventListener('mouseup', (e) => {
    if (!pointerDown) return;
    pointerDown = false;
    canvas.classList.remove('panning');
    if (dragging) return;

    const w = screenToWorld(activeCamera(), e.clientX, e.clientY, canvas);

    if (getView() === 'system') {
      const hit = hitTestPlanet(getState(), getViewedSystemId(), w.x, w.y);
      onSelect(hit);
      return;
    }

    // Galaxy: scout click takes priority over star click.
    const scoutHit = hitTestScout(getState(), w.x, w.y);
    if (scoutHit && !e.shiftKey) {
      onScoutSelect(scoutHit);
      return;
    }

    const starId = hitTestStar(getState(), w.x, w.y);
    if (!starId) return;

    if (e.altKey && onBattleGroupTravel) {
      onBattleGroupTravel(starId);
      return;
    }

    if (e.shiftKey || shiftHeld) {
      onScoutTravel(starId);
      return;
    }

    if (pendingStarClick && pendingStarClick.id === starId) {
      clearTimeout(pendingStarClick.timer);
      pendingStarClick = null;
      onStarView(starId);
      return;
    }
    if (pendingStarClick) clearTimeout(pendingStarClick.timer);
    pendingStarClick = {
      id: starId,
      timer: setTimeout(() => {
        pendingStarClick = null;
        onStarTravel(starId);
      }, DOUBLE_CLICK_MS),
    };
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const cam = activeCamera();
    const clamp = getView() === 'galaxy' ? clampGalaxyZoom : clampZoom;
    const factor = e.deltaY < 0 ? CAMERA_ZOOM_STEP : 1 / CAMERA_ZOOM_STEP;

    if (getView() === 'system' && follow.enabled) {
      cam.zoom = clamp(cam.zoom * factor);
      return;
    }
    const before = screenToWorld(cam, e.clientX, e.clientY, canvas);
    cam.zoom = clamp(cam.zoom * factor);
    const after = screenToWorld(cam, e.clientX, e.clientY, canvas);
    cam.x += before.x - after.x;
    cam.y += before.y - after.y;
  }, { passive: false });
}
