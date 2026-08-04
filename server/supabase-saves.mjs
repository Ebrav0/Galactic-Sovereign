import { gzipSync, gunzipSync } from 'node:zlib';
import { createClient } from '@supabase/supabase-js';

import { SAVE_SLOTS } from './auth-store.mjs';
import { deserialize } from '../src/js/save.js';

export const GS_SAVE_BUCKET = 'gs-save-envelopes';
export const MAX_SAVE_BYTES = 8 * 1024 * 1024;

function storagePath(gsUserId, slot) {
  return `${String(gsUserId)}/${slot}.json.gz`;
}

function revisionConflict(currentRevision) {
  const error = new Error('Save revision conflict');
  error.code = 'REVISION_CONFLICT';
  error.currentRevision = currentRevision;
  return error;
}

/**
 * Server-only solo-save backend. Uses the Supabase service role;
 * players never authenticate to Supabase.
 */
export class SupabaseSaveStore {
  constructor({ url, serviceRoleKey }) {
    if (!url || !serviceRoleKey) {
      throw new Error('SupabaseSaveStore requires url and serviceRoleKey');
    }
    this.client = createClient(String(url).replace(/\/$/, ''), String(serviceRoleKey), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async listSaves(userId) {
    const { data, error } = await this.client
      .from('gs_save_slots')
      .select('slot, revision, save_version, saved_at, byte_size')
      .eq('gs_user_id', String(userId))
      .order('slot', { ascending: true });
    if (error) throw new Error(`Supabase listSaves: ${error.message}`);
    return (data ?? []).map((row) => ({
      slot: row.slot,
      revision: row.revision,
      saveVersion: row.save_version,
      savedAt: row.saved_at,
      sizeBytes: row.byte_size,
    }));
  }

  async countSaves() {
    const { count, error } = await this.client
      .from('gs_save_slots')
      .select('*', { count: 'exact', head: true });
    if (error) throw new Error(`Supabase countSaves: ${error.message}`);
    return Number(count || 0);
  }

  async listAllSaveSummaries({ limit = 100 } = {}) {
    const capped = Math.max(1, Math.min(500, Number(limit) || 100));
    const { data, error } = await this.client
      .from('gs_save_slots')
      .select('gs_user_id, slot, revision, save_version, saved_at, byte_size')
      .order('saved_at', { ascending: false })
      .limit(capped);
    if (error) throw new Error(`Supabase listAllSaveSummaries: ${error.message}`);
    return (data ?? []).map((row) => ({
      userId: row.gs_user_id,
      slot: row.slot,
      revision: row.revision,
      saveVersion: row.save_version,
      savedAt: row.saved_at,
      sizeBytes: row.byte_size,
    }));
  }

  async getSave(userId, slot) {
    if (!SAVE_SLOTS.includes(slot)) return null;
    const { data: meta, error } = await this.client
      .from('gs_save_slots')
      .select('slot, revision, save_version, saved_at, storage_path, byte_size')
      .eq('gs_user_id', String(userId))
      .eq('slot', slot)
      .maybeSingle();
    if (error) throw new Error(`Supabase getSave meta: ${error.message}`);
    if (!meta) return null;

    const { data: blob, error: downloadError } = await this.client.storage
      .from(GS_SAVE_BUCKET)
      .download(meta.storage_path);
    if (downloadError) throw new Error(`Supabase getSave download: ${downloadError.message}`);

    const compressed = Buffer.from(await blob.arrayBuffer());
    const envelope = gunzipSync(compressed).toString('utf8');
    return {
      slot: meta.slot,
      revision: meta.revision,
      saveVersion: meta.save_version,
      savedAt: meta.saved_at,
      envelope,
    };
  }

  async putSave(userId, slot, envelope, expectedRevision = null) {
    if (!SAVE_SLOTS.includes(slot)) throw new Error('Invalid save slot');
    const raw = typeof envelope === 'string' ? envelope : JSON.stringify(envelope);
    if (Buffer.byteLength(raw) > MAX_SAVE_BYTES) throw new Error('Save exceeds 8 MiB');
    const parsed = deserialize(raw);
    if (!parsed.ok) throw new Error(parsed.error || 'Invalid save');

    const current = await this.getSaveMeta(userId, slot);
    if (current && expectedRevision !== current.revision) {
      throw revisionConflict(current.revision);
    }
    if (!current && expectedRevision !== 0 && expectedRevision !== null) {
      throw revisionConflict(0);
    }

    const revision = (current?.revision ?? 0) + 1;
    let envelopeMeta;
    try {
      envelopeMeta = JSON.parse(raw);
    } catch {
      throw new Error('Invalid save');
    }
    const savedAt = Number(envelopeMeta.savedAt) || Date.now();
    const saveVersion = Number(envelopeMeta.saveVersion) || 0;
    const path = storagePath(userId, slot);
    const compressed = gzipSync(Buffer.from(raw, 'utf8'));

    const { error: uploadError } = await this.client.storage
      .from(GS_SAVE_BUCKET)
      .upload(path, compressed, {
        contentType: 'application/gzip',
        upsert: true,
      });
    if (uploadError) throw new Error(`Supabase putSave upload: ${uploadError.message}`);

    const { error: upsertError } = await this.client.from('gs_save_slots').upsert({
      gs_user_id: String(userId),
      slot,
      revision,
      save_version: saveVersion,
      saved_at: savedAt,
      byte_size: Buffer.byteLength(raw),
      storage_path: path,
    }, { onConflict: 'gs_user_id,slot' });
    if (upsertError) throw new Error(`Supabase putSave meta: ${upsertError.message}`);

    return {
      slot,
      revision,
      saveVersion,
      savedAt,
      envelope: raw,
    };
  }

  async deleteSave(userId, slot) {
    if (!SAVE_SLOTS.includes(slot)) throw new Error('Invalid save slot');
    const meta = await this.getSaveMeta(userId, slot);
    if (!meta) return false;

    const { error: deleteMetaError } = await this.client
      .from('gs_save_slots')
      .delete()
      .eq('gs_user_id', String(userId))
      .eq('slot', slot);
    if (deleteMetaError) throw new Error(`Supabase deleteSave meta: ${deleteMetaError.message}`);

    const { error: removeError } = await this.client.storage
      .from(GS_SAVE_BUCKET)
      .remove([meta.storage_path]);
    if (removeError) {
      // Meta already gone; log-style soft failure for orphaned blob.
      console.warn(`[supabase-saves] storage remove failed for ${meta.storage_path}: ${removeError.message}`);
    }
    return true;
  }

  async getSaveMeta(userId, slot) {
    if (!SAVE_SLOTS.includes(slot)) return null;
    const { data, error } = await this.client
      .from('gs_save_slots')
      .select('slot, revision, save_version, saved_at, storage_path, byte_size')
      .eq('gs_user_id', String(userId))
      .eq('slot', slot)
      .maybeSingle();
    if (error) throw new Error(`Supabase getSaveMeta: ${error.message}`);
    if (!data) return null;
    return {
      slot: data.slot,
      revision: data.revision,
      saveVersion: data.save_version,
      savedAt: data.saved_at,
      storage_path: data.storage_path,
      sizeBytes: data.byte_size,
    };
  }
}

export function createSupabaseSaveStoreFromEnv(env = process.env) {
  const url = String(env.SUPABASE_URL || '').trim();
  const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !serviceRoleKey) return null;
  return new SupabaseSaveStore({ url, serviceRoleKey });
}
