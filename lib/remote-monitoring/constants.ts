/**
 * Remote Monitoring — Clinical Constants
 *
 * ALL data sourced from reference/clinical_content.md Module 5.
 * Every value character-for-character from protocol v3.3.
 */

import type {
  RedFlagAlert,
  BillingCode,
  TimHf2Evidence,
} from './types';

// ==========================================================================
// Red Flag Alert Criteria — Section 5.2
// Source: reference/clinical_content.md, Module 5, Section 5.2
// ==========================================================================
export const RED_FLAG_ALERTS: RedFlagAlert[] = [
  {
    id: 'weight-gain-3lb',
    // Source: "Weight gain >= 3 lbs in 2 days | Call clinic same day"
    finding: 'Weight gain \u22653 lbs in 2 days',
    action: 'Call clinic same day',
    severity: 'same-day',
  },
  {
    id: 'weight-gain-5lb',
    // Source: "Weight gain >= 5 lbs in 1 week | Urgent evaluation within 24h"
    finding: 'Weight gain \u22655 lbs in 1 week',
    action: 'Urgent evaluation within 24h',
    severity: 'urgent',
  },
  {
    id: 'sbp-low',
    // Source: "SBP <90 mmHg with symptoms | Hold GDMT; call provider"
    finding: 'SBP <90 mmHg with symptoms',
    action: 'Hold GDMT; call provider',
    severity: 'urgent',
  },
  {
    id: 'spo2-low',
    // Source: "SpO2 <92% at rest (if baseline normal) | Urgent evaluation"
    finding: 'SpO2 <92% at rest (if baseline normal)',
    action: 'Urgent evaluation',
    severity: 'urgent',
  },
  {
    id: 'dyspnea',
    // Source: "New/worsening dyspnea at rest | Same-day evaluation"
    finding: 'New/worsening dyspnea at rest',
    action: 'Same-day evaluation',
    severity: 'same-day',
  },
  {
    id: 'chest-pain-syncope',
    // Source: "Chest pain, syncope | EMERGENCY -- Call 911"
    finding: 'Chest pain, syncope',
    action: 'EMERGENCY \u2014 Call 911',
    severity: 'emergency',
  },
];

// ==========================================================================
// Billing Codes (2025) — Section 5.3
// Source: reference/clinical_content.md, Module 5, Section 5.3
// ==========================================================================
export const BILLING_CODES: BillingCode[] = [
  {
    // Source: "99453 | RPM initial setup | $19-21"
    code: '99453',
    description: 'RPM initial setup',
    reimbursement: '$19-21',
  },
  {
    // Source: "99454 | RPM monthly device (>=16 days data) | $48-55"
    code: '99454',
    description: 'RPM monthly device (\u226516 days data)',
    reimbursement: '$48-55',
  },
  {
    // Source: "99457 | RPM first 20 min management | $48-52"
    code: '99457',
    description: 'RPM first 20 min management',
    reimbursement: '$48-52',
  },
  {
    // Source: "99458 | RPM additional 20 min | $38-42"
    code: '99458',
    description: 'RPM additional 20 min',
    reimbursement: '$38-42',
  },
  {
    // Source: "98975-98981 | RTM codes (similar structure) | Similar range"
    code: '98975-98981',
    description: 'RTM codes (similar structure)',
    reimbursement: 'Similar range',
  },
  {
    // Source: "G0511 | RHC/FQHC Comprehensive Care Management | Consolidated"
    code: 'G0511',
    description: 'RHC/FQHC Comprehensive Care Management',
    reimbursement: 'Consolidated',
  },
];

// Source: "Revenue Potential: $150-200/month per high-risk patient with full capture."
export const REVENUE_POTENTIAL =
  '$150-200/month per high-risk patient with full capture';

// ==========================================================================
// TIM-HF2 Evidence — Section 5.1
// Source: reference/clinical_content.md, Module 5, Section 5.1
// ==========================================================================
export const TIM_HF2_EVIDENCE: TimHf2Evidence = {
  name: 'TIM-HF2',
  year: 2018,
  outcomes: [
    {
      // Source: "All-cause mortality | HR 0.70 (95% CI 0.50-0.96) -- 30% reduction"
      outcome: 'All-cause mortality',
      result: 'HR 0.70 (95% CI 0.50-0.96) \u2014 30% reduction',
    },
    {
      // Source: "Days lost to hospitalization | 4.88% vs 6.64%"
      outcome: 'Days lost to hospitalization',
      result: '4.88% vs 6.64%',
    },
    {
      // Source: "Key finding | Patients living farther from cardiologists benefit most"
      outcome: 'Key finding',
      result: 'Patients living farther from cardiologists benefit most',
    },
  ],
};
