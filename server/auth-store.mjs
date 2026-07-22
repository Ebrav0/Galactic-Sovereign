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
    `);
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

  async authenticate(username, password) {
    let canonical;
    try { canonical = normalizeUsername(username); } catch { return null; }
    const row = this.db.prepare('SELECT * FROM users WHERE username = ?').get(canonical);
    if (!row || row.status !== 'active') return null;
    if (!await argonVerify(row.password_hash, String(password ?? ''))) return null;
    return publicUser(row);
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
      SELECT s.*, u.username, u.display_name, u.role, u.status, u.must_change_password, u.created_at AS user_created_at, u.updated_at
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
