import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ authorize: vi.fn(), insert: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/auth/authorization', () => ({ authorizeProviderForPatient: mocks.authorize }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
import { saveTitrationNote } from '@/lib/integration/actions';
import { selectChecklistLabs } from '@/lib/integration/patient-selection';
import type { TitrationNoteData } from '@/lib/integration/types';
const actor = '71000000-0000-4000-8000-000000000001';
const patient = '71000000-0000-4000-8000-000000000002';
const resultId = '71000000-0000-4000-8000-000000000003';
function data(): TitrationNoteData {
  return { vitals: { sbp: 120, hr: 70, potassium: 4.2, creatinine: 1.1, egfr: null, creatinineBaseline: null },
    laboratorySnapshots: null, sourceReadAt: null, safetyGateResults: [{ parameter: 'Potassium', status: 'pass' }],
    titrationAction: { action: 'hold', details: 'Manually selected draft decision.' },
    providerNotes: 'Synthetic justification for the selected decision.', nextCallDate: '' };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockReset().mockResolvedValue({ authorized: true, user: { id: actor }, supabase: { from: (table: string) => {
    expect(table).toBe('provider_notes'); return { insert: mocks.insert };
  } } });
  mocks.insert.mockReset().mockResolvedValue({ error: null }); mocks.revalidate.mockReset();
});
describe('titration-note legacy write boundary', () => {
  it('requires expected actor and records only a draft note, not a care receipt', async () => {
    expect(await saveTitrationNote(patient, data(), actor)).toEqual({ success: true, outcome: 'saved' });
    expect(mocks.insert).toHaveBeenCalledWith({ patient_id: patient, provider_id: actor, content: expect.stringContaining('no imported laboratory source') });
    expect(mocks.revalidate).toHaveBeenCalledWith('/patients/' + patient);
  });
  it.each(['missing-actor', 'invalid-patient', 'different-actor', 'no-consent', 'no-mfa', 'unlinked'])('refuses %s before INSERT', async (kind) => {
    let expected = actor, target = patient;
    if (kind === 'missing-actor') expected = '';
    if (kind === 'invalid-patient') target = 'not-a-uuid';
    if (kind === 'different-actor') expected = patient;
    if (['no-consent', 'no-mfa', 'unlinked'].includes(kind)) mocks.authorize.mockResolvedValue({ authorized: false, error: 'Unauthorized' });
    const result = await saveTitrationNote(target, data(), expected);
    expect(result).toMatchObject({ success: false, outcome: 'not_saved' }); expect(mocks.insert).not.toHaveBeenCalled();
  });
  it.each(['null-lab', 'nonfinite', 'out-of-existing-range', 'extra-property', 'long-notes', 'oversized-complete-note'])('refuses %s before INSERT', async (kind) => {
    const draft = data();
    if (kind === 'null-lab') draft.vitals.potassium = null;
    if (kind === 'nonfinite') draft.vitals.sbp = NaN;
    if (kind === 'out-of-existing-range') draft.vitals.potassium = 1.0;
    if (kind === 'extra-property') Object.assign(draft, { approved: true });
    if (kind === 'long-notes') draft.providerNotes = 'N'.repeat(2001);
    if (kind === 'oversized-complete-note') draft.medicationChanges = Array.from({ length: 30 }, () => ({ name: 'N'.repeat(150), fromDose: '10mg', toDose: '20mg' }));
    expect(await saveTitrationNote(patient, draft, actor)).toMatchObject({ success: false, outcome: 'not_saved' });
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it('preserves distinct imported precision/cohort date and manually entered value as declared, not verified-current', async () => {
    const draft = data(); draft.sourceReadAt = '2026-09-29T12:00:00Z';
    draft.laboratorySnapshots = selectChecklistLabs([{
      id: resultId + ':potassium', patient_id: patient, original_lab_result_id: resultId, analyte: 'potassium', root_id: null, version_id: null,
      revision: null, status: 'original', effective_lab_result_id: resultId, value: '4.20000000000000001',
      collected_at: '2026-09-20T12:00:00.000001Z', notes: null, lab_facility: null, evaluation_status: 'pending',
    }], patient, new Date('2026-09-29T12:00:00Z'));
    expect(await saveTitrationNote(patient, draft, actor)).toMatchObject({ success: true });
    const content = mocks.insert.mock.calls[0][0].content;
    expect(content).toContain('form value 4.2'); expect(content).toContain('4.20000000000000001');
    expect(content).toContain('2026-09-20T12:00:00.000001Z'); expect(content).toContain('client-declared snapshots');
    expect(content).toContain('not server-verified current revisions'); expect(content).toContain(resultId);
  });
  it('rejects imported observations from a different patient', async () => {
    const draft = data(); draft.sourceReadAt = '2026-09-29T12:00:00Z';
    draft.laboratorySnapshots = selectChecklistLabs([{
      id: resultId + ':potassium', patient_id: actor, original_lab_result_id: resultId, analyte: 'potassium', root_id: null, version_id: null,
      revision: null, status: 'original', effective_lab_result_id: resultId, value: '4.2', collected_at: '2026-09-20T12:00:00Z',
      notes: null, lab_facility: null, evaluation_status: null,
    }], actor);
    expect(await saveTitrationNote(patient, draft, actor)).toMatchObject({ success: false, outcome: 'not_saved' });
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it.each(['returned-error', 'thrown-error', 'lost-revalidation'])('reports %s after dispatch as unknown, never invites automatic retry', async (kind) => {
    if (kind === 'returned-error') mocks.insert.mockResolvedValue({ error: new Error('Private error') });
    if (kind === 'thrown-error') mocks.insert.mockRejectedValue(new Error('Private error'));
    if (kind === 'lost-revalidation') mocks.revalidate.mockImplementation(() => { throw new Error('Private error'); });
    const result = await saveTitrationNote(patient, data(), actor);
    expect(result).toMatchObject({ success: false, outcome: 'unknown' }); expect(result.error).toContain('may have been saved');
    expect(result.error).not.toContain('Private'); expect(mocks.insert).toHaveBeenCalledOnce();
  });
  it('reports authorization failure before dispatch as not_saved', async () => {
    mocks.authorize.mockRejectedValue(new Error('Private auth error'));
    expect(await saveTitrationNote(patient, data(), actor)).toMatchObject({ success: false, outcome: 'not_saved' });
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
