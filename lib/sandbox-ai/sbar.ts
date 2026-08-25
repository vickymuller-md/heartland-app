/**
 * Sandbox AI-Assisted Check-In -- SBAR Draft Mapper
 *
 * Maps a structured check-in extraction plus the synthetic patient fixture
 * onto the existing SBAR generator (lib/sbar/populate.ts). Pure functions;
 * the draft is provider-facing, editable, and always shown next to its
 * source values.
 */

import { populateSbar } from '@/lib/sbar/populate';
import type { SbarData, SbarInput } from '@/lib/sbar/types';
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

function labNumber(patient: SandboxPatient, name: string): number | null {
  const lab = patient.labs.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
  if (!lab) return null;
  const value = Number.parseFloat(lab.value);
  return Number.isFinite(value) ? value : null;
}

function trackLetter(track: string): SbarInput['track_assignment'] {
  if (/track a/i.test(track)) return 'A';
  if (/track b/i.test(track)) return 'B';
  return 'hybrid';
}

export function checkInToSbarInput(patient: SandboxPatient, extraction: CheckInExtraction): SbarInput {
  const lastSynthetic = patient.vitals.at(-1);
  const tierMatch = /tier (\d)/i.exec(patient.facilityTier);
  return {
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
    labs: [{
      collected_at: patient.labs[0]?.collected ?? 'not recorded',
      potassium: labNumber(patient, 'Potassium'),
      creatinine: labNumber(patient, 'Creatinine'),
      egfr: labNumber(patient, 'eGFR'),
      bnp: labNumber(patient, 'BNP'),
      nt_probnp: labNumber(patient, 'NT-proBNP'),
      sodium: labNumber(patient, 'Sodium'),
    }],
    risk_tier: patient.riskTier.toLowerCase() as SbarInput['risk_tier'],
    track_assignment: trackLetter(patient.track),
    facility_tier: tierMatch ? Number(tierMatch[1]) : null,
  };
}

export function draftSbarFromCheckIn(patient: SandboxPatient, extraction: CheckInExtraction): SbarData {
  return populateSbar(checkInToSbarInput(patient, extraction));
}
