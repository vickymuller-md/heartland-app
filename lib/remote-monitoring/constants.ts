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
// Billing code navigation — verify current CMS descriptors, payer rules, and
// device/data requirements before use. Self-entered app data does not itself
// establish RPM eligibility.
//
// Descriptors follow the CMS CY2026 Physician Fee Schedule, which added the
// 2-15 day and first-10-minute codes and revised 99454 to 16-30 days. No
// payment amount is carried here by design.
// ==========================================================================
export const BILLING_CODES: BillingCode[] = [
  {
    code: '99453',
    description: 'RPM initial setup and patient education (one-time, not monthly)',
    verification: 'Confirm device, setup, episode, consent, and payer requirements.',
  },
  {
    code: '99445',
    description: 'RPM device supply and data transmission, 2-15 days in 30 days (added in CY2026)',
    verification:
      'Confirm current monitoring-day, connected-device, and transmission rules. Not additive with 99454: bill one or the other.',
  },
  {
    code: '99454',
    description: 'RPM device supply and data transmission, 16-30 days in 30 days',
    verification:
      'Confirm current monitoring-day, connected-device, and transmission rules. Not additive with 99445: bill one or the other.',
  },
  {
    code: '99470',
    description: 'RPM treatment management, first 10 minutes (added in CY2026)',
    verification:
      'Confirm interactive communication, time, personnel, supervision, and payer rules. Not additive with 99457: bill one or the other.',
  },
  {
    code: '99457',
    description: 'RPM treatment management, first 20 minutes',
    verification:
      'Confirm interactive communication, time, personnel, supervision, and payer rules. Not additive with 99470: bill one or the other.',
  },
  {
    code: '99458',
    description: 'RPM treatment management, each additional 20 minutes',
    verification: 'Confirm incremental time and all base-code requirements.',
  },
  {
    code: '98975-98986',
    description: 'Remote therapeutic monitoring code family (expanded in CY2026)',
    verification:
      'Do not substitute RTM for RPM; verify modality, data, and payer policy. 98978 and 98986 carry no physician fee schedule payment.',
  },
];

export const CMS_2026_PFS_URL =
  'https://www.cms.gov/medicare/payment/fee-schedules/physician/federal-regulation-notices/cms-1832-f';

// ==========================================================================
// TIM-HF2 Evidence — Section 5.1
// Source: reference/clinical_content.md, Module 5, Section 5.1
// ==========================================================================
export const TIM_HF2_EVIDENCE: TimHf2Evidence = {
  name: 'TIM-HF2',
  year: 2018,
  outcomes: [
    {
      // Koehler 2018: all-cause death was a secondary endpoint; the primary endpoint was days lost.
      outcome: 'All-cause mortality (secondary endpoint)',
      result: 'HR 0.70 (95% CI 0.50-0.96) \u2014 30% lower all-cause death',
    },
    {
      // Source: "Days lost to hospitalization | 4.88% vs 6.64%"
      outcome: 'Days lost to hospitalization',
      result: '4.88% vs 6.64%',
    },
    {
      // Prespecified 2025 analysis (Lancet Reg Health Eur): benefit rose with travel distance to the cardiologist.
      outcome: 'Key finding',
      result: 'Benefit greatest at longer travel distances to the cardiologist (prespecified 2025 analysis)',
    },
  ],
};
