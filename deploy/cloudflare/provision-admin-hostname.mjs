#!/usr/bin/env node
/**
 * Provision admin.galacticsovereign.xyz on the existing Cloudflare Tunnel:
 * tunnel ingress, proxied DNS CNAME, and Zero Trust Access (whole host).
 *
 * Env:
 *   CLOUDFLARE_API_TOKEN   (required)
 *   CF_ACCOUNT_ID          (default: galactic-sovereign account)
 *   CF_TUNNEL_ID           (default: galactic-sovereign tunnel)
 *   CF_ACCESS_OWNER_EMAIL  (required when creating an Access app)
 *
 * Never prints the API token. Exits non-zero on API failures.
 */

const API = 'https://api.cloudflare.com/client/v4';

const ZONE_NAME = 'galacticsovereign.xyz';
const PLAY_HOST = 'play.galacticsovereign.xyz';
const ADMIN_HOST = 'admin.galacticsovereign.xyz';
const ORIGIN_SERVICE = 'http://127.0.0.1:8080';
const CATCH_ALL = { service: 'http_status:404' };

const DEFAULT_ACCOUNT_ID = 'c5622d4df2987b072f2316b48515aa66';
const DEFAULT_TUNNEL_ID = 'd4b4a4ea-ddaf-4bec-bc97-8f9155d56d06';

function die(message, detail) {
  const err = { ok: false, error: message };
  if (detail !== undefined) err.detail = detail;
  console.error(JSON.stringify(err, null, 2));
  process.exit(1);
}

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) die(`Missing required env ${name}`);
  return value;
}

function authHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function cfFetch(token, method, path, body, { optional = false } = {}) {
  const url = path.startsWith('http') ? path : `${API}${path}`;
  const init = { method, headers: authHeaders(token) };
  if (body !== undefined) init.body = JSON.stringify(body);

  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (optional) return null;
    die(`Network error calling ${method} ${path}`, String(err?.message || err));
  }

  let json;
  try {
    json = await res.json();
  } catch {
    if (optional) return null;
    die(`Non-JSON response from ${method} ${path}`, { status: res.status });
  }

  if (!res.ok || json?.success === false) {
    if (optional) return null;
    die(`Cloudflare API failure: ${method} ${path}`, {
      status: res.status,
      errors: json?.errors ?? null,
      messages: json?.messages ?? null,
    });
  }

  return json;
}

async function listAll(token, path, resultKey = 'result') {
  const items = [];
  let page = 1;
  for (;;) {
    const sep = path.includes('?') ? '&' : '?';
    const json = await cfFetch(token, 'GET', `${path}${sep}page=${page}&per_page=50`);
    const batch = json[resultKey] ?? json.result ?? [];
    if (!Array.isArray(batch)) {
      die(`Expected array from ${path}`, { type: typeof batch });
    }
    items.push(...batch);
    const totalPages = Number(json.result_info?.total_pages || 1);
    if (page >= totalPages || batch.length === 0) break;
    page += 1;
  }
  return items;
}

function hostnameRule(hostname) {
  return { hostname, service: ORIGIN_SERVICE };
}

function isCatchAll(rule) {
  return rule && !rule.hostname && !rule.path;
}

function ensureIngress(existingIngress) {
  const ingress = Array.isArray(existingIngress) ? existingIngress.map((r) => ({ ...r })) : [];
  const catchAll = ingress.find(isCatchAll) || { ...CATCH_ALL };
  const withoutCatchAll = ingress.filter((r) => !isCatchAll(r));

  const byHost = new Map();
  for (const rule of withoutCatchAll) {
    if (rule.hostname) byHost.set(String(rule.hostname).toLowerCase(), rule);
  }

  byHost.set(PLAY_HOST, { ...(byHost.get(PLAY_HOST) || {}), ...hostnameRule(PLAY_HOST) });
  byHost.set(ADMIN_HOST, { ...(byHost.get(ADMIN_HOST) || {}), ...hostnameRule(ADMIN_HOST) });

  // Preserve other host rules, then ensure play + admin, then catch-all last.
  const others = [];
  for (const [host, rule] of byHost) {
    if (host === PLAY_HOST || host === ADMIN_HOST) continue;
    others.push(rule);
  }

  const next = [
    ...others,
    byHost.get(PLAY_HOST),
    byHost.get(ADMIN_HOST),
    { service: catchAll.service || CATCH_ALL.service },
  ];

  const before = JSON.stringify(ingress);
  const after = JSON.stringify(next);
  return { ingress: next, changed: before !== after };
}

