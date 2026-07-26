/**
 * Latest-value relay for high-frequency co-op control input.
 *
 * WebSocket delivery remains reliable and ordered. This relay only limits how
 * often non-zero changes are enqueued while guaranteeing that the newest
 * direction is sent at the trailing edge of the throttle window.
 */
export function createCoopInputRelay({
  send,
  minIntervalMs = 50,
  now = () => performance.now(),
  schedule = (callback, delayMs) => setTimeout(callback, delayMs),
  cancel = (timer) => clearTimeout(timer),
} = {}) {
  if (typeof send !== 'function') throw new TypeError('createCoopInputRelay requires send');

  let desired = { x: 0, y: 0 };
  let sent = { x: 0, y: 0 };
  let sentAt = -Infinity;
  let timer = null;

  const sameInput = (a, b) => a.x === b.x && a.y === b.y;

  function clearScheduled() {
    if (timer == null) return;
    cancel(timer);
    timer = null;
  }

  function dispatchLatest() {
    clearScheduled();
    if (sameInput(desired, sent)) return false;
    sent = { ...desired };
    sentAt = now();
    send(sent.x, sent.y);
    return true;
  }

  function scheduleTrailing() {
    if (timer != null) return;
    const remaining = Math.max(0, minIntervalMs - (now() - sentAt));
    timer = schedule(() => {
      timer = null;
      dispatchLatest();
    }, remaining);
  }

  function update(x, y) {
    desired = { x, y };
    if (sameInput(desired, sent)) {
      clearScheduled();
      return false;
    }

    const releasing = x === 0 && y === 0;
    if (releasing || now() - sentAt >= minIntervalMs) {
      return dispatchLatest();
    }

    scheduleTrailing();
    return false;
  }

  function reset({ preserveDesired = false, resendDesired = false } = {}) {
    const previousDesired = desired;
    clearScheduled();
    desired = preserveDesired ? previousDesired : { x: 0, y: 0 };
    sent = { x: 0, y: 0 };
    sentAt = -Infinity;
    if (resendDesired && !sameInput(desired, sent)) dispatchLatest();
  }

  return {
    update,
    reset,
    dispose: () => reset(),
    snapshot: () => ({
      desired: { ...desired },
      sent: { ...sent },
      sentAt,
      trailingScheduled: timer != null,
    }),
  };
}
