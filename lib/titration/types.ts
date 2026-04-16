import type { z } from 'zod';

/**
 * Titration step definition for the 5-step wizard.
 * Source: HEARTLAND Protocol v3.3, Module 3
 */
export interface TitrationStepDefinition {
  id: string;
  label: string;
  description: string;
  schema?: z.ZodSchema;
}

/**
 * Vital signs collected during Pre-Call Vitals step.
 * Source: reference/clinical_content.md Section 3.3
 */
export interface VitalSigns {
  sbp: number;                   // Systolic blood pressure (mmHg)
  hr: number;                    // Heart rate (bpm)
  potassium: number;             // K+ (mEq/L)
  creatinine: number;            // Cr (mg/dL)
  creatinineBaseline?: number;   // Baseline Cr for % increase calculation
  // eGFR (mL/min/1.73m²) — optional; required for renal safety gates
  egfr?: number;
}

/**
 * Safety gate evaluation status.
 * - pass: safe to proceed
 * - warning: borderline, proceed with caution
 * - blocked: cannot proceed, action required
 */
export type SafetyGateStatus = 'pass' | 'warning' | 'blocked';

/**
 * Result of evaluating a single safety gate against vital signs.
 * Source: reference/clinical_content.md Section 3.3
 */
export interface SafetyGateResult {
  parameter: string;
  value: number;
  threshold: string;
  status: SafetyGateStatus;
  action: string;
  details: string;
}

/**
 * Titration action recommendation from the decision algorithm.
 * Source: reference/clinical_content.md Section 3.3
 */
export interface TitrationAction {
  action: 'uptitrate' | 'hold' | 'reduce';
  details: string;
}

/**
 * Safety gate evaluator definition stored in constants.
 */
export interface SafetyGateDefinition {
  id: string;
  parameter: string;
  evaluate: (vitals: VitalSigns) => SafetyGateResult;
}

/**
 * Dual-track feature definition for Track A/Track B comparison.
 * Source: reference/clinical_content.md Section 3.2
 */
export interface DualTrackDefinition {
  id: string;
  name: string;
  features: string[];
}

/**
 * Hozho Trial parameter entry.
 * Source: reference/clinical_content.md Section 3.1
 */
export interface HozhoTrialParameter {
  parameter: string;
  result: string;
}

/**
 * Titration decision entry from the 7-row algorithm.
 * Source: reference/clinical_content.md Section 3.3
 */
export interface TitrationDecisionEntry {
  parameter: string;
  action: string;
}

/**
 * Medication entry for the medication review step.
 */
export interface MedicationEntry {
  name: string;
  currentDose: string;
}

/**
 * Drug class union for per-drug-class titration recommendations.
 * Source: HEARTLAND Protocol v3.3 Module 2 GDMT quadruple therapy + loop diuretic
 */
export type DrugClass = 'ARNI' | 'Beta-blocker' | 'MRA' | 'SGLT2i' | 'Loop diuretic';

/**
 * Per-drug-class recommendation from the titration engine.
 * Unlike the global TitrationAction, this tells providers which specific
 * drug to hold/reduce/uptitrate based on which safety gate is relevant.
 */
export interface DrugClassRecommendation {
  drugClass: DrugClass;
  action: 'uptitrate' | 'hold' | 'reduce' | 'not-applicable';
  reason: string;
  safetyGateFailed: string | null;
}
