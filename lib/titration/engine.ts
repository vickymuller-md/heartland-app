// Pure functions for Titration Checklist safety gate evaluation and decision algorithm.
// Source: reference/clinical_content.md Module 3, Section 3.3
// NO side effects, NO async, NO DOM — safe for server or client.

import { SAFETY_GATES, ACEI_KEYWORDS } from './constants';
import type { VitalSigns, SafetyGateResult, TitrationAction, DrugClass, DrugClassRecommendation } from './types';

/**
 * Evaluates all 5 safety gates against the provided vital signs.
 * Returns an array of SafetyGateResult (one per gate).
 *
 * Source: reference/clinical_content.md Section 3.3, ACC/AHA 2022 HF Guidelines (eGFR)
 */
export function evaluateSafetyGates(vitals: VitalSigns): SafetyGateResult[] {
  return SAFETY_GATES.map((gate) => gate.evaluate(vitals));
}

/**
 * Returns true only if no gate has status 'blocked'.
 * Warnings are allowed (proceed with caution), but blocks prevent progression.
 */
export function canProceedPastSafetyGates(results: SafetyGateResult[]): boolean {
  return results.every((r) => r.status !== 'blocked');
}

/**
 * Implements the 7-row titration decision algorithm from protocol Section 3.3.
 * Returns the FIRST matching action (most restrictive first for safety).
 *
 * Priority order:
 * 1. SBP < 90 -> reduce (most dangerous)
 * 2. HR < 50 -> reduce (bradycardia)
 * 3. K+ > 5.5 -> hold (hyperkalemia)
 * 4. Cr increase > 30% -> hold (renal)
 * 5. K+ 5.0-5.5 -> hold (borderline K+)
 * 6. SBP 90-99 -> hold (borderline SBP)
 * 7. SBP >= 100 -> uptitrate (safe)
 *
 * Source: reference/clinical_content.md Section 3.3
 */
export function getTitrationAction(vitals: VitalSigns): TitrationAction {
  // Check most restrictive conditions first

  // SBP < 90 OR symptomatic hypotension -> REDUCE
  if (vitals.sbp < 90) {
    return {
      action: 'reduce',
      details: 'SBP <90 mmHg OR symptomatic hypotension: REDUCE dose or hold; consider cardiology input',
    };
  }

  // HR < 50 (for beta-blockers) -> reduce
  if (vitals.hr < 50) {
    return {
      action: 'reduce',
      details: 'HR <50 (for beta-blockers): Reduce dose; if symptomatic, hold',
    };
  }

  // K+ > 5.5 -> HOLD
  if (vitals.potassium > 5.5) {
    return {
      action: 'hold',
      details: 'K+ >5.5: HOLD MRA/finerenone and ARNI; urgent recheck; dietary counseling',
    };
  }

  // Cr increase > 30% from baseline -> HOLD
  if (vitals.creatinineBaseline && vitals.creatinineBaseline > 0) {
    const crIncrease = ((vitals.creatinine - vitals.creatinineBaseline) / vitals.creatinineBaseline) * 100;
    if (crIncrease > 30) {
      return {
        action: 'hold',
        details: 'Cr increase >30%: HOLD ARNI/MRA; evaluate; cardiology consult',
      };
    }
  }

  // K+ 5.0-5.5 -> hold (reduce MRA dose)
  if (vitals.potassium >= 5.0) {
    return {
      action: 'hold',
      details: 'K+ 5.0-5.5: Reduce MRA/finerenone dose; recheck in 1 week',
    };
  }

  // SBP 90-99 AND asymptomatic -> HOLD
  if (vitals.sbp < 100) {
    return {
      action: 'hold',
      details: 'SBP 90-99 mmHg AND asymptomatic: HOLD current dose; reassess in 1 week',
    };
  }

  if (vitals.egfr === undefined) {
    return {
      action: 'hold',
      details: 'eGFR missing: HOLD the advisory pathway until renal context is reviewed',
    };
  }

  // Numeric signal only. Symptoms and other clinical context are not evaluated here.
  return {
    action: 'uptitrate',
    details: 'No entered numeric gate triggered a hold. Symptoms and full clinical context remain unevaluated; provider decision required',
  };
}

// ==========================================================================
// Per-Drug-Class Titration Engine (TITR-01)
// Returns one recommendation per drug class, each with its own safety gate check.
// Source: HEARTLAND Protocol v3.3 Module 3 + ACC/AHA 2022 HF Guidelines
// ==========================================================================

