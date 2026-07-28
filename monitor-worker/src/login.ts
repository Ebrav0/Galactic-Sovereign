export const LOGIN_EVENT_TYPES = ['user.login', 'solo.enter', 'multiplayer.join'] as const;
export type LoginEventType = (typeof LOGIN_EVENT_TYPES)[number];

export interface LoginEvent {
  version: 1;
  type: LoginEventType;
  eventId: string;
  timestamp: number;
  user: {
    id: string;
    username: string;
    displayName: string;
    role: string;
  };
  context?: {
    mode?: string;
    reason?: string;
  };
}

function safeString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) return null;
  return normalized;
}

function isLoginEventType(value: unknown): value is LoginEventType {
  return typeof value === 'string' && (LOGIN_EVENT_TYPES as readonly string[]).includes(value);
}

export function validateLoginEvent(value: unknown): LoginEvent | null {
  if (!value || typeof value !== 'object') return null;
  const event = value as Record<string, unknown>;
  const user = event.user as Record<string, unknown> | null;
  const eventId = safeString(event.eventId, 64);
  const id = safeString(user?.id, 128);
  const username = safeString(user?.username, 32);
  const displayName = safeString(user?.displayName, 80);
  const role = safeString(user?.role, 24);
  if (
    event.version !== 1
    || !isLoginEventType(event.type)
    || !eventId
    || !/^[0-9a-f-]{36}$/i.test(eventId)
    || !Number.isInteger(event.timestamp)
    || !id
    || !username
    || !displayName
    || !role
  ) return null;

  let context: LoginEvent['context'];
  if (event.context != null) {
    if (typeof event.context !== 'object') return null;
    const raw = event.context as Record<string, unknown>;
    const mode = raw.mode == null ? undefined : safeString(raw.mode, 32) ?? null;
    const reason = raw.reason == null ? undefined : safeString(raw.reason, 32) ?? null;
    if (mode === null || reason === null) return null;
    if (mode || reason) context = { ...(mode ? { mode } : {}), ...(reason ? { reason } : {}) };
  }

  return {
    version: 1,
    type: event.type,
    eventId,
    timestamp: event.timestamp as number,
    user: { id, username, displayName, role },
    ...(context ? { context } : {}),
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function eventCopy(event: LoginEvent): { subjectPrefix: string; headline: string; summary: string } {
  switch (event.type) {
    case 'solo.enter':
      return {
        subjectPrefix: 'SOLO',
        headline: 'Galactic Sovereign solo session',
        summary: 'A user started or loaded a solo session.',
      };
    case 'multiplayer.join':
      return {
        subjectPrefix: 'MULTIPLAYER',
        headline: 'Galactic Sovereign multiplayer join',
        summary: 'A user joined the multiplayer server.',
      };
    default:
      return {
        subjectPrefix: 'LOGIN',
        headline: 'Galactic Sovereign login',
        summary: 'A user logged in successfully.',
      };
  }
}

export function formatLoginEmail(event: LoginEvent): { subject: string; text: string; html: string } {
  const occurredAt = new Date(event.timestamp * 1_000).toISOString();
  const copy = eventCopy(event);
  const subject = `${copy.subjectPrefix}: Galactic Sovereign — ${event.user.username}`;
  const detailLines = [
    `Display name: ${event.user.displayName}`,
    `Username: ${event.user.username}`,
    `Role: ${event.user.role}`,
    `Event: ${event.type}`,
    ...(event.context?.mode ? [`Mode: ${event.context.mode}`] : []),
    ...(event.context?.reason ? [`Reason: ${event.context.reason}`] : []),
    `Time: ${occurredAt}`,
    `Event ID: ${event.eventId}`,
  ];
  const text = [copy.summary, '', ...detailLines].join('\n');
  const html = [
    `<h1>${escapeHtml(copy.headline)}</h1>`,
    `<p>${escapeHtml(copy.summary)}</p>`,
    '<dl>',
    `<dt>Display name</dt><dd>${escapeHtml(event.user.displayName)}</dd>`,
    `<dt>Username</dt><dd>${escapeHtml(event.user.username)}</dd>`,
    `<dt>Role</dt><dd>${escapeHtml(event.user.role)}</dd>`,
    `<dt>Event</dt><dd>${escapeHtml(event.type)}</dd>`,
    ...(event.context?.mode ? [`<dt>Mode</dt><dd>${escapeHtml(event.context.mode)}</dd>`] : []),
    ...(event.context?.reason ? [`<dt>Reason</dt><dd>${escapeHtml(event.context.reason)}</dd>`] : []),
    `<dt>Time</dt><dd>${escapeHtml(occurredAt)}</dd>`,
    `<dt>Event ID</dt><dd>${escapeHtml(event.eventId)}</dd>`,
    '</dl>',
  ].join('');
  return { subject, text, html };
}
