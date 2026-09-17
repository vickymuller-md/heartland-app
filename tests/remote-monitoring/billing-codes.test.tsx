import { describe, it, expect } from 'vitest';
import {
  RED_FLAG_ALERTS,
  BILLING_CODES,
  TIM_HF2_EVIDENCE,
  CMS_2026_PFS_URL,
} from '@/lib/remote-monitoring/constants';

// ==========================================================================
// RMON-03: Red Flag Alert Criteria — Data Integrity
// Protocol v3.3 Module 5, Section 5.2
// ==========================================================================
describe('RMON-03: Red Flag Alert Criteria', () => {
  it('RED_FLAG_ALERTS has exactly 6 entries', () => {
    expect(RED_FLAG_ALERTS).toHaveLength(6);
  });

  it('contains weight gain >= 3 lbs in 2 days alert (same-day)', () => {
    const alert = RED_FLAG_ALERTS.find((a) => a.finding.includes('3 lbs'));
    expect(alert).toBeDefined();
    expect(alert!.action).toContain('Call clinic same day');
    expect(alert!.severity).toBe('same-day');
  });

  it('contains weight gain >= 5 lbs in 1 week alert (urgent)', () => {
    const alert = RED_FLAG_ALERTS.find((a) => a.finding.includes('5 lbs'));
    expect(alert).toBeDefined();
    expect(alert!.action).toContain('Urgent evaluation within 24h');
    expect(alert!.severity).toBe('urgent');
  });

  it('contains SBP < 90 mmHg with symptoms alert (urgent)', () => {
    const alert = RED_FLAG_ALERTS.find((a) => a.finding.includes('SBP'));
    expect(alert).toBeDefined();
    expect(alert!.action).toContain('Hold GDMT');
    expect(alert!.severity).toBe('urgent');
  });

  it('contains SpO2 < 92% at rest alert (urgent)', () => {
    const alert = RED_FLAG_ALERTS.find((a) => a.finding.includes('SpO2'));
    expect(alert).toBeDefined();
    expect(alert!.severity).toBe('urgent');
  });

  it('contains new/worsening dyspnea at rest alert (same-day)', () => {
    const alert = RED_FLAG_ALERTS.find((a) => a.finding.includes('dyspnea'));
    expect(alert).toBeDefined();
    expect(alert!.severity).toBe('same-day');
  });

  it('contains chest pain/syncope alert as EMERGENCY', () => {
    const alert = RED_FLAG_ALERTS.find((a) => a.finding.includes('Chest pain'));
    expect(alert).toBeDefined();
    expect(alert!.severity).toBe('emergency');
    expect(alert!.action).toContain('Call 911');
  });

  it('every alert has an id, finding, action, and severity', () => {
    RED_FLAG_ALERTS.forEach((alert) => {
      expect(alert.id).toBeTruthy();
      expect(alert.finding).toBeTruthy();
      expect(alert.action).toBeTruthy();
      expect(['emergency', 'urgent', 'same-day']).toContain(alert.severity);
    });
  });
});

// ==========================================================================
// RMON-04: RPM Billing Codes — Data Integrity
// Protocol v3.3 Module 5, Section 5.3
// ==========================================================================
describe('RMON-04: RPM Billing Codes', () => {
  it('BILLING_CODES has the core RPM and RTM references', () => {
    expect(BILLING_CODES.length).toBeGreaterThanOrEqual(5);
  });

  it('includes CPT 99453 without a reimbursement claim', () => {
    const code = BILLING_CODES.find((c) => c.code === '99453');
    expect(code).toBeDefined();
    expect(code!.description).toContain('initial setup');
    expect(code!.verification).toContain('payer requirements');
  });

  it('requires device and transmission verification for CPT 99454', () => {
    const code = BILLING_CODES.find((c) => c.code === '99454');
    expect(code).toBeDefined();
    expect(code!.verification).toContain('connected-device');
  });

  it('requires communication and time verification for CPT 99457', () => {
    const code = BILLING_CODES.find((c) => c.code === '99457');
    expect(code).toBeDefined();
    expect(code!.verification).toContain('interactive communication');
  });

  it('requires base-code verification for CPT 99458', () => {
    const code = BILLING_CODES.find((c) => c.code === '99458');
    expect(code).toBeDefined();
    expect(code!.verification).toContain('base-code');
  });

  it('includes the RTM code family 98975-98986 and flags the unpaid codes', () => {
    const code = BILLING_CODES.find((c) => c.code === '98975-98986');
    expect(code).toBeDefined();
    expect(code!.verification).toContain('Do not substitute');
    expect(code!.verification).toContain('98978 and 98986 carry no physician fee schedule payment');
  });

  it('includes the CY2026 codes 99445 and 99470 as non-additive alternatives', () => {
    const twoToFifteen = BILLING_CODES.find((c) => c.code === '99445');
    expect(twoToFifteen).toBeDefined();
    expect(twoToFifteen!.description).toContain('2-15 days');
    expect(twoToFifteen!.verification).toContain('Not additive with 99454');

    const firstTenMinutes = BILLING_CODES.find((c) => c.code === '99470');
    expect(firstTenMinutes).toBeDefined();
    expect(firstTenMinutes!.description).toContain('first 10 minutes');
    expect(firstTenMinutes!.verification).toContain('Not additive with 99457');
  });

  it('describes 99453 as one-time and 99454 as 16-30 days', () => {
    expect(BILLING_CODES.find((c) => c.code === '99453')!.description).toContain('one-time, not monthly');
    expect(BILLING_CODES.find((c) => c.code === '99454')!.description).toContain('16-30 days');
  });

  it('every billing code has code, description, and a verification warning', () => {
    BILLING_CODES.forEach((code) => {
      expect(code.code).toBeTruthy();
      expect(code.description).toBeTruthy();
      expect(code.verification).toBeTruthy();
    });
  });

  it('links the current CMS CY 2026 fee schedule', () => {
    expect(CMS_2026_PFS_URL).toContain('cms-1832-f');
  });
});

// ==========================================================================
// RMON-05: TIM-HF2 Evidence — Data Integrity
// Protocol v3.3 Module 5, Section 5.1
// ==========================================================================
describe('RMON-05: TIM-HF2 Evidence', () => {
  it('TIM_HF2_EVIDENCE has name "TIM-HF2" and year 2018', () => {
    expect(TIM_HF2_EVIDENCE.name).toBe('TIM-HF2');
    expect(TIM_HF2_EVIDENCE.year).toBe(2018);
  });

  it('has exactly 3 outcomes', () => {
    expect(TIM_HF2_EVIDENCE.outcomes).toHaveLength(3);
  });

  it('outcome 1: all-cause mortality HR 0.70, labelled as the secondary endpoint', () => {
    const outcome = TIM_HF2_EVIDENCE.outcomes[0];
    expect(outcome.outcome).toContain('All-cause mortality');
    expect(outcome.outcome).toContain('secondary endpoint');
    expect(outcome.result).toContain('HR 0.70');
    expect(outcome.result).toContain('30% lower all-cause death');
  });

  it('outcome 2: days lost to hospitalization 4.88% vs 6.64%', () => {
    const outcome = TIM_HF2_EVIDENCE.outcomes[1];
    expect(outcome.result).toContain('4.88%');
    expect(outcome.result).toContain('6.64%');
  });

  it('outcome 3: benefit greatest at longer travel distances (prespecified 2025 analysis)', () => {
    const outcome = TIM_HF2_EVIDENCE.outcomes[2];
    expect(outcome.result).toContain('longer travel distances');
    expect(outcome.result).toContain('2025');
  });
});
