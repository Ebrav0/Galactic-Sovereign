import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { hash as argonHash, verify as argonVerify, Algorithm } from '@node-rs/argon2';

import { deserialize } from '../src/js/save.js';

export const SAVE_SLOTS = Object.freeze([
  'autosave',
  'slot-1',
  'slot-2',
  'slot-3',
  'exit-save',
  'tutorial-checkpoint',
]);

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_MIN_LENGTH = 12;
const ARGON_OPTIONS = Object.freeze({
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
});

const now = () => Date.now();
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

function normalizeUsername(value) {
  const username = String(value ?? '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) {
    throw new Error('Username must be 3-32 lowercase letters, numbers, dots, dashes, or underscores');
  }
  return username;
}

function normalizeDisplayName(value, fallback) {
  const name = String(value ?? fallback ?? '').trim().replace(/\s+/g, ' ').slice(0, 32);
  if (!name) throw new Error('Display name is required');
  return name;
}

function assertPassword(password) {
  const value = String(password ?? '');
  if (value.length < PASSWORD_MIN_LENGTH || value.length > 256) {
    throw new Error(`Password must be ${PASSWORD_MIN_LENGTH}-256 characters`);
  }
  return value;
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    mustChangePassword: !!row.must_change_password,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at ?? null,
  };
}

export function generateTemporaryPassword() {
  return `${randomToken(12)}!aA7`;
}

