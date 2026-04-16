// Phase 17: Comorbidity Manager engine functions
// Source: HEARTLAND Protocol Module 6, Section 6.2
// Pure functions -- no side effects, fully testable

import type {
  ReferralCriteriaInput,
  ReferralEvaluation,
  DeviceCriteriaInput,
  DeviceEvaluation,
} from './types';

/**
 * Evaluate Advanced HF Referral Criteria (COMR-04)
 * Gate: LVEF <=35% AND gdmtDuration >=3 months AND hospitalizations >=2 in last 12 months
 * Always includes 3 additional informational criteria regardless of gate result.
 */
export function evaluateReferralCriteria(
  input: ReferralCriteriaInput,
): ReferralEvaluation {
  const { lvef, gdmtDurationMonths, hfHospitalizationsLast12m } = input;

  if (
    lvef === null ||
    gdmtDurationMonths === null ||
    hfHospitalizationsLast12m === null
  ) {
    return {
      result: 'insufficient_data',
      gateMet: false,
      additionalCriteria: [],
      recommendation:
        'Enter LVEF, GDMT duration, and hospitalization count to evaluate.',
    };
  }

  const gateMet =
    lvef <= 35 &&
    gdmtDurationMonths >= 3 &&
    hfHospitalizationsLast12m >= 2;

  return {
    result: gateMet ? 'refer' : 'monitor',
    gateMet,
    additionalCriteria: [
      'Consider referral also if: continuous/frequent IV inotropes needed',
      'Peak VO2 <14 mL/kg/min on CPET',
      'Persistent NYHA Class IIIb-IV symptoms',
    ],
    recommendation: gateMet
      ? 'Referral to advanced HF center recommended. Patient meets primary gate criteria.'
      : 'Primary gate criteria not met. Continue GDMT optimization.',
  };
}

/**
 * Evaluate Device Criteria (COMR-05)
 * CRT candidate: LVEF <=35% + LBBB + QRS >=150ms + GDMT >=3 months
 * Possible CRT: QRS 130-149ms
 * ICD only: LVEF <=35% without CRT criteria
 */
export function evaluateDeviceCriteria(
  input: DeviceCriteriaInput,
): DeviceEvaluation {
  const { lvef, lbbb, qrsMs, gdmtDurationMonths } = input;

  if (lvef === null || qrsMs === null || gdmtDurationMonths === null) {
    return {
      result: 'insufficient_data',
      recommendation:
        'Enter LVEF, QRS duration, and GDMT duration to evaluate.',
    };
  }

  const lvefThresholdMet = lvef <= 35 && gdmtDurationMonths >= 3;

  if (!lvefThresholdMet) {
    return {
      result: 'monitor',
      recommendation:
        'LVEF >35% or GDMT duration <3 months. Device evaluation criteria not met.',
    };
  }

  if (lbbb && qrsMs >= 150) {
    return {
      result: 'crt_candidate',
      recommendation:
        'CRT candidate: LVEF \u226435%, LBBB morphology, QRS \u2265150 ms. Refer for electrophysiology evaluation.',
    };
  }

  if (qrsMs >= 130 && qrsMs <= 149) {
    return {
      result: 'possible_crt',
      recommendation:
        'Possible CRT candidate: QRS 130-149 ms. Electrophysiology evaluation recommended.',
    };
  }

  // LVEF <=35% without CRT criteria: ICD consideration
  return {
    result: 'icd_only',
    recommendation:
      'Primary prevention ICD consideration: LVEF \u226435% after \u22653 months GDMT. Refer for electrophysiology evaluation.',
  };
}
