const SESSION_KEY = 'heartland_public_sandbox_session_v1';
const CAMPAIGN_KEY = 'heartland_public_campaign_v1';
const CAMPAIGN_VALUE = /^[A-Za-z0-9._~-]{1,80}$/;
const UUID_VALUE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface PublicDisseminationContext {
  anonymousSessionId?: string;
  campaignSource?: string;
  campaignMedium?: string;
  campaignName?: string;
}

function cleanCampaignValue(value: string | null): string | undefined {
  return value && CAMPAIGN_VALUE.test(value) ? value : undefined;
}

function parseStoredCampaign(value: string): Omit<PublicDisseminationContext, 'anonymousSessionId'> {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const record = parsed as Record<string, unknown>;
  return {
    campaignSource: cleanCampaignValue(typeof record.campaignSource === 'string' ? record.campaignSource : null),
    campaignMedium: cleanCampaignValue(typeof record.campaignMedium === 'string' ? record.campaignMedium : null),
    campaignName: cleanCampaignValue(typeof record.campaignName === 'string' ? record.campaignName : null),
  };
}

export function getPublicDisseminationContext(): PublicDisseminationContext {
  if (typeof window === 'undefined') return {};

  let anonymousSessionId: string | undefined;
  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    anonymousSessionId = stored && UUID_VALUE.test(stored) ? stored : crypto.randomUUID();
    sessionStorage.setItem(SESSION_KEY, anonymousSessionId);
  } catch {
    // Telemetry remains optional when hardened browsers block storage.
  }

  let campaign: Omit<PublicDisseminationContext, 'anonymousSessionId'> = {};
  try {
    const params = new URLSearchParams(window.location.search);
    const incoming = {
      campaignSource: cleanCampaignValue(params.get('utm_source')),
      campaignMedium: cleanCampaignValue(params.get('utm_medium')),
      campaignName: cleanCampaignValue(params.get('utm_campaign')),
    };
    if (incoming.campaignSource || incoming.campaignMedium || incoming.campaignName) {
      campaign = incoming;
      sessionStorage.setItem(CAMPAIGN_KEY, JSON.stringify(incoming));
    } else {
      const stored = sessionStorage.getItem(CAMPAIGN_KEY);
      campaign = stored ? parseStoredCampaign(stored) : {};
    }
  } catch {
    campaign = {};
  }

  return { anonymousSessionId, ...campaign };
}
