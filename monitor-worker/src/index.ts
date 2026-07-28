import { authenticateMobileRequest, AccessError } from './access';
import {
  aggregateTrendPoints,
  findings,
  HEARTBEAT_STALE_SECONDS,
  statusSnapshot,
  trendPoint,
  validateHeartbeat,
  type Finding,
  type Heartbeat,
  type TrendPoint,
} from './health';
import { formatLoginEmail, validateLoginEvent } from './login';

const LAST_KEY = 'state:last-heartbeat';
const ACTIVE_KEY = 'state:active-alerts';
const MAX_BODY = 64 * 1024;
const HISTORY_RETENTION_SECONDS = 32 * 86400;

function responseHeaders(request: Request, contentType?: string): Headers {
  const headers = new Headers({
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'self'; connect-src 'self'; img-src 'self'; font-src 'self'; style-src 'self'; script-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  });
  if (contentType) headers.set('content-type', contentType);
  if (new URL(request.url).protocol === 'https:') headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  return headers;
}

function json(request: Request, payload: unknown, status = 200): Response {
  return Response.json(payload, { status, headers: responseHeaders(request, 'application/json; charset=utf-8') });
}

async function boundedBody(request: Request): Promise<ArrayBuffer> {
  const announced = Number(request.headers.get('content-length') || 0);
  if (announced > MAX_BODY) throw new Error('body too large');
  if (!request.body) return new ArrayBuffer(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel();
      throw new Error('body too large');
    }
    chunks.push(value);
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output.buffer;
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let mismatch = a.byteLength ^ b.byteLength;
  const length = Math.max(a.byteLength, b.byteLength);
  for (let index = 0; index < length; index += 1) mismatch |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return mismatch === 0;
}

async function verifySignature(body: ArrayBuffer, supplied: string, secret: string): Promise<boolean> {
  if (!secret || secret.length < 32 || !/^[a-f0-9]{64}$/i.test(supplied)) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return constantTimeEqual(hex(await crypto.subtle.sign('HMAC', key, body)), supplied.toLowerCase());
}

async function verifyTextSignature(value: string, supplied: string, secret: string): Promise<boolean> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
  return constantTimeEqual(expected, supplied.toLowerCase());
}

function safeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

async function receiveArchive(request: Request, environment: Env, filename: string): Promise<Response> {
  if (!/^snapshot-[0-9]{8}T[0-9]{6}Z\.tar\.gz$/.test(filename)) return json(request, { ok: false, error: 'Invalid archive name' }, 400);
  const size = Number(request.headers.get('content-length') || 0);
  const checksum = (request.headers.get('x-gs-sha256') || '').toLowerCase();
  const timestamp = Number(request.headers.get('x-gs-timestamp') || 0);
  const signature = request.headers.get('x-gs-signature') || '';
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(size) || size < 1 || size > 100 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(checksum) || Math.abs(now - timestamp) > 300) return json(request, { ok: false, error: 'Invalid archive metadata' }, 400);
  if (!await verifyTextSignature(`${filename}\n${size}\n${checksum}\n${timestamp}`, signature, environment.ARCHIVE_UPLOAD_SECRET)) return json(request, { ok: false, error: 'Invalid signature' }, 403);
  if (!request.body) return json(request, { ok: false, error: 'Archive body required' }, 400);
  const key = `daily/${filename}`;
  const existing = await environment.ARCHIVE.head(key);
  if (existing) return json(request, { ok: false, error: 'Archive already exists' }, 409);
  const object = await environment.ARCHIVE.put(key, request.body, {
    sha256: checksum,
    httpMetadata: { contentType: 'application/gzip' },
    customMetadata: { uploadedBy: 'galactic-sovereign-ct' },
  });
  console.log(JSON.stringify({ event: 'immutable-archive', key, size: object.size }));
  return json(request, { ok: true, key, size: object.size, checksum: object.checksums.toJSON().sha256 });
}

