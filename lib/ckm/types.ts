/**
 * CKM Staging Types
 *
 * Based on AHA 2023 Presidential Advisory: Cardiovascular-Kidney-Metabolic (CKM) Syndrome
 * Source: reference/clinical_content.md Section 1.1
 */

/** CKM Syndrome Stage (0-4) per AHA 2023 taxonomy */
export type CkmStage = 0 | 1 | 2 | 3 | 4;

/** Input factors for CKM stage classification */
export interface CkmInput {
  /** BMI >=25 OR prediabetes present */
  excessAdiposity: boolean;
  /** T2DM, HTN, high triglycerides, or moderate-to-high CKD */
  metabolicRisk: boolean;
  /** Subclinical CVD with CKM risk factors */
  subclinicalCvd: boolean;
  /** Clinical CVD (including HF) or kidney failure */
  clinicalCvd: boolean;
}

/** CKM classification result with display metadata */
export interface CkmResult {
  stage: CkmStage;
  label: string;
  color: string;
}