function appCoversHost(app, host) {
  const targets = [];
  if (app?.domain) targets.push(String(app.domain));
  if (Array.isArray(app?.self_hosted_domains)) {
    for (const d of app.self_hosted_domains) targets.push(String(d));
  }
  if (Array.isArray(app?.destinations)) {
    for (const d of app.destinations) {
      if (d?.uri) targets.push(String(d.uri));
      if (d?.hostname) targets.push(String(d.hostname));
    }
  }

  const hostLower = host.toLowerCase();
  return targets.some((raw) => {
    const s = String(raw).toLowerCase();
    if (s === hostLower) return true;
    if (s.startsWith(`${hostLower}/`)) return true;
    // Wildcard host forms like *.galacticsovereign.xyz
    if (s.startsWith('*.') && hostLower.endsWith(s.slice(1))) return true;
    return false;
  });
}

function isPlayAdminApp(app) {
  if (appCoversHost(app, ADMIN_HOST)) return false;
  const name = String(app?.name || '').toLowerCase();
  const blobs = [
    name,
    String(app?.domain || ''),
    ...(Array.isArray(app?.self_hosted_domains) ? app.self_hosted_domains : []),
    ...(Array.isArray(app?.destinations)
      ? app.destinations.map((d) => d?.uri || d?.hostname || '')
      : []),
  ]
    .map((s) => String(s).toLowerCase())
    .join('\n');

  const mentionsPlayAdmin =
    blobs.includes(`${PLAY_HOST}/admin`) ||
    blobs.includes(`${PLAY_HOST}/api/v1/admin`) ||
    (blobs.includes(PLAY_HOST) && (blobs.includes('/admin') || name.includes('admin')));

  return mentionsPlayAdmin;
}

