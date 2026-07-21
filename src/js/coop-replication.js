// Generic host-authoritative shared-state replication.
//
// The projection excludes entities that have dedicated high-rate channels
// (flagships, heroes, fleets, tactical battles). Everything else is deeply
// diffed so a new solo feature cannot silently become "local only" simply
// because somebody forgot to add it to a hand-written summary.

const OMIT_ROOT_KEYS = new Set([
  'time',
  'flagship',
  'coopMeta',
]);

function jsonClone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

/** Create the canonical low-frequency replica projection. */
export function projectSharedState(state) {
  const out = {};
  for (const [key, value] of Object.entries(state ?? {})) {
    if (OMIT_ROOT_KEYS.has(key)) continue;
    out[key] = jsonClone(value);
  }
  // playTime changes continuously and is presentation/accounting only.
  if (out.meta && typeof out.meta === 'object') delete out.meta.playTimeMs;

  const stripPose = (entity) => {
    if (!entity || typeof entity !== 'object') return;
    delete entity.x;
    delete entity.y;
    delete entity.vx;
    delete entity.vy;
    delete entity.heading;
    delete entity.hp;
  };
  for (const flagship of out.playerFlagships ?? []) stripPose(flagship);
  for (const hero of out.heroFlagships ?? []) stripPose(hero);
  for (const battle of Object.values(out.systemBattles ?? {})) {
    delete battle.events;
    delete battle.fxEvents;
    for (const unit of battle.units ?? []) stripPose(unit);
  }
  return out;
}

function samePrimitive(a, b) {
  return Object.is(a, b);
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function arraysHaveStableIds(a, b) {
  if (a.length !== b.length || a.length === 0) return false;
  return a.every((entry, index) => (
    isRecord(entry)
    && isRecord(b[index])
    && (entry.id ?? entry.pilotId) != null
    && String(entry.id ?? entry.pilotId) === String(b[index].id ?? b[index].pilotId)
  ));
}

/**
 * Deep diff two projected states.
 * Operations are deliberately tiny and JSON-safe:
 *   { op: 'set', path: ['research', 'progress'], value: 123 }
 *   { op: 'delete', path: ['diplomacy', 'wars', 2] }
 */
export function diffSharedState(previous, next) {
  const ops = [];

  function walk(before, after, path) {
    if (samePrimitive(before, after)) return;

    if (Array.isArray(before) && Array.isArray(after)) {
      // Stable entity arrays can be diffed field-by-field. Other list shape
      // changes are replaced atomically, which also provides tombstones.
      if (arraysHaveStableIds(before, after)) {
        for (let i = 0; i < after.length; i++) walk(before[i], after[i], [...path, i]);
      } else {
        ops.push({ op: 'set', path, value: jsonClone(after) });
      }
      return;
    }

    if (isRecord(before) && isRecord(after)) {
      const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
      for (const key of keys) {
        if (!(key in after)) {
          ops.push({ op: 'delete', path: [...path, key] });
        } else if (!(key in before)) {
          ops.push({ op: 'set', path: [...path, key], value: jsonClone(after[key]) });
        } else {
          walk(before[key], after[key], [...path, key]);
        }
      }
      return;
    }

    ops.push({ op: 'set', path, value: jsonClone(after) });
  }

  walk(previous ?? {}, next ?? {}, []);
  return ops;
}

function parentForPath(root, path, create = false) {
  let cursor = root;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    const nextKey = path[i + 1];
    if (cursor[key] == null && create) {
      cursor[key] = typeof nextKey === 'number' ? [] : {};
    }
    cursor = cursor[key];
    if (cursor == null) return null;
  }
  return cursor;
}

/** Apply ordered delta operations to a live client state object. */
export function applySharedStateDelta(state, operations) {
  if (!state || !Array.isArray(operations)) return 0;
  let applied = 0;
  for (const operation of operations) {
    const path = Array.isArray(operation?.path) ? operation.path : null;
    if (!path || path.length === 0) continue;
    const parent = parentForPath(state, path, operation.op === 'set');
    if (!parent) continue;
    const key = path[path.length - 1];
    if (operation.op === 'delete') {
      if (Array.isArray(parent) && typeof key === 'number') parent.splice(key, 1);
      else delete parent[key];
      applied += 1;
    } else if (operation.op === 'set') {
      parent[key] = jsonClone(operation.value);
      applied += 1;
    }
  }
  return applied;
}

export function replicationManifest({
  worldId,
  tick,
  deltaRevision,
  eventRevision,
  poseRevision,
} = {}) {
  return {
    worldId: worldId ?? null,
    tick: Number(tick) || 0,
    deltaRevision: Number(deltaRevision) || 0,
    eventRevision: Number(eventRevision) || 0,
    poseRevision: Number(poseRevision) || 0,
  };
}
