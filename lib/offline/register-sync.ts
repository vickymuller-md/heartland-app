/** Legacy compatibility shim: purge old clinical queues and install no sync
 * listeners or Background Sync jobs. */

import { clearOfflineData } from './db';

/**
 * Register sync triggers for the offline queue.
 * Returns a cleanup function for React useEffect.
 */
export function registerSyncListeners(): () => void {
  void clearOfflineData();
  return () => {};
}
