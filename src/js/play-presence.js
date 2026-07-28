// Lightweight hosted presence socket for online status + owner notices.
import { hostedPresenceUrl, isHostedMode } from './account-client.js';

const PING_MS = 25_000;
const RECONNECT_MS = 2_500;
const ALLOWED_MODES = new Set(['online', 'solo']);

export function createPlayPresence({ onNotice } = {}) {
  let ws = null;
  let wanted = false;
  let mode = 'online';
  let pingTimer = 0;
  let reconnectTimer = 0;

  function clearTimers() {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = 0;
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = 0;
    }
  }

  function scheduleReconnect() {
    if (!wanted || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = 0;
      if (wanted) connect();
    }, RECONNECT_MS);
  }

  function publishMode() {
    if (ws?.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify({ type: 'presence', mode }));
    } catch { /* ignore */ }
  }

  function handleMessage(raw) {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (msg?.type === 'presenceReady') {
      publishMode();
      return;
    }
    if (msg?.type !== 'adminNotice') return;
    const notice = String(msg.notice || '').trim().slice(0, 220);
    if (notice) onNotice?.(notice);
  }

  function connect() {
    if (!isHostedMode() || !wanted) return;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      publishMode();
      return;
    }
    clearTimers();
    try {
      ws = new WebSocket(hostedPresenceUrl());
    } catch {
      scheduleReconnect();
      return;
    }
    ws.addEventListener('open', () => {
      publishMode();
      pingTimer = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) {
          try { ws.send(JSON.stringify({ type: 'ping' })); } catch { /* ignore */ }
        }
      }, PING_MS);
    });
    ws.addEventListener('message', (event) => handleMessage(event.data));
    ws.addEventListener('close', () => {
      clearTimers();
      ws = null;
      scheduleReconnect();
    });
    ws.addEventListener('error', () => {
      try { ws?.close(); } catch { /* ignore */ }
    });
  }

  return {
    enable(nextMode = 'online') {
      if (ALLOWED_MODES.has(nextMode)) mode = nextMode;
      wanted = true;
      connect();
    },
    setMode(nextMode) {
      if (!ALLOWED_MODES.has(nextMode) || mode === nextMode) {
        if (ALLOWED_MODES.has(nextMode)) mode = nextMode;
        return;
      }
      mode = nextMode;
      publishMode();
    },
    disable() {
      wanted = false;
      clearTimers();
      const socket = ws;
      ws = null;
      if (socket && socket.readyState <= WebSocket.OPEN) {
        try { socket.close(1000, 'presence off'); } catch { /* ignore */ }
      }
    },
    isEnabled() {
      return wanted;
    },
  };
}
