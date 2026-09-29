import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getPatientOperationalView } from '@/lib/patient/operational';
import { PatientBrief } from '@/app/(provider)/patients/[patientId]/_components/patient-brief';
import type { EffectiveLabObservation } from '@/lib/labs/effective';

vi.mock('@/lib/daily-loop/queries', () => ({ getPatientWorkItems: vi.fn().mockResolvedValue({ items: [], error: null }) }));
const id = (n: number) => `63000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = id(1); const patient = id(2);
function observation(n: number, patch: Partial<EffectiveLabObservation> = {}): EffectiveLabObservation {
  const result = { id: `${id(n)}:potassium`, patient_id: patient, original_lab_result_id: id(n), analyte: 'potassium' as const,
    root_id: null, version_id: null, revision: null, status: 'original' as const, effective_lab_result_id: id(n),
    value: '4.2', collected_at: '2026-09-01T12:00:00.123456Z', notes: null, lab_facility: null,
    evaluation_status: null, ...patch };
  return { ...result, id: `${result.original_lab_result_id}:${result.analyte}` };
}
function database(items: EffectiveLabObservation[] = [], options: { actor?: string; error?: unknown } = {}) {
  const from = vi.fn((table: string) => {
    if (table === 'lab_results') throw new Error('Raw laboratory fallback forbidden');
    const query = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], count: 0, error: null }).then(resolve),
    };
    return query;
  });
  const rpc = vi.fn().mockResolvedValue({ error: options.error ?? null, data: {
    actor_id: options.actor ?? actor, patient_ids: [patient], snapshot: 'a'.repeat(64), next_cursor: null,
    items: [...items].sort((a, b) => a.id.localeCompare(b.id)),
  } });
  return { client: { from, rpc } as unknown as SupabaseClient, from, rpc };
}

describe('Patient operational effective laboratory sources', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-29T12:00:00Z')); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('keeps independent collection instants, exact decimals and missing analytes in the brief', async () => {
    const potassium = observation(101, { value: '4.200000000000000001' });
    const creatinine = observation(102, { analyte: 'creatinine', value: '1.1', collected_at: '2026-09-28T13:14:15.654321Z' });
    const db = database([potassium, creatinine]);
    const { brief, error } = await getPatientOperationalView(db.client, actor, patient);
    expect(error).toBeNull();
    expect(brief.labsUnavailable).toBe(false);
    expect(brief.latestLabs?.potassium).toMatchObject({ value: potassium.value, collectedAt: potassium.collected_at, status: 'recency_unassessed' });
    expect(brief.latestLabs?.creatinine.collectedAt).toBe(creatinine.collected_at);
    expect(brief.latestLabs?.egfr).toMatchObject({ value: null, status: 'missing' });
    expect(brief.sourceDataAsOf).toBe(creatinine.collected_at);
    expect(brief.missingData).toContain('eGFR: No recorded source for this analyte.');
    expect(db.rpc).toHaveBeenCalledWith('get_effective_lab_observations', { p_patient_ids: [patient], p_after: null, p_snapshot: null });
    expect(db.from).not.toHaveBeenCalledWith('lab_results');
    render(<PatientBrief brief={brief} />);
    const k = within(screen.getByLabelText('Potassium source'));
    expect(k.getByText(/4\.200000000000000001/)).toBeInTheDocument();
    expect(k.getByText('2026-09-01T12:00:00.123456Z (UTC)')).toBeInTheDocument();
    expect(k.getByText('Recency not assessed')).toBeInTheDocument();
    expect(screen.getByText('Most recent source timestamp (not completeness):')).toBeInTheDocument();
    expect(within(screen.getByLabelText('eGFR source')).getByText('Missing')).toBeInTheDocument();
    expect(screen.queryByText(/normal/i)).not.toBeInTheDocument();
  });

  it('shows cancellation without reviving an older source or claiming review/contact', async () => {
    const cancelled = observation(102, { status: 'cancelled', root_id: id(202), version_id: id(302), revision: '2',
      effective_lab_result_id: null, value: null, collected_at: '2026-09-28T12:00:00Z' });
    const { brief, timeline } = await getPatientOperationalView(database([observation(101), cancelled]).client, actor, patient);
    expect(brief.latestLabs?.potassium).toMatchObject({ status: 'cancelled', value: null, source: { status: 'cancelled', revision: '2' } });
    expect(brief.sourceDataAsOf).toBeNull();
    const event = timeline.find((item) => item.id === `lab-${cancelled.id}`)!;
    expect(event.occurredAt).toBe(cancelled.collected_at);
    expect(event.detail).toContain('No current value');
    expect(event.detail).toContain('no clinical review or human communication inferred');
    render(<PatientBrief brief={brief} />);
    const k = within(screen.getByLabelText('Potassium source'));
    expect(k.getByText('Cancelled — reconcile source')).toBeInTheDocument();
    expect(k.getByText('Source: cancelled · revision 2.')).toBeInTheDocument();
    expect(k.queryByText(/4\.2/)).not.toBeInTheDocument();
  });

  it('retains a corrected value collection time and explicitly pending alert processing', async () => {
    const corrected = observation(101, { status: 'corrected', root_id: id(201), version_id: id(301), revision: '3',
      effective_lab_result_id: id(401), value: '4.1', evaluation_status: 'pending' });
    const { brief, timeline } = await getPatientOperationalView(database([corrected]).client, actor, patient);
    expect(brief.sourceDataAsOf).toBe(corrected.collected_at);
    expect(brief.sourceDataStale).toBe(true);
    expect(timeline[0]).toMatchObject({ occurredAt: corrected.collected_at, status: 'corrected' });
    expect(timeline[0].detail).toContain('documented collection, not correction-processing time');
    render(<PatientBrief brief={brief} />);
    expect(within(screen.getByLabelText('Potassium source')).getByText(/Source: corrected · revision 3\. Alert processing pending\./)).toBeInTheDocument();
  });

  it.each([
    { error: { code: '40001', message: 'Source changed during pagination' } },
    { actor: id(9) },
  ])('keeps other summary data but marks a failed or wrong-actor read unavailable', async (options) => {
    const db = database([observation(101)], options);
    const { brief, timeline, error } = await getPatientOperationalView(db.client, actor, patient);
    expect(brief.latestLabs).toBeNull(); expect(brief.labsUnavailable).toBe(true);
    expect(brief.missingData).toContain('Labs query unavailable');
    expect(brief.missingData).not.toContain('No lab result available');
    expect(error).toContain('queries failed');
    expect(timeline.filter((item) => item.type === 'lab')).toEqual([]);
    expect(db.from).not.toHaveBeenCalledWith('lab_results');
    render(<PatientBrief brief={brief} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Laboratory data unavailable');
  });

  it('distinguishes an authorized empty source view from a failed query', async () => {
    const { brief, error } = await getPatientOperationalView(database().client, actor, patient);
    expect(error).toBeNull(); expect(brief.labsUnavailable).toBe(false); expect(brief.latestLabs).toBeNull();
    expect(brief.missingData).toContain('No lab result available');
    render(<PatientBrief brief={brief} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each([
    { value: '-0.0000000000000000001' },
    { collected_at: '2026-10-01T00:00:00Z' },
  ])('does not promote invalid or future sources to a current value', async (patch) => {
    const { brief, timeline } = await getPatientOperationalView(database([observation(101, patch)]).client, actor, patient);
    expect(brief.latestLabs?.potassium).toMatchObject({ status: 'invalid', value: null });
    expect(brief.sourceDataAsOf).toBeNull();
    render(<PatientBrief brief={brief} />);
    expect(within(screen.getByLabelText('Potassium source')).getByText('Invalid — verify source')).toBeInTheDocument();
    expect(timeline[0].title).toContain('invalid — verify source');
    expect(timeline[0].detail).toContain('Recorded source value (not usable)');
    expect(timeline[0].status).toBe('invalid');
  });

  it('marks invalid non-summary analytes and conflicting same-instant sources in the timeline', async () => {
    const { timeline } = await getPatientOperationalView(database([
      observation(101, { analyte: 'bnp', value: '-1' }),
      observation(102, { analyte: 'sodium', value: '140' }),
      observation(103, { analyte: 'sodium', value: '141' }),
    ]).client, actor, patient);
    expect(timeline).toHaveLength(3);
    expect(timeline.every((event) => event.status === 'invalid')).toBe(true);
    expect(timeline.filter((event) => event.title.startsWith('Sodium')).every((event) => event.detail.includes('Conflicting current sources'))).toBe(true);
  });

  it('orders summary and timeline by instant rather than ISO spelling, retaining microseconds', async () => {
    const sameSecond = observation(101, { collected_at: '2026-09-28T12:00:00Z' });
    const oneMicroLater = observation(102, { analyte: 'creatinine', collected_at: '2026-09-28T12:00:00.000001Z' });
    const earlierOffset = observation(103, { analyte: 'egfr', collected_at: '2026-09-28T14:00:00+03:00' });
    const { brief, timeline } = await getPatientOperationalView(database([sameSecond, oneMicroLater, earlierOffset]).client, actor, patient);
    expect(brief.sourceDataAsOf).toBe(oneMicroLater.collected_at);
    expect(timeline.map((item) => item.occurredAt)).toEqual([oneMicroLater.collected_at, sameSecond.collected_at, earlierOffset.collected_at]);
  });

  it.each([
    { patient_id: id(9) }, { collected_at: 'invalid' }, { value: 'NaN' },
  ])('rejects malformed or cross-patient source DTOs without exposing a partial timeline', async (patch) => {
    const { brief, timeline } = await getPatientOperationalView(database([observation(101, patch)]).client, actor, patient);
    expect(brief.labsUnavailable).toBe(true); expect(brief.latestLabs).toBeNull();
    expect(timeline.filter((item) => item.type === 'lab')).toEqual([]);
  });
});