export class AuthStore {
  constructor({ dataDir, dbPath = null, sessionPepper = '' } = {}) {
    this.dataDir = path.resolve(dataDir || path.join(process.cwd(), 'server', 'data'));
    fs.mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(this.dataDir, 0o700); } catch { /* platform/filesystem dependent */ }
    this.dbPath = dbPath || path.join(this.dataDir, 'accounts.sqlite');
    this.sessionPepper = String(sessionPepper || '');
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA synchronous = FULL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('owner', 'player')),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
        must_change_password INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        csrf_token TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
      CREATE TABLE IF NOT EXISTS save_slots (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        slot TEXT NOT NULL,
        revision INTEGER NOT NULL,
        save_version INTEGER NOT NULL,
        saved_at INTEGER NOT NULL,
        envelope_json TEXT NOT NULL,
        PRIMARY KEY (user_id, slot)
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_user_id TEXT,
        target_user_id TEXT,
        action TEXT NOT NULL,
        detail_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS audit_created_idx ON audit_events(created_at);
      CREATE TABLE IF NOT EXISTS legacy_pilots (
        pilot_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        claimed_user_id TEXT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
        imported_at INTEGER NOT NULL,
        claimed_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS admin_handoffs (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS admin_handoffs_expiry_idx ON admin_handoffs(expires_at);
    `);
    try {
      this.db.exec('ALTER TABLE users ADD COLUMN last_login_at INTEGER');
    } catch { /* column already exists */ }
    try { if (this.dbPath !== ':memory:') fs.chmodSync(this.dbPath, 0o600); } catch { /* ignore */ }
  }

  close() {
    this.db.close();
  }

  audit(action, { actorUserId = null, targetUserId = null, detail = {} } = {}) {
    this.db.prepare(`
      INSERT INTO audit_events(actor_user_id, target_user_id, action, detail_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(actorUserId, targetUserId, String(action).slice(0, 80), JSON.stringify(detail), now());
  }

  async createUser({ username, displayName, password, role = 'player', mustChangePassword = true, actorUserId = null }) {
    const canonical = normalizeUsername(username);
    const safeDisplayName = normalizeDisplayName(displayName, canonical);
    const safePassword = assertPassword(password);
    if (!['owner', 'player'].includes(role)) throw new Error('Invalid role');
    const passwordHash = await argonHash(safePassword, ARGON_OPTIONS);
    const id = crypto.randomUUID();
    const createdAt = now();
    this.db.prepare(`
      INSERT INTO users(id, username, display_name, password_hash, role, status, must_change_password, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(id, canonical, safeDisplayName, passwordHash, role, mustChangePassword ? 1 : 0, createdAt, createdAt);
    this.audit('user.created', { actorUserId, targetUserId: id, detail: { username: canonical, role } });
    return this.getUserById(id);
  }

  getUserById(id) {
    return publicUser(this.db.prepare('SELECT * FROM users WHERE id = ?').get(String(id)));
  }

  getUserByUsername(username) {
    let canonical;
    try { canonical = normalizeUsername(username); } catch { return null; }
    return publicUser(this.db.prepare('SELECT * FROM users WHERE username = ?').get(canonical));
  }

  listUsers() {
    return this.db.prepare('SELECT * FROM users ORDER BY created_at ASC').all().map(publicUser);
  }

  summarizeSaveEnvelope(envelope, meta = {}) {
    try {
      const parsed = typeof envelope === 'string' ? JSON.parse(envelope) : envelope;
      const state = parsed?.state && typeof parsed.state === 'object' ? parsed.state : parsed;
      const campaign = state?.campaign && typeof state.campaign === 'object' ? state.campaign : {};
      const tutorial = campaign.tutorial && typeof campaign.tutorial === 'object' ? campaign.tutorial : {};
      const outposts = Array.isArray(state?.outposts) ? state.outposts : [];
      const systems = Array.isArray(state?.systems) ? state.systems : null;
      return {
        slot: meta.slot ?? null,
        revision: meta.revision ?? null,
        saveVersion: meta.saveVersion ?? parsed?.saveVersion ?? null,
        savedAt: meta.savedAt ?? parsed?.savedAt ?? null,
        sizeBytes: meta.sizeBytes ?? (typeof envelope === 'string' ? Buffer.byteLength(envelope) : null),
        campaignMode: campaign.mode ?? null,
        tutorialStatus: tutorial.status ?? null,
        tutorialStepId: tutorial.currentStepId ?? null,
        credits: Number.isFinite(Number(state?.credits)) ? Number(state.credits) : null,
        outpostCount: outposts.length,
        systemCount: systems ? systems.length : null,
      };
    } catch {
      return {
        slot: meta.slot ?? null,
        revision: meta.revision ?? null,
        saveVersion: meta.saveVersion ?? null,
        savedAt: meta.savedAt ?? null,
        sizeBytes: meta.sizeBytes ?? null,
        campaignMode: null,
        tutorialStatus: null,
        tutorialStepId: null,
        credits: null,
        outpostCount: null,
        systemCount: null,
        corrupt: true,
      };
    }
  }

  listSaveSummaries(userId) {
    const rows = this.db.prepare(`
      SELECT slot, revision, save_version AS saveVersion, saved_at AS savedAt,
             length(envelope_json) AS sizeBytes, envelope_json AS envelope
      FROM save_slots WHERE user_id = ? ORDER BY saved_at DESC, slot ASC
    `).all(String(userId));
    return rows.map((row) => this.summarizeSaveEnvelope(row.envelope, {
      slot: row.slot,
      revision: row.revision,
      saveVersion: row.saveVersion,
      savedAt: row.savedAt,
      sizeBytes: row.sizeBytes,
    }));
  }

  listUserSessions(userId) {
    const t = now();
    return this.db.prepare(`
      SELECT substr(token_hash, 1, 12) AS sessionId,
             created_at AS createdAt, last_seen_at AS lastSeenAt, expires_at AS expiresAt
      FROM sessions WHERE user_id = ? AND expires_at > ?
      ORDER BY last_seen_at DESC
    `).all(String(userId), t);
  }

  listActiveSessions() {
    const t = now();
    return this.db.prepare(`
      SELECT substr(s.token_hash, 1, 12) AS sessionId,
             s.user_id AS userId, u.username, u.display_name AS displayName,
             s.created_at AS createdAt, s.last_seen_at AS lastSeenAt, s.expires_at AS expiresAt
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.expires_at > ?
      ORDER BY s.last_seen_at DESC
      LIMIT 200
    `).all(t);
  }

  listAllSaveSummaries({ limit = 100 } = {}) {
    const capped = Math.max(1, Math.min(500, Number(limit) || 100));
    const rows = this.db.prepare(`
      SELECT s.user_id AS userId, u.username, u.display_name AS displayName,
             s.slot, s.revision, s.save_version AS saveVersion, s.saved_at AS savedAt,
             length(s.envelope_json) AS sizeBytes, s.envelope_json AS envelope
      FROM save_slots s
      JOIN users u ON u.id = s.user_id
      ORDER BY s.saved_at DESC
      LIMIT ?
    `).all(capped);
    return rows.map((row) => ({
      userId: row.userId,
      username: row.username,
      displayName: row.displayName,
      ...this.summarizeSaveEnvelope(row.envelope, {
        slot: row.slot,
        revision: row.revision,
        saveVersion: row.saveVersion,
        savedAt: row.savedAt,
        sizeBytes: row.sizeBytes,
      }),
    }));
  }

  listUsersEnriched({ onlineWindowMs = 120_000, lastServer = null } = {}) {
    const t = now();
    const users = this.listUsers();
    const sessionAgg = this.db.prepare(`
      SELECT user_id AS userId,
             COUNT(*) AS activeSessionCount,
             MAX(last_seen_at) AS lastSeenAt,
             SUM(CASE WHEN last_seen_at >= created_at THEN last_seen_at - created_at ELSE 0 END) AS approxOnlineMs
      FROM sessions
      WHERE expires_at > ?
      GROUP BY user_id
    `).all(t);
    const sessionByUser = new Map(sessionAgg.map((row) => [row.userId, row]));
    const saveAgg = this.db.prepare(`
      SELECT user_id AS userId, COUNT(*) AS soloSaveCount, MAX(saved_at) AS latestSoloSavedAt
      FROM save_slots GROUP BY user_id
    `).all();
    const saveByUser = new Map(saveAgg.map((row) => [row.userId, row]));
    const latestEnvelopes = this.db.prepare(`
      SELECT s.user_id AS userId, s.slot, s.revision, s.save_version AS saveVersion,
             s.saved_at AS savedAt, length(s.envelope_json) AS sizeBytes, s.envelope_json AS envelope
      FROM save_slots s
      INNER JOIN (
        SELECT user_id, MAX(saved_at) AS max_saved
        FROM save_slots GROUP BY user_id
      ) latest ON latest.user_id = s.user_id AND latest.max_saved = s.saved_at
    `).all();
    const latestByUser = new Map();
    for (const row of latestEnvelopes) {
      if (latestByUser.has(row.userId)) continue;
      latestByUser.set(row.userId, this.summarizeSaveEnvelope(row.envelope, row));
    }
    const legacyByUser = new Map(
      this.db.prepare(`
        SELECT claimed_user_id AS userId, pilot_id AS pilotId
        FROM legacy_pilots WHERE claimed_user_id IS NOT NULL
      `).all().map((row) => [row.userId, row.pilotId]),
    );
    return users.map((user) => {
      const sessions = sessionByUser.get(user.id);
      const saves = saveByUser.get(user.id);
      const lastSeenAt = sessions?.lastSeenAt ?? null;
      return {
        ...user,
        lastSeenAt,
        activeSessionCount: Number(sessions?.activeSessionCount || 0),
        approxOnline: lastSeenAt != null && (t - lastSeenAt) <= onlineWindowMs,
        approxOnlineMs: Number(sessions?.approxOnlineMs || 0),
        soloSaveCount: Number(saves?.soloSaveCount || 0),
        latestSoloSavedAt: saves?.latestSoloSavedAt ?? null,
        latestSoloSummary: latestByUser.get(user.id) ?? null,
        multiplayerOnline: false,
        multiplayerRttMs: null,
        lastServer: lastServer || null,
        legacyPilotId: legacyByUser.get(user.id) ?? null,
      };
    });
  }

  getUserDetail(userId, { lastServer = null } = {}) {
    const user = this.getUserById(userId);
    if (!user) return null;
    const enriched = this.listUsersEnriched({ lastServer }).find((entry) => entry.id === user.id);
    return {
      user: enriched || user,
      sessions: this.listUserSessions(user.id),
      saves: this.listSaveSummaries(user.id),
      legacyPilot: this.claimedPilotForUser(user.id),
    };
  }

  adminOverviewCounts() {
    const t = now();
    const users = this.db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN status = 'disabled' THEN 1 ELSE 0 END) AS disabled,
        SUM(CASE WHEN role = 'owner' THEN 1 ELSE 0 END) AS owners
      FROM users
    `).get();
    const activeSessions = this.db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE expires_at > ?').get(t)?.count || 0;
    const soloSaves = this.db.prepare('SELECT COUNT(*) AS count FROM save_slots').get()?.count || 0;
    return {
      users: {
        total: Number(users?.total || 0),
        active: Number(users?.active || 0),
        disabled: Number(users?.disabled || 0),
        owners: Number(users?.owners || 0),
      },
      activeSessions: Number(activeSessions),
      soloSaves: Number(soloSaves),
    };
  }

  updateDisplayName(userId, displayName, actorUserId) {
    const name = normalizeDisplayName(displayName);
    const result = this.db.prepare('UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?')
      .run(name, now(), String(userId));
    if (!result.changes) throw new Error('User not found');
    this.audit('user.display_name_changed', {
      actorUserId, targetUserId: String(userId), detail: { displayName: name },
    });
    return this.getUserById(userId);
  }

  createAdminHandoff(userId) {
    const user = this.getUserById(userId);
    if (!user || user.role !== 'owner' || user.status !== 'active' || user.mustChangePassword) {
      throw new Error('Owner handoff unavailable');
    }
    this.db.prepare('DELETE FROM admin_handoffs WHERE expires_at < ? OR consumed_at IS NOT NULL').run(now());
    const token = randomToken(32);
    const tokenHash = this.hashSessionToken(token);
    const expiresAt = now() + 60_000;
    this.db.prepare(`
      INSERT INTO admin_handoffs(token_hash, user_id, expires_at, consumed_at)
      VALUES (?, ?, ?, NULL)
    `).run(tokenHash, user.id, expiresAt);
    this.audit('admin.handoff_created', { actorUserId: user.id, targetUserId: user.id });
    return { token, expiresAt };
  }

  redeemAdminHandoff(rawToken) {
    if (!rawToken) throw new Error('Handoff token required');
    const tokenHash = this.hashSessionToken(String(rawToken));
    const row = this.db.prepare('SELECT * FROM admin_handoffs WHERE token_hash = ?').get(tokenHash);
    if (!row || row.consumed_at != null || row.expires_at <= now()) {
      throw new Error('Handoff token invalid or expired');
    }
    const user = this.getUserById(row.user_id);
    if (!user || user.role !== 'owner' || user.status !== 'active' || user.mustChangePassword) {
      throw new Error('Handoff account unavailable');
    }
    this.db.prepare('UPDATE admin_handoffs SET consumed_at = ? WHERE token_hash = ?').run(now(), tokenHash);
    const created = this.createSession(user.id);
    this.audit('admin.handoff_redeemed', { actorUserId: user.id, targetUserId: user.id });
    return { ...created, user };
  }

  listAuditEvents(limit = 50) {
    const capped = Math.max(1, Math.min(200, Number(limit) || 50));
    return this.db.prepare(`
      SELECT e.id, e.actor_user_id AS actorUserId, a.username AS actorUsername,
             e.target_user_id AS targetUserId, t.username AS targetUsername,
             e.action, e.detail_json AS detailJson, e.created_at AS createdAt
      FROM audit_events e
      LEFT JOIN users a ON a.id = e.actor_user_id
      LEFT JOIN users t ON t.id = e.target_user_id
      ORDER BY e.id DESC
      LIMIT ?
    `).all(capped).map((row) => ({
      id: row.id,
      actorUserId: row.actorUserId,
      actorUsername: row.actorUsername,
      targetUserId: row.targetUserId,
      targetUsername: row.targetUsername,
      action: row.action,
      detail: (() => { try { return JSON.parse(row.detailJson || '{}'); } catch { return {}; } })(),
      createdAt: row.createdAt,
    }));
  }

  async authenticate(username, password) {
    let canonical;
    try { canonical = normalizeUsername(username); } catch { return null; }
    const row = this.db.prepare('SELECT * FROM users WHERE username = ?').get(canonical);
    if (!row || row.status !== 'active') return null;
    if (!await argonVerify(row.password_hash, String(password ?? ''))) return null;
    const loginAt = now();
    this.db.prepare('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?')
      .run(loginAt, loginAt, row.id);
    return publicUser({ ...row, last_login_at: loginAt, updated_at: loginAt });
  }

  createSession(userId) {
    const user = this.getUserById(userId);
    if (!user || user.status !== 'active') throw new Error('Account unavailable');
    const token = randomToken(32);
    const tokenHash = this.hashSessionToken(token);
    const csrfToken = randomToken(24);
    const createdAt = now();
    this.db.prepare(`
      INSERT INTO sessions(token_hash, user_id, csrf_token, created_at, last_seen_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(tokenHash, userId, csrfToken, createdAt, createdAt, createdAt + SESSION_TTL_MS);
    this.audit('session.created', { actorUserId: userId, targetUserId: userId });
    return { token, tokenHash, csrfToken, expiresAt: createdAt + SESSION_TTL_MS };
  }

  getSession(rawToken, { touch = true } = {}) {
    if (!rawToken) return null;
    const tokenHash = this.hashSessionToken(String(rawToken));
    const row = this.db.prepare(`
      SELECT s.*, u.username, u.display_name, u.role, u.status, u.must_change_password,
             u.created_at AS user_created_at, u.updated_at, u.last_login_at
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
    `).get(tokenHash);
    if (!row || row.expires_at <= now() || row.status !== 'active') {
      if (row) this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
      return null;
    }
    if (touch && now() - row.last_seen_at > 60_000) {
      this.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').run(now(), tokenHash);
    }
    return {
      tokenHash,
      csrfToken: row.csrf_token,
      expiresAt: row.expires_at,
      user: publicUser({
        id: row.user_id,
        username: row.username,
        display_name: row.display_name,
        role: row.role,
        status: row.status,
        must_change_password: row.must_change_password,
        created_at: row.user_created_at,
        updated_at: row.updated_at,
        last_login_at: row.last_login_at,
      }),
    };
  }

  revokeSessionHash(tokenHash, actorUserId = null) {
    const row = this.db.prepare('SELECT user_id FROM sessions WHERE token_hash = ?').get(tokenHash);
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    if (row) this.audit('session.revoked', { actorUserId, targetUserId: row.user_id });
  }

  hashSessionToken(rawToken) {
    if (!this.sessionPepper) return sha256(String(rawToken));
    return crypto.createHmac('sha256', this.sessionPepper).update(String(rawToken)).digest('hex');
  }

  revokeUserSessions(userId, actorUserId = null) {
    const result = this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(String(userId));
    this.audit('sessions.revoked_all', { actorUserId, targetUserId: String(userId), detail: { count: Number(result.changes) } });
    return Number(result.changes);
  }

  async changePassword(userId, currentPassword, newPassword) {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(String(userId));
    if (!row || !await argonVerify(row.password_hash, String(currentPassword ?? ''))) {
      throw new Error('Current password is incorrect');
    }
    const passwordHash = await argonHash(assertPassword(newPassword), ARGON_OPTIONS);
    this.db.prepare(`UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?`)
      .run(passwordHash, now(), row.id);
    this.revokeUserSessions(row.id, row.id);
    this.audit('password.changed', { actorUserId: row.id, targetUserId: row.id });
  }

  async resetPassword(userId, password, actorUserId) {
    const passwordHash = await argonHash(assertPassword(password), ARGON_OPTIONS);
    const result = this.db.prepare(`
      UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?
    `).run(passwordHash, now(), String(userId));
    if (!result.changes) throw new Error('User not found');
    this.revokeUserSessions(userId, actorUserId);
    this.audit('password.reset', { actorUserId, targetUserId: String(userId) });
    return this.getUserById(userId);
  }

  setUserStatus(userId, status, actorUserId) {
    if (!['active', 'disabled'].includes(status)) throw new Error('Invalid status');
    const target = this.getUserById(userId);
    if (!target) throw new Error('User not found');
    if (target.role === 'owner' && status === 'disabled') throw new Error('Owner account cannot be disabled');
    this.db.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), String(userId));
    if (status === 'disabled') this.revokeUserSessions(userId, actorUserId);
    this.audit('user.status_changed', { actorUserId, targetUserId: String(userId), detail: { status } });
    return this.getUserById(userId);
  }

  listSaves(userId) {
    return this.db.prepare(`
      SELECT slot, revision, save_version AS saveVersion, saved_at AS savedAt, length(envelope_json) AS sizeBytes
      FROM save_slots WHERE user_id = ? ORDER BY slot
    `).all(String(userId));
  }

  getSave(userId, slot) {
    if (!SAVE_SLOTS.includes(slot)) return null;
    return this.db.prepare(`
      SELECT slot, revision, save_version AS saveVersion, saved_at AS savedAt, envelope_json AS envelope
      FROM save_slots WHERE user_id = ? AND slot = ?
    `).get(String(userId), slot) ?? null;
  }

  putSave(userId, slot, envelope, expectedRevision = null) {
    if (!SAVE_SLOTS.includes(slot)) throw new Error('Invalid save slot');
    const raw = typeof envelope === 'string' ? envelope : JSON.stringify(envelope);
    if (Buffer.byteLength(raw) > 8 * 1024 * 1024) throw new Error('Save exceeds 8 MiB');
    const parsed = deserialize(raw);
    if (!parsed.ok) throw new Error(parsed.error || 'Invalid save');
    const current = this.getSave(userId, slot);
    if (current && expectedRevision !== current.revision) {
      const conflict = new Error('Save revision conflict');
      conflict.code = 'REVISION_CONFLICT';
      conflict.currentRevision = current.revision;
      throw conflict;
    }
    if (!current && expectedRevision !== 0 && expectedRevision !== null) {
      const conflict = new Error('Save revision conflict');
      conflict.code = 'REVISION_CONFLICT';
      conflict.currentRevision = 0;
      throw conflict;
    }
    const revision = (current?.revision ?? 0) + 1;
    const envelopeMeta = JSON.parse(raw);
    const savedAt = Number(envelopeMeta.savedAt) || now();
    const saveVersion = Number(envelopeMeta.saveVersion) || 0;
    this.db.prepare(`
      INSERT INTO save_slots(user_id, slot, revision, save_version, saved_at, envelope_json)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, slot) DO UPDATE SET
        revision = excluded.revision,
        save_version = excluded.save_version,
        saved_at = excluded.saved_at,
        envelope_json = excluded.envelope_json
    `).run(String(userId), slot, revision, saveVersion, savedAt, raw);
    this.audit('save.written', { actorUserId: String(userId), targetUserId: String(userId), detail: { slot, revision } });
    return this.getSave(userId, slot);
  }

  deleteSave(userId, slot) {
    if (!SAVE_SLOTS.includes(slot)) throw new Error('Invalid save slot');
    const result = this.db.prepare('DELETE FROM save_slots WHERE user_id = ? AND slot = ?')
      .run(String(userId), slot);
    if (result.changes) this.audit('save.deleted', {
      actorUserId: String(userId), targetUserId: String(userId), detail: { slot },
    });
    return Number(result.changes) > 0;
  }

  importLegacyPilots(pilots) {
    const statement = this.db.prepare(`
      INSERT INTO legacy_pilots(pilot_id, display_name, claimed_user_id, imported_at, claimed_at)
      VALUES (?, ?, NULL, ?, NULL)
      ON CONFLICT(pilot_id) DO UPDATE SET display_name = excluded.display_name
    `);
    let imported = 0;
    for (const pilot of pilots ?? []) {
      const pilotId = String(pilot?.pilotId ?? '').slice(0, 80);
      const displayName = normalizeDisplayName(pilot?.displayName, pilotId);
      if (!pilotId) continue;
      statement.run(pilotId, displayName, now());
      imported += 1;
    }
    if (imported) this.audit('legacy_pilots.imported', { detail: { count: imported } });
    return imported;
  }

  listLegacyPilots() {
    return this.db.prepare(`
      SELECT lp.pilot_id AS pilotId, lp.display_name AS displayName,
             lp.claimed_user_id AS claimedUserId, u.username AS claimedUsername,
             lp.imported_at AS importedAt, lp.claimed_at AS claimedAt
      FROM legacy_pilots lp LEFT JOIN users u ON u.id = lp.claimed_user_id
      ORDER BY lp.display_name, lp.pilot_id
    `).all();
  }

  claimedPilotForUser(userId) {
    return this.db.prepare(`
      SELECT pilot_id AS pilotId, display_name AS displayName
      FROM legacy_pilots WHERE claimed_user_id = ?
    `).get(String(userId)) ?? null;
  }

  claimLegacyPilot(pilotId, userId, actorUserId) {
    const pilot = this.db.prepare('SELECT * FROM legacy_pilots WHERE pilot_id = ?').get(String(pilotId));
    const user = this.getUserById(userId);
    if (!pilot) throw new Error('Legacy pilot not found');
    if (!user) throw new Error('User not found');
    if (pilot.claimed_user_id && pilot.claimed_user_id !== user.id) throw new Error('Legacy pilot is already claimed');
    const existing = this.claimedPilotForUser(user.id);
    if (existing && existing.pilotId !== pilot.pilot_id) throw new Error('User already has a legacy pilot');
    this.db.prepare('UPDATE legacy_pilots SET claimed_user_id = ?, claimed_at = ? WHERE pilot_id = ?')
      .run(user.id, now(), pilot.pilot_id);
    this.audit('legacy_pilot.claimed', {
      actorUserId, targetUserId: user.id, detail: { pilotId: pilot.pilot_id },
    });
    return this.listLegacyPilots().find((entry) => entry.pilotId === pilot.pilot_id);
  }
}
