import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { GA_EVENTS } from '@/lib/analytics';
import type { GAEventName, GAEventParams } from '@/lib/analytics';

describe('GA4 Event Constants (ANLYT-01)', () => {
  it('GA_EVENTS has exactly 7 event keys', () => {
    expect(Object.keys(GA_EVENTS)).toHaveLength(7);
  });

  it('GA_EVENTS.LANDING_CTA_CLICKED equals "landing_cta_clicked"', () => {
    expect(GA_EVENTS.LANDING_CTA_CLICKED).toBe('landing_cta_clicked');
  });

  it('GA_EVENTS.ACCESS_REQUEST_SUBMITTED equals "access_request_submitted"', () => {
    expect(GA_EVENTS.ACCESS_REQUEST_SUBMITTED).toBe('access_request_submitted');
  });

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

describe('GA4 Layout Integration (ANLYT-01)', () => {
  const layoutPath = path.resolve(__dirname, '../../app/layout.tsx');
  const layoutContent = fs.readFileSync(layoutPath, 'utf-8');

  it('root layout does not load Google Analytics on authenticated surfaces', () => {
    expect(layoutContent).not.toContain('GoogleAnalytics');
  });

  it('root layout contains no analytics environment hook or Google import', () => {
    expect(layoutContent).not.toContain('NEXT_PUBLIC_GA_MEASUREMENT_ID');
    expect(layoutContent).not.toContain('@next/third-parties/google');
  });
});

describe('GA4 Type Exports (ANLYT-01)', () => {
  it('GAEventName type accepts valid event names', () => {
    const validEvent: GAEventName = 'risk_calculator_completed';
    expect(validEvent).toBe('risk_calculator_completed');
  });

  it('GAEventParams type accepts string and number values', () => {
    const params: GAEventParams = {
      risk_tier: 'High',
      risk_score: 12,
    };
    expect(params.risk_tier).toBe('High');
    expect(params.risk_score).toBe(12);
  });
});
