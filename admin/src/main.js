import '@phosphor-icons/web/regular';
import './styles.css';

const app = document.querySelector('#app');
const previewMode = import.meta.env.DEV && new URLSearchParams(location.search).has('preview');
let session = null;
let activePeriod = '7d';
let state = {
  overview: null, operations: null, live: [], multiplayerHealth: null, sessions: [], releases: null,
  telemetry: [], users: [], saves: [], backups: [], audit: [],
};

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const fmtDate = (value) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Never';
const fmtAgo = (value) => {
  const ms = Date.now() - Number(value || 0);
  if (!value) return 'Unknown';
  if (ms < 60_000) return 'Just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
};
const fmtDuration = (ms) => {
  const seconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h ? `${h}h ` : ''}${m}m`;
};
const fmtBytes = (value) => {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
};

function previewState() {
  const now = Date.now();
  const telemetry = Array.from({ length: 29 }, (_, index) => ({
    timestamp: Math.floor((now - (28 - index) * 6 * 3600_000) / 1000),
    diskUsePercent: 29 + Math.sin(index / 5) * 1.4 + index * 0.06,
    backupAgeSeconds: 420 + (index % 4) * 180,
    playersOnline: Math.max(0, Math.round(2.2 + Math.sin(index / 2) * 1.8)),
    availableServices: 4,
  }));
  return {
    overview: { gateway: { ok: true }, multiplayer: { ok: true, worldId: 'production-world', playersOnline: 3 }, users: { total: 8, active: 8, disabled: 0 }, soloSaves: 14, activeSessions: 5 },
    operations: { ok: true, readiness: 100, telemetryAgeSeconds: 18, findings: [], telemetry: { timestamp: Math.floor(now / 1000), services: { gateway: true, coop: true, site: true, tunnel: true }, backupAgeSeconds: 420, diskUsePercent: 31, firewallOk: true, restoreTestAt: Math.floor(now / 1000) - 86400, offsiteRestoreTestAt: Math.floor(now / 1000) - 86400, upsState: 'OL', release: 'game-20260722T210000Z', siteRelease: 'site-20260722T215200Z', playersOnline: 3 } },
    live: [0, 1, 2].map((index) => ({ userId: `preview-${index}`, username: `player-${index + 1}`, displayName: 'Connected player', connectedAt: now - [4_320_000, 2_838_000, 909_000][index], lastActivityAt: now - index * 12_000, connections: 1 })),
    multiplayerHealth: { ok: true, playersOnline: 3, worldId: 'production-world' },
    sessions: [0, 1, 2, 3, 4].map((index) => ({ sessionId: `a1b2c3d4e5${index}0`, userId: `preview-${index}`, username: `player-${index + 1}`, displayName: 'Player account', createdAt: now - (index + 1) * 3_600_000, lastSeenAt: now - index * 24_000, expiresAt: now + 5 * 86_400_000 })),
    releases: { rollbackAvailable: true, game: { current: 'game-20260722T210000Z', releases: [{ id: 'game-20260722T210000Z', surface: 'game', installedAt: now - 86_400_000, current: true }, { id: 'game-20260720T190000Z', surface: 'game', installedAt: now - 3 * 86_400_000, current: false }] }, site: { current: 'site-20260722T215200Z', releases: [{ id: 'site-20260722T215200Z', surface: 'site', installedAt: now - 76_000_000, current: true }, { id: 'site-20260720T171500Z', surface: 'site', installedAt: now - 3 * 86_400_000, current: false }] } },
    telemetry,
    users: [], saves: [], backups: [{ name: 'snapshot-latest.tar.gz', modifiedAt: now - 420_000, sizeBytes: 24_300_000 }], audit: [],
  };
}

async function api(path, options = {}) {
  if (previewMode) {
    if (options.method && options.method !== 'GET') return { ok: true, requestId: 'preview-request', delivered: state.live.length, revoked: 1 };
    if (path === '/api/v1/admin/session') return { ok: true, identity: { email: 'owner@galacticsovereign.xyz', sub: 'preview-owner' }, capabilities: [], csrfToken: 'preview', expiresAt: Date.now() + 3_600_000, playOrigin: 'http://127.0.0.1:5173' };
  }
  const headers = { accept: 'application/json', ...options.headers };
  if (options.body != null) headers['content-type'] = 'application/json';
  if (options.mutation) {
    headers['x-csrf-token'] = session.csrfToken;
    delete options.mutation;
  }
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers, body: options.body == null ? undefined : JSON.stringify(options.body) });
  const payload = await response.json().catch(() => ({ ok: false, error: `Unexpected response (${response.status})` }));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload;
}

const navItems = [
  ['command', 'ph-command', 'Command'], ['live', 'ph-users-three', 'Live'], ['sessions', 'ph-clock-counter-clockwise', 'Sessions'],
  ['releases', 'ph-cube', 'Releases'], ['analytics', 'ph-chart-line-up', 'Analytics'], ['records', 'ph-identification-card', 'Players'],
  ['recovery', 'ph-database', 'Recovery'], ['audit', 'ph-scroll', 'Audit'],
];

function shell() {
  app.innerHTML = `
    <div class="command-shell">
      <header class="command-topbar">
        <a class="brand-lockup" href="#command" aria-label="Galactic Sovereign command">
          <img src="/assets/galactic-sovereign-logo.png" alt="" />
          <span><strong>Galactic Sovereign</strong><small>Tactical mission board</small></span>
        </a>
        <div class="owner-verified"><i class="ph ph-shield-check" aria-hidden="true"></i><span>Owner verified</span><span class="health-dot"></span></div>
        <time id="command-clock"></time>
        <button class="owner-menu" type="button"><i class="ph ph-user-circle" aria-hidden="true"></i><span>${escapeHtml(session.identity.email || session.identity.sub)}</span></button>
      </header>
      <aside class="command-rail">
        <nav aria-label="Admin sections">${navItems.map(([id, icon, label]) => `<a href="#${id}"><i class="ph ${icon}" aria-hidden="true"></i><span>${label}</span></a>`).join('')}</nav>
        <div class="rail-status"><span class="health-dot"></span><strong>Protected origin</strong><small>Cloudflare Access verified</small></div>
        <a class="play-link" href="${escapeHtml(session.playOrigin)}"><i class="ph ph-play" aria-hidden="true"></i><span>Open Play</span></a>
      </aside>
      <main class="command-main">
        <div class="page-toolbar">
          <button class="menu-toggle" type="button" aria-label="Open navigation"><i class="ph ph-list"></i></button>
          <div><p class="eyebrow">Production control plane</p><h1>Command</h1></div>
          <button class="refresh" type="button"><i class="ph ph-arrow-clockwise" aria-hidden="true"></i><span>Refresh</span></button>
        </div>
        <div id="notice" role="status" aria-live="polite"></div>
        <section id="content" aria-busy="true"><div class="loading">Reading production state…</div></section>
      </main>
    </div>
    <dialog id="confirm-dialog" class="action-dialog"><form method="dialog"><p class="eyebrow">Confirm owner action</p><h2 id="confirm-title">Confirm action</h2><p id="confirm-copy"></p><label id="confirm-field" class="confirm-field" hidden>Type <strong id="confirm-expected"></strong><input id="confirm-input" autocomplete="off" /></label><div class="dialog-actions"><button value="cancel">Cancel</button><button id="confirm-action" class="button-danger" value="confirm">Confirm</button></div></form></dialog>
    <dialog id="player-dialog" class="action-dialog"><form id="player-form"><p class="eyebrow">Player access</p><h2>Create player</h2><label>Username<input name="username" pattern="[a-z0-9._-]{3,32}" required autocomplete="off" /></label><label>Display name<input name="displayName" maxlength="32" required autocomplete="off" /></label><div class="dialog-actions"><button type="button" data-close-player>Cancel</button><button type="submit" class="button-primary">Create account</button></div></form></dialog>
    <dialog id="secret-dialog" class="action-dialog"><form method="dialog"><p class="eyebrow">One-time credential</p><h2>Temporary password</h2><p>Copy this now. It will not be shown again.</p><code id="secret-value"></code><div class="dialog-actions"><button id="copy-secret" type="button">Copy</button><button value="close" class="button-primary">Done</button></div></form></dialog>`;
  document.querySelector('.menu-toggle').addEventListener('click', () => document.querySelector('.command-rail').classList.toggle('command-rail--open'));
  document.querySelector('.refresh').addEventListener('click', refresh);
  window.addEventListener('hashchange', render);
  setClock();
  setInterval(setClock, 1000);
}

function setClock() {
  const el = document.querySelector('#command-clock');
  if (el) el.textContent = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date());
}

async function load() {
  if (previewMode) { state = previewState(); return; }
  const [overview, operations, multiplayer, sessions, releases, telemetry, users, saves, backups, audit] = await Promise.all([
    api('/api/v1/admin/overview'), api('/api/v1/admin/operations'), api('/api/v1/admin/multiplayer'), api('/api/v1/admin/sessions'),
    api('/api/v1/admin/releases'), api(`/api/v1/admin/telemetry?period=${activePeriod}`), api('/api/v1/admin/users'),
    api('/api/v1/admin/saves'), api('/api/v1/admin/backups'), api('/api/v1/admin/audit?limit=100'),
  ]);
  state = { overview, operations: operations.operations, live: multiplayer.live, multiplayerHealth: multiplayer.health, sessions: sessions.sessions, releases, telemetry: telemetry.points, users: users.users, saves: saves.saves, backups: backups.backups, audit: audit.events };
}

function statusPill(ok, label) { return `<span class="status ${ok ? 'status--ok' : 'status--bad'}"><span class="health-dot"></span>${escapeHtml(label)}</span>`; }
function metric(value, label, detail = '') { return `<div class="metric"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span>${detail ? `<small>${escapeHtml(detail)}</small>` : ''}</div>`; }

function serviceMatrix(telemetry) {
  const services = [
    ['Website', telemetry?.services?.site], ['Play', telemetry?.services?.gateway], ['Co-op', telemetry?.services?.coop],
    ['Tunnel', telemetry?.services?.tunnel], ['Firewall', telemetry?.firewallOk], ['Backup', Number(telemetry?.backupAgeSeconds) <= 1800],
    ['Restore', Boolean(telemetry?.restoreTestAt)],
  ];
  return `<div class="system-matrix">${services.map(([name, ok]) => `<div><strong>${name}</strong><i class="ph ${ok === false ? 'ph-x-circle matrix-bad' : ok == null ? 'ph-question matrix-unknown' : 'ph-check-circle matrix-ok'}" aria-hidden="true"></i><span>${ok === false ? 'Needs attention' : ok == null ? 'Unknown' : 'Healthy'}</span></div>`).join('')}</div>`;
}

function commandView() {
  const ops = state.operations;
  const t = ops?.telemetry;
  const ready = ops?.readiness;
  const findings = ops?.findings || [];
  const newestBackup = state.backups[0];
  return `<div class="mission-grid">
    <section class="board-panel readiness-panel"><div class="readiness-copy"><p class="eyebrow">Production posture</p><h2>${ops?.ok ? 'Operations ready' : 'Action required'}</h2><p>${findings.length ? `${findings.length} production finding${findings.length === 1 ? '' : 's'} require review.` : 'All monitored production systems are operational.'}</p></div><div class="readiness-score" style="--score:${ready ?? 0}"><span>Readiness score</span><strong>${ready ?? '—'}</strong><small>${ops?.ok ? 'Healthy' : 'Review findings'}</small></div><div class="attention"><strong>Needs attention</strong>${findings.length ? findings.map((item) => `<div class="attention-row attention-row--${item.severity}"><i class="ph ph-warning-circle"></i><span>${escapeHtml(item.message)}</span></div>`).join('') : '<div class="attention-row"><i class="ph ph-check-circle"></i><span>No active incidents.</span></div>'}</div></section>
    <section class="board-panel live-panel"><div class="panel-heading"><div><p class="eyebrow">Live now</p><h2>${state.live.length} player${state.live.length === 1 ? '' : 's'} connected</h2></div><a class="button-outline" href="#live">Open live console <i class="ph ph-arrow-up-right"></i></a></div><div class="live-list">${state.live.length ? state.live.slice(0, 4).map((row) => `<div class="live-row"><i class="ph ph-user-circle"></i><span><strong>${escapeHtml(row.displayName || row.username)}</strong><small>${fmtDuration(Date.now() - row.connectedAt)} connected</small></span>${statusPill(true, 'In game')}</div>`).join('') : '<div class="empty-state">No players connected.</div>'}</div></section>
    <section class="board-panel matrix-panel"><div class="panel-heading"><div><p class="eyebrow">System matrix</p><h2>Production systems</h2></div><small>Checked ${ops?.telemetryAgeSeconds == null ? 'never' : `${ops.telemetryAgeSeconds}s ago`}</small></div>${serviceMatrix(t)}</section>
    <section class="board-panel trends-panel"><div class="panel-heading"><div><p class="eyebrow">7-day trends</p><h2>Capacity and activity</h2></div><a href="#analytics">Explore analytics</a></div><canvas class="telemetry-chart" data-period="7d" aria-label="Seven day disk, player, and backup trends"></canvas><div class="chart-legend"><span class="legend-disk">Disk use</span><span class="legend-players">Players online</span><span class="legend-backup">Backup age</span></div></section>
    <section class="board-panel recovery-panel"><div class="recovery-row"><i class="ph ph-hard-drives"></i><span><strong>Local restore</strong><small>${t?.restoreTestAt ? 'Verified' : 'No verification recorded'}</small></span><time>${t?.restoreTestAt ? fmtDate(t.restoreTestAt * 1000) : '—'}</time>${statusPill(Boolean(t?.restoreTestAt), t?.restoreTestAt ? 'Verified' : 'Unknown')}</div><div class="recovery-row"><i class="ph ph-cloud-check"></i><span><strong>Offsite restore</strong><small>${t?.offsiteRestoreTestAt ? 'Verified' : 'No verification recorded'}</small></span><time>${t?.offsiteRestoreTestAt ? fmtDate(t.offsiteRestoreTestAt * 1000) : '—'}</time>${statusPill(Boolean(t?.offsiteRestoreTestAt), t?.offsiteRestoreTestAt ? 'Verified' : 'Unknown')}</div><div class="recovery-row"><i class="ph ph-archive"></i><span><strong>Newest backup</strong><small>${newestBackup ? escapeHtml(newestBackup.name) : 'No readable metadata'}</small></span><time>${newestBackup ? fmtAgo(newestBackup.modifiedAt) : '—'}</time>${statusPill(Boolean(newestBackup), newestBackup ? 'Complete' : 'Unknown')}</div></section>
    <section class="board-panel release-strip"><div><i class="ph ph-cube"></i><span><small>Game release</small><strong>${escapeHtml(state.releases?.game?.current || t?.release || 'Unknown')}</strong></span></div><div><i class="ph ph-globe-hemisphere-west"></i><span><small>Site release</small><strong>${escapeHtml(state.releases?.site?.current || t?.siteRelease || 'Unknown')}</strong></span></div><a class="button-outline" href="#releases">View deployment history <i class="ph ph-arrow-up-right"></i></a></section>
  </div>`;
}

function liveView() {
  return `<div class="section-heading"><div><p class="eyebrow">Multiplayer operations</p><h2>Live players</h2><p>Presence is read from the authenticated Play relay. Network addresses are never exposed here.</p></div>${statusPill(Boolean(state.multiplayerHealth?.ok), state.multiplayerHealth?.ok ? 'World online' : 'World unavailable')}</div><div class="split-layout"><section class="board-panel"><div class="data-list data-list--live"><div class="data-head"><span>Player</span><span>Connected</span><span>Activity</span><span>Connections</span><span></span></div>${state.live.length ? state.live.map((row) => `<div class="data-row"><span><strong>${escapeHtml(row.displayName || row.username)}</strong><small>@${escapeHtml(row.username)}</small></span><span>${fmtDuration(Date.now() - row.connectedAt)}</span><span>${fmtAgo(row.lastActivityAt)}</span><span>${row.connections}</span><span><button data-kick="${escapeHtml(row.userId)}" class="button-danger button-small">Kick</button></span></div>`).join('') : '<div class="empty-state">No players are connected right now.</div>'}</div></section><aside class="board-panel notice-composer"><p class="eyebrow">Maintenance notice</p><h2>Message connected players</h2><p>The message appears as an in-game owner notice. It cannot issue commands or alter game state.</p><form id="notice-form"><label for="notice-message">Message</label><textarea id="notice-message" maxlength="180" required placeholder="Example: Scheduled maintenance begins in 10 minutes."></textarea><button class="button-primary" type="submit">Send notice</button></form></aside></div>`;
}

function sessionsView() {
  return `<div class="section-heading"><div><p class="eyebrow">Identity control</p><h2>Active sessions</h2><p>Revoke one session without signing the player out everywhere.</p></div>${metric(state.sessions.length, 'active sessions')}</div><section class="board-panel"><div class="data-list"><div class="data-head"><span>Player</span><span>Session</span><span>Last seen</span><span>Expires</span><span></span></div>${state.sessions.length ? state.sessions.map((row) => `<div class="data-row"><span><strong>${escapeHtml(row.displayName)}</strong><small>@${escapeHtml(row.username)}</small></span><code>${escapeHtml(row.sessionId)}</code><span>${fmtAgo(row.lastSeenAt)}</span><span>${fmtDate(row.expiresAt)}</span><span><button data-revoke-session="${escapeHtml(row.sessionId)}" class="button-danger button-small">Revoke</button></span></div>`).join('') : '<div class="empty-state">No active sessions.</div>'}</div></section>`;
}

function releaseColumn(title, inventory, icon) {
  const rows = inventory?.releases || [];
  return `<section class="board-panel release-column"><div class="panel-heading"><div><p class="eyebrow">${escapeHtml(title)}</p><h2><i class="ph ${icon}"></i> ${escapeHtml(inventory?.current || 'No active release')}</h2></div>${statusPill(Boolean(inventory?.current), inventory?.current ? 'Healthy' : 'Unknown')}</div><div class="release-list">${rows.length ? rows.map((row) => `<div class="release-row ${row.current ? 'release-row--current' : ''}"><span><strong>${escapeHtml(row.id)}</strong><small>${row.current ? 'Current production release' : `Installed ${fmtDate(row.installedAt)}`}</small></span>${row.current ? '<span class="current-badge">Current</span>' : `<button class="button-outline button-small" data-rollback-surface="${row.surface}" data-rollback-id="${escapeHtml(row.id)}" ${state.releases.rollbackAvailable ? '' : 'disabled'}>Rollback</button>`}</div>`).join('') : '<div class="empty-state">No installed release inventory is available.</div>'}</div></section>`;
}

function releasesView() { return `<div class="section-heading"><div><p class="eyebrow">Atomic deployments</p><h2>Releases and rollback</h2><p>Every rollback creates a fresh backup, accepts only an installed release, and automatically returns to the current release if health checks fail.</p></div>${statusPill(Boolean(state.releases?.rollbackAvailable), state.releases?.rollbackAvailable ? 'Rollback broker ready' : 'Rollback unavailable')}</div><div class="release-grid">${releaseColumn('Game release', state.releases?.game, 'ph-game-controller')}${releaseColumn('Website release', state.releases?.site, 'ph-globe')}</div>`; }

function analyticsView() {
  const last = state.telemetry.at(-1);
  return `<div class="section-heading"><div><p class="eyebrow">Capacity history</p><h2>Operational analytics</h2><p>Sanitized production telemetry retained locally for 30 days.</p></div><div class="period-picker" role="group" aria-label="Analytics period">${['24h','7d','30d'].map((period) => `<button data-period="${period}" class="${activePeriod === period ? 'is-active' : ''}">${period}</button>`).join('')}</div></div><div class="analytics-metrics">${metric(last ? `${Math.round(last.diskUsePercent)}%` : '—', 'disk use')}${metric(last ? String(Math.round(last.playersOnline)) : '—', 'players online')}${metric(last ? `${Math.round(last.backupAgeSeconds / 60)}m` : '—', 'backup age')}${metric(state.telemetry.length, 'chart points')}</div><section class="board-panel analytics-chart"><canvas class="telemetry-chart" data-period="${activePeriod}" aria-label="${activePeriod} operational telemetry"></canvas><div class="chart-legend"><span class="legend-disk">Disk use</span><span class="legend-players">Players online</span><span class="legend-backup">Backup age</span></div></section>`;
}

function recordsView() {
  return `<div class="section-heading"><div><p class="eyebrow">Player access</p><h2>Player accounts</h2><p>Create accounts and control authentication without exposing credentials after their one-time reveal.</p></div><button id="new-player" class="button-primary"><i class="ph ph-user-plus"></i>Create player</button></div><section class="board-panel"><div class="data-list"><div class="data-head"><span>Player</span><span>Status</span><span>Role</span><span>Created</span><span></span></div>${state.users.length ? state.users.map((user) => `<div class="data-row"><span><strong>${escapeHtml(user.displayName)}</strong><small>@${escapeHtml(user.username)}</small></span><span>${statusPill(user.status === 'active', user.status)}</span><span>${escapeHtml(user.role)}</span><span>${fmtDate(user.createdAt)}</span><span class="row-actions"><button data-revoke-user="${user.id}" class="button-small">Sign out all</button>${user.role !== 'owner' ? `<button data-toggle-user="${user.id}" data-next-status="${user.status === 'active' ? 'disabled' : 'active'}" class="button-small">${user.status === 'active' ? 'Disable' : 'Enable'}</button><button data-reset-user="${user.id}" class="button-small">Reset password</button>` : ''}</span></div>`).join('') : '<div class="empty-state">No player accounts.</div>'}</div></section>`;
}

function recoveryView() {
  return `<div class="section-heading"><div><p class="eyebrow">Recovery inventory</p><h2>Saves and backups</h2><p>Read-only visibility into player saves and local recovery artifacts.</p></div></div><div class="split-layout split-layout--equal"><section class="board-panel"><div class="panel-heading"><h2>Player saves</h2><span>${state.saves.length}</span></div><div class="compact-list">${state.saves.length ? state.saves.map((save) => `<div><span><strong>${escapeHtml(save.displayName || save.username)}</strong><small>${escapeHtml(save.slot)} · revision ${save.revision} · save v${save.saveVersion}</small></span><span><strong>${fmtBytes(save.sizeBytes)}</strong><small>${fmtAgo(save.savedAt)}</small></span></div>`).join('') : '<div class="empty-state">No saves found.</div>'}</div></section><section class="board-panel"><div class="panel-heading"><h2>Local backups</h2><span>${state.backups.length}</span></div><div class="compact-list">${state.backups.slice(0, 50).map((backup) => `<div><span><strong>${escapeHtml(backup.name)}</strong><small>${fmtDate(backup.modifiedAt)}</small></span><strong>${fmtBytes(backup.sizeBytes)}</strong></div>`).join('') || '<div class="empty-state">No backup metadata found.</div>'}</div></section></div>`;
}

function auditView() {
  return `<div class="section-heading"><div><p class="eyebrow">Append-only history</p><h2>Audit trail</h2><p>Every Admin mutation is attributed to the verified Cloudflare Access identity.</p></div></div><section class="board-panel"><div class="data-list"><div class="data-head"><span>Time</span><span>Identity</span><span>Action</span><span>Result</span><span>Request</span></div>${state.audit.length ? state.audit.map((event) => `<div class="data-row"><span>${fmtDate(event.createdAt)}</span><span>${escapeHtml(event.actorUsername || 'system')}</span><code>${escapeHtml(event.action)}</code><span>${statusPill(event.detail?.result !== 'failure', event.detail?.result || 'recorded')}</span><code>${escapeHtml(event.detail?.requestId || '—')}</code></div>`).join('') : '<div class="empty-state">No Admin mutations recorded.</div>'}</div></section>`;
}

function render() {
  const section = (location.hash || '#command').slice(1);
  const views = { command: commandView, live: liveView, sessions: sessionsView, releases: releasesView, analytics: analyticsView, records: recordsView, recovery: recoveryView, audit: auditView };
  const labels = { command: 'Command', live: 'Live operations', sessions: 'Sessions', releases: 'Deployments', analytics: 'Analytics', records: 'Players', recovery: 'Recovery', audit: 'Audit trail' };
  document.querySelector('h1').textContent = labels[section] || 'Command';
  document.querySelectorAll('nav a').forEach((link) => link.toggleAttribute('aria-current', link.hash === `#${section}`));
  document.querySelector('#content').innerHTML = (views[section] || views.command)();
  document.querySelector('#content').setAttribute('aria-busy', 'false');
  document.querySelector('.command-rail').classList.remove('command-rail--open');
  bindSection(section);
  requestAnimationFrame(drawCharts);
}

