/**
 * Dual Sync Trigger Registration
 *
 * PRIMARY: online + visibilitychange event listeners (works on ALL browsers
 * including iOS Safari — the main target for rural patients).
 *
 * ENHANCEMENT: Chrome Background Sync registration (gracefully degrades
 * when SyncManager is unavailable on iOS/Firefox).
 *
 * Requirements: PWA-04 (sync on online/foreground)
 */

import { flushQueue } from './sync';

/**
 * Register sync triggers for the offline queue.
 * Returns a cleanup function for React useEffect.
 */
export function registerSyncListeners(): () => void {
  // PRIMARY: Works on ALL browsers including iOS Safari
  const handleOnline = () => {
    flushQueue();
  };

  const handleVisibility = () => {
    if (document.visibilityState === 'visible' && navigator.onLine) {
      flushQueue();
    }
  };

  window.addEventListener('online', handleOnline);
  document.addEventListener('visibilitychange', handleVisibility);

  // ENHANCEMENT: Chrome/Chromium only — Background Sync
  if ('serviceWorker' in navigator && 'SyncManager' in window) {
    navigator.serviceWorker.ready
      .then((registration) => {
        (registration as unknown as { sync: { register: (tag: string) => Promise<void> } })
          .sync.register('flush-vitals')
          .catch(() => {
            // SyncManager not available; primary listeners handle it
          });
      })
      .catch(() => {
        // Service worker not ready; primary listeners handle it
      });
  }

  // Return cleanup function for React useEffect
  return () => {
    window.removeEventListener('online', handleOnline);
    document.removeEventListener('visibilitychange', handleVisibility);
  };
}
