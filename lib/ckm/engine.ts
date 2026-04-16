/**
 * CKM Stage Classification Engine
 *
 * Pure function that classifies a patient's CKM Syndrome Stage (0-4)
 * based on the AHA 2023 Presidential Advisory taxonomy.
 *
 * Priority order (highest wins):
 *   Stage 4: Clinical CVD (including HF) or kidney failure
 *   Stage 3: Subclinical CVD with CKM risk factors
 *   Stage 2: Metabolic risk (T2DM, HTN, high TG, moderate-to-high CKD)
 *   Stage 1: Excess adiposity (BMI >=25 or prediabetes)
 *   Stage 0: No CKM factors
 *
 * Source: reference/clinical_content.md Section 1.1
 */

import type { CkmInput, CkmStage } from './types';

/**
 * Classify CKM Syndrome Stage from boolean risk factor inputs.
 *
 * @param input - Four boolean CKM risk factors
 * @returns CKM stage 0-4 (highest applicable stage wins)
 */
export function classifyCkmStage(input: CkmInput): CkmStage {
  if (input.clinicalCvd) return 4;
  if (input.subclinicalCvd) return 3;
  if (input.metabolicRisk) return 2;
  if (input.excessAdiposity) return 1;
  return 0;
}

export type { CkmStage, CkmInput };