function bindSection(section) {
  if (section === 'live') {
    document.querySelectorAll('[data-kick]').forEach((button) => button.addEventListener('click', () => confirmAction({ title: 'Kick player', copy: 'This closes every active multiplayer connection for this account.', label: 'Kick player' }, () => api(`/api/v1/admin/multiplayer/${encodeURIComponent(button.dataset.kick)}/kick`, { method: 'POST', mutation: true }))));
    document.querySelector('#notice-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const message = document.querySelector('#notice-message').value;
      try { const result = await api('/api/v1/admin/multiplayer/notice', { method: 'POST', mutation: true, body: { message } }); notice(`Notice delivered to ${result.delivered} connection${result.delivered === 1 ? '' : 's'}.`, 'ok'); event.target.reset(); await refresh(); } catch (error) { notice(error.message, 'error'); }
    });
  }
  if (section === 'sessions') document.querySelectorAll('[data-revoke-session]').forEach((button) => button.addEventListener('click', () => confirmAction({ title: 'Revoke session', copy: `Revoke session ${button.dataset.revokeSession}?`, label: 'Revoke session' }, () => api(`/api/v1/admin/sessions/${button.dataset.revokeSession}`, { method: 'DELETE', mutation: true }))));
  if (section === 'releases') document.querySelectorAll('[data-rollback-id]').forEach((button) => button.addEventListener('click', () => confirmAction({ title: `Rollback ${button.dataset.rollbackSurface}`, copy: 'A fresh backup runs first. If the selected release fails health validation, production automatically returns to the current release.', label: 'Start rollback', confirmText: button.dataset.rollbackId }, () => api(`/api/v1/admin/releases/${button.dataset.rollbackSurface}/${encodeURIComponent(button.dataset.rollbackId)}/rollback`, { method: 'POST', mutation: true, body: { confirmation: button.dataset.rollbackId } }))));
  if (section === 'analytics') document.querySelectorAll('[data-period]').forEach((button) => button.addEventListener('click', async () => { activePeriod = button.dataset.period; if (!previewMode) state.telemetry = (await api(`/api/v1/admin/telemetry?period=${activePeriod}`)).points; render(); }));
  if (section === 'records') bindRecords();
}

