"use client";

/**
 * OfflineIndicator -- Banner showing offline status and pending sync count.
 *
 * Three states:
 * 1. Online + zero pending: render nothing
 * 2. Offline: red banner "You are offline."
 * 3. Pending records: yellow banner "X record(s) waiting to sync."
 *    If also online: adds "Syncing now..."
 *
 * Accessible: role="status" + aria-live="polite" for screen reader announcements.
 * Requirement: VITL-10 (offline status indicator)
 */

import { usePendingSyncCount, useIsOnline } from "@/lib/offline/hooks";

export function OfflineIndicator() {
  const pendingCount = usePendingSyncCount();
  const isOnline = useIsOnline();

  // Nothing to show when online and fully synced
  if (isOnline && pendingCount === 0) {
    return null;
  }

  return (
    <div role="status" aria-live="polite" className="space-y-2">
      {/* Offline banner */}
      {!isOnline && (
        <div className="bg-red-50 text-red-800 border border-red-200 px-4 py-3 rounded-lg text-base">
          You are offline.
        </div>
      )}

      {/* Pending sync count */}
      {pendingCount > 0 && (
        <div className="bg-yellow-50 text-yellow-800 border border-yellow-200 px-4 py-3 rounded-lg text-base">
          {pendingCount} record{pendingCount !== 1 ? "s" : ""} waiting to sync.
          {isOnline && (
            <span className="ml-1 font-medium">Syncing now...</span>
          )}
        </div>
      )}
    </div>
  );
}
