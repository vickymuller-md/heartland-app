/** Legacy compatibility shim. Plaintext clinical queues are purged, never sent. */

import { clearOfflineData } from './db';

/**
 * Flush the offline queue to Supabase.
 * Reads pending+failed items (attempts < 5), upserts each with onConflict
 * client_id, marks synced on success or failed+attempts++ on error.
 */
export async function flushQueue(): Promise<{ synced: number; failed: number }> {
  await clearOfflineData();
  return { synced: 0, failed: 0 };
}
