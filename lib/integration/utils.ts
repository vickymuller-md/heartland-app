/**
 * Phase 12: Tool Integration -- Pure utility functions
 *
 * Extracted from actions.ts to avoid 'use server' constraint on sync functions.
 * These are pure functions with no Supabase dependency, exported for unit testing.
 */

import { format } from 'date-fns';
import type { TitrationNoteData, GdmtMedicationInput } from './types';
import { LAB_ANALYTES, labCollectionUTC } from '@/lib/labs/quality';
import type { LabAnalyte } from '@/lib/labs/quality';

// ---------- Constants ----------

/** Track value mapping: engine returns 'track-a'|'track-b'|'hybrid', DB expects 'A'|'B'|'hybrid' */
export const TRACK_MAP: Record<string, string> = {
  'track-a': 'A',
  'track-b': 'B',
  'hybrid': 'hybrid',
};

// ---------- Pure Functions ----------

export const TITRATION_SOURCE_NOTICE = 'Imported sources are client-declared snapshots, not server-verified current revisions. Manual form entries may differ. No laboratory review, patient contact or completed care is confirmed.';

/** Import provenance is intentionally separate from the numeric values used in the draft. */
export function formatTitrationSources(data: Pick<TitrationNoteData, 'vitals' | 'laboratorySnapshots' | 'sourceReadAt'>): string {
  if (!data.laboratorySnapshots) return 'Laboratory provenance: manual educational entries; no imported laboratory source or collection time is asserted.';
  const lines = [TITRATION_SOURCE_NOTICE, 'Source read completed: ' + (data.sourceReadAt ? labCollectionUTC(data.sourceReadAt) : 'not supplied')];
  for (const analyte of Object.keys(LAB_ANALYTES) as LabAnalyte[]) {
    const source = data.laboratorySnapshots[analyte]; const observation = source.observation;
    const entered = data.vitals[analyte];
    lines.push(LAB_ANALYTES[analyte].label + ': form value ' + (entered == null || !Number.isFinite(entered) ? 'not entered' : entered) + ' ' + LAB_ANALYTES[analyte].unit + '.');
    if (!observation) { lines.push('  Imported source: missing.'); continue; }
    lines.push('  Imported source: ' + (observation.status === 'cancelled' ? 'cancelled; no value' : observation.value + ' ' + LAB_ANALYTES[analyte].unit)
      + '; collected ' + labCollectionUTC(observation.collected_at) + '; quality ' + source.state + '; ' + source.reason);
    lines.push('  Source status ' + observation.status + '; revision ' + (observation.revision ?? 'unregistered')
      + '; original ' + observation.original_lab_result_id + '; root ' + (observation.root_id ?? 'none')
      + '; version ' + (observation.version_id ?? 'none') + '; effective ' + (observation.effective_lab_result_id ?? 'none')
      + '; alert processing ' + (observation.evaluation_status ?? 'not supplied') + '.');
  }
  return lines.join('\n');
}

/**
 * Format titration checklist data into a structured provider note.
 * INTG-04: Pure function -- no Supabase dependency.
 *
 * - Provider notes are limited to 2000 chars; no silent truncation of a justification.
 * - Reject complete notes exceeding5000 chars, preserving every submitted source/limitation.
 */
export function formatTitrationNote(data: TitrationNoteData): string {
  const dateStr = format(new Date(), 'MM/dd/yyyy');
  if (data.providerNotes.length > 2000) throw new Error('Provider notes exceed 2,000 characters. Shorten them explicitly before saving.');

  // Build form-value line, never imply a shared collection date across analytes.
  let vitalsLine = `Vitals: SBP ${data.vitals.sbp} mmHg | HR ${data.vitals.hr} bpm | K+ ${data.vitals.potassium ?? 'N/A'} | Cr ${data.vitals.creatinine ?? 'N/A'}`;
  if (data.vitals.egfr != null) {
    vitalsLine += ` | eGFR ${data.vitals.egfr}`;
  }

  const lines = [
    `[TITRATION CHECKLIST — ${dateStr}]`,
    vitalsLine,
    formatTitrationSources(data),
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
    data.nextCallDate ? `Next call: ${data.nextCallDate}` : null,
  ].filter((l): l is string => l !== null);
  if (data.providerNotes) lines.push('Notes: ' + data.providerNotes);
  const note = lines.join('\n');
  if (note.length > 5000) throw new Error('The complete note exceeds5,000characters. Shorten optional text explicitly; no note was saved.');
  return note;
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
