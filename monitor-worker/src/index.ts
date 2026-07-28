import { findings, validateHeartbeat, type Finding, type Heartbeat } from './health';
import { formatLoginEmail, validateLoginEvent } from './login';

const LAST_KEY = 'state:last-heartbeat';
const ACTIVE_KEY = 'state:active-alerts';
const MAX_BODY = 64 * 1024;
/** CT posts heartbeats every 5 minutes; alert after three consecutive misses. */
const HEARTBEAT_STALE_SECONDS = 900;

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
    if (size > MAX_BODY) { await reader.cancel(); throw new Error('body too large'); }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return out.buffer;
}

function hex(bytes: ArrayBuffer): string { return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
function constantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let mismatch = a.byteLength ^ b.byteLength;
  const length = Math.max(a.byteLength, b.byteLength);
  for (let index = 0; index < length; index += 1) mismatch |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return mismatch === 0;
}
async function verifySignature(body: ArrayBuffer, supplied: string, secret: string): Promise<boolean> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return constantTimeEqual(hex(await crypto.subtle.sign('HMAC', key, body)), supplied.toLowerCase());
}

async function verifyTextSignature(value: string, supplied: string, secret: string): Promise<boolean> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
  return constantTimeEqual(expected, supplied.toLowerCase());
}

async function receiveArchive(request: Request, env: Env, filename: string): Promise<Response> {
  if (!/^snapshot-[0-9]{8}T[0-9]{6}Z\.tar\.gz$/.test(filename)) return Response.json({ ok: false, error: 'Invalid archive name' }, { status: 400 });
  const size = Number(request.headers.get('content-length') || 0);
  const checksum = (request.headers.get('x-gs-sha256') || '').toLowerCase();
  const timestamp = Number(request.headers.get('x-gs-timestamp') || 0);
  const signature = request.headers.get('x-gs-signature') || '';
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(size) || size < 1 || size > 100 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(checksum) || Math.abs(now - timestamp) > 300) return Response.json({ ok: false, error: 'Invalid archive metadata' }, { status: 400 });
  if (!await verifyTextSignature(`${filename}\n${size}\n${checksum}\n${timestamp}`, signature, env.ARCHIVE_UPLOAD_SECRET)) return Response.json({ ok: false, error: 'Invalid signature' }, { status: 403 });
  if (!request.body) return Response.json({ ok: false, error: 'Archive body required' }, { status: 400 });
  const key = `daily/${filename}`;
  const existing = await env.ARCHIVE.head(key);
  if (existing) return Response.json({ ok: false, error: 'Archive already exists' }, { status: 409 });
  const object = await env.ARCHIVE.put(key, request.body, { sha256: checksum, httpMetadata: { contentType: 'application/gzip' }, customMetadata: { uploadedBy: 'galactic-sovereign-ct' } });
  console.log({ event: 'immutable-archive', key, size: object.size });
  return Response.json({ ok: true, key, size: object.size, checksum: object.checksums.toJSON().sha256 });
}

async function send(env: Env, subject: string, findingsList: Finding[], heartbeat: Heartbeat | null): Promise<void> {
  const lines = findingsList.length ? findingsList.map((item) => `- ${item.severity.toUpperCase()}: ${item.message}`) : ['- All monitored systems have recovered.'];
  const releaseLine = heartbeat ? `\nGame release: ${heartbeat.release}\nSite release: ${heartbeat.siteRelease}` : '';
  const text = `Galactic Sovereign production health update\n\n${lines.join('\n')}${releaseLine}`;
  const html = `<h1>Galactic Sovereign health</h1><ul>${lines.map((line) => `<li>${line.slice(2)}</li>`).join('')}</ul>${heartbeat ? `<p>Game release: ${heartbeat.release}<br>Site release: ${heartbeat.siteRelease}</p>` : ''}`;
  await env.ALERT_EMAIL.send({ to: env.ALERT_TO, from: { email: env.ALERT_FROM, name: 'Galactic Sovereign' }, subject, text, html });
}

async function reconcile(env: Env, heartbeat: Heartbeat | null, current: Finding[]): Promise<void> {
  const previous = await env.HEALTH.get<string[]>(ACTIVE_KEY, 'json') ?? [];
  const keys = current.map((item) => item.key).sort();
  if (keys.length === 0 && previous.length > 0) {
    await send(env, 'RECOVERED: Galactic Sovereign is healthy', [], heartbeat);
    await env.HEALTH.delete(ACTIVE_KEY);
    console.log({ event: 'recovery', previous });
    return;
  }
  if (keys.length === 0) return;
  const fingerprint = keys.join(',');
  if (await env.HEALTH.get(`dedupe:${fingerprint}`)) return;
  await send(env, `ALERT: Galactic Sovereign ${current.some((item) => item.severity === 'critical') ? 'critical' : 'warning'}`, current, heartbeat);
  await Promise.all([
    env.HEALTH.put(ACTIVE_KEY, JSON.stringify(keys)),
    env.HEALTH.put(`dedupe:${fingerprint}`, '1', { expirationTtl: 1800 }),
  ]);
  console.log({ event: 'alert', findings: current });
}