async function send(environment: Env, subject: string, findingsList: Finding[], heartbeat: Heartbeat | null): Promise<void> {
  const lines = findingsList.length ? findingsList.map((item) => `- ${item.severity.toUpperCase()}: ${item.message}`) : ['- All monitored systems have recovered.'];
  const releaseLine = heartbeat ? `\nGame release: ${heartbeat.release}\nSite release: ${heartbeat.siteRelease}` : '';
  const text = `Galactic Sovereign production health update\n\n${lines.join('\n')}${releaseLine}`;
  const html = `<h1>Galactic Sovereign health</h1><ul>${lines.map((line) => `<li>${safeHtml(line.slice(2))}</li>`).join('')}</ul>${heartbeat ? `<p>Game release: ${safeHtml(heartbeat.release)}<br>Site release: ${safeHtml(heartbeat.siteRelease)}</p>` : ''}`;
  await environment.ALERT_EMAIL.send({
    to: environment.ALERT_TO,
    from: { email: environment.ALERT_FROM, name: 'Galactic Sovereign' },
    subject,
    text,
    html,
  });
}

async function reconcile(environment: Env, heartbeat: Heartbeat | null, current: Finding[]): Promise<void> {
  const previous = await environment.HEALTH.get<string[]>(ACTIVE_KEY, 'json') ?? [];
  const keys = current.map((item) => item.key).sort();
  if (keys.length === 0 && previous.length > 0) {
    await send(environment, 'RECOVERED: Galactic Sovereign is healthy', [], heartbeat);
    await environment.HEALTH.delete(ACTIVE_KEY);
    console.log(JSON.stringify({ event: 'recovery', previous }));
    return;
  }
  if (keys.length === 0) return;
  const fingerprint = keys.join(',');
  if (await environment.HEALTH.get(`dedupe:${fingerprint}`)) return;
  await send(environment, `ALERT: Galactic Sovereign ${current.some((item) => item.severity === 'critical') ? 'critical' : 'warning'}`, current, heartbeat);
  await Promise.all([
    environment.HEALTH.put(ACTIVE_KEY, JSON.stringify(keys)),
    environment.HEALTH.put(`dedupe:${fingerprint}`, '1', { expirationTtl: 1800 }),
  ]);
  console.log(JSON.stringify({ event: 'alert', findings: current }));
}

function historyKey(timestamp: number): string {
  return `history:${new Date(timestamp * 1000).toISOString().slice(0, 10)}`;
}

async function persistHistory(environment: Env, heartbeat: Heartbeat): Promise<void> {
  const key = historyKey(heartbeat.timestamp);
  const existing = await environment.HEALTH.get<TrendPoint[]>(key, 'json') ?? [];
  const points = existing
    .filter((point) => point && Number.isFinite(point.timestamp) && point.timestamp !== heartbeat.timestamp)
    .concat(trendPoint(heartbeat))
    .sort((left, right) => left.timestamp - right.timestamp)
    .slice(-300);
  await environment.HEALTH.put(key, JSON.stringify(points), { expirationTtl: HISTORY_RETENTION_SECONDS });
}

async function receiveHeartbeat(request: Request, environment: Env, context: ExecutionContext): Promise<Response> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return json(request, { ok: false, error: 'JSON body required' }, 415);
  let body: ArrayBuffer;
  try {
    body = await boundedBody(request);
  } catch {
    return json(request, { ok: false, error: 'Invalid body' }, 413);
  }
  const supplied = request.headers.get('x-gs-signature') || '';
  if (!await verifySignature(body, supplied, environment.HEARTBEAT_SECRET)) return json(request, { ok: false, error: 'Invalid signature' }, 403);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return json(request, { ok: false, error: 'Invalid JSON' }, 400);
  }
  const heartbeat = validateHeartbeat(parsed);
  const now = Math.floor(Date.now() / 1000);
  if (!heartbeat || Math.abs(now - heartbeat.timestamp) > 300) return json(request, { ok: false, error: 'Invalid or stale heartbeat' }, 400);

  const previous = await environment.HEALTH.get<Heartbeat>(LAST_KEY, 'json');
  if (previous && heartbeat.timestamp <= previous.timestamp) {
    return json(request, { ok: true, accepted: false, reason: heartbeat.timestamp === previous.timestamp ? 'duplicate' : 'out-of-order' }, 202);
  }

  await Promise.all([
    environment.HEALTH.put(LAST_KEY, JSON.stringify(heartbeat), { expirationTtl: 86400 * 45 }),
    persistHistory(environment, heartbeat),
  ]);
  context.waitUntil(reconcile(environment, heartbeat, findings(heartbeat, now)));
  return json(request, { ok: true, accepted: true });
}