function extractIncludeEmails(policies) {
  const includes = [];
  if (!Array.isArray(policies)) return includes;
  for (const policy of policies) {
    if (!Array.isArray(policy?.include)) continue;
    for (const rule of policy.include) {
      if (rule?.email?.email) {
        includes.push({ email: { email: String(rule.email.email) } });
      } else if (typeof rule?.email === 'string') {
        includes.push({ email: { email: rule.email } });
      } else if (rule?.emails) {
        // Rare shape — skip unknown structures
        includes.push(rule);
      } else if (rule?.email_domain || rule?.email_list || rule?.everyone) {
        includes.push(rule);
      }
    }
  }
  // De-dupe by JSON
  const seen = new Set();
  return includes.filter((item) => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function getAppPolicies(token, accountId, appId) {
  const json = await cfFetch(token, 'GET', `/accounts/${accountId}/access/apps/${appId}`);
  const app = json.result;
  if (Array.isArray(app?.policies) && app.policies.length) return app.policies;
  const nested = await cfFetch(
    token,
    'GET',
    `/accounts/${accountId}/access/apps/${appId}/policies`,
    undefined,
    { optional: true },
  );
  if (Array.isArray(nested?.result)) return nested.result;
  return Array.isArray(app?.policies) ? app.policies : [];
}

async function main() {
  const token = requireEnv('CLOUDFLARE_API_TOKEN');
  const accountId = process.env.CF_ACCOUNT_ID?.trim() || DEFAULT_ACCOUNT_ID;
  const tunnelId = process.env.CF_TUNNEL_ID?.trim() || DEFAULT_TUNNEL_ID;
  const tunnelCnameTarget = `${tunnelId}.cfargotunnel.com`;

  const summary = {
    ok: true,
    accountId,
    tunnelId,
    zone: ZONE_NAME,
    playHost: PLAY_HOST,
    adminHost: ADMIN_HOST,
    actions: {
      tunnelIngress: 'unchanged',
      dns: 'unchanged',
      access: 'unchanged',
    },
    details: {},
  };

  // 3. Find zone
  const zones = await listAll(token, `/zones?name=${encodeURIComponent(ZONE_NAME)}`);
  const zone = zones.find((z) => z.name === ZONE_NAME);
  if (!zone?.id) die(`Zone not found: ${ZONE_NAME}`);
  summary.details.zoneId = zone.id;

  // 4–5. Tunnel configuration
  const cfgRes = await cfFetch(
    token,
    'GET',
    `/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`,
  );
  const currentConfig = cfgRes.result?.config && typeof cfgRes.result.config === 'object'
    ? { ...cfgRes.result.config }
    : {};
  const { ingress, changed: ingressChanged } = ensureIngress(currentConfig.ingress);
  summary.details.ingress = ingress.map((r) =>
    r.hostname ? { hostname: r.hostname, service: r.service } : { service: r.service },
  );

  if (ingressChanged) {
    const nextConfig = { ...currentConfig, ingress };
    await cfFetch(
      token,
      'PUT',
      `/accounts/${accountId}/cfd_tunnel/${tunnelId}/configurations`,
      { config: nextConfig },
    );
    summary.actions.tunnelIngress = 'updated';
  }

  // 6. DNS CNAME admin -> {tunnel_id}.cfargotunnel.com (proxied)
  const dnsRecords = await listAll(
    token,
    `/zones/${zone.id}/dns_records?name=${encodeURIComponent(ADMIN_HOST)}`,
  );
  const adminDns = dnsRecords.find(
    (r) => r.type === 'CNAME' && String(r.name).toLowerCase() === ADMIN_HOST,
  );

  if (!adminDns) {
    const created = await cfFetch(token, 'POST', `/zones/${zone.id}/dns_records`, {
      type: 'CNAME',
      name: 'admin',
      content: tunnelCnameTarget,
      proxied: true,
      ttl: 1,
    });
    summary.actions.dns = 'created';
    summary.details.dnsRecordId = created.result?.id ?? null;
  } else {
    const content = String(adminDns.content || '').replace(/\.$/, '').toLowerCase();
    const needsUpdate =
      content !== tunnelCnameTarget.toLowerCase() || adminDns.proxied !== true;
    if (needsUpdate) {
      await cfFetch(token, 'PUT', `/zones/${zone.id}/dns_records/${adminDns.id}`, {
        type: 'CNAME',
        name: 'admin',
        content: tunnelCnameTarget,
        proxied: true,
        ttl: 1,
      });
      summary.actions.dns = 'updated';
    }
    summary.details.dnsRecordId = adminDns.id;
  }
  summary.details.dnsTarget = tunnelCnameTarget;

  // 7. Access apps
  const apps = await listAll(token, `/accounts/${accountId}/access/apps`);
  summary.details.accessAppCount = apps.length;

  const covering = apps.filter((app) => appCoversHost(app, ADMIN_HOST));
  if (covering.length > 0) {
    summary.actions.access = 'already_covers_admin';
    summary.details.accessApps = covering.map((a) => ({
      id: a.id,
      name: a.name,
      domain: a.domain,
    }));
  } else {
    const ownerEmail = process.env.CF_ACCESS_OWNER_EMAIL?.trim();
    if (!ownerEmail) {
      die('Missing required env CF_ACCESS_OWNER_EMAIL (needed to create Access app)');
    }

    let include = [{ email: { email: ownerEmail } }];
    let reusedFrom = null;

    const playAdminCandidates = apps.filter(isPlayAdminApp);
    for (const candidate of playAdminCandidates) {
      const policies = Array.isArray(candidate.policies)
        ? candidate.policies
        : await getAppPolicies(token, accountId, candidate.id);
      const emails = extractIncludeEmails(policies);
      if (emails.length) {
        include = emails;
        reusedFrom = { id: candidate.id, name: candidate.name, domain: candidate.domain };
        break;
      }
    }

    const created = await cfFetch(token, 'POST', `/accounts/${accountId}/access/apps`, {
      name: 'Galactic Sovereign Admin',
      type: 'self_hosted',
      domain: ADMIN_HOST,
      destinations: [{ type: 'public', uri: ADMIN_HOST }],
      session_duration: '12h',
      auto_redirect_to_identity: false,
      enable_binding_cookie: true,
      http_only_cookie_attribute: true,
      same_site_cookie_attribute: 'lax',
      app_launcher_visible: false,
      policies: [
        {
          name: 'Allow owner email',
          decision: 'allow',
          include,
        },
      ],
    });

    summary.actions.access = 'created';
    summary.details.accessApp = {
      id: created.result?.id ?? null,
      name: created.result?.name ?? null,
      domain: created.result?.domain ?? ADMIN_HOST,
      reusedPolicyFrom: reusedFrom,
      includeCount: include.length,
    };
  }

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  die('Unhandled script error', String(err?.stack || err?.message || err));
});