async function receiveHeartbeat(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  let body: ArrayBuffer;
  try { body = await boundedBody(request); } catch { return Response.json({ ok: false, error: 'Invalid body' }, { status: 413 }); }
  const supplied = request.headers.get('x-gs-signature') || '';
  if (!supplied || !await verifySignature(body, supplied, env.HEARTBEAT_SECRET)) return Response.json({ ok: false, error: 'Invalid signature' }, { status: 403 });
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder().decode(body)); } catch { return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }
  const heartbeat = validateHeartbeat(parsed);
  const now = Math.floor(Date.now() / 1000);
  if (!heartbeat || Math.abs(now - heartbeat.timestamp) > 300) return Response.json({ ok: false, error: 'Invalid or stale heartbeat' }, { status: 400 });
  await env.HEALTH.put(LAST_KEY, JSON.stringify(heartbeat), { expirationTtl: 86400 * 45 });
  ctx.waitUntil(reconcile(env, heartbeat, findings(heartbeat, now)));
  return Response.json({ ok: true });
}

async function receiveLogin(request: Request, env: Env): Promise<Response> {
  let body: ArrayBuffer;
  try { body = await boundedBody(request); } catch { return Response.json({ ok: false, error: 'Invalid body' }, { status: 413 }); }
  const supplied = request.headers.get('x-gs-signature') || '';
  if (!supplied || !await verifySignature(body, supplied, env.LOGIN_NOTIFICATION_SECRET)) {
    return Response.json({ ok: false, error: 'Invalid signature' }, { status: 403 });
  }
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder().decode(body)); } catch {
    return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }
  const event = validateLoginEvent(parsed);
  const now = Math.floor(Date.now() / 1_000);
  if (!event || Math.abs(now - event.timestamp) > 300) {
    return Response.json({ ok: false, error: 'Invalid or stale login event' }, { status: 400 });
  }
  const dedupeKey = `login-event:${event.eventId}`;
  if (await env.HEALTH.get(dedupeKey)) return Response.json({ ok: true, duplicate: true });
  const message = formatLoginEmail(event);
  try {
    await env.ALERT_EMAIL.send({
      to: env.ALERT_TO,
      from: { email: env.ALERT_FROM, name: 'Galactic Sovereign' },
      ...message,
    });
    await env.HEALTH.put(dedupeKey, 'sent', { expirationTtl: 86400 });
  } catch (error) {
    console.error({ event: 'login-email-failed', eventId: event.eventId, error: String(error) });
    return Response.json({ ok: false, error: 'Email delivery failed' }, { status: 503 });
  }
  console.log({ event: 'login-email-sent', eventId: event.eventId, type: event.type, username: event.user.username });
  return Response.json({ ok: true });
}

async function scheduledCheck(env: Env): Promise<void> {
  const last = await env.HEALTH.get<Heartbeat>(LAST_KEY, 'json');
  const now = Math.floor(Date.now() / 1000);
  if (!last) return;
  if (now - last.timestamp > HEARTBEAT_STALE_SECONDS) await reconcile(env, last, [{ key: 'heartbeat-missed', severity: 'critical', message: 'Three consecutive CT heartbeats were missed' }]);
  else await reconcile(env, last, findings(last, now));
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/heartbeat') return receiveHeartbeat(request, env, ctx);
    if (request.method === 'POST' && url.pathname === '/events/login') return receiveLogin(request, env);
    const archiveMatch = /^\/archive\/daily\/([^/]+)$/.exec(url.pathname);
    if (request.method === 'PUT' && archiveMatch) return receiveArchive(request, env, decodeURIComponent(archiveMatch[1]!));
    if (request.method === 'GET' && url.pathname === '/healthz') {
      const last = await env.HEALTH.get<Heartbeat>(LAST_KEY, 'json');
      const age = last ? Math.max(0, Math.floor(Date.now() / 1000) - last.timestamp) : null;
      return Response.json({ ok: age !== null && age <= HEARTBEAT_STALE_SECONDS, heartbeatAgeSeconds: age }, { headers: { 'cache-control': 'no-store' } });
    }
    return new Response('Not found', { status: 404 });
  },
  async scheduled(_controller, env, ctx): Promise<void> { ctx.waitUntil(scheduledCheck(env)); },
} satisfies ExportedHandler<Env>;
