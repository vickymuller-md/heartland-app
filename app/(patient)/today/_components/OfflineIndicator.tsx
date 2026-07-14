"use client";

/**
 * OfflineIndicator -- Banner showing offline status and pending sync count.
 *
 * Clinical values are never queued locally. Offline users receive an explicit
 * reconnect message and keep their unsent values only in the visible form.
 *
 * Accessible: role="status" + aria-live="polite" for screen reader announcements.
 * Requirement: VITL-10 (offline status indicator)
 */

import { useIsOnline } from "@/lib/offline/hooks";

export function OfflineIndicator() {
  const isOnline = useIsOnline();

  if (isOnline) return null;

  return (
    <div role="status" aria-live="polite" className="space-y-2">
      <div className="bg-red-50 text-red-800 border border-red-200 px-4 py-3 rounded-lg text-base">
        You are offline. Reconnect before submitting; clinical data is not saved on this device.
      </div>
    </div>
  );
}
