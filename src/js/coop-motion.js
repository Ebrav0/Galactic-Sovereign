const POSITION_FIELDS = ['x', 'y', 'vx', 'vy'];

function finite(value, fallback = 0) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function shortestHeadingDelta(from, to) {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function blendHeading(from, to, alpha) {
  if (!Number.isFinite(from)) return to;
  if (!Number.isFinite(to)) return from;
  return from + shortestHeadingDelta(from, to) * alpha;
}

function interpolatePose(before, after, alpha) {
  const pose = {
    systemId: after.systemId ?? before.systemId ?? null,
    time: before.time + (after.time - before.time) * alpha,
  };
  for (const field of POSITION_FIELDS) {
    pose[field] = finite(before[field]) + (finite(after[field]) - finite(before[field])) * alpha;
  }
  pose.heading = blendHeading(before.heading, after.heading, alpha);
  return pose;
}

function extrapolatePose(sample, ageMs) {
  const seconds = Math.max(0, ageMs) / 1000;
  return {
    ...sample,
    time: sample.time + Math.max(0, ageMs),
    x: finite(sample.x) + finite(sample.vx) * seconds,
    y: finite(sample.y) + finite(sample.vy) * seconds,
  };
}

export function createRemotePoseBuffer({
  interpolationDelayMs = 120,
  maxExtrapolationMs = 100,
  maxSamples = 8,
} = {}) {
  const histories = new Map();

  function push(id, pose, time) {
    if (id == null || !Number.isFinite(time) || !Number.isFinite(pose?.x) || !Number.isFinite(pose?.y)) {
      return false;
    }
    const key = String(id);
    const sample = {
      systemId: pose.systemId ?? null,
      time: Number(time),
      x: Number(pose.x),
      y: Number(pose.y),
      vx: finite(pose.vx),
      vy: finite(pose.vy),
      heading: finite(pose.heading),
    };
    let history = histories.get(key) ?? [];
    const last = history.at(-1);
    if (last && (sample.time < last.time || sample.systemId !== last.systemId)) history = [];
    if (history.at(-1)?.time === sample.time) history[history.length - 1] = sample;
    else history.push(sample);
    if (history.length > maxSamples) history.splice(0, history.length - maxSamples);
    histories.set(key, history);
    return true;
  }

  function sample(id, hostTime) {
    const history = histories.get(String(id)) ?? [];
    if (!history.length || !Number.isFinite(hostTime)) return null;
    const renderTime = hostTime - interpolationDelayMs;
    if (renderTime <= history[0].time) return { ...history[0] };

    for (let index = 1; index < history.length; index += 1) {
      const before = history[index - 1];
      const after = history[index];
      if (renderTime > after.time) continue;
      const span = Math.max(1, after.time - before.time);
      return interpolatePose(before, after, Math.max(0, Math.min(1, (renderTime - before.time) / span)));
    }

    const latest = history.at(-1);
    return extrapolatePose(latest, Math.min(maxExtrapolationMs, Math.max(0, renderTime - latest.time)));
  }

  return {
    push,
    sample,
    clear: (id) => {
      if (id == null) histories.clear();
      else histories.delete(String(id));
    },
    diagnostics: () => ({
      trackedEntities: histories.size,
      interpolationDelayMs,
      maxExtrapolationMs,
    }),
  };
}

/**
 * Reconcile a locally predicted pose toward the latest authoritative sample.
 * The blend is based on elapsed render time, so packet arrival cadence does not
 * change correction strength.
 */
export function reconcilePredictedPose(target, sample, {
  renderTimeMs,
  dtMs,
  maxErr,
  inputActive = false,
  forceSnap = false,
  maxProjectionMs = 250,
} = {}) {
  if (!target || !sample || !Number.isFinite(sample.x) || !Number.isFinite(sample.y)) {
    return { hardSnapped: false, err: 0, alpha: 0 };
  }
  const projected = extrapolatePose(
    sample,
    Math.min(maxProjectionMs, Math.max(0, finite(renderTimeMs) - finite(sample.time))),
  );
  const targetValid = Number.isFinite(target.x) && Number.isFinite(target.y);
  const dx = projected.x - finite(target.x, projected.x);
  const dy = projected.y - finite(target.y, projected.y);
  const err = Math.hypot(dx, dy);
  const budget = Math.max(1, finite(maxErr, 1));

  if (!targetValid || forceSnap || err > budget * 2.5) {
    target.x = projected.x;
    target.y = projected.y;
    target.vx = finite(projected.vx);
    target.vy = finite(projected.vy);
    if (Number.isFinite(projected.heading)) target.heading = projected.heading;
    return { hardSnapped: true, err, alpha: 1 };
  }

  const tauMs = err > budget ? 65 : (inputActive ? 220 : 140);
  const alpha = 1 - Math.exp(-Math.max(0, finite(dtMs)) / tauMs);
  target.x += dx * alpha;
  target.y += dy * alpha;

  const velocityTauMs = inputActive ? 350 : 120;
  const velocityAlpha = 1 - Math.exp(-Math.max(0, finite(dtMs)) / velocityTauMs);
  target.vx = finite(target.vx) + (finite(projected.vx) - finite(target.vx)) * velocityAlpha;
  target.vy = finite(target.vy) + (finite(projected.vy) - finite(target.vy)) * velocityAlpha;
  if (Number.isFinite(projected.heading)) {
    target.heading = blendHeading(target.heading, projected.heading, velocityAlpha);
  }
  return { hardSnapped: false, err, alpha };
}
