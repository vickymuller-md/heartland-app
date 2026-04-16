/**
 * Phase 12: Tool Integration -- Pure utility functions
 *
 * Extracted from actions.ts to avoid 'use server' constraint on sync functions.
 * These are pure functions with no Supabase dependency, exported for unit testing.
 */

import { format } from 'date-fns';
import type { TitrationNoteData, GdmtMedicationInput } from './types';

// ---------- Constants ----------

/** Track value mapping: engine returns 'track-a'|'track-b'|'hybrid', DB expects 'A'|'B'|'hybrid' */
export const TRACK_MAP: Record<string, string> = {
  'track-a': 'A',
  'track-b': 'B',
  'hybrid': 'hybrid',
};

// ---------- Pure Functions ----------

/**
 * Format titration checklist data into a structured provider note.
 * INTG-04: Pure function -- no Supabase dependency.
 *
 * - Truncates providerNotes to 2000 chars
 * - Total output capped at 5000 chars
 */
export function formatTitrationNote(data: TitrationNoteData): string {
  const dateStr = format(new Date(), 'MM/dd/yyyy');
  const truncatedNotes = data.providerNotes
    ? data.providerNotes.slice(0, 2000)
    : null;

  // Build vitals line with optional eGFR and lab date
  let vitalsLine = `Vitals: SBP ${data.vitals.sbp} mmHg | HR ${data.vitals.hr} bpm | K+ ${data.vitals.potassium ?? 'N/A'} | Cr ${data.vitals.creatinine ?? 'N/A'}`;
  if (data.vitals.egfr != null) {
    vitalsLine += ` | eGFR ${data.vitals.egfr}`;
  }
  if (data.vitals.labDate) {
    try {
      const labDateFormatted = format(new Date(data.vitals.labDate), 'MM/dd/yyyy');
      vitalsLine += ` (labs: ${labDateFormatted})`;
    } catch {
      // skip if date is invalid
    }
  }

  const lines = [
    `[TITRATION CHECKLIST — ${dateStr}]`,
    vitalsLine,
    data.vitals.creatinineBaseline != null
      ? `Baseline Cr: ${data.vitals.creatinineBaseline} mg/dL`
      : null,
    data.symptomsReported
      ? `Symptoms: ${data.symptomsReported}`
      : null,
    `Safety Gates: ${data.safetyGateResults.map(g => `${g.parameter}: ${g.status.toUpperCase()}`).join(', ')}`,
    `Decision: ${data.titrationAction.action.toUpperCase()} — ${data.titrationAction.details}`,
    data.perDrugRecommendations && data.perDrugRecommendations.length > 0
      ? `Per-drug: ${data.perDrugRecommendations.map(r => `${r.drugClass}: ${r.action.toUpperCase()}`).join(' | ')}`
      : null,
    data.medicationChanges && data.medicationChanges.length > 0
      ? `Medications: ${data.medicationChanges.map(c => `${c.name} ${c.fromDose}\u2192${c.toDose}`).join(', ')}`
      : null,
    truncatedNotes ? `Notes: ${truncatedNotes}` : null,
    data.nextCallDate ? `Next call: ${data.nextCallDate}` : null,
  ].filter((l): l is string => l !== null);
  return lines.join('\n').slice(0, 5000);
}

/**
 * Filter GDMT medications against existing patient medications.
 * INTG-05: Pure function -- no Supabase dependency.
 *
 * Case-insensitive, whitespace-trimmed comparison.
 */
export function buildGdmtMedications(
  selected: GdmtMedicationInput[],
  existingMedNames: string[]
): GdmtMedicationInput[] {
  const normalizedExisting = existingMedNames.map(n => n.toLowerCase().trim());
  return selected.filter(
    m => !normalizedExisting.includes(m.name.toLowerCase().trim())
  );
}
