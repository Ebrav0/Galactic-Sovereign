const state = {
  ready: false,
  hosted: false,
  session: null,
};

let discoveryPromise = null;

export function accountState() {
  return { ...state, session: state.session ? structuredClone(state.session) : null };
}

export function isHostedMode() {
  return state.hosted;
}

export function currentAccountSession() {
  return state.session;
}

function metaContent(name) {
  return document.querySelector(`meta[name="${name}"]`)?.getAttribute('content')?.trim() || '';
}

export function playOrigin() {
  return metaContent('gs-play-origin') || window.location.origin;
}

export function adminOrigin() {
  return metaContent('gs-admin-origin') || window.location.origin;
}

export async function discoverAccountSession({ force = false } = {}) {
  if (discoveryPromise && !force) return discoveryPromise;
  discoveryPromise = (async () => {
    if (!/^https?:$/.test(window.location.protocol)) {
      Object.assign(state, { ready: true, hosted: false, session: null });
      return accountState();
    }
    try {
      const response = await fetch('/api/v1/session', {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      });
      const type = response.headers.get('content-type') || '';
      if (!response.ok || !type.includes('application/json')) throw new Error('Hosted API unavailable');
      const payload = await response.json();
      Object.assign(state, { ready: true, hosted: true, session: payload.authenticated ? payload : null });
      document.documentElement.dataset.hosted = 'true';
    } catch {
      Object.assign(state, { ready: true, hosted: false, session: null });
      document.documentElement.dataset.hosted = 'false';
    }
    window.dispatchEvent(new CustomEvent('gs-account-changed', { detail: accountState() }));
    return accountState();
  })();
  return discoveryPromise;
}

export async function accountApi(pathname, {
  method = 'GET',
  body,
  csrf = false,
  timeoutMs = 15_000,
  keepalive = false,
} = {}) {
  if (!state.ready) await discoverAccountSession();
  if (!state.hosted) throw new Error('Hosted account API is unavailable');
  const controller = keepalive ? null : new AbortController();
  const timeout = keepalive ? null : setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(pathname, {
      method,
      credentials: 'same-origin',
      redirect: 'follow',
      ...(controller ? { signal: controller.signal } : {}),
      keepalive: !!keepalive,
      headers: {
        accept: 'application/json',
        ...(body == null ? {} : { 'content-type': 'application/json' }),
        ...(csrf && state.session?.csrfToken ? { 'x-csrf-token': state.session.csrfToken } : {}),
      },
      body: body == null ? undefined : JSON.stringify(body),
    });
    if (keepalive) {
      // Page is unloading; do not wait on JSON parsing.
      return { response, payload: {} };
    }
    const type = response.headers.get('content-type') || '';
    if (!type.includes('application/json')) {
      throw new Error('Admin authorization expired. Reload and sign in again.');
    }
    const payload = await response.json();
    return { response, payload };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Admin request timed out. Reload and try again.');
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function loginAccount(username, password) {
  const result = await accountApi('/api/v1/auth/login', { method: 'POST', body: { username, password } });
  if (!result.response.ok) throw new Error(result.payload.error || 'Login failed');
  state.session = result.payload;
  window.dispatchEvent(new CustomEvent('gs-account-changed', { detail: accountState() }));
  return state.session;
}

export async function logoutAccount() {
  const result = await accountApi('/api/v1/auth/logout', { method: 'POST', csrf: true });
  if (!result.response.ok) throw new Error(result.payload.error || 'Logout failed');
  state.session = null;
  window.dispatchEvent(new CustomEvent('gs-account-changed', { detail: accountState() }));
}

export async function changeAccountPassword(currentPassword, newPassword) {
  const result = await accountApi('/api/v1/auth/change-password', {
    method: 'POST', csrf: true, body: { currentPassword, newPassword },
  });
  if (!result.response.ok) throw new Error(result.payload.error || 'Password change failed');
  state.session = null;
  window.dispatchEvent(new CustomEvent('gs-account-changed', { detail: accountState() }));
}

export async function createAdminHandoff() {
  const result = await accountApi('/api/v1/auth/admin-handoff', { method: 'POST', csrf: true });
  if (!result.response.ok) throw new Error(result.payload.error || 'Admin handoff failed');
  return result.payload;
}

export function hostedMultiplayerUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/multiplayer`;
}
