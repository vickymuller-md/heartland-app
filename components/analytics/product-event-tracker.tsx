'use client';

import { useEffect } from 'react';
import { trackProductEvent, type ProductEventInput } from '@/lib/product-analytics/actions';

function getDeviceClass(): 'mobile' | 'tablet' | 'desktop' {
  if (window.innerWidth < 640) return 'mobile';
  if (window.innerWidth < 1024) return 'tablet';
  return 'desktop';
}

export function ProductEventTracker({
  eventName,
  area,
}: Pick<ProductEventInput, 'eventName' | 'area'>) {
  useEffect(() => {
    void trackProductEvent({ eventName, area, deviceClass: getDeviceClass() });
  }, [area, eventName]);

  return null;
}
