import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPublicDisseminationContext } from '@/lib/product-analytics/public-context';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';

describe('public dissemination context', () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.history.replaceState({}, '', '/sandbox');
    Object.defineProperty(window, 'crypto', {
      configurable: true,
      value: { randomUUID: vi.fn(() => SESSION_ID) },
    });
  });

  it('keeps one anonymous identifier for the browser-tab session', () => {
    const first = getPublicDisseminationContext();
    const second = getPublicDisseminationContext();

    expect(first.anonymousSessionId).toBe(SESSION_ID);
    expect(second.anonymousSessionId).toBe(SESSION_ID);
    expect(window.crypto.randomUUID).toHaveBeenCalledTimes(1);
  });

  it('captures constrained UTM labels and carries them into the sandbox', () => {
    window.history.replaceState(
      {},
      '',
      '/risk-calculator?utm_source=rhihub&utm_medium=referral&utm_campaign=summer_2026',
    );
    expect(getPublicDisseminationContext()).toMatchObject({
      campaignSource: 'rhihub',
      campaignMedium: 'referral',
      campaignName: 'summer_2026',
    });

    window.history.replaceState({}, '', '/sandbox');
    expect(getPublicDisseminationContext()).toMatchObject({
      campaignSource: 'rhihub',
      campaignMedium: 'referral',
      campaignName: 'summer_2026',
    });
  });

  it('rejects campaign values that could contain identifiers or free text', () => {
    window.history.replaceState(
      {},
      '',
      '/sandbox?utm_source=person%40example.com&utm_campaign=free%20text',
    );
    const context = getPublicDisseminationContext();

    expect(context.campaignSource).toBeUndefined();
    expect(context.campaignName).toBeUndefined();
  });
});
