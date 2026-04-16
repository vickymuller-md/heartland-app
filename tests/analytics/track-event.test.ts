import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @next/third-parties/google -- use vi.hoisted to avoid hoisting issues
const { mockSendGAEvent } = vi.hoisted(() => ({
  mockSendGAEvent: vi.fn(),
}));
vi.mock('@next/third-parties/google', () => ({
  sendGAEvent: mockSendGAEvent,
}));

import { trackEvent } from '@/components/analytics/track-event';
import { GA_EVENTS } from '@/lib/analytics';

describe('trackEvent Helper (ANLYT-02)', () => {
  beforeEach(() => {
    mockSendGAEvent.mockClear();
  });

  it('trackEvent calls sendGAEvent with correct event name and params', () => {
    trackEvent('risk_calculator_completed', { risk_tier: 'High', risk_score: 12 });

    expect(mockSendGAEvent).toHaveBeenCalledOnce();
    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'risk_calculator_completed', {
      risk_tier: 'High',
      risk_score: 12,
    });
  });

  it('trackEvent passes empty params when none provided', () => {
    trackEvent('gdmt_pathway_used');

    expect(mockSendGAEvent).toHaveBeenCalledOnce();
    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'gdmt_pathway_used', {});
  });

  it('dispatches tier_selector_completed event correctly', () => {
    trackEvent('tier_selector_completed', { tier_result: 'Tier 2' });

    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'tier_selector_completed', {
      tier_result: 'Tier 2',
    });
  });

  it('dispatches patient_vitals_logged event correctly', () => {
    trackEvent('patient_vitals_logged', { vital_type: 'weight' });

    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'patient_vitals_logged', {
      vital_type: 'weight',
    });
  });

  it('dispatches alert_triggered event correctly', () => {
    trackEvent('alert_triggered', { alert_type: 'weight_gain', severity: 'high' });

    expect(mockSendGAEvent).toHaveBeenCalledWith('event', 'alert_triggered', {
      alert_type: 'weight_gain',
      severity: 'high',
    });
  });
});

describe('GA_EVENTS values match expected strings (ANLYT-02)', () => {
  it('GA_EVENTS.RISK_CALCULATOR_COMPLETED equals "risk_calculator_completed"', () => {
    expect(GA_EVENTS.RISK_CALCULATOR_COMPLETED).toBe('risk_calculator_completed');
  });

  it('GA_EVENTS.GDMT_PATHWAY_USED equals "gdmt_pathway_used"', () => {
    expect(GA_EVENTS.GDMT_PATHWAY_USED).toBe('gdmt_pathway_used');
  });

  it('GA_EVENTS.TIER_SELECTOR_COMPLETED equals "tier_selector_completed"', () => {
    expect(GA_EVENTS.TIER_SELECTOR_COMPLETED).toBe('tier_selector_completed');
  });

  it('GA_EVENTS.PATIENT_VITALS_LOGGED equals "patient_vitals_logged"', () => {
    expect(GA_EVENTS.PATIENT_VITALS_LOGGED).toBe('patient_vitals_logged');
  });

  it('GA_EVENTS.ALERT_TRIGGERED equals "alert_triggered"', () => {
    expect(GA_EVENTS.ALERT_TRIGGERED).toBe('alert_triggered');
  });
});