function bindRecords() {
  const playerDialog = document.querySelector('#player-dialog');
  document.querySelector('#new-player')?.addEventListener('click', () => playerDialog.showModal());
  document.querySelector('[data-close-player]')?.addEventListener('click', () => playerDialog.close());
  document.querySelector('#player-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    try {
      const result = await api('/api/v1/admin/users', { method: 'POST', mutation: true, body: { username: data.get('username'), displayName: data.get('displayName') } });
      playerDialog.close();
      showSecret(result.temporaryPassword);
      await refresh();
    } catch (error) { notice(error.message, 'error'); }
  });
  document.querySelectorAll('[data-revoke-user]').forEach((button) => button.addEventListener('click', () => confirmAction({ title: 'Sign out player', copy: 'Every active session for this player will be revoked.', label: 'Sign out all' }, () => api(`/api/v1/admin/users/${button.dataset.revokeUser}/revoke-sessions`, { method: 'POST', mutation: true }))));
  document.querySelectorAll('[data-toggle-user]').forEach((button) => button.addEventListener('click', () => confirmAction({ title: `${button.dataset.nextStatus === 'disabled' ? 'Disable' : 'Enable'} player`, copy: 'This changes whether the player can authenticate.', label: button.dataset.nextStatus === 'disabled' ? 'Disable' : 'Enable' }, () => api(`/api/v1/admin/users/${button.dataset.toggleUser}/status`, { method: 'PATCH', mutation: true, body: { status: button.dataset.nextStatus } }))));
  document.querySelectorAll('[data-reset-user]').forEach((button) => button.addEventListener('click', () => confirmAction({ title: 'Reset password', copy: 'All sessions are revoked and a one-time password is generated.', label: 'Reset password' }, async () => { const result = await api(`/api/v1/admin/users/${button.dataset.resetUser}/reset-password`, { method: 'POST', mutation: true }); showSecret(result.temporaryPassword); })));
}