async function receiveLogin(request: Request, environment: Env): Promise<Response> {
  let body: ArrayBuffer;
  try { body = await boundedBody(request); } catch { return json(request, { ok: false, error: 'Invalid body' }, 413); }
  const supplied = request.headers.get('x-gs-signature') || '';
  if (!supplied || !await verifySignature(body, supplied, environment.LOGIN_NOTIFICATION_SECRET)) {
    return json(request, { ok: false, error: 'Invalid signature' }, 403);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder().decode(body)); } catch {
    return json(request, { ok: false, error: 'Invalid JSON' }, 400);
  }
  const event = validateLoginEvent(parsed);
  const now = Math.floor(Date.now() / 1_000);
  if (!event || Math.abs(now - event.timestamp) > 300) {
    return json(request, { ok: false, error: 'Invalid or stale login event' }, 400);
  }
  const dedupeKey = `login-event:${event.eventId}`;
  if (await environment.HEALTH.get(dedupeKey)) return json(request, { ok: true, duplicate: true });
  const message = formatLoginEmail(event);
  try {
    await environment.ALERT_EMAIL.send({
      to: environment.ALERT_TO,
      from: { email: environment.ALERT_FROM, name: 'Galactic Sovereign' },
      ...message,
    });
    await environment.HEALTH.put(dedupeKey, 'sent', { expirationTtl: 86400 });
  } catch (error) {
    console.error({ event: 'login-email-failed', eventId: event.eventId, error: String(error) });
    return json(request, { ok: false, error: 'Email delivery failed' }, 503);
  }
  console.log({ event: 'login-email-sent', eventId: event.eventId, type: event.type, username: event.user.username });
  return json(request, { ok: true });
}

async function scheduledCheck(environment: Env): Promise<void> {
  const last = await environment.HEALTH.get<Heartbeat>(LAST_KEY, 'json');
  const now = Math.floor(Date.now() / 1000);
  if (!last) return;
  if (now - last.timestamp > HEARTBEAT_STALE_SECONDS) await reconcile(environment, last, [{ key: 'heartbeat-missed', severity: 'critical', message: 'Three consecutive CT heartbeats were missed' }]);
  else await reconcile(environment, last, findings(last, now));
}

function utcDaysBetween(fromSeconds: number, toSeconds: number): string[] {
  const dates: string[] = [];
  const start = new Date(fromSeconds * 1000);
  start.setUTCHours(0, 0, 0, 0);
  for (let cursor = start.getTime(); cursor <= toSeconds * 1000; cursor += 86400 * 1000) dates.push(new Date(cursor).toISOString().slice(0, 10));
  return dates;
}

async function statusHistory(environment: Env, period: string): Promise<TrendPoint[]> {
  const configs = {
    '24h': { duration: 86400, bucket: 15 * 60 },
    '7d': { duration: 7 * 86400, bucket: 60 * 60 },
    '30d': { duration: 30 * 86400, bucket: 6 * 60 * 60 },
  } as const;
  const config = configs[period as keyof typeof configs] ?? configs['24h'];
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - config.duration;
  const partitions = await Promise.all(utcDaysBetween(cutoff, now).map((date) => environment.HEALTH.get<TrendPoint[]>(`history:${date}`, 'json')));
  const points = partitions.flatMap((partition) => partition ?? []).filter((point) => point.timestamp >= cutoff && point.timestamp <= now);
  return aggregateTrendPoints(points, config.bucket);
}

