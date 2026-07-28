import crypto from 'node:crypto';

const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_RETRY_DELAYS_MS = [0, 250, 1_000];
export const LOGIN_EVENT_TYPES = Object.freeze(['user.login', 'solo.enter', 'multiplayer.join']);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertConfiguration(endpoint, secret, production) {
  if (!endpoint) return null;
  if (!secret) throw new Error('GS_LOGIN_NOTIFICATION_URL requires login-notification-secret');
  const url = new URL(endpoint);
  if (production && url.protocol !== 'https:') {
    throw new Error('GS_LOGIN_NOTIFICATION_URL must use HTTPS in production');
  }
  if (Buffer.byteLength(secret) < 32) {
    throw new Error('login-notification-secret must be at least 32 bytes');
  }
  return url.toString();
}

function normalizeContext(context) {
  if (!context || typeof context !== 'object') return undefined;
  const out = {};
  if (typeof context.mode === 'string' && context.mode.trim()) {
    out.mode = context.mode.trim().slice(0, 32);
  }
  if (typeof context.reason === 'string' && context.reason.trim()) {
    out.reason = context.reason.trim().slice(0, 32);
  }
  return Object.keys(out).length ? out : undefined;
}

export function createLoginNotifier({
  endpoint = '',
  secret = '',
  production = process.env.NODE_ENV === 'production',
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
  logger = console,
  now = () => Date.now(),
  randomUUID = () => crypto.randomUUID(),
} = {}) {
  const target = assertConfiguration(String(endpoint).trim(), String(secret), production);
  if (!target) return { enabled: false, notify: async () => false };

  async function notify(user, { type = 'user.login', context } = {}) {
    if (!LOGIN_EVENT_TYPES.includes(type)) {
      throw new Error(`Unsupported login notification type: ${type}`);
    }
    const payload = {
      version: 1,
      type,
      eventId: randomUUID(),
      timestamp: Math.floor(now() / 1_000),
      user: {
        id: String(user.id),
        username: String(user.username),
        displayName: String(user.displayName),
        role: String(user.role),
      },
    };
    const normalizedContext = normalizeContext(context);
    if (normalizedContext) payload.context = normalizedContext;
    const body = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
    let lastError = null;

    for (const delayMs of retryDelaysMs) {
      if (delayMs > 0) await sleep(delayMs);
      try {
        const response = await fetchImpl(target, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-gs-signature': signature,
          },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (response.ok) return true;
        lastError = new Error(`HTTP ${response.status}`);
        if (response.status >= 400 && response.status < 500 && response.status !== 429) break;
      } catch (error) {
        lastError = error;
      }
    }

    logger.error('[app] login notification failed', {
      eventId: payload.eventId,
      type: payload.type,
      username: payload.user.username,
      error: String(lastError?.message || lastError || 'unknown error'),
    });
    return false;
  }

  return { enabled: true, notify };
}
