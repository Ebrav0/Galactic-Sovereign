const byId = (id) => document.getElementById(id);

const state = {
  session: null,
  selectedUserId: null,
  pollTimer: null,
  users: [],
};

function metaContent(name) {
  return document.querySelector(`meta[name="${name}"]`)?.getAttribute('content')?.trim() || '';
}

function playOrigin() {
  return metaContent('gs-play-origin') || location.origin;
}

function setStatus(id, message, kind = '') {
  const el = byId(id);
  if (!el) return;
  el.textContent = message || '';
  el.dataset.kind = kind;
}

function formatRelative(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return '—';
  const t = Number(ms);
  const delta = Date.now() - t;
  const abs = Math.abs(delta);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const units = [
    ['year', 365.25 * 24 * 3600_000],
    ['month', 30.44 * 24 * 3600_000],
    ['day', 24 * 3600_000],
    ['hour', 3600_000],
    ['minute', 60_000],
    ['second', 1000],
  ];
  for (const [unit, size] of units) {
    if (abs >= size || unit === 'second') {
      return rtf.format(Math.round(-delta / size), /** @type {Intl.RelativeTimeFormatUnit} */ (unit));
    }
  }
  return '—';
}

function formatLocal(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return '';
  try {
    return new Date(Number(ms)).toLocaleString();
  } catch {
    return '';
  }
}

