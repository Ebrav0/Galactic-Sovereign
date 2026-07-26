#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const API = 'https://api.cloudflare.com/client/v4';

function requireEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const ACCOUNT_ID = requireEnv('CF_ACCOUNT_ID');
const ZONE_ID = requireEnv('CF_ZONE_ID');
const TUNNEL_ID = requireEnv('CF_TUNNEL_ID');
const HOSTNAME = String(process.env.CF_SITE_HOSTNAME || 'galacticsovereign.xyz').trim();
const SERVICE = String(process.env.CF_SITE_SERVICE || 'http://127.0.0.1:8081').trim();
const TOKEN = String(process.env.CLOUDFLARE_API_TOKEN || '').trim();

if (!TOKEN) throw new Error('CLOUDFLARE_API_TOKEN is required');

async function request(method, apiPath, body) {
  const response = await fetch(`${API}${apiPath}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok || payload.success === false) {
    throw new Error(`${method} ${apiPath} failed (${response.status}): ${JSON.stringify(payload.errors || payload.messages || [])}`);
  }
  return payload.result;
}

const tunnelPath = `/accounts/${ACCOUNT_ID}/cfd_tunnel/${TUNNEL_ID}/configurations`;
const current = await request('GET', tunnelPath);
const config = structuredClone(current?.config || {});
const ingress = Array.isArray(config.ingress) ? config.ingress : [];
const catchAll = ingress.find((rule) => !rule.hostname && !rule.path) || { service: 'http_status:404' };
const preserved = ingress.filter((rule) => rule.hostname && String(rule.hostname).toLowerCase() !== HOSTNAME);
const nextIngress = [
  { hostname: HOSTNAME, service: SERVICE },
  ...preserved,
  { service: catchAll.service || 'http_status:404' },
];

const backupDir = path.resolve(process.env.CF_EXPORT_DIR || 'output/infra-baseline');
fs.mkdirSync(backupDir, { recursive: true });
const timestamp = new Date().toISOString().replace(/[-:.]/g, '').replace('T', '-').replace('Z', 'Z');
const exportPath = path.join(backupDir, `cloudflare-tunnel-before-apex-${timestamp}.json`);
fs.writeFileSync(exportPath, `${JSON.stringify({ accountId: ACCOUNT_ID, tunnelId: TUNNEL_ID, config }, null, 2)}\n`, { mode: 0o600 });

if (JSON.stringify(ingress) !== JSON.stringify(nextIngress)) {
  await request('PUT', tunnelPath, { config: { ...config, ingress: nextIngress } });
}

const target = `${TUNNEL_ID}.cfargotunnel.com`;
let dnsAction = 'skipped';
if (process.env.CF_SKIP_DNS !== '1') {
  const recordQuery = `/zones/${ZONE_ID}/dns_records?type=CNAME&name=${encodeURIComponent(HOSTNAME)}`;
  const records = await request('GET', recordQuery);
  const existing = Array.isArray(records) ? records.find((record) => record.name === HOSTNAME) : null;
  dnsAction = 'unchanged';
  if (!existing) {
    await request('POST', `/zones/${ZONE_ID}/dns_records`, {
      type: 'CNAME', name: '@', content: target, proxied: true, ttl: 1,
    });
    dnsAction = 'created';
  } else if (existing.content.replace(/\.$/, '') !== target || existing.proxied !== true) {
    await request('PUT', `/zones/${ZONE_ID}/dns_records/${existing.id}`, {
      type: 'CNAME', name: '@', content: target, proxied: true, ttl: 1,
    });
    dnsAction = 'updated';
  }
}

console.log(JSON.stringify({
  ok: true,
  hostname: HOSTNAME,
  service: SERVICE,
  dnsAction,
  tunnelIngress: nextIngress.map((rule) => rule.hostname ? { hostname: rule.hostname, service: rule.service } : { service: rule.service }),
  rollbackExport: exportPath,
}, null, 2));
