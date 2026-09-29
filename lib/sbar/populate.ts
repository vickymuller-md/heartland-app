/**
 * populateSbar -- Pure function: patient data -> SBAR section strings
 * Phase 15: SBAR-02 (auto-populate from patient data)
 *
 * No Supabase, no React imports. Unit-testable.
 */

import { z } from 'zod';
import { effectiveLabObservationSchema, selectLatestEffectiveLab } from '@/lib/labs/effective';
import { LAB_OBSERVATION_FIELDS, labCollectionUTC } from '@/lib/labs/quality';
import type { SbarInput, SbarContext, SbarData } from './types';

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

function formatLabs(input: SbarInput, now: Date): string {
  const patientId = z.guid().parse(input.patient_id).toLowerCase();
  const labs = z.array(effectiveLabObservationSchema).parse(input.labs);
  if (labs.some((lab) => lab.patient_id.toLowerCase() !== patientId)
    || new Set(labs.map((lab) => lab.id)).size !== labs.length) throw new Error('Invalid SBAR laboratory scope');
  if (labs.length === 0) return 'Recorded laboratory sources: none available. No recency or clinical suitability assessed.';
  const lines = Object.entries(LAB_OBSERVATION_FIELDS).map(([field, { label, unit }]) => {
    const selected = selectLatestEffectiveLab(labs, patientId, field as SbarInput['labs'][number]['analyte'], now);
    if (selected.state === 'missing') return `  - ${label}: no recorded source.`;
    const source = selected.observation;
    const value = selected.state === 'available' ? `${source.value} ${unit}`
      : selected.state === 'cancelled' ? 'cancelled; no current value' : `not usable; ${selected.reason}`;
    const version = source.revision ? `revision ${source.revision}` : 'unregistered source';
    const processing = source.evaluation_status === 'pending' ? '; alert processing pending'
      : source.evaluation_status ? `; alert processing: ${source.evaluation_status}` : '';
    return `  - ${label}: ${value}; collected ${labCollectionUTC(source.collected_at)}; ${source.status}, ${version}${processing}.`;
  });
  return `Recorded laboratory sources (latest collection per analyte; recency and clinical suitability not assessed):\n${lines.join('\n')}`;
}

// ── Main populate function ───────────────────────────────────

export function populateSbar(input: SbarInput, now = new Date()): SbarData {
  return formatSbarSections(input, formatLabs(input, now));
}

/** Text formatting only. Authenticated callers must use populateSbar's validated projection. */
export function formatSbarSections(input: SbarContext, laboratoryText: string): SbarData {
  const riskLabel = formatRiskTier(input.risk_tier);
  const trackLabel = formatTrack(input.track_assignment);
  const facilityLabel =
    input.facility_tier !== null ? `Tier ${input.facility_tier}` : 'not recorded';

  // Situation
  const situation = [
    `Draft handoff for ${input.patient_name}, risk tier ${riskLabel}; referral/transfer not confirmed.`,
    formatVitals(input.vitals),
    'Reason for handoff: [ Provider to specify ]',
  ].join('\n');

  // Background
  const background = [
    `Monitoring track: ${trackLabel}.`,
    `Facility tier: ${facilityLabel}.`,
    formatMeds(input.medications),
    laboratoryText,
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
