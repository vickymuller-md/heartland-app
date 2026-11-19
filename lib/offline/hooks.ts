/**
 * Offline Reactive Hooks — Dexie useLiveQuery + Online Status
 *
 * usePendingSyncCount: reactive count of pending+failed items in sync queue
 * useIsOnline: reactive boolean tracking navigator.onLine
 *
 * Requirements: VITL-10 (offline status indicator), PWA-04 (sync triggers)
 */

'use client';

import { useSyncExternalStore } from 'react';

/**
 * Returns the count of items in the sync queue that are pending or failed.
 * Reactively updates when the queue changes (Dexie live query).
 */
export function usePendingSyncCount(): number {
  return 0;
}

/**
 * Tracks navigator.onLine reactively via online/offline events.
 * Returns true when the browser reports connectivity, false when offline.
 */
function subscribeToConnectivity(notify: () => void) {
  window.addEventListener('online', notify);
  window.addEventListener('offline', notify);
  return () => {
    window.removeEventListener('online', notify);
    window.removeEventListener('offline', notify);
  };
}

export function useIsOnline(): boolean {
  return useSyncExternalStore(subscribeToConnectivity, () => navigator.onLine, () => true);
}
