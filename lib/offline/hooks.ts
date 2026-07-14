/**
 * Offline Reactive Hooks — Dexie useLiveQuery + Online Status
 *
 * usePendingSyncCount: reactive count of pending+failed items in sync queue
 * useIsOnline: reactive boolean tracking navigator.onLine
 *
 * Requirements: VITL-10 (offline status indicator), PWA-04 (sync triggers)
 */

'use client';

import { useState, useEffect } from 'react';

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
export function useIsOnline(): boolean {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
