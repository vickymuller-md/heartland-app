/**
 * populateSbar -- Pure function: patient data -> SBAR section strings
 * Phase 15: SBAR-02 (auto-populate from patient data)
 *
 * No Supabase, no React imports. Unit-testable.
 */

import type { SbarInput, SbarData } from './types';

// ── Track assignment label mapping ───────────────────────────

const TRACK_LABELS: Record<string, string> = {
  A: 'Digital Track (Track A)',
  B: 'Analog Track (Track B)',
  hybrid: 'Hybrid',
};

function formatTrack(t: string | null): string {
  if (t === null) return 'not assigned';
  return TRACK_LABELS[t] ?? 'not assigned';
}

// ── Risk tier label mapping ──────────────────────────────────

function formatRiskTier(tier: string | null): string {
  if (tier === null) return 'not calculated';
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

// ── Vitals formatting ────────────────────────────────────────

function formatVitals(
  v: SbarInput['vitals'],
): string {
  if (!v) return 'Vitals: not recorded.';

  const weight = v.weight_lbs !== null ? `${v.weight_lbs} lbs` : 'not recorded';
  const bp =
    v.sbp !== null && v.dbp !== null
      ? `${v.sbp}/${v.dbp} mmHg`
      : 'not recorded';
  const hr = v.heart_rate !== null ? `${v.heart_rate} bpm` : 'not recorded';
  const spo2 = v.spo2 !== null ? `${v.spo2}%` : 'not recorded';

  return `Most recent vitals: Weight ${weight}, BP ${bp}, HR ${hr}, SpO2 ${spo2}.`;
}

// ── Medications formatting ───────────────────────────────────

function formatMeds(meds: SbarInput['medications']): string {
  if (meds.length === 0) return 'Active medications: none recorded.';

  const lines = meds.map((m) => `  - ${m.name} ${m.dosage} ${m.frequency}`);
  return `Active medications (${meds.length}):\n${lines.join('\n')}`;
}

// ── Labs formatting ──────────────────────────────────────────

function formatLabs(labs: SbarInput['labs']): string {
  if (labs.length === 0) return 'Recent labs: no recent labs.';

  // Use first element (most recent, already sorted by Server Component)
  const lab = labs[0];
  const parts: string[] = [];

  if (lab.potassium !== null) parts.push(`K+ ${lab.potassium} mEq/L`);
  if (lab.creatinine !== null) parts.push(`Creatinine ${lab.creatinine} mg/dL`);
  if (lab.egfr !== null) parts.push(`eGFR ${lab.egfr} mL/min`);
  if (lab.bnp !== null) parts.push(`BNP ${lab.bnp} pg/mL`);
  if (lab.nt_probnp !== null) parts.push(`NT-proBNP ${lab.nt_probnp} pg/mL`);
  if (lab.sodium !== null) parts.push(`Na ${lab.sodium} mEq/L`);

  if (parts.length === 0) return 'Recent labs: no recent labs.';

  return `Most recent labs (${lab.collected_at}):\n  ${parts.join(', ')}.`;
}

// ── Main populate function ───────────────────────────────────

export function populateSbar(input: SbarInput): SbarData {
  const riskLabel = formatRiskTier(input.risk_tier);
  const trackLabel = formatTrack(input.track_assignment);
  const facilityLabel =
    input.facility_tier !== null ? `Tier ${input.facility_tier}` : 'not recorded';

  // Situation
  const situation = [
    `${input.patient_name} is a patient at risk tier ${riskLabel} being referred/transferred.`,
    formatVitals(input.vitals),
    'Reason for handoff: [ Provider to specify ]',
  ].join('\n');

  // Background
  const background = [
    `Monitoring track: ${trackLabel}.`,
    `Facility tier: ${facilityLabel}.`,
    formatMeds(input.medications),
    formatLabs(input.labs),
  ].join('\n');

  // Assessment
  const assessment = [
    `HEARTLAND Risk Tier: ${riskLabel}.`,
    input.risk_tier !== null
      ? 'Clinical assessment: [ Provider to add clinical assessment ]'
      : 'Risk tier: not calculated. [ Provider to add clinical assessment ]',
  ].join('\n');

  // Recommendation
  const recommendation =
    '[ Provider to complete: specify referral type (cardiology consult / hospital transfer / specialist referral), urgency (routine / urgent / emergent), and follow-up timing ]';

  return { situation, background, assessment, recommendation };
}
