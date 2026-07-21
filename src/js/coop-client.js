// Browser WebSocket client for the co-op host (shared empire).

import { deserialize } from './save.js';
import { PROTOCOL_VERSION } from './coop-protocol.js';

const DEFAULT_COOP_PORT = '9090';

/** True when `coop` is a real WS endpoint, not a flag like 1 / 2 / true / 8080. */
function looksLikeWsEndpoint(raw) {
  const v = String(raw ?? '').trim();
  if (!v) return false;
  // Never treat bare numbers / booleans as hosts (static serve is often :8080;
  // ?coop=2 must not become a relative WS URL against that origin).
  if (/^(?:\d+|true|false|yes|no)$/i.test(v)) return false;
  if (/^wss?:\/\//i.test(v)) return true;
  // host:port (localhost:9090) or IPv4 with optional port
  if (/^[a-z0-9.-]+:\d{2,5}(?:\/.*)?$/i.test(v)) return true;
  if (/^\d{1,3}(?:\.\d{1,3}){3}(?::\d{2,5})?(?:\/.*)?$/.test(v)) return true;
  return false;
}

function defaultWsUrl() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('coop');
  // ?coop, ?coop=1, ?coop=2, ?coop=true → default host. Only custom when it looks like a URL.
  if (looksLikeWsEndpoint(raw)) {
    const v = raw.trim();
    if (/^wss?:\/\//i.test(v)) return v;
    return `ws://${v}`;
  }
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const host = window.location.hostname || '127.0.0.1';
  // Always default to the co-op host port — never the static/Vite page port (8080/5173).
  const port = params.get('coopPort') || DEFAULT_COOP_PORT;
  return `${proto}://${host}:${port}`;
}

/** HTTP health URL sibling of a co-op WebSocket endpoint. */
function coopHealthUrl(wsUrl = defaultWsUrl()) {
  try {
    const u = new URL(wsUrl);
    u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
    u.pathname = '/health';
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

export function coopQueryEnabled() {
  const params = new URLSearchParams(window.location.search);
  return params.has('coop');
}

export function createCoopClient({
  onSummary,
  onSnapshot,
  onDelta,
  onEvents,
  onNotice,
  onStatus,
  onError,
} = {}) {
  /** @type {WebSocket | null} */
  let ws = null;
  let playerId = null;
  let connected = false;
  let authed = false;
  let lastSummary = null;
  let pending = new Map();
  let requestSeq = 0;
  const requestSession = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  let worldId = null;
  let lastAppliedTick = 0;
  const revisions = { pose: 0, delta: 0, events: 0, checkpoint: 0 };
  let reconnectToken = null;
  const notices = [];

  function status(patch) {
    onStatus?.({
      connected,
      authed,
      playerId,
      worldId,
      lastAppliedTick,
      revisions: { ...revisions },
      url: ws?.url ?? null,
      summary: lastSummary,
      ...patch,
    });
  }

  function identityStorageKey(playerName) {
    const endpoint = ws?.url ?? defaultWsUrl();
    return `gs.coop.identity.v2:${endpoint}:${String(playerName || 'pilot').toLowerCase()}`;
  }

  function loadIdentity(playerName) {
    try {
      const saved = JSON.parse(localStorage.getItem(identityStorageKey(playerName)) || 'null');
      if (saved?.playerId && saved?.reconnectToken) return saved;
    } catch { /* storage unavailable or stale */ }
    return {
      playerId: null,
      reconnectToken: globalThis.crypto?.randomUUID?.()
        ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    };
  }

  function saveIdentity(playerName, identity) {
    try {
      localStorage.setItem(identityStorageKey(playerName), JSON.stringify(identity));
    } catch { /* private mode / disabled storage */ }
  }

  function acceptsEnvelope(msg, channel) {
    if (msg.worldId && worldId && msg.worldId !== worldId) return false;
    const revision = Number(msg.revision) || 0;
    if (revision && revision <= revisions[channel]) return false;
    const tick = Number(msg.tick) || 0;
    if (channel !== 'pose' && tick && tick < lastAppliedTick) return false;
    if (revision) revisions[channel] = revision;
    if (tick) lastAppliedTick = Math.max(lastAppliedTick, tick);
    return true;
  }

  function send(msg) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error('Co-op host is not connected');
    }
    ws.send(JSON.stringify(msg));
  }

  function handleMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      onError?.('Invalid message from co-op host');
      return;
    }

    if (msg.type === 'welcome') {
      if (msg.protocolVersion !== PROTOCOL_VERSION) {
        onError?.(`Co-op protocol mismatch (client ${PROTOCOL_VERSION}, host ${msg.protocolVersion ?? 'unknown'})`);
        try { ws?.close(4002, 'protocol mismatch'); } catch { /* ignore */ }
        return;
      }
      authed = true;
      playerId = msg.playerId;
      reconnectToken = msg.reconnectToken ?? reconnectToken;
      worldId = msg.worldId ?? worldId;
      lastAppliedTick = Number(msg.tick) || 0;
      Object.assign(revisions, {
        pose: Number(msg.manifest?.poseRevision) || 0,
        delta: Number(msg.manifest?.deltaRevision) || 0,
        events: Number(msg.manifest?.eventRevision) || 0,
        checkpoint: 1,
      });
      lastSummary = msg.summary ?? null;
      if (msg.snapshotJson) {
        onSnapshot?.(msg.snapshotJson, msg.summary, {
          worldId,
          tick: lastAppliedTick,
          revision: revisions.checkpoint,
          reason: 'welcome',
        });
      }
      status({ phase: 'playing' });
      return;
    }

    if (msg.type === 'summary') {
      lastSummary = msg.summary ?? lastSummary;
      if (msg.notice) {
        notices.push(msg.notice);
        onNotice?.(msg.notice);
      }
      onSummary?.(lastSummary);
      // Avoid status→banner thrash on every ~1s summary; onSummary already updates HUD.
      return;
    }

    if (msg.type === 'pose') {
      if (!acceptsEnvelope(msg, 'pose')) {
        return;
      }
      lastSummary = msg.pose ?? msg.summary ?? lastSummary;
      if (msg.notice) {
        notices.push(msg.notice);
        onNotice?.(msg.notice);
      }
      onSummary?.(lastSummary, {
        worldId: msg.worldId ?? worldId,
        tick: Number(msg.tick) || 0,
        revision: Number(msg.revision) || revisions.pose,
      });
      return;
    }

    if (msg.type === 'delta') {
      if (!acceptsEnvelope(msg, 'delta')) return;
      onDelta?.(msg.operations ?? [], {
        worldId: msg.worldId ?? worldId,
        tick: Number(msg.tick) || 0,
        revision: Number(msg.revision) || revisions.delta,
      });
      return;
    }

    if (msg.type === 'events') {
      if (!acceptsEnvelope(msg, 'events')) return;
      for (const event of msg.events ?? []) {
        if (event?.notice) {
          notices.push(event.notice);
          onNotice?.(event.notice);
        }
      }
      onEvents?.(msg.events ?? [], {
        worldId: msg.worldId ?? worldId,
        tick: Number(msg.tick) || 0,
        revision: Number(msg.revision) || revisions.events,
      });
      return;
    }

    if (msg.type === 'checkpoint') {
      if (!acceptsEnvelope(msg, 'checkpoint')) return;
      if (msg.snapshotJson) {
        onSnapshot?.(msg.snapshotJson, msg.pose ?? msg.summary ?? null, {
          worldId: msg.worldId ?? worldId,
          tick: Number(msg.tick) || 0,
          revision: Number(msg.revision) || revisions.checkpoint,
          reason: msg.reason ?? 'resync',
        });
      }
      return;
    }

    if (msg.type === 'snapshot') {
      lastSummary = msg.summary ?? lastSummary;
      if (msg.snapshotJson) onSnapshot?.(msg.snapshotJson, msg.summary);
      return;
    }

    if (msg.type === 'commandResult') {
      const entry = pending.get(msg.requestId);
      if (entry) {
        pending.delete(msg.requestId);
        if (msg.result?.ok) entry.resolve(msg.result);
        else entry.reject(new Error(msg.result?.reason || 'Command failed'));
      }
      return;
    }

    if (msg.type === 'error') {
      onError?.(msg.error || 'Co-op error');
      status({ lastError: msg.error });
      return;
    }

    if (msg.type === 'pong') return;
  }

  function connect({
    url = defaultWsUrl(),
    password = '',
    playerName = 'pilot',
  } = {}) {
    disconnect();
    return new Promise((resolve, reject) => {
      let settled = false;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        reject(err);
        return;
      }

      ws.addEventListener('open', () => {
        connected = true;
        status({ phase: 'hello' });
        const identity = loadIdentity(playerName);
        reconnectToken = identity.reconnectToken;
        send({
          type: 'hello',
          protocolVersion: PROTOCOL_VERSION,
          playerId: identity.playerId,
          reconnectToken: identity.reconnectToken,
          playerName,
          password: password || undefined,
          lastSeen: {
            worldId,
            tick: lastAppliedTick,
            poseRevision: revisions.pose,
            deltaRevision: revisions.delta,
            eventRevision: revisions.events,
          },
        });
      });

      ws.addEventListener('message', (ev) => {
        handleMessage(ev.data);
        if (!settled && authed) {
          settled = true;
          saveIdentity(playerName, { playerId, reconnectToken });
          resolve({ playerId, summary: lastSummary });
        }
      });

      ws.addEventListener('error', () => {
        if (!settled) {
          settled = true;
          reject(new Error(`Could not connect to co-op host at ${url}`));
        }
        onError?.(`Co-op connection error (${url})`);
        status({ phase: 'error' });
      });

      ws.addEventListener('close', () => {
        connected = false;
        authed = false;
        status({ phase: 'closed' });
        if (!settled) {
          settled = true;
          reject(new Error('Co-op connection closed before welcome'));
        }
      });
    });
  }

  function disconnect() {
    if (ws) {
      try { ws.close(); } catch { /* ignore */ }
    }
    ws = null;
    connected = false;
    authed = false;
    playerId = null;
    worldId = null;
    lastAppliedTick = 0;
    revisions.pose = 0;
    revisions.delta = 0;
    revisions.events = 0;
    revisions.checkpoint = 0;
    lastSummary = null;
    for (const [, entry] of pending) entry.reject(new Error('Disconnected'));
    pending.clear();
    status({ phase: 'idle' });
  }

  function command(commandName, payload = {}) {
    if (!authed) return Promise.reject(new Error('Not connected to co-op host'));
    const requestId = `${requestSession}:${++requestSeq}`;
    return new Promise((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      try {
        send({
          type: 'command',
          command: commandName,
          requestId,
          payload,
        });
      } catch (err) {
        pending.delete(requestId);
        reject(err);
      }
      setTimeout(() => {
        if (pending.has(requestId)) {
          pending.delete(requestId);
          reject(new Error(`Co-op command timed out: ${commandName}`));
        }
      }, 8000);
    });
  }

  function takeNotices() {
    const out = notices.splice(0, notices.length);
    return out;
  }

  function parseSnapshot(snapshotJson) {
    // Skip CRC + migration/init — co-op host sends live current-version state.
    // Full deserialize was the main-thread freeze (1MB parse + dozen init passes).
    const result = deserialize(snapshotJson, { verifyChecksum: false, trustCurrent: true });
    if (!result.ok) throw new Error(result.error || 'Bad snapshot');
    return result.state;
  }

  return {
    connect,
    disconnect,
    command,
    takeNotices,
    parseSnapshot,
    isActive: () => authed,
    isConnected: () => connected,
    getPlayerId: () => playerId,
    getWorldId: () => worldId,
    getLastAppliedTick: () => lastAppliedTick,
    getRevisions: () => ({ ...revisions }),
    getSummary: () => lastSummary,
    getUrl: () => ws?.url ?? defaultWsUrl(),
  };
}

export { defaultWsUrl, coopHealthUrl, DEFAULT_COOP_PORT, looksLikeWsEndpoint };