/**
 * Evaluates safety gates per drug class and returns individual recommendations.
 * Unlike getTitrationAction (global), this function differentiates:
 * - SBP gates apply to ARNI only (vasodilator)
 * - HR gates apply to Beta-blocker only
 * - K+ gates apply to MRA and ARNI
 * - eGFR gates apply per-drug with different thresholds
 * - Cr increase gates apply to ARNI and MRA
 *
 * Priority order within each drug (most restrictive first for safety):
 * 1. SBP <90 -> reduce (ARNI only)
 * 2. SBP 90-99 -> hold (ARNI only)
 * 3. HR <50 -> reduce (Beta-blocker only)
 * 4. K+ >5.5 -> hold (MRA, ARNI)
 * 5. K+ 5.0-5.5 -> hold (MRA only)
 * 6. Cr increase >30% -> hold (MRA, ARNI)
 * 7. eGFR per-drug thresholds (skip if undefined)
 * 8. Default: uptitrate
 */
export function getPerDrugRecommendations(
  vitals: VitalSigns,
  activeDrugClasses: DrugClass[],
): DrugClassRecommendation[] {
  return activeDrugClasses.map((drugClass) => {
    // SBP check applies to ARNI (vasodilator)
    if (drugClass === 'ARNI' && vitals.sbp < 90) {
      return { drugClass, action: 'reduce' as const, reason: 'SBP <90', safetyGateFailed: 'SBP' };
    }
    if (drugClass === 'ARNI' && vitals.sbp < 100) {
      return { drugClass, action: 'hold' as const, reason: 'SBP 90-99', safetyGateFailed: 'SBP' };
    }

    // HR only affects Beta-blocker
    if (drugClass === 'Beta-blocker' && vitals.hr < 50) {
      return { drugClass, action: 'reduce' as const, reason: 'HR <50', safetyGateFailed: 'HR' };
    }

    // K+ >5.5 affects MRA and ARNI
    if ((drugClass === 'MRA' || drugClass === 'ARNI') && vitals.potassium > 5.5) {
      return { drugClass, action: 'hold' as const, reason: 'K+ >5.5', safetyGateFailed: 'K+' };
    }

    // K+ 5.0-5.5 affects MRA only (reduce dose)
    if (drugClass === 'MRA' && vitals.potassium >= 5.0) {
      return { drugClass, action: 'hold' as const, reason: 'K+ 5.0-5.5', safetyGateFailed: 'K+' };
    }

    // Cr increase >30% affects ARNI and MRA
    if ((drugClass === 'ARNI' || drugClass === 'MRA') &&
        vitals.creatinineBaseline && vitals.creatinineBaseline > 0) {
      const pct = ((vitals.creatinine - vitals.creatinineBaseline) / vitals.creatinineBaseline) * 100;
      if (pct > 30) {
        return { drugClass, action: 'hold' as const, reason: `Cr +${pct.toFixed(0)}%`, safetyGateFailed: 'Cr' };
      }
    }

    if (
      vitals.egfr === undefined &&
      (drugClass === 'MRA' || drugClass === 'SGLT2i' || drugClass === 'ARNI')
    ) {
      return {
        drugClass,
        action: 'not-applicable' as const,
        reason: 'eGFR missing — renal gate incomplete',
        safetyGateFailed: 'eGFR',
      };
    }

    // eGFR per-drug thresholds
    if (vitals.egfr !== undefined && vitals.egfr !== null) {
      if (drugClass === 'MRA' && vitals.egfr <= 30) {
        return { drugClass, action: 'hold' as const, reason: `eGFR ${vitals.egfr} <=30`, safetyGateFailed: 'eGFR' };
      }
      if (drugClass === 'SGLT2i' && vitals.egfr <= 20) {
        return { drugClass, action: 'hold' as const, reason: `eGFR ${vitals.egfr} <=20`, safetyGateFailed: 'eGFR' };
      }
      if (drugClass === 'ARNI' && vitals.egfr <= 20) {
        return { drugClass, action: 'hold' as const, reason: `eGFR ${vitals.egfr} <=20`, safetyGateFailed: 'eGFR' };
      }
    }

    // Default: all gates passed -> uptitrate
    return {
      drugClass,
      action: 'uptitrate' as const,
      reason: 'No entered class-specific numeric gate triggered; provider review still required',
      safetyGateFailed: null,
    };
  });
}

// ==========================================================================
// ACEi Detection (TITR-02)
// Pure function to detect ACE inhibitor presence in medication name list
// ==========================================================================

/**
 * Returns true if any medication name contains an ACEi keyword.
 * Uses case-insensitive substring matching (consistent with GDMT_CLASS_KEYWORDS pattern).
 */
export function detectAceiPresence(medicationNames: string[]): boolean {
  return medicationNames.some((name) =>
    ACEI_KEYWORDS.some((kw) => name.toLowerCase().includes(kw)),
  );
}

/**
 * Returns true if ARNI is among the active drug classes being considered for titration.
 */
export function isArniBeingConsidered(activeDrugClasses: DrugClass[]): boolean {
  return activeDrugClasses.includes('ARNI');
}
