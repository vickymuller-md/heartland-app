/**
 * Sandbox AI-Assisted Check-In -- SBAR Draft Mapper
 *
 * Maps a structured check-in extraction plus the synthetic patient fixture
 * onto the existing SBAR generator (lib/sbar/populate.ts). Pure functions;
 * the draft is provider-facing, editable, and always shown next to its
 * source values.
 */

import { formatSbarSections } from '@/lib/sbar/populate';
import type { SbarData, SbarContext } from '@/lib/sbar/types';
import type { SandboxPatient } from '@/lib/sandbox/types';
import type { CheckInExtraction } from './types';

const FREQUENCY_PATTERN = /(twice daily|once daily|daily|nightly|weekly)$/i;

function parseDose(dose: string): { dosage: string; frequency: string } {
  const match = FREQUENCY_PATTERN.exec(dose.trim());
  if (!match) return { dosage: dose.trim(), frequency: '' };
  return {
    dosage: dose.slice(0, match.index).trim() || dose.trim(),
    frequency: match[1].toLowerCase(),
  };
}

interface SyntheticSbarInput extends SbarContext {
  source_kind: 'synthetic-fixture';
  synthetic_labs: SandboxPatient['labs'];
}

function trackLetter(track: string): SbarContext['track_assignment'] {
  if (/track a/i.test(track)) return 'A';
  if (/track b/i.test(track)) return 'B';
  return 'hybrid';
}

export function checkInToSbarInput(patient: SandboxPatient, extraction: CheckInExtraction): SyntheticSbarInput {
  const lastSynthetic = patient.vitals.at(-1);
  const tierMatch = /tier (\d)/i.exec(patient.facilityTier);
  return {
    source_kind: 'synthetic-fixture',
    patient_name: patient.name,
    vitals: {
      recorded_at: 'Today (automated check-in)',
      weight_lbs: extraction.weightLbs ?? lastSynthetic?.weight ?? null,
      sbp: extraction.sbp ?? lastSynthetic?.sbp ?? null,
      dbp: null,
      heart_rate: lastSynthetic?.heartRate ?? null,
      spo2: extraction.spo2,
    },
    medications: patient.medications.map((medication) => ({
      name: medication.name,
      ...parseDose(medication.dose),
    })),
    synthetic_labs: patient.labs.map((lab) => ({ ...lab })),
    risk_tier: patient.riskTier.toLowerCase() as SbarContext['risk_tier'],
    track_assignment: trackLetter(patient.track),
    facility_tier: tierMatch ? Number(tierMatch[1]) : null,
  };
}

export function draftSbarFromCheckIn(patient: SandboxPatient, extraction: CheckInExtraction): SbarData {
  const input = checkInToSbarInput(patient, extraction);
  const laboratoryText = ['Synthetic fixture labs — demonstration only; not registered laboratory sources.',
    ...input.synthetic_labs.map((lab) => `  - ${lab.name}: ${lab.value}; fixture collection: ${lab.collected}.`),
  ].join('\n');
  return formatSbarSections(input, laboratoryText);
}