async function confirmAction({ title, copy, label, confirmText = null }, operation) {
  const dialog = document.querySelector('#confirm-dialog');
  const field = document.querySelector('#confirm-field');
  const input = document.querySelector('#confirm-input');
  const action = document.querySelector('#confirm-action');
  document.querySelector('#confirm-title').textContent = title;
  document.querySelector('#confirm-copy').textContent = copy;
  action.textContent = label;
  field.hidden = !confirmText;
  document.querySelector('#confirm-expected').textContent = confirmText || '';
  input.value = '';
  action.disabled = Boolean(confirmText);
  input.oninput = () => { action.disabled = Boolean(confirmText && input.value !== confirmText); };
  dialog.showModal();
  const confirmed = await new Promise((resolve) => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }));
  input.oninput = null;
  action.disabled = false;
  if (!confirmed) return;
  if (confirmText && input.value !== confirmText) { notice('Typed confirmation did not match.', 'error'); return; }
  try { await operation(); notice(`${title} completed.`, 'ok'); await refresh(); } catch (error) { notice(error.message, 'error'); }
}

function showSecret(value) {
  const dialog = document.querySelector('#secret-dialog');
  document.querySelector('#secret-value').textContent = value;
  document.querySelector('#copy-secret').onclick = async () => { await navigator.clipboard.writeText(value); notice('Temporary password copied.', 'ok'); };
  dialog.showModal();
}

