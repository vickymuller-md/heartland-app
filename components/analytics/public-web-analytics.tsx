'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { track } from '@vercel/analytics';
import { Analytics, type BeforeSendEvent } from '@vercel/analytics/next';
import { getPublicDisseminationContext } from '@/lib/product-analytics/public-context';

const INTERNAL_TRAFFIC_KEY = 'heartland_internal_analytics_v1';
const CAMPAIGN_EVENT_KEY = 'heartland_campaign_event_v1';
const PUBLIC_PATHS = new Set([
  '/',
  '/about',
  '/downtime',
  '/gdmt-pathway',
  '/guide',
  '/pocket-cards',
  '/remote-monitoring',
  '/request-access',
  '/risk-calculator',
  '/sandbox',
  '/tier-selector',
  '/titration-checklist',
]);

function isInternalTraffic(): boolean {
  try {
    const marker = new URLSearchParams(window.location.search).get('hl_internal');
    if (marker === '1') localStorage.setItem(INTERNAL_TRAFFIC_KEY, '1');
    if (marker === '0') localStorage.removeItem(INTERNAL_TRAFFIC_KEY);
    return marker === '1' || localStorage.getItem(INTERNAL_TRAFFIC_KEY) === '1';
  } catch {
    return true;
  }
}

function filterPublicEvent(event: BeforeSendEvent): BeforeSendEvent | null {
  if (isInternalTraffic()) return null;
  try {
    const url = new URL(event.url, window.location.origin);
    if (!PUBLIC_PATHS.has(url.pathname)) return null;
    url.search = '';
    url.hash = '';
    return { ...event, url: url.toString() };
  } catch {
    return null;
  }
}

export function PublicWebAnalytics() {
  const pathname = usePathname();
  const isPublicPath = PUBLIC_PATHS.has(pathname);

  useEffect(() => {
    if (!isPublicPath || isInternalTraffic()) return;
    const context = getPublicDisseminationContext();
    if (!context.campaignSource || !context.campaignName) return;

    const eventKey = `${context.campaignSource}:${context.campaignName}:${pathname}`;
    try {
      if (sessionStorage.getItem(CAMPAIGN_EVENT_KEY) === eventKey) return;
      sessionStorage.setItem(CAMPAIGN_EVENT_KEY, eventKey);
    } catch {
      return;
    }
    track('campaign_visit', {
      source: context.campaignSource,
      campaign: context.campaignName,
    });
  }, [isPublicPath, pathname]);

  if (!isPublicPath) return null;
  return <Analytics beforeSend={filterPublicEvent} />;
}
