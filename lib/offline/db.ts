/** Legacy IndexedDB schema retained only so previous plaintext clinical data
 * can be found and deleted after the secure offline-storage shutdown. */

import Dexie, { type EntityTable } from 'dexie';

/** A record in the offline sync queue */
export interface SyncQueueItem {
  /** Client-generated UUID — used as Supabase onConflict key for idempotent upserts */
  id: string;
  /** Target Supabase table */
  table: 'vitals' | 'symptoms';
  /** Row payload including client_id */
  payload: Record<string, unknown>;
  /** Queue status lifecycle: pending -> syncing -> synced|failed */
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  /** Number of sync attempts (dead letter at >= 5) */
  attempts: number;
  /** Epoch ms when enqueued */
  created_at: number;
  /** Epoch ms when successfully synced */
  synced_at?: number;
}

const db = new Dexie('heartland') as Dexie & {
  sync_queue: EntityTable<SyncQueueItem, 'id'>;
};

db.version(1).stores({
  sync_queue: 'id, table, status, created_at',
});

/** Delete any clinical records left by versions that supported offline writes. */
export async function clearOfflineData(): Promise<void> {
  try {
    await db.sync_queue.clear();
  } catch {
    // Cleanup must remain best-effort on browsers where IndexedDB is blocked.
  }
}

/** Clear app-owned browser state during logout or session transitions. */
export async function clearClientSecurityState(): Promise<void> {
  await clearOfflineData();

  if (typeof window !== 'undefined') {
    for (const storage of [window.localStorage, window.sessionStorage]) {
      try {
        const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
        for (const key of keys) {
          if (key?.startsWith('heartland')) storage.removeItem(key);
        }
      } catch {
        // Storage may be unavailable in private or restricted browser contexts.
      }
    }
  }

  if (typeof caches !== 'undefined') {
    try {
      const cacheNames = await caches.keys();
      await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
    } catch {
      // Logout must still complete if CacheStorage is unavailable.
    }
  }
}

export { db };
