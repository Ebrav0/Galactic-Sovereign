import {
  accountApi,
  changeAccountPassword,
  currentAccountSession,
  discoverAccountSession,
  loginAccount,
  logoutAccount,
} from './account-client.js';
import { browserLocalSaveCandidates, importBrowserLocalSaves } from './save.js';

const byId = (id) => document.getElementById(id);

/** @type {null | (() => Promise<void> | void)} */
let hostedSaveFlushHandler = null;

/** Register a flush callback so Sign out can persist the active solo save first. */
export function setHostedSaveFlushHandler(handler) {
  hostedSaveFlushHandler = typeof handler === 'function' ? handler : null;
}

function installMarkup() {
  if (byId('account-gate')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <div id="account-gate" class="account-gate hidden" role="dialog" aria-modal="true" aria-labelledby="account-gate-title">
      <div class="account-card">
        <div class="account-card__sigil" aria-hidden="true">⬡</div>
        <p class="account-card__eyebrow">Sovereign Identity Network</p>
        <h2 id="account-gate-title">Command authorization</h2>
        <p class="account-card__copy">Sign in with the account issued by the server owner. Solo saves and multiplayer identity stay attached to this account.</p>
        <form id="account-login-form" class="account-form">
          <label><span>Username</span><input id="account-username" name="username" autocomplete="username" maxlength="32" required /></label>
          <label><span>Password</span><input id="account-password" name="password" type="password" autocomplete="current-password" maxlength="256" required /></label>
          <p id="account-login-status" class="account-status" aria-live="polite"></p>
          <button class="btn btn--primary btn--block" type="submit">Authorize command</button>
        </form>
        <form id="account-password-form" class="account-form hidden">
          <p class="account-card__notice">Your temporary password must be replaced before saves or multiplayer unlock.</p>
          <label><span>Temporary password</span><input id="account-current-password" type="password" autocomplete="current-password" maxlength="256" required /></label>
          <label><span>New password</span><input id="account-new-password" type="password" autocomplete="new-password" minlength="12" maxlength="256" required /></label>
          <label><span>Confirm new password</span><input id="account-confirm-password" type="password" autocomplete="new-password" minlength="12" maxlength="256" required /></label>
          <p id="account-password-status" class="account-status" aria-live="polite"></p>
          <button class="btn btn--primary btn--block" type="submit">Replace password</button>
        </form>
      </div>
    </div>
    <div id="account-chip" class="account-chip hidden">
      <span><small>Signed in</small><strong id="account-chip-name">—</strong></span>
      <button id="account-admin-open" class="btn btn--ghost btn--xs hidden" type="button">Admin</button>
      <button id="account-logout" class="btn btn--ghost btn--xs" type="button">Sign out</button>
    </div>
    <div id="account-import" class="account-import hidden" role="status">
      <div><strong>Local saves found</strong><span>Copy them to this account? Browser originals will be retained.</span></div>
      <button id="account-import-now" class="btn btn--primary btn--xs" type="button">Copy saves</button>
      <button id="account-import-later" class="btn btn--ghost btn--xs" type="button">Later</button>
    </div>
    <div id="account-admin-backdrop" class="modal-backdrop hidden"></div>
    <section id="account-admin" class="panel panel--modal account-admin hidden" role="dialog" aria-modal="true" aria-labelledby="account-admin-title">
      <div class="panel__header">
        <span class="panel__marker" aria-hidden="true"></span>
        <span class="panel__title" id="account-admin-title">Operations Dashboard</span>
        <span class="panel__trace" aria-hidden="true"></span>
        <button id="account-admin-close" class="btn btn--ghost btn--xs" type="button">Close</button>
      </div>
      <div class="panel__body account-admin__body">
        <p class="account-card__notice">Intended to run behind Cloudflare Access. Passwords and secrets are never listed here.</p>
        <div id="account-admin-overview" class="account-admin__overview" aria-live="polite"></div>
        <form id="account-create-form" class="account-form account-form--row">
          <label><span>Username</span><input id="account-create-username" maxlength="32" required /></label>
          <label><span>Display name</span><input id="account-create-display" maxlength="32" required /></label>
          <button class="btn btn--primary btn--sm" type="submit">Create player</button>
        </form>
        <p id="account-admin-status" class="account-status" aria-live="polite"></p>
        <div id="account-temp-password" class="account-temp-password hidden"></div>
        <h3 class="account-admin__section-title">Players</h3>
        <div id="account-user-list" class="account-user-list"></div>
        <h3 class="account-admin__section-title">Active sessions</h3>
        <div id="account-session-list" class="account-user-list"></div>
        <h3 class="account-admin__section-title">Multiplayer</h3>
        <div id="account-mp-status" class="account-user-list"></div>
        <h3 class="account-admin__section-title">Save files (metadata)</h3>
        <div id="account-save-list" class="account-user-list"></div>
        <h3 class="account-admin__section-title">Backups</h3>
        <div id="account-backup-list" class="account-user-list"></div>
        <h3 class="account-admin__section-title">Audit log</h3>
        <div id="account-audit-list" class="account-user-list"></div>
        <div id="account-legacy-section" class="account-legacy-section hidden">
          <h3>Legacy multiplayer pilots</h3>
          <p>Attach each preserved pilot identity to one account. Claims are one-time.</p>
          <div id="account-legacy-list" class="account-user-list"></div>
        </div>
      </div>
    </section>
  `);
}

function setStatus(id, message, kind = '') {
  const element = byId(id);
  if (!element) return;
  element.textContent = message || '';
  element.dataset.kind = kind;
}

function configureHostedMultiplayer(session) {
  const callsign = byId('title-mp-callsign');
  const password = byId('title-mp-password');
  callsign?.closest('label')?.classList.add('hidden');
  password?.closest('label')?.classList.add('hidden');
  if (callsign) {
    callsign.value = session.user.displayName;
    callsign.required = false;
  }
  if (password) password.value = '';
  const join = byId('title-mp-join-btn');
  if (join) join.textContent = 'Join persistent universe';
}

async function renderAccount() {
  const session = currentAccountSession();
  const gate = byId('account-gate');
  const loginForm = byId('account-login-form');
  const passwordForm = byId('account-password-form');
  const chip = byId('account-chip');
  const mustChange = !!session?.user?.mustChangePassword;
  gate?.classList.toggle('hidden', !!session?.authenticated && !mustChange);
  loginForm?.classList.toggle('hidden', !!session?.authenticated);
  passwordForm?.classList.toggle('hidden', !mustChange);
  chip?.classList.toggle('hidden', !session?.authenticated || mustChange);
  if (!session?.authenticated || mustChange) return;
  byId('account-chip-name').textContent = session.user.displayName;
  byId('account-admin-open')?.classList.toggle('hidden', session.user.role !== 'owner');
  configureHostedMultiplayer(session);
  const localSaves = browserLocalSaveCandidates();
  if (localSaves.length && sessionStorage.getItem('gs.local-import.dismissed') !== '1') {
    byId('account-import')?.classList.remove('hidden');
  }
}

function formatWhen(ts) {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleString(); } catch { return String(ts); }
}

function formatBytes(n) {
  const value = Number(n);
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function fillSimpleList(elementId, rows) {
  const list = byId(elementId);
  if (!list) return;
  list.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'account-card__notice';
    empty.textContent = 'None';
    list.append(empty);
    return;
  }
  for (const row of rows) {
    const article = document.createElement('article');
    article.className = 'account-user-row';
    const identity = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = row.title;
    const meta = document.createElement('span');
    meta.textContent = row.meta;
    identity.append(title, meta);
    article.append(identity);
    list.append(article);
  }
}

async function renderUsers() {
  const [usersResult, overviewResult, sessionsResult, savesResult, backupsResult, auditResult, mpResult] = await Promise.all([
    accountApi('/api/v1/admin/users'),
    accountApi('/api/v1/admin/overview'),
    accountApi('/api/v1/admin/sessions'),
    accountApi('/api/v1/admin/saves'),
    accountApi('/api/v1/admin/backups'),
    accountApi('/api/v1/admin/audit?limit=40'),
    accountApi('/api/v1/admin/multiplayer'),
  ]);
  if (!usersResult.response.ok) throw new Error(usersResult.payload.error || 'Could not load users');

  const overview = byId('account-admin-overview');
  if (overview && overviewResult.response.ok) {
    const o = overviewResult.payload;
    const mp = o.multiplayer || {};
    overview.replaceChildren();
    const line = document.createElement('p');
    line.textContent = [
      `Accounts ${o.users?.active ?? '—'}/${o.users?.total ?? '—'} active`,
      `Sessions ${o.activeSessions ?? '—'}`,
      `Solo saves ${o.soloSaves ?? '—'}`,
      `Relay sockets ${o.liveRelayCount ?? '—'}`,
      `Co-op online ${mp.playersOnline ?? '—'} · tick ${mp.tick ?? '—'}`,
      mp.ok === false ? `Co-op health: ${mp.error || 'down'}` : 'Co-op health: ok',
    ].join(' · ');
    overview.append(line);
  }

  const list = byId('account-user-list');
  list.replaceChildren();
  for (const user of usersResult.payload.users ?? []) {
    const row = document.createElement('article');
    row.className = 'account-user-row';
    const identity = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = user.displayName;
    const meta = document.createElement('span');
    meta.textContent = [
      user.username,
      user.role,
      user.status,
      user.mustChangePassword ? 'password change required' : null,
      `last login ${formatWhen(user.lastLoginAt)}`,
      `last seen ${formatWhen(user.lastSeenAt)}`,
      `${user.activeSessionCount || 0} session(s)`,
      user.multiplayerOnline ? 'MP online' : 'MP offline',
      `${user.soloSaveCount || 0} save(s)`,
    ].filter(Boolean).join(' · ');
    identity.append(name, meta);
    row.append(identity);
    if (user.role !== 'owner') {
      for (const [action, label] of [
        ['status', user.status === 'active' ? 'Disable' : 'Enable'],
        ['reset', 'Reset password'],
        ['revoke', 'Revoke sessions'],
      ]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn--ghost btn--xs';
        button.dataset.userId = user.id;
        button.dataset.action = action;
        button.dataset.nextStatus = user.status === 'active' ? 'disabled' : 'active';
        button.textContent = label;
        row.append(button);
      }
    }
    list.append(row);
  }

  fillSimpleList('account-session-list', (sessionsResult.payload?.sessions ?? []).map((s) => ({
    title: `${s.displayName || s.username} · ${s.sessionId}`,
    meta: `created ${formatWhen(s.createdAt)} · last seen ${formatWhen(s.lastSeenAt)} · expires ${formatWhen(s.expiresAt)}`,
  })));

  const mpLive = mpResult.payload?.live ?? [];
  const mpHealth = mpResult.payload?.health ?? {};
  fillSimpleList('account-mp-status', [
    {
      title: `World ${mpHealth.worldId || '—'}`,
      meta: `online ${mpHealth.playersOnline ?? '—'} · tick ${mpHealth.tick ?? '—'} · saved ${formatWhen(mpHealth.lastSavedAt)}`,
    },
    ...mpLive.map((p) => ({
      title: p.displayName || p.userId,
      meta: `RTT ${p.lastRttMs ?? '—'} ms`,
    })),
  ]);

  fillSimpleList('account-save-list', (savesResult.payload?.saves ?? []).map((s) => ({
    title: `${s.displayName || s.username} · ${s.slot}`,
    meta: `rev ${s.revision} · ${formatBytes(s.sizeBytes)} · ${formatWhen(s.savedAt)} · credits ${s.credits ?? '—'}`,
  })));

  fillSimpleList('account-backup-list', (backupsResult.payload?.backups ?? []).map((b) => ({
    title: b.name,
    meta: `${formatBytes(b.sizeBytes)} · ${formatWhen(b.modifiedAt)}`,
  })));

  fillSimpleList('account-audit-list', (auditResult.payload?.events ?? []).map((e) => ({
    title: e.action,
    meta: `${e.actorUsername || 'system'} → ${e.targetUsername || '—'} · ${formatWhen(e.createdAt)}`,
  })));

  const legacyResult = await accountApi('/api/v1/admin/legacy-pilots');
  if (!legacyResult.response.ok) throw new Error(legacyResult.payload.error || 'Could not load legacy pilots');
  const legacySection = byId('account-legacy-section');
  const legacyList = byId('account-legacy-list');
  const pilots = legacyResult.payload.pilots ?? [];
  legacySection.classList.toggle('hidden', pilots.length === 0);
  legacyList.replaceChildren();
  for (const pilot of pilots) {
    const row = document.createElement('article');
    row.className = 'account-user-row account-legacy-row';
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
      for (const user of usersResult.payload.users ?? []) {
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
    legacyList.append(row);
  }
}

function showTemporaryPassword(username, password) {
  const box = byId('account-temp-password');
  box.replaceChildren();
  const title = document.createElement('strong');
  title.textContent = `Temporary password for ${username}`;
  const code = document.createElement('code');
  code.textContent = password;
  const note = document.createElement('span');
  note.textContent = 'Copy it now. It is shown only in this response.';
  box.append(title, code, note);
  box.classList.remove('hidden');
}

export async function initAccountUi() {
  installMarkup();
  const discovered = await discoverAccountSession();
  if (!discovered.hosted) return;
  document.body.classList.add('hosted-mode');
  await renderAccount();

  byId('account-login-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    setStatus('account-login-status', 'Authorizing…', 'busy');
    try {
      await loginAccount(byId('account-username').value, byId('account-password').value);
      byId('account-password').value = '';
      setStatus('account-login-status', '');
      await renderAccount();
    } catch (error) {
      setStatus('account-login-status', error.message, 'error');
    }
  });

  byId('account-password-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const next = byId('account-new-password').value;
    if (next !== byId('account-confirm-password').value) {
      setStatus('account-password-status', 'New passwords do not match', 'error');
      return;
    }
    setStatus('account-password-status', 'Replacing password…', 'busy');
    try {
      await changeAccountPassword(byId('account-current-password').value, next);
      byId('account-current-password').value = '';
      byId('account-new-password').value = '';
      byId('account-confirm-password').value = '';
      setStatus('account-password-status', 'Password changed. Sign in again.', 'ok');
      await renderAccount();
    } catch (error) {
      setStatus('account-password-status', error.message, 'error');
    }
  });

  byId('account-logout')?.addEventListener('click', async () => {
    try {
      if (hostedSaveFlushHandler) await hostedSaveFlushHandler();
    } catch { /* best-effort flush before session revoke */ }
    try { await logoutAccount(); } finally { window.location.reload(); }
  });
  byId('account-import-later')?.addEventListener('click', () => {
    sessionStorage.setItem('gs.local-import.dismissed', '1');
    byId('account-import')?.classList.add('hidden');
  });
  byId('account-import-now')?.addEventListener('click', async () => {
    const button = byId('account-import-now');
    button.disabled = true;
    button.textContent = 'Copying…';
    const result = await importBrowserLocalSaves();
    button.disabled = false;
    if (result.ok) {
      button.textContent = `Copied ${result.imported.length}`;
      setTimeout(() => byId('account-import')?.classList.add('hidden'), 1800);
    } else {
      button.textContent = result.error || 'Copy failed';
    }
  });

  const closeAdmin = () => {
    byId('account-admin')?.classList.add('hidden');
    byId('account-admin-backdrop')?.classList.add('hidden');
  };
  const openAdmin = async () => {
    if (!window.location.pathname.startsWith('/admin')) {
      window.location.assign('/admin');
      return;
    }
    byId('account-admin')?.classList.remove('hidden');
    byId('account-admin-backdrop')?.classList.remove('hidden');
    try { await renderUsers(); } catch (error) { setStatus('account-admin-status', error.message, 'error'); }
  };
  byId('account-admin-open')?.addEventListener('click', openAdmin);
  byId('account-admin-close')?.addEventListener('click', () => {
    closeAdmin();
    if (window.location.pathname.startsWith('/admin')) window.location.assign('/');
  });
  byId('account-admin-backdrop')?.addEventListener('click', closeAdmin);

  byId('account-create-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    setStatus('account-admin-status', 'Creating account…', 'busy');
    try {
      const result = await accountApi('/api/v1/admin/users', {
        method: 'POST', csrf: true,
        body: { username: byId('account-create-username').value, displayName: byId('account-create-display').value },
      });
      if (!result.response.ok) return setStatus('account-admin-status', result.payload.error || 'Create failed', 'error');
      showTemporaryPassword(result.payload.user.username, result.payload.temporaryPassword);
      setStatus('account-admin-status', 'Account created', 'ok');
      form.reset();
      await renderUsers();
    } catch (error) {
      setStatus('account-admin-status', error.message || 'Create failed', 'error');
    } finally {
      if (submit) submit.disabled = false;
    }
  });

  byId('account-user-list')?.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-user-id]');
    if (!button) return;
    button.disabled = true;
    let pathname;
    let method = 'POST';
    let body;
    if (button.dataset.action === 'status') {
      pathname = `/api/v1/admin/users/${encodeURIComponent(button.dataset.userId)}/status`;
      method = 'PATCH';
      body = { status: button.dataset.nextStatus };
    } else if (button.dataset.action === 'reset') {
      pathname = `/api/v1/admin/users/${encodeURIComponent(button.dataset.userId)}/reset-password`;
    } else {
      pathname = `/api/v1/admin/users/${encodeURIComponent(button.dataset.userId)}/revoke-sessions`;
    }
    const result = await accountApi(pathname, { method, csrf: true, body });
    button.disabled = false;
    if (!result.response.ok) return setStatus('account-admin-status', result.payload.error || 'Action failed', 'error');
    if (result.payload.temporaryPassword) showTemporaryPassword(result.payload.user.username, result.payload.temporaryPassword);
    setStatus('account-admin-status', 'Account updated', 'ok');
    await renderUsers();
  });

  byId('account-legacy-list')?.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-pilot-id]');
    if (!button) return;
    const userId = button.parentElement.querySelector('select')?.value;
    if (!userId) return;
    button.disabled = true;
    const result = await accountApi(`/api/v1/admin/legacy-pilots/${encodeURIComponent(button.dataset.pilotId)}/claim`, {
      method: 'POST', csrf: true, body: { userId },
    });
    button.disabled = false;
    if (!result.response.ok) return setStatus('account-admin-status', result.payload.error || 'Claim failed', 'error');
    setStatus('account-admin-status', 'Legacy pilot attached', 'ok');
    await renderUsers();
  });

  if (window.location.pathname.startsWith('/admin') && currentAccountSession()?.user?.role === 'owner') {
    await openAdmin();
  }
}
