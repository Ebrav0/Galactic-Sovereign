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
  hitTestSystemStar,
  hitTestStar,
  hitTestScout,
  hitTestFleetMarker,
  hitTestCombatUnit,
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
    onCombatSelect,
    onCombatFocus,
    getCombatCommandMode,
    onCombatCommand,
    onCombatContextCommand,
    onCombatCancelCommand,
    onCombatClearSelection,
    onCombatMarqueeSelect,
    onCombatMarquee,
    combatUiActive,
    onTogglePause,
    onToggleView,
    onFlagshipInput,
    onStarTravel,
    onScoutTravel,
    onBuilderDroneTravel,
    onBattleGroupTravel,
    onBattleGroupSelect,
    onStarView,
    onScoutSelect,
    onFollowRequest,
    onToggleOrbit,
    onCloseSidePanel,
    onGalaxyStarClick,
    onBuilderDroneDeployClick,
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

  let spaceHeld = false;
  let spaceUsedForPan = false;

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
      if (!e.repeat) {
        spaceHeld = true;
        spaceUsedForPan = false;
      }
    } else if (e.code === 'Escape') {
      if (getCombatCommandMode?.()) {
        e.preventDefault();
        onCombatCancelCommand?.();
        canvas.classList.remove('combat-command-move', 'combat-command-attack');
        return;
      }
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
    if (e.code === 'Space') {
      e.preventDefault();
      if (spaceHeld && !spaceUsedForPan) onTogglePause();
      spaceHeld = false;
      spaceUsedForPan = false;
    }
  });

  window.addEventListener('blur', () => {
    if (held.size > 0) {
      held.clear();
      emitThrust();
    }
    shiftHeld = false;
    tabHeld = false;
    spaceHeld = false;
    spaceUsedForPan = false;
  });

  let pointerDown = false;
  let dragging = false;
  let dragMode = null; // 'pan' | 'marquee' | null
  let lastX = 0;
  let lastY = 0;
  let downX = 0;
  let downY = 0;
  let pendingStarClick = null;
  let shiftHeld = false;
  let tabHeld = false;
  let marqueeAdditive = false;

  window.addEventListener('keydown', (e) => {
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') shiftHeld = true;
    if (e.code === 'Tab') {
      tabHeld = true;
      if (getView() === 'galaxy') e.preventDefault();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') shiftHeld = false;
    if (e.code === 'Tab') tabHeld = false;
  });

  function beginPan() {
    dragMode = 'pan';
    dragging = true;
    canvas.classList.add('panning');
    canvas.classList.remove('combat-marquee');
    onCombatMarquee?.(null);
  }

  function applyPan(dx, dy) {
    const cam = activeCamera();
    cam.x -= dx / cam.zoom;
    cam.y -= dy / cam.zoom;
    if (getView() === 'system') follow.enabled = false;
    if (spaceHeld) spaceUsedForPan = true;
  }

  function beginMarquee(additive) {
    dragMode = 'marquee';
    dragging = true;
    marqueeAdditive = additive;
    canvas.classList.add('combat-marquee');
    canvas.classList.remove('panning');
    const w0 = screenToWorld(camera, downX, downY, canvas);
    onCombatMarquee?.({ x0: w0.x, y0: w0.y, x1: w0.x, y1: w0.y });
  }

  function updateMarquee(clientX, clientY) {
    const w0 = screenToWorld(camera, downX, downY, canvas);
    const w1 = screenToWorld(camera, clientX, clientY, canvas);
    onCombatMarquee?.({ x0: w0.x, y0: w0.y, x1: w1.x, y1: w1.y });
  }

  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 1) {
      e.preventDefault();
      pointerDown = true;
      dragging = false;
      dragMode = null;
      downX = lastX = e.clientX;
      downY = lastY = e.clientY;
      beginPan();
      return;
    }
    if (e.button !== 0) return;
    pointerDown = true;
    dragging = false;
    dragMode = null;
    downX = lastX = e.clientX;
    downY = lastY = e.clientY;
    shiftHeld = e.shiftKey;
    tabHeld = e.getModifierState?.('Tab') || tabHeld;

    // Combat: Space+LMB starts pan immediately.
    if (combatUiActive?.() && spaceHeld) {
      beginPan();
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (pointerDown) {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      const totalDx = e.clientX - downX;
      const totalDy = e.clientY - downY;
      const pastThreshold = Math.abs(totalDx) > DRAG_THRESHOLD_PX || Math.abs(totalDy) > DRAG_THRESHOLD_PX;

      if (dragMode === 'pan') {
        applyPan(dx, dy);
      } else if (dragMode === 'marquee') {
        updateMarquee(e.clientX, e.clientY);
      } else if (pastThreshold) {
        const inCombat = combatUiActive?.();
        if (inCombat && !spaceHeld) {
          beginMarquee(!!(e.shiftKey || shiftHeld));
          updateMarquee(e.clientX, e.clientY);
        } else {
          beginPan();
          applyPan(dx, dy);
        }
      }
      lastX = e.clientX;
      lastY = e.clientY;
    } else {
      const w = screenToWorld(activeCamera(), e.clientX, e.clientY, canvas);
      const hit = getView() === 'galaxy'
        ? hitTestFleetMarker(getState(), w.x, w.y) ?? hitTestStar(getState(), w.x, w.y) ?? hitTestScout(getState(), w.x, w.y)
        : (combatUiActive?.()
          ? hitTestCombatUnit(getState(), getViewedSystemId(), w.x, w.y)
          : hitTestPlanet(getState(), getViewedSystemId(), w.x, w.y));
      canvas.classList.toggle('hover-body', hit !== null);
      const commandMode = getCombatCommandMode?.();
      canvas.classList.toggle('combat-command-move', commandMode === 'move');
      canvas.classList.toggle('combat-command-attack', commandMode === 'attack');
    }
  });

  window.addEventListener('mouseup', (e) => {
    if (!pointerDown) return;
    const wasDragging = dragging;
    const mode = dragMode;
    pointerDown = false;
    dragging = false;
    dragMode = null;
    canvas.classList.remove('panning');
    canvas.classList.remove('combat-marquee');

    if (mode === 'marquee') {
      const w0 = screenToWorld(camera, downX, downY, canvas);
      const w1 = screenToWorld(camera, e.clientX, e.clientY, canvas);
      onCombatMarqueeSelect?.(w0.x, w0.y, w1.x, w1.y, { additive: marqueeAdditive });
      onCombatMarquee?.(null);
      return;
    }

    if (wasDragging) {
      onCombatMarquee?.(null);
      return;
    }

    const w = screenToWorld(activeCamera(), e.clientX, e.clientY, canvas);

    if (getView() === 'system') {
      if (combatUiActive?.()) {
        const unit = hitTestCombatUnit(getState(), getViewedSystemId(), w.x, w.y);
        const commandMode = getCombatCommandMode?.();
        if (commandMode) {
          onCombatCommand?.(w, unit, commandMode);
          return;
        }
        if (unit) {
          if (unit.side === 'player') {
            onCombatSelect?.(unit.id, { additive: !!(e.shiftKey || shiftHeld) });
          } else {
            onCombatFocus?.(unit.id);
          }
          return;
        }
        onCombatClearSelection?.();
        return;
      }
      const hit = hitTestPlanet(getState(), getViewedSystemId(), w.x, w.y)
        ?? hitTestSystemStar(getState(), getViewedSystemId(), w.x, w.y);
      onSelect(hit);
      return;
    }

    // Galaxy: fleet/scout clicks take priority over star click.
    const fleetHit = hitTestFleetMarker(getState(), w.x, w.y);
    if (fleetHit && !e.shiftKey && !(e.ctrlKey || e.metaKey) && !(e.altKey || tabHeld)) {
      onBattleGroupSelect?.(fleetHit);
      return;
    }

    const scoutHit = hitTestScout(getState(), w.x, w.y);
    if (scoutHit && !e.shiftKey) {
      onScoutSelect(scoutHit);
      return;
    }

    const starId = hitTestStar(getState(), w.x, w.y);
    if (!starId) return;

    if ((e.ctrlKey || e.metaKey) && onBuilderDroneDeployClick) {
      onBuilderDroneDeployClick(starId);
      return;
    }

    if ((e.altKey || tabHeld) && onBattleGroupTravel) {
      onBattleGroupTravel(starId);
      return;
    }

    if (e.shiftKey || shiftHeld) {
      if (ctx.getSelectedBuilderDroneId?.()) {
        onBuilderDroneTravel?.(starId);
      } else {
        onScoutTravel(starId);
      }
      return;
    }

    if (pendingStarClick && pendingStarClick.id === starId) {
      clearTimeout(pendingStarClick.timer);
      pendingStarClick = null;
      onStarView(starId);
      return;
    }
    if (pendingStarClick) clearTimeout(pendingStarClick.timer);
    if (onGalaxyStarClick) onGalaxyStarClick(starId);
    pendingStarClick = {
      id: starId,
      timer: setTimeout(() => {
        pendingStarClick = null;
        onStarTravel(starId);
      }, DOUBLE_CLICK_MS),
    };
  });

  canvas.addEventListener('auxclick', (e) => {
    if (e.button === 1) e.preventDefault();
  });

  canvas.addEventListener('contextmenu', (e) => {
    if (!combatUiActive?.()) return;
    e.preventDefault();
    const w = screenToWorld(camera, e.clientX, e.clientY, canvas);
    const unit = hitTestCombatUnit(getState(), getViewedSystemId(), w.x, w.y);
    onCombatContextCommand?.(w, unit);
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
