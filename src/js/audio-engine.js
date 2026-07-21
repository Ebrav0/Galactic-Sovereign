// Web Audio mixer: lazy decode, persistent buses, bounded voices, loops, and diagnostics.

const SETTINGS_KEY = 'galactic-sovereign.audio.v1';
const BUS_NAMES = ['ui', 'combat', 'world', 'ambience', 'music'];
const DEFAULT_SETTINGS = Object.freeze({
  muted: false,
  reducedDynamics: false,
  master: 0.8,
  ui: 0.72,
  combat: 0.78,
  world: 0.76,
  ambience: 0.62,
  music: 0.5,
});

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));
const nowMs = () => globalThis.performance?.now?.() ?? Date.now();

function loadSettings(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem?.(SETTINGS_KEY) ?? 'null');
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_SETTINGS };
    return {
      ...DEFAULT_SETTINGS,
      ...Object.fromEntries(BUS_NAMES.concat('master').map((key) => [key, clamp01(parsed[key] ?? DEFAULT_SETTINGS[key])])),
      muted: parsed.muted === true,
      reducedDynamics: parsed.reducedDynamics === true,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function createAudioEngine(catalog, options = {}) {
  const windowRef = options.windowRef ?? globalThis.window;
  const documentRef = options.documentRef ?? globalThis.document;
  const storage = options.storage ?? globalThis.localStorage;
  const fetchFn = options.fetchFn ?? globalThis.fetch?.bind(globalThis);
  const contextFactory = options.contextFactory ?? (() => {
    const Context = windowRef?.AudioContext ?? windowRef?.webkitAudioContext;
    return Context ? new Context() : null;
  });
  const random = options.random ?? Math.random;
  const clock = options.now ?? nowMs;
  const maxVoices = Math.max(8, options.maxVoices ?? 36);
  const settings = loadSettings(storage);
  const listeners = new Set();
  const buffers = new Map();
  const bufferPromises = new Map();
  const cooldowns = new Map();
  const voices = [];
  const loops = new Map();
  const pendingLoops = new Map();
  const ledger = [];
  let context = null;
  let masterNode = null;
  let compressor = null;
  let busNodes = null;
  let unlocked = false;
  let lastError = null;

  const record = (status, cueId, detail = {}) => {
    ledger.push({ at: Math.round(clock()), status, cueId, ...detail });
    if (ledger.length > 240) ledger.splice(0, ledger.length - 240);
    if (status === 'load_error' || status === 'play_error' || status === 'unlock_error' || status === 'loop_error') {
      lastError = { status, cueId, ...detail, at: Math.round(clock()) };
    } else if (status === 'started' || status === 'loop_started' || status === 'decoded' || status === 'unlocked') {
      lastError = null;
    }
  };

  const notify = () => {
    const snapshot = api.snapshot(true);
    for (const listener of listeners) listener(snapshot);
  };

  const persist = () => {
    try { storage?.setItem?.(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* device policy may block storage */ }
  };

  const setParam = (param, value, seconds = 0.025) => {
    if (!param) return;
    const at = context?.currentTime ?? 0;
    if (typeof param.setTargetAtTime === 'function') param.setTargetAtTime(value, at, seconds);
    else param.value = value;
  };

  const applySettings = () => {
    if (!context || !masterNode || !busNodes) return;
    setParam(masterNode.gain, settings.muted ? 0 : settings.master);
    for (const bus of BUS_NAMES) setParam(busNodes[bus]?.gain, settings[bus]);
    if (compressor) {
      setParam(compressor.threshold, settings.reducedDynamics ? -28 : -12);
      setParam(compressor.ratio, settings.reducedDynamics ? 8 : 3);
      setParam(compressor.knee, settings.reducedDynamics ? 10 : 24);
    }
  };

  const ensureGraph = () => {
    if (context) return context;
    context = contextFactory?.() ?? null;
    if (!context) {
      record('unsupported', 'audio.engine');
      return null;
    }
    masterNode = context.createGain();
    compressor = context.createDynamicsCompressor?.() ?? null;
    if (compressor) {
      masterNode.connect(compressor);
      compressor.connect(context.destination);
    } else {
      masterNode.connect(context.destination);
    }
    busNodes = {};
    for (const bus of BUS_NAMES) {
      const node = context.createGain();
      node.connect(masterNode);
      busNodes[bus] = node;
    }
    applySettings();
    record('initialized', 'audio.engine', { contextState: context.state });
    return context;
  };

  const resolveUrl = (path) => {
    const base = options.baseUrl ?? documentRef?.baseURI ?? globalThis.location?.href ?? 'http://localhost/';
    return new URL(path, base).href;
  };

  // Prefer MP3 (Safari/WebKit) then fall back to the CC0 OGG masters.
  const candidatesFor = (path) => {
    if (typeof path !== 'string') return [];
    if (/\.ogg$/i.test(path)) return [path.replace(/\.ogg$/i, '.mp3'), path];
    if (/\.mp3$/i.test(path)) return [path, path.replace(/\.mp3$/i, '.ogg')];
    return [path];
  };

  const decode = async (arrayBuffer) => {
    const result = context.decodeAudioData(arrayBuffer.slice(0));
    if (result?.then) return result;
    return new Promise((resolve, reject) => context.decodeAudioData(arrayBuffer.slice(0), resolve, reject));
  };

  const fetchAndDecode = async (path) => {
    if (!fetchFn) throw new Error('fetch unavailable');
    const response = await fetchFn(resolveUrl(path));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return decode(await response.arrayBuffer());
  };

  const loadBuffer = async (path) => {
    if (buffers.has(path)) return buffers.get(path);
    if (bufferPromises.has(path)) return bufferPromises.get(path);
    const promise = (async () => {
      ensureGraph();
      if (!context) throw new Error('Web Audio unavailable');
      const candidates = candidatesFor(path);
      let lastFailure = null;
      for (const candidate of candidates) {
        if (buffers.has(candidate)) {
          const hit = buffers.get(candidate);
          buffers.set(path, hit);
          return hit;
        }
        try {
          const buffer = await fetchAndDecode(candidate);
          buffers.set(candidate, buffer);
          buffers.set(path, buffer);
          record('decoded', 'audio.asset', { path: candidate });
          return buffer;
        } catch (error) {
          lastFailure = error;
        }
      }
      throw lastFailure ?? new Error(`Unable to decode ${path}`);
    })().catch((error) => {
      record('load_error', 'audio.asset', { path, error: String(error?.message ?? error) });
      throw error;
    }).finally(() => bufferPromises.delete(path));
    bufferPromises.set(path, promise);
    return promise;
  };

  const ensureRunning = async () => {
    const ctx = ensureGraph();
    if (!ctx) return false;
    if (ctx.state === 'running') {
      unlocked = true;
      return true;
    }
    try {
      await ctx.resume();
    } catch (error) {
      record('unlock_error', 'audio.engine', { error: String(error?.message ?? error) });
      return false;
    }
    unlocked = ctx.state === 'running';
    return unlocked;
  };

  const pick = (values = []) => values[Math.min(values.length - 1, Math.floor(random() * values.length))];
  const rateFor = (layer, cue) => {
    const low = layer.rateMin ?? cue.rateMin ?? 1;
    const high = layer.rateMax ?? cue.rateMax ?? low;
    return low + (high - low) * random();
  };

  const trimVoices = (incomingPriority = 1) => {
    for (let i = voices.length - 1; i >= 0; i--) if (voices[i].ended) voices.splice(i, 1);
    if (voices.length < maxVoices) return;
    voices.sort((a, b) => a.priority - b.priority || a.startedAt - b.startedAt);
    const victim = voices.find((voice) => voice.priority <= incomingPriority) ?? voices[0];
    try { victim.source.stop(); } catch { /* already ended */ }
    victim.ended = true;
  };

  const startLayer = async (cueId, cue, layer, opts) => {
    const path = pick(layer.files ?? cue.files ?? []);
    if (!path) return false;
    const buffer = await loadBuffer(path);
    if (!(await ensureRunning())) return false;
    const priority = opts.priority ?? cue.priority ?? 1;
    trimVoices(priority);
    const source = context.createBufferSource();
    const gainNode = context.createGain();
    const panner = context.createStereoPanner?.() ?? null;
    source.buffer = buffer;
    source.playbackRate.value = opts.rate ?? rateFor(layer, cue);
    gainNode.gain.value = clamp01((layer.gain ?? cue.gain ?? 1) * (opts.gain ?? 1));
    if (panner) {
      panner.pan.value = Math.max(-1, Math.min(1, opts.pan ?? 0));
      source.connect(gainNode);
      gainNode.connect(panner);
      panner.connect(busNodes[layer.bus ?? cue.bus ?? 'world']);
    } else {
      source.connect(gainNode);
      gainNode.connect(busNodes[layer.bus ?? cue.bus ?? 'world']);
    }
    const voice = { source, cueId, priority, startedAt: clock(), ended: false };
    voices.push(voice);
    source.onended = () => { voice.ended = true; };
    source.start(context.currentTime + Math.max(0, layer.delayMs ?? 0) / 1000);
    record('started', cueId, { path, bus: layer.bus ?? cue.bus ?? 'world', pan: opts.pan ?? 0 });
    return true;
  };

  const playCueInternal = async (cueId, opts = {}) => {
    const cue = catalog[cueId];
    if (!cue) {
      record('unknown', cueId);
      return false;
    }
    const time = clock();
    const cooldownMs = opts.cooldownMs ?? cue.cooldownMs ?? 0;
    if (!opts.force && time < (cooldowns.get(cueId) ?? 0)) {
      record('cooldown', cueId);
      return false;
    }
    cooldowns.set(cueId, time + cooldownMs);
    if (settings.muted || settings.master <= 0) {
      record('muted', cueId);
      return false;
    }
    if (!(await ensureRunning())) {
      record('locked', cueId, { contextState: context?.state ?? 'none' });
      return false;
    }
    const layers = cue.layers?.length ? cue.layers : [cue];
    const results = await Promise.all(layers.map((layer) => startLayer(cueId, cue, layer, opts)));
    notify();
    return results.some(Boolean);
  };

  const api = {
    async unlock() {
      const ok = await ensureRunning();
      record(ok ? 'unlocked' : 'locked', 'audio.engine', { contextState: context?.state ?? 'none' });
      notify();
      return ok;
    },

    isUnlocked() { return unlocked && context?.state === 'running'; },

    playCue(cueId, opts = {}) {
      return playCueInternal(cueId, opts).catch((error) => {
        record('play_error', cueId, { error: String(error?.message ?? error) });
        return false;
      });
    },

    async preload(cueIds = []) {
      ensureGraph();
      const paths = [];
      for (const cueId of cueIds) {
        const cue = catalog[cueId];
        if (!cue) continue;
        for (const layer of cue.layers ?? [cue]) if (layer.files?.[0]) paths.push(layer.files[0]);
      }
      const results = await Promise.allSettled([...new Set(paths)].map(loadBuffer));
      return results.filter((result) => result.status === 'fulfilled').length;
    },

    async startLoop(loopId, cueId, opts = {}) {
      const existing = loops.get(loopId);
      if (existing?.cueId === cueId) {
        setParam(existing.gainNode.gain, clamp01((existing.baseGain ?? 1) * (opts.gain ?? 1)), opts.fadeSeconds ?? 0.08);
        if (opts.rate != null && existing.source?.playbackRate) {
          setParam(existing.source.playbackRate, opts.rate, 0.12);
        }
        return true;
      }
      if (pendingLoops.get(loopId)?.cueId === cueId) return true;
      api.stopLoop(loopId, 0.18);
      if (!(await ensureRunning())) return false;
      const cue = catalog[cueId];
      const layer = cue?.layers?.[0] ?? cue;
      const path = pick(layer?.files ?? []);
      if (!cue || !path) return false;
      const token = Symbol(loopId);
      pendingLoops.set(loopId, { token, cueId });
      try {
        const buffer = await loadBuffer(path);
        // Re-check after every await: stopLoop may have cancelled this start,
        // or a newer startLoop for the same id may have taken ownership.
        if (pendingLoops.get(loopId)?.token !== token || !(await ensureRunning())) return false;
        if (pendingLoops.get(loopId)?.token !== token) return false;
        const source = context.createBufferSource();
        const gainNode = context.createGain();
        source.buffer = buffer;
        source.loop = true;
        source.playbackRate.value = opts.rate ?? rateFor(layer, cue);
        const baseGain = layer.gain ?? cue.gain ?? 1;
        gainNode.gain.value = 0;
        source.connect(gainNode);
        gainNode.connect(busNodes[layer.bus ?? cue.bus ?? 'ambience']);
        if (pendingLoops.get(loopId)?.token !== token) return false;
        source.start();
        setParam(gainNode.gain, clamp01(baseGain * (opts.gain ?? 1)), opts.fadeSeconds ?? 0.25);
        loops.set(loopId, { cueId, source, gainNode, baseGain, path });
        pendingLoops.delete(loopId);
        record('loop_started', cueId, { loopId, path });
        notify();
        return true;
      } catch (error) {
        if (pendingLoops.get(loopId)?.token === token) pendingLoops.delete(loopId);
        record('loop_error', cueId, { loopId, error: String(error?.message ?? error) });
        return false;
      }
    },

    stopLoop(loopId, fadeSeconds = 0.2) {
      pendingLoops.delete(loopId);
      const loop = loops.get(loopId);
      if (!loop) return false;
      loops.delete(loopId);
      setParam(loop.gainNode.gain, 0, Math.max(0.01, fadeSeconds / 3));
      try { loop.source.stop((context?.currentTime ?? 0) + Math.max(0.02, fadeSeconds)); } catch { /* already stopped */ }
      record('loop_stopped', loop.cueId, { loopId });
      notify();
      return true;
    },

    stopAllLoops() { for (const loopId of [...loops.keys()]) api.stopLoop(loopId); },

    getSettings() { return { ...settings }; },

    setSettings(patch = {}) {
      for (const key of ['master', ...BUS_NAMES]) if (patch[key] != null) settings[key] = clamp01(patch[key]);
      if (patch.muted != null) settings.muted = patch.muted === true;
      if (patch.reducedDynamics != null) settings.reducedDynamics = patch.reducedDynamics === true;
      persist();
      applySettings();
      record('settings', 'audio.engine', { settings: { ...settings } });
      notify();
      return api.getSettings();
    },

    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },

    snapshot(compact = false) {
      const recent = ledger.slice(compact ? -10 : -40);
      const startedByCue = {};
      for (const event of ledger) if (event.status === 'started' || event.status === 'loop_started') {
        startedByCue[event.cueId] = (startedByCue[event.cueId] ?? 0) + 1;
      }
      return {
        supported: !!(context ?? (windowRef?.AudioContext || windowRef?.webkitAudioContext)),
        unlocked,
        contextState: context?.state ?? 'uninitialized',
        settings: { ...settings },
        decodedBuffers: buffers.size,
        pendingBuffers: bufferPromises.size,
        activeVoices: voices.filter((voice) => !voice.ended).length,
        activeLoops: [...loops.entries()].map(([id, loop]) => ({ id, cueId: loop.cueId })),
        startedByCue,
        lastError,
        recent,
      };
    },
  };

  const unlockFromGesture = () => {
    api.unlock().then((ok) => {
      if (!ok) return;
      windowRef?.removeEventListener?.('pointerdown', unlockFromGesture, true);
      windowRef?.removeEventListener?.('keydown', unlockFromGesture, true);
    });
  };
  windowRef?.addEventListener?.('pointerdown', unlockFromGesture, true);
  windowRef?.addEventListener?.('keydown', unlockFromGesture, true);
  documentRef?.addEventListener?.('visibilitychange', () => {
    if (!context) return;
    if (documentRef.hidden) context.suspend?.();
    else if (unlocked) ensureRunning().then((ok) => { if (ok) notify(); });
  });

  return api;
}