function drawCharts() {
  document.querySelectorAll('.telemetry-chart').forEach((canvas) => {
    const points = state.telemetry;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(400, rect.width * ratio);
    canvas.height = Math.max(210, rect.height * ratio);
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    const width = canvas.width / ratio;
    const height = canvas.height / ratio;
    const pad = { left: 42, right: 18, top: 18, bottom: 28 };
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(185,137,47,.18)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i += 1) { const y = pad.top + (height - pad.top - pad.bottom) * i / 4; ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke(); }
    if (!points.length) { ctx.fillStyle = '#8f9cad'; ctx.font = '14px Inter, sans-serif'; ctx.fillText('Telemetry history will appear after the next health samples.', pad.left, height / 2); return; }
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;
    const series = [
      { color: '#d7b46a', values: points.map((point) => Math.min(100, point.diskUsePercent)) },
      { color: '#6edc91', values: points.map((point) => Math.min(100, point.playersOnline * 10)) },
      { color: '#f2c55c', values: points.map((point) => Math.min(100, point.backupAgeSeconds / 36)) },
    ];
    for (const line of series) {
      ctx.strokeStyle = line.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      line.values.forEach((value, index) => { const x = pad.left + plotW * index / Math.max(1, line.values.length - 1); const y = pad.top + plotH * (1 - value / 100); if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
      ctx.stroke();
    }
    ctx.fillStyle = '#7e8ca1';
    ctx.font = '11px Inter, sans-serif';
    ctx.fillText('0%', 12, height - pad.bottom + 3);
    ctx.fillText('100%', 4, pad.top + 4);
    ctx.fillText(canvas.dataset.period || activePeriod, width - 40, height - 7);
  });
}

function notice(message, type) { const el = document.querySelector('#notice'); el.className = `notice notice--${type}`; el.textContent = message; }
async function refresh() { try { document.querySelector('.refresh').disabled = true; await load(); render(); } catch (error) { notice(error.message, 'error'); } finally { document.querySelector('.refresh').disabled = false; } }

try {
  session = await api('/api/v1/admin/session');
  shell();
  await refresh();
} catch (error) {
  app.innerHTML = `<main class="fatal"><img src="/assets/galactic-sovereign-logo.png" alt="Galactic Sovereign" /><p class="eyebrow">Access validation failed</p><h1>Command unavailable</h1><p>${escapeHtml(error.message)}</p><a href="https://play.galacticsovereign.xyz">Return to Play</a></main>`;
}