async function mobileApi(request: Request, environment: Env, identity: Awaited<ReturnType<typeof authenticateMobileRequest>>): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== 'GET' && request.method !== 'HEAD') return json(request, { ok: false, error: 'Method not allowed' }, 405);
  if (url.pathname === '/api/session') {
    return json(request, {
      ok: true,
      identity: { email: identity.email, expiresAt: identity.expiresAt },
      logoutUrl: '/cdn-cgi/access/logout',
    });
  }
  if (url.pathname === '/api/status') {
    const heartbeat = await environment.HEALTH.get<Heartbeat>(LAST_KEY, 'json');
    return json(request, { ok: true, status: statusSnapshot(heartbeat, Math.floor(Date.now() / 1000)) });
  }
  if (url.pathname === '/api/history') {
    const period = url.searchParams.get('period') || '24h';
    if (!['24h', '7d', '30d'].includes(period)) return json(request, { ok: false, error: 'Period must be 24h, 7d, or 30d' }, 400);
    return json(request, { ok: true, period, points: await statusHistory(environment, period) });
  }
  return json(request, { ok: false, error: 'API route not found' }, 404);
}

function isLocalPreview(request: Request, environment: Env): boolean {
  const host = new URL(request.url).hostname.toLowerCase();
  return environment.LOCAL_DEV_BYPASS === '1' && (host === 'localhost' || host === '127.0.0.1');
}

async function serveMobileAsset(request: Request, environment: Env): Promise<Response> {
  const assetResponse = await environment.ASSETS.fetch(request);
  const headers = new Headers(assetResponse.headers);
  responseHeaders(request).forEach((value, name) => headers.set(name, value));
  const url = new URL(request.url);
  if (url.pathname !== '/' && /\.[A-Za-z0-9]+$/.test(url.pathname)) headers.set('cache-control', 'private, max-age=86400');
  return new Response(assetResponse.body, { status: assetResponse.status, statusText: assetResponse.statusText, headers });
}

export default {
  async fetch(request, environment, context): Promise<Response> {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();
    const monitorRequest = host === environment.MONITOR_HOST.toLowerCase() || isLocalPreview(request, environment);
    const mobileRequest = host === environment.MOBILE_HOST.toLowerCase() || isLocalPreview(request, environment);

    if (monitorRequest && request.method === 'POST' && url.pathname === '/heartbeat') return receiveHeartbeat(request, environment, context);
    if (monitorRequest && request.method === 'POST' && url.pathname === '/events/login') return receiveLogin(request, environment);
    const archiveMatch = /^\/archive\/daily\/([^/]+)$/.exec(url.pathname);
    if (monitorRequest && request.method === 'PUT' && archiveMatch) return receiveArchive(request, environment, decodeURIComponent(archiveMatch[1]!));
    if (monitorRequest && request.method === 'GET' && url.pathname === '/healthz') {
      const last = await environment.HEALTH.get<Heartbeat>(LAST_KEY, 'json');
      const age = last ? Math.max(0, Math.floor(Date.now() / 1000) - last.timestamp) : null;
      return json(request, { ok: age !== null && age <= HEARTBEAT_STALE_SECONDS, heartbeatAgeSeconds: age });
    }

    if (!mobileRequest) {
      console.log(JSON.stringify({ event: 'host-rejected', host, monitorHost: environment.MONITOR_HOST, mobileHost: environment.MOBILE_HOST, localPreview: isLocalPreview(request, environment) }));
      return new Response('Not found', { status: 404, headers: responseHeaders(request, 'text/plain; charset=utf-8') });
    }
    try {
      const identity = await authenticateMobileRequest(request, environment);
      if (url.pathname.startsWith('/api/')) return mobileApi(request, environment, identity);
      if (!['GET', 'HEAD'].includes(request.method)) return json(request, { ok: false, error: 'Method not allowed' }, 405);
      return serveMobileAsset(request, environment);
    } catch (error) {
      const status = error instanceof AccessError ? error.status : 403;
      const message = status === 503 ? 'Mobile identity verification is unavailable' : status === 404 ? 'Not found' : 'Authentication required';
      return json(request, { ok: false, error: message }, status);
    }
  },
  async scheduled(_controller, environment, context): Promise<void> {
    context.waitUntil(scheduledCheck(environment));
  },
} satisfies ExportedHandler<Env>;
