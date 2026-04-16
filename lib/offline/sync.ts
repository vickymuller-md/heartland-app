/**
 * Sync Engine — Flush offline queue to Supabase
 *
 * Reads pending/failed items from Dexie, upserts to Supabase with onConflict
 * client_id for idempotency, marks synced/failed. Auto-cleans synced items
 * older than 24h to prevent IndexedDB bloat (critical for iOS 50MB cap).
 *
 * Requirements: PWA-03 (offline queue + sync)
 */

import { db } from './db';
import { createClient } from '@/lib/supabase/client';

/** Prevent concurrent flushes (visibilitychange can fire rapidly) */
let flushing = false;

/**
 * Flush the offline queue to Supabase.
 * Reads pending+failed items (attempts < 5), upserts each with onConflict
 * client_id, marks synced on success or failed+attempts++ on error.
 */
export async function flushQueue(): Promise<{ synced: number; failed: number }> {
  if (flushing) return { synced: 0, failed: 0 };
  flushing = true;

  try {
    const pending = await db.sync_queue
      .where('status')
      .anyOf(['pending', 'failed'])
      .and((item) => item.attempts < 5)
      .toArray();

    let synced = 0;
    let failed = 0;

    for (const item of pending) {
      await db.sync_queue.update(item.id, { status: 'syncing' });

      try {
        const supabase = createClient();
        const { error } = await supabase
          .from(item.table)
          .upsert(item.payload, { onConflict: 'client_id' });

        if (error) throw error;

        await db.sync_queue.update(item.id, {
          status: 'synced',
          synced_at: Date.now(),
        });
        synced++;
      } catch {
        await db.sync_queue.update(item.id, {
          status: 'failed',
          attempts: item.attempts + 1,
        });
        failed++;
      }
    }

    // Auto-clean synced items older than 24h to prevent IndexedDB bloat
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    await db.sync_queue
      .where('status')
      .equals('synced')
      .and((item) => (item.synced_at ?? 0) < oneDayAgo)
      .delete();

    return { synced, failed };
  } finally {
    flushing = false;
  }
}
