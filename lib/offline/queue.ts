/**
 * Offline Queue — CRUD Functions for Dexie sync_queue
 *
 * Enqueue vitals/symptoms for later sync. Each record gets a client-generated
 * UUID that becomes the onConflict key in Supabase, making retries idempotent.
 *
 * Requirements: VITL-09 (offline vitals), PWA-03 (offline queue)
 */

import { db } from './db';

/**
 * Enqueue a vitals record for offline sync.
 * Generates a UUID client_id, stores in IndexedDB, returns the client_id.
 */
export async function enqueueVitals(
  vitals: Record<string, unknown>,
): Promise<string> {
  const id = crypto.randomUUID();
  await db.sync_queue.add({
    id,
    table: 'vitals',
    payload: { ...vitals, client_id: id },
    status: 'pending',
    attempts: 0,
    created_at: Date.now(),
  });
  return id;
}

/**
 * Enqueue a symptoms record for offline sync.
 * Same pattern as enqueueVitals but targets the symptoms table.
 */
export async function enqueueSymptoms(
  symptoms: Record<string, unknown>,
): Promise<string> {
  const id = crypto.randomUUID();
  await db.sync_queue.add({
    id,
    table: 'symptoms',
    payload: { ...symptoms, client_id: id },
    status: 'pending',
    attempts: 0,
    created_at: Date.now(),
  });
  return id;
}

/**
 * Get all items eligible for sync: status pending or failed, with < 5 attempts.
 * Items with attempts >= 5 are dead-lettered and excluded.
 */
export async function getPendingItems() {
  return db.sync_queue
    .where('status')
    .anyOf(['pending', 'failed'])
    .and((item) => item.attempts < 5)
    .toArray();
}

/**
 * Delete all synced items from the queue.
 * Returns the number of items deleted.
 */
export async function clearSynced(): Promise<number> {
  return db.sync_queue.where('status').equals('synced').delete();
}
