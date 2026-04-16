/**
 * Dexie IndexedDB Database — Offline Sync Queue
 *
 * All patient vitals/symptoms writes go to IndexedDB first (instant feedback),
 * then flush to Supabase when connectivity returns.
 *
 * Requirements: PWA-03 (offline queue + sync)
 * Source: HEARTLAND Protocol v3.3, Module 5
 */

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

export { db };
