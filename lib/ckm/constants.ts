/**
 * CKM Stage Display Constants
 *
 * Source: reference/clinical_content.md Section 1.1
 * AHA 2023 Presidential Advisory CKM Syndrome taxonomy
 */

/** Stage labels and Tailwind color classes for CKM stages 0-4 */
export const CKM_STAGE_LABELS: Record<number, { label: string; color: string }> = {
  0: { label: 'Stage 0 — No CKM Factors', color: 'text-gray-700 bg-gray-100' },
  1: { label: 'Stage 1 — Excess Adiposity', color: 'text-blue-700 bg-blue-100' },
  2: { label: 'Stage 2 — Metabolic Risk', color: 'text-amber-700 bg-amber-100' },
  3: { label: 'Stage 3 — Subclinical CVD', color: 'text-orange-700 bg-orange-100' },
  4: { label: 'Stage 4 — Clinical CVD/HF', color: 'text-red-700 bg-red-100' },
};
