import { describe, it, expect } from 'vitest';
import {
  RED_FLAG_ALERTS,
  BILLING_CODES,
  TIM_HF2_EVIDENCE,
  REVENUE_POTENTIAL,
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
  it('BILLING_CODES has at least 6 entries', () => {
    expect(BILLING_CODES.length).toBeGreaterThanOrEqual(6);
  });

  it('includes CPT 99453 (RPM initial setup, $19-21)', () => {
    const code = BILLING_CODES.find((c) => c.code === '99453');
    expect(code).toBeDefined();
    expect(code!.description).toContain('initial setup');
    expect(code!.reimbursement).toBe('$19-21');
  });

  it('includes CPT 99454 (RPM monthly device, $48-55)', () => {
    const code = BILLING_CODES.find((c) => c.code === '99454');
    expect(code).toBeDefined();
    expect(code!.reimbursement).toBe('$48-55');
  });

  it('includes CPT 99457 (RPM first 20 min management, $48-52)', () => {
    const code = BILLING_CODES.find((c) => c.code === '99457');
    expect(code).toBeDefined();
    expect(code!.reimbursement).toBe('$48-52');
  });

  it('includes CPT 99458 (RPM additional 20 min, $38-42)', () => {
    const code = BILLING_CODES.find((c) => c.code === '99458');
    expect(code).toBeDefined();
    expect(code!.reimbursement).toBe('$38-42');
  });

  it('includes RTM codes 98975-98981', () => {
    const code = BILLING_CODES.find((c) => c.code === '98975-98981');
    expect(code).toBeDefined();
    expect(code!.reimbursement).toContain('Similar');
  });

  it('includes G0511 (RHC/FQHC)', () => {
    const code = BILLING_CODES.find((c) => c.code === 'G0511');
    expect(code).toBeDefined();
    expect(code!.description).toContain('RHC/FQHC');
  });

  it('every billing code has code, description, and reimbursement', () => {
    BILLING_CODES.forEach((code) => {
      expect(code.code).toBeTruthy();
      expect(code.description).toBeTruthy();
      expect(code.reimbursement).toBeTruthy();
    });
  });

  it('REVENUE_POTENTIAL contains $150-200/month', () => {
    expect(REVENUE_POTENTIAL).toContain('$150-200/month');
    expect(REVENUE_POTENTIAL).toContain('high-risk patient');
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

  it('outcome 1: all-cause mortality HR 0.70 with 30% reduction', () => {
    const outcome = TIM_HF2_EVIDENCE.outcomes[0];
    expect(outcome.outcome).toContain('All-cause mortality');
    expect(outcome.result).toContain('HR 0.70');
    expect(outcome.result).toContain('30%');
  });

  it('outcome 2: days lost to hospitalization 4.88% vs 6.64%', () => {
    const outcome = TIM_HF2_EVIDENCE.outcomes[1];
    expect(outcome.result).toContain('4.88%');
    expect(outcome.result).toContain('6.64%');
  });

  it('outcome 3: patients farther from cardiologists benefit most', () => {
    const outcome = TIM_HF2_EVIDENCE.outcomes[2];
    expect(outcome.result).toContain('farther from cardiologists');
  });
});
