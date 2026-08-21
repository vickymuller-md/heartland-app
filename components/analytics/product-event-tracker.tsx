'use client';

import { useEffect } from 'react';
import { trackProductEvent, type ProductEventInput } from '@/lib/product-analytics/actions';
import { getPublicDisseminationContext } from '@/lib/product-analytics/public-context';

function getDeviceClass(): 'mobile' | 'tablet' | 'desktop' {
  if (window.innerWidth < 640) return 'mobile';
  if (window.innerWidth < 1024) return 'tablet';
  return 'desktop';
}

export function ProductEventTracker({
  eventName,
  area,
  trackDuration = false,
}: Pick<ProductEventInput, 'eventName' | 'area'> & { trackDuration?: boolean }) {
  useEffect(() => {
    const eventId = crypto.randomUUID();
    const publicContext = area === 'sandbox' ? getPublicDisseminationContext() : {};
    void trackProductEvent({ eventId, eventName, area, deviceClass: getDeviceClass(), ...publicContext });
    if (!trackDuration) return;

    const startedAt = Date.now();
    let recorded = false;
    const recordDuration = () => {
      if (recorded) return;
      recorded = true;
      void trackProductEvent({
        eventName,
        area,
        eventId,
        deviceClass: getDeviceClass(),
        durationMs: Math.min(Date.now() - startedAt, 3_600_000),
        ...publicContext,
      });
    };
    window.addEventListener('pagehide', recordDuration, { once: true });
    return () => {
      window.removeEventListener('pagehide', recordDuration);
      recordDuration();
    };
  }, [area, eventName, trackDuration]);

  return null;
}