function formatDuration(ms) {
  const value = Math.max(0, Number(ms) || 0);
  const hours = Math.floor(value / 3_600_000);
  const minutes = Math.floor((value % 3_600_000) / 60_000);
  if (hours > 48) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${Math.floor(value / 1000)}s`;
}

function stageLabel(summary) {
  if (!summary) return '—';
  const parts = [];
  if (summary.campaignMode) parts.push(summary.campaignMode);
  if (summary.tutorialStatus) parts.push(summary.tutorialStatus);
  if (summary.outpostCount != null) parts.push(`${summary.outpostCount} outposts`);
  if (summary.credits != null) parts.push(`${Math.round(summary.credits)}¢`);
  return parts.length ? parts.join(' · ') : 'saved';
}

async function api(pathname, { method = 'GET', body, csrf = false } = {}) {
  const response = await fetch(pathname, {
    method,
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      ...(body == null ? {} : { 'content-type': 'application/json' }),
      ...(csrf && state.session?.csrfToken ? { 'x-csrf-token': state.session.csrfToken } : {}),
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
  const type = response.headers.get('content-type') || '';
  if (!type.includes('application/json')) {
    throw new Error('Admin API unavailable. Reload and sign in again.');
  }
  const payload = await response.json();
  return { response, payload };
}

function wipeHandoffQuery() {
  const url = new URL(location.href);
  if (!url.searchParams.has('handoff')) return;
  url.searchParams.delete('handoff');
  history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
}

async function redeemHandoffIfPresent() {
  const token = new URL(location.href).searchParams.get('handoff');
  if (!token) return false;
  try {
    const { response, payload } = await api('/api/v1/auth/admin-handoff/redeem', {
      method: 'POST',
      body: { token },
    });
    wipeHandoffQuery();
    if (!response.ok) throw new Error(payload.error || 'Handoff failed');
    state.session = payload;
    return true;
  } catch (error) {
    wipeHandoffQuery();
    throw error;
  }
}

async function discoverSession() {
  const { response, payload } = await api('/api/v1/session');
  if (!response.ok) throw new Error(payload.error || 'Session discovery failed');
  state.session = payload.authenticated ? payload : null;
  return state.session;
}

function showView(view) {
  byId('admin-login-gate')?.classList.toggle('hidden', view !== 'login');
  byId('admin-forbidden')?.classList.toggle('hidden', view !== 'forbidden');
  byId('admin-shell')?.classList.toggle('hidden', view !== 'shell');
}

function wirePlayLinks() {
  const play = playOrigin();
  const openPlay = byId('admin-open-play');
  const forbiddenPlay = byId('admin-forbidden-play');
  if (openPlay) openPlay.href = `${play}/`;
  if (forbiddenPlay) forbiddenPlay.href = `${play}/`;
}

function showTempPassword(username, password) {
  const box = byId('admin-temp-password');
  if (!box) return;
  box.replaceChildren();
  const title = document.createElement('strong');
  title.textContent = `Temporary password for ${username}`;
  const code = document.createElement('code');
  code.textContent = password;
  const note = document.createElement('span');
  note.textContent = 'Copy it now. It is shown only in this response.';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'btn btn--ghost btn--xs';
  copy.textContent = 'Copy';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(password);
      copy.textContent = 'Copied';
      setTimeout(() => { copy.textContent = 'Copy'; }, 1400);
    } catch {
      copy.textContent = 'Select & copy';
    }
  });
  box.append(title, code, note, copy);
  box.classList.remove('hidden');
}

function renderOverview(data) {
  const grid = byId('admin-overview-grid');
  if (!grid) return;
  const users = data.users || {};
  const mp = data.multiplayer || {};
  const cards = [
    ['Users', `${users.active ?? 0} active / ${users.total ?? 0}`],
    ['Disabled', String(users.disabled ?? 0)],
    ['Sessions', String(data.activeSessions ?? 0)],
    ['Solo saves', String(data.soloSaves ?? 0)],
    ['MP online', String(mp.playersOnline ?? mp.online ?? data.liveRelayCount ?? '—')],
    ['Gateway', data.gateway?.ok ? 'ok' : 'down'],
    ['Co-op', mp.ok === false ? (mp.error || 'unreachable') : (mp.ok ? 'ok' : '—')],
    ['Relay sockets', String(data.liveRelayCount ?? 0)],
  ];
  grid.replaceChildren();
  for (const [label, value] of cards) {
    const card = document.createElement('div');
    card.className = 'admin-stat';
    const k = document.createElement('span');
    k.textContent = label;
    const v = document.createElement('strong');
    v.textContent = value;
    card.append(k, v);
    grid.append(card);
  }
}

function renderPlayers(users) {
  state.users = users;
  const body = byId('admin-players-body');
  if (!body) return;
  body.replaceChildren();
  for (const user of users) {
    const tr = document.createElement('tr');
    tr.dataset.userId = user.id;
    if (user.id === state.selectedUserId) tr.classList.add('is-selected');
    const mp = user.multiplayerOnline
      ? `online${user.multiplayerRttMs != null ? ` · ${user.multiplayerRttMs}ms` : ''}`
      : '—';
    const cells = [
      `${user.displayName}\n${user.username}${user.role === 'owner' ? ' · owner' : ''}`,
      user.status + (user.mustChangePassword ? ' · pwd' : '') + (user.approxOnline ? ' · live' : ''),
      formatRelative(user.lastSeenAt),
      formatDuration(user.approxOnlineMs),
      mp,
      stageLabel(user.latestSoloSummary),
    ];
    cells.forEach((text, index) => {
      const td = document.createElement('td');
      if (index === 0) {
        const name = document.createElement('strong');
        name.textContent = user.displayName;
        const meta = document.createElement('span');
        meta.className = 'admin-table__meta';
        meta.textContent = `${user.username}${user.role === 'owner' ? ' · owner' : ''}`;
        td.append(name, meta);
      } else {
        td.textContent = text;
        if (index === 2 && user.lastSeenAt) td.title = formatLocal(user.lastSeenAt);
      }
      tr.append(td);
    });
    body.append(tr);
  }
}

function renderMultiplayer(payload) {
  const health = byId('admin-mp-health');
  const body = byId('admin-mp-body');
  if (health) {
    const h = payload.health || {};
    health.textContent = h.ok === false
      ? `Co-op health: unreachable${h.error ? ` (${h.error})` : ''}`
      : `Co-op health: ok · players ${h.playersOnline ?? h.online ?? '—'} · tick ${h.tick ?? h.lastTick ?? '—'}`;
  }
  if (!body) return;
  body.replaceChildren();
  const live = payload.live ?? [];
  if (!live.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4;
    td.textContent = 'No live multiplayer relays.';
    tr.append(td);
    body.append(tr);
    return;
  }
  for (const entry of live) {
    const tr = document.createElement('tr');
    const name = document.createElement('td');
    name.textContent = entry.displayName || entry.accountId || '—';
    const connected = document.createElement('td');
    connected.textContent = formatRelative(entry.connectedAt);
    connected.title = formatLocal(entry.connectedAt);
    const rtt = document.createElement('td');
    rtt.textContent = entry.lastRttMs != null ? `${entry.lastRttMs} ms` : '—';
    const action = document.createElement('td');
    const kick = document.createElement('button');
    kick.type = 'button';
    kick.className = 'btn btn--danger btn--xs';
    kick.textContent = 'Kick';
    kick.dataset.kickUserId = entry.accountId;
    action.append(kick);
    tr.append(name, connected, rtt, action);
    body.append(tr);
  }
}

function renderAudit(events) {
  const body = byId('admin-audit-body');
  if (!body) return;
  body.replaceChildren();
  for (const event of events) {
    const tr = document.createElement('tr');
    const when = document.createElement('td');
    when.textContent = formatRelative(event.createdAt);
    when.title = formatLocal(event.createdAt);
    const action = document.createElement('td');
    action.textContent = event.action;
    const actor = document.createElement('td');
    actor.textContent = event.actorUsername || event.actorUserId || '—';
    const target = document.createElement('td');
    target.textContent = event.targetUsername || event.targetUserId || '—';
    const detail = document.createElement('td');
    detail.className = 'admin-table__detail';
    try {
      detail.textContent = JSON.stringify(event.detail || {});
    } catch {
      detail.textContent = '—';
    }
    tr.append(when, action, actor, target, detail);
    body.append(tr);
  }
}

function renderLegacy(pilots, users) {
  const section = byId('admin-legacy');
  const list = byId('admin-legacy-list');
  if (!section || !list) return;
  section.classList.toggle('hidden', !pilots.length);
  list.replaceChildren();
  for (const pilot of pilots) {
    const row = document.createElement('article');
    row.className = 'admin-legacy-row';
    const identity = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = pilot.displayName;
    const meta = document.createElement('span');
    meta.textContent = pilot.claimedUsername ? `Claimed by ${pilot.claimedUsername}` : pilot.pilotId;
    identity.append(name, meta);
    row.append(identity);
    if (!pilot.claimedUserId) {
      const select = document.createElement('select');
      select.className = 'menu-select';
      select.setAttribute('aria-label', `Account for ${pilot.displayName}`);
      for (const user of users) {
        if (user.status !== 'active') continue;
        const option = document.createElement('option');
        option.value = user.id;
        option.textContent = user.username;
        select.append(option);
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn--primary btn--xs';
      button.dataset.pilotId = pilot.pilotId;
      button.textContent = 'Claim';
      row.append(select, button);
    }
    list.append(row);
  }
}

async function loadDetail(userId) {
  state.selectedUserId = userId;
  const empty = byId('admin-detail-empty');
  const body = byId('admin-detail-body');
  empty?.classList.add('hidden');
  body?.classList.remove('hidden');
  body.replaceChildren();
  const loading = document.createElement('p');
  loading.className = 'account-status';
  loading.textContent = 'Loading…';
  body.append(loading);

  const { response, payload } = await api(`/api/v1/admin/users/${encodeURIComponent(userId)}`);
  if (!response.ok) {
    loading.textContent = payload.error || 'Could not load user';
    loading.dataset.kind = 'error';
    return;
  }

  const user = payload.user;
  body.replaceChildren();

  const head = document.createElement('div');
  head.className = 'admin-detail__identity';
  const title = document.createElement('strong');
  title.textContent = user.displayName;
  const meta = document.createElement('span');
  meta.textContent = `${user.username} · ${user.role} · ${user.status}`;
  head.append(title, meta);
  body.append(head);

  const rename = document.createElement('form');
  rename.className = 'admin-detail__rename';
  rename.innerHTML = `
    <label><span>Display name</span><input name="displayName" maxlength="32" required /></label>
    <button class="btn btn--ghost btn--xs" type="submit">Save name</button>
  `;
  const renameInput = rename.querySelector('input[name="displayName"]');
  if (renameInput) renameInput.value = user.displayName;
  rename.addEventListener('submit', async (event) => {
    event.preventDefault();
    const next = renameInput?.value || '';
    const result = await api(`/api/v1/admin/users/${encodeURIComponent(user.id)}`, {
      method: 'PATCH', csrf: true, body: { displayName: next },
    });
    if (!result.response.ok) {
      setStatus('admin-players-status', result.payload.error || 'Rename failed', 'error');
      return;
    }
    setStatus('admin-players-status', 'Display name updated', 'ok');
    await refreshDashboard();
    await loadDetail(user.id);
  });
  body.append(rename);

  const actions = document.createElement('div');
  actions.className = 'admin-detail__actions';
  const buttons = [];
  if (user.role !== 'owner') {
    buttons.push(['status', user.status === 'active' ? 'Disable' : 'Enable']);
    buttons.push(['reset', 'Reset password']);
    buttons.push(['revoke', 'Revoke sessions']);
  }
  if (user.multiplayerOnline) buttons.push(['kick', 'Kick MP']);
  for (const [action, label] of buttons) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = action === 'kick' || action === 'status' && user.status === 'active'
      ? 'btn btn--danger btn--xs'
      : 'btn btn--ghost btn--xs';
    button.dataset.detailAction = action;
    button.dataset.userId = user.id;
    button.dataset.nextStatus = user.status === 'active' ? 'disabled' : 'active';
    button.textContent = label;
    actions.append(button);
  }
  body.append(actions);

  const sessions = document.createElement('div');
  sessions.className = 'admin-detail__block';
  sessions.innerHTML = '<h3>Sessions</h3>';
  const sessionList = document.createElement('ul');
  for (const session of payload.sessions ?? []) {
    const li = document.createElement('li');
    li.textContent = `${session.sessionId} · seen ${formatRelative(session.lastSeenAt)} · expires ${formatRelative(session.expiresAt)}`;
    li.title = `${formatLocal(session.lastSeenAt)} / ${formatLocal(session.expiresAt)}`;
    sessionList.append(li);
  }
  if (!sessionList.children.length) {
    const li = document.createElement('li');
    li.textContent = 'No active sessions';
    sessionList.append(li);
  }
  sessions.append(sessionList);
  body.append(sessions);

  const saves = document.createElement('div');
  saves.className = 'admin-detail__block';
  saves.innerHTML = '<h3>Solo saves</h3>';
  const saveList = document.createElement('ul');
  for (const save of payload.saves ?? []) {
    const li = document.createElement('li');
    li.textContent = `slot ${save.slot} · rev ${save.revision} · ${stageLabel(save)} · ${formatRelative(save.savedAt)}`;
    li.title = formatLocal(save.savedAt);
    saveList.append(li);
  }
  if (!saveList.children.length) {
    const li = document.createElement('li');
    li.textContent = 'No solo saves';
    saveList.append(li);
  }
  saves.append(saveList);
  body.append(saves);

  if (payload.legacyPilot) {
    const legacy = document.createElement('div');
    legacy.className = 'admin-detail__block';
    legacy.innerHTML = `<h3>Legacy pilot</h3><p>${payload.legacyPilot.displayName || payload.legacyPilot.pilotId}</p>`;
    body.append(legacy);
  }

  for (const row of byId('admin-players-body')?.querySelectorAll('tr') ?? []) {
    row.classList.toggle('is-selected', row.dataset.userId === user.id);
  }
}

async function refreshDashboard() {
  if (!state.session?.authenticated || state.session.user?.role !== 'owner') return;
  const poll = byId('admin-poll-status');
  if (poll) poll.textContent = 'Refreshing…';
  try {
    const [overview, users, multiplayer, audit, legacy] = await Promise.all([
      api('/api/v1/admin/overview'),
      api('/api/v1/admin/users'),
      api('/api/v1/admin/multiplayer'),
      api('/api/v1/admin/audit?limit=50'),
      api('/api/v1/admin/legacy-pilots'),
    ]);
    if (!overview.response.ok) throw new Error(overview.payload.error || 'Overview failed');
    if (!users.response.ok) throw new Error(users.payload.error || 'Users failed');
    if (!multiplayer.response.ok) throw new Error(multiplayer.payload.error || 'Multiplayer failed');
    if (!audit.response.ok) throw new Error(audit.payload.error || 'Audit failed');

    renderOverview(overview.payload);
    renderPlayers(users.payload.users ?? []);
    renderMultiplayer(multiplayer.payload);
    renderAudit(audit.payload.events ?? []);
    if (legacy.response.ok) renderLegacy(legacy.payload.pilots ?? [], users.payload.users ?? []);
    if (poll) poll.textContent = `Updated ${new Date().toLocaleTimeString()}`;
    setStatus('admin-players-status', '');
  } catch (error) {
    if (poll) poll.textContent = 'Refresh failed';
    setStatus('admin-players-status', error.message || 'Refresh failed', 'error');
  }
}

function startPolling() {
  stopPolling();
  state.pollTimer = setInterval(() => {
    if (document.hidden) return;
    refreshDashboard();
  }, 10_000);
}

function stopPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = null;
}

async function enterShell() {
  showView('shell');
  byId('admin-signed-as').textContent = `Signed in as ${state.session.user.displayName}`;
  wirePlayLinks();
  await refreshDashboard();
  startPolling();
}

async function bootstrap() {
  wirePlayLinks();
  try {
    await redeemHandoffIfPresent();
  } catch (error) {
    setStatus('admin-login-status', error.message || 'Handoff failed', 'error');
  }
  if (!state.session) {
    try {
      await discoverSession();
    } catch (error) {
      setStatus('admin-login-status', error.message || 'Could not reach API', 'error');
      showView('login');
      return;
    }
  }

  if (!state.session?.authenticated) {
    showView('login');
    return;
  }
  if (state.session.user?.mustChangePassword) {
    setStatus('admin-login-status', 'Replace your temporary password on Play first, then return.', 'error');
    showView('login');
    return;
  }
  if (state.session.user?.role !== 'owner') {
    showView('forbidden');
    return;
  }
  await enterShell();
}

function bindEvents() {
  byId('admin-login-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus('admin-login-status', 'Authorizing…', 'busy');
    try {
      const { response, payload } = await api('/api/v1/auth/login', {
        method: 'POST',
        body: {
          username: byId('admin-login-username').value,
          password: byId('admin-login-password').value,
        },
      });
      if (!response.ok) throw new Error(payload.error || 'Login failed');
      state.session = payload;
      byId('admin-login-password').value = '';
      setStatus('admin-login-status', '');
      if (payload.user?.mustChangePassword) {
        setStatus('admin-login-status', 'Replace your temporary password on Play first, then return.', 'error');
        showView('login');
        return;
      }
      if (payload.user?.role !== 'owner') {
        showView('forbidden');
        return;
      }
      await enterShell();
    } catch (error) {
      setStatus('admin-login-status', error.message || 'Login failed', 'error');
    }
  });

  byId('admin-sign-out')?.addEventListener('click', async () => {
    try {
      await api('/api/v1/auth/logout', { method: 'POST', csrf: true });
    } catch { /* best effort */ }
    state.session = null;
    stopPolling();
    location.reload();
  });

  byId('admin-create-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    setStatus('admin-create-status', 'Creating account…', 'busy');
    try {
      const { response, payload } = await api('/api/v1/admin/users', {
        method: 'POST',
        csrf: true,
        body: {
          username: byId('admin-create-username').value,
          displayName: byId('admin-create-display').value,
        },
      });
      if (!response.ok) {
        setStatus('admin-create-status', payload.error || 'Create failed', 'error');
        return;
      }
      showTempPassword(payload.user.username, payload.temporaryPassword);
      setStatus('admin-create-status', 'Account created', 'ok');
      form.reset();
      await refreshDashboard();
    } catch (error) {
      setStatus('admin-create-status', error.message || 'Create failed', 'error');
    } finally {
      if (submit) submit.disabled = false;
    }
  });

  byId('admin-players-body')?.addEventListener('click', (event) => {
    const row = event.target.closest('tr[data-user-id]');
    if (!row) return;
    loadDetail(row.dataset.userId).catch((error) => {
      setStatus('admin-players-status', error.message || 'Detail failed', 'error');
    });
  });

  byId('admin-detail-close')?.addEventListener('click', () => {
    state.selectedUserId = null;
    byId('admin-detail-body')?.classList.add('hidden');
    byId('admin-detail-empty')?.classList.remove('hidden');
    for (const row of byId('admin-players-body')?.querySelectorAll('tr') ?? []) {
      row.classList.remove('is-selected');
    }
  });

  byId('admin-detail-body')?.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-detail-action]');
    if (!button) return;
    button.disabled = true;
    const userId = button.dataset.userId;
    try {
      let result;
      if (button.dataset.detailAction === 'status') {
        result = await api(`/api/v1/admin/users/${encodeURIComponent(userId)}/status`, {
          method: 'PATCH', csrf: true, body: { status: button.dataset.nextStatus },
        });
      } else if (button.dataset.detailAction === 'reset') {
        result = await api(`/api/v1/admin/users/${encodeURIComponent(userId)}/reset-password`, {
          method: 'POST', csrf: true,
        });
      } else if (button.dataset.detailAction === 'revoke') {
        result = await api(`/api/v1/admin/users/${encodeURIComponent(userId)}/revoke-sessions`, {
          method: 'POST', csrf: true,
        });
      } else if (button.dataset.detailAction === 'kick') {
        result = await api(`/api/v1/admin/multiplayer/${encodeURIComponent(userId)}/kick`, {
          method: 'POST', csrf: true,
        });
      }
      if (!result?.response.ok) {
        setStatus('admin-players-status', result?.payload?.error || 'Action failed', 'error');
        return;
      }
      if (result.payload.temporaryPassword) {
        showTempPassword(result.payload.user.username, result.payload.temporaryPassword);
      }
      setStatus('admin-players-status', 'Account updated', 'ok');
      await refreshDashboard();
      await loadDetail(userId);
    } catch (error) {
      setStatus('admin-players-status', error.message || 'Action failed', 'error');
    } finally {
      button.disabled = false;
    }
  });

  byId('admin-mp-body')?.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-kick-user-id]');
    if (!button) return;
    button.disabled = true;
    try {
      const { response, payload } = await api(
        `/api/v1/admin/multiplayer/${encodeURIComponent(button.dataset.kickUserId)}/kick`,
        { method: 'POST', csrf: true },
      );
      if (!response.ok) throw new Error(payload.error || 'Kick failed');
      await refreshDashboard();
    } catch (error) {
      setStatus('admin-players-status', error.message || 'Kick failed', 'error');
    } finally {
      button.disabled = false;
    }
  });

  byId('admin-legacy-list')?.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-pilot-id]');
    if (!button) return;
    const userId = button.parentElement.querySelector('select')?.value;
    if (!userId) return;
    button.disabled = true;
    try {
      const { response, payload } = await api(
        `/api/v1/admin/legacy-pilots/${encodeURIComponent(button.dataset.pilotId)}/claim`,
        { method: 'POST', csrf: true, body: { userId } },
      );
      if (!response.ok) throw new Error(payload.error || 'Claim failed');
      setStatus('admin-players-status', 'Legacy pilot attached', 'ok');
      await refreshDashboard();
    } catch (error) {
      setStatus('admin-players-status', error.message || 'Claim failed', 'error');
    } finally {
      button.disabled = false;
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.session?.user?.role === 'owner') refreshDashboard();
  });
}

bindEvents();
bootstrap().catch((error) => {
  console.error(error);
  setStatus('admin-login-status', error.message || 'Admin boot failed', 'error');
  showView('login');
});
