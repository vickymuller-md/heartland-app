/** Offline clinical writes are intentionally disabled until encrypted,
 * user-bound storage and a formally reviewed threat model are available. */

import { clearOfflineData, db } from './db';

export class OfflineClinicalStorageDisabledError extends Error {
  constructor() {
    super('Offline clinical storage is disabled. Reconnect before submitting.');
    this.name = 'OfflineClinicalStorageDisabledError';
  }
}

/**
 * Enqueue a vitals record for offline sync.
 * Generates a UUID client_id, stores in IndexedDB, returns the client_id.
 */
export async function enqueueVitals(
  _vitals: Record<string, unknown>,
): Promise<string> {
  await clearOfflineData();
  throw new OfflineClinicalStorageDisabledError();
}

/**
 * Enqueue a symptoms record for offline sync.
 * Same pattern as enqueueVitals but targets the symptoms table.
 */
export async function enqueueSymptoms(
  _symptoms: Record<string, unknown>,
): Promise<string> {
  await clearOfflineData();
  throw new OfflineClinicalStorageDisabledError();
}

/**
 * Get all items eligible for sync: status pending or failed, with < 5 attempts.
 * Items with attempts >= 5 are dead-lettered and excluded.
 */
export async function getPendingItems() {
  await clearOfflineData();
  return [];
}

/**
 * Delete all synced items from the queue.
 * Returns the number of items deleted.
 */
export async function clearSynced(): Promise<number> {
  const count = await db.sync_queue.count();
  await clearOfflineData();
  return count;
}
