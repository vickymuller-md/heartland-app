'use client';

import { sendGAEvent } from '@next/third-parties/google';
import type { GAEventName, GAEventParams } from '@/lib/analytics';

/**
 * Typed wrapper around sendGAEvent.
 *
 * This is the ONLY place sendGAEvent is called directly.
 * All other code uses trackEvent() for consistent event dispatch.
 */
export function trackEvent(
  eventName: GAEventName,
  params?: GAEventParams,
): void {
  sendGAEvent('event', eventName, params ?? {});
}
