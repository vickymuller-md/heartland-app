import { describe, expect, it } from 'vitest';
import { availableCareCommands, careStepStateSchema, careWorkflowDetailSchema, careWorkflowTimeline } from '@/lib/care-workflow/step-types';

const id = (n: number) => `ab000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-09-29T12:00:00.123456Z';
const due = '2026-10-01T12:00:00Z';
const payload = { occurred_at: '2026-09-29T08:00:00.123456-04:00', next_review_at: due, next_action: 'Review missing evidence',
  evidence: '  Source evidence  ', reason: 'Exact documented source', sources: [
    { analyte: 'egfr', root_id: null, expected_root_revision: null },
    { analyte: 'potassium', root_id: id(40), expected_root_revision: '1' },
  ], intent_resolutions: [] };
const receipt = { request_id: id(20), work_item_id: id(5), event_id: id(30), previous_event_id: null,
  workflow_revision: '3', ownership_revision: '1', stage: 'result_received', recorded_at: at, due_at: due,
  sources: [{ analyte: 'egfr', root_id: null, observed_head: null }, { analyte: 'potassium', root_id: id(40), observed_head: {
    version_id: id(50), revision: '1', status: 'original', effective_lab_result_id: id(60), value: '4.60', collected_at: at } }],
  intent_resolutions: [], clinical_review_recorded: false, communication_confirmed: false, care_completed: false };
const composition = { id: id(30), revision: '3', ownership_revision: '1', actor_id: id(1), from_stage: 'collected', to_stage: 'result_received',
  occurred_at: at, recorded_at: at, payload, receipt };
const stepPayload = { occurred_at: at, next_review_at: due, next_action: 'Review next evidence', evidence: 'Synthetic source', details: {} };
const step = { id: id(10), actor_id: id(1), revision: '2', ownership_revision: '1', from_stage: 'requested', to_stage: 'collected',
  occurred_at: at, recorded_at: at, command: 'record_collection', payload: stepPayload };
const barrier = { ...step, id: id(11), revision: '4', from_stage: 'result_received', to_stage: 'result_received', command: 'record_exception',
  payload: { ...stepPayload, details: { exception_id: id(12), code: 'report_missing', reason: 'Synthetic missing report' } } };
const unlink = { ...composition, id: id(31), revision: '5', from_stage: 'result_received',
  payload: { ...payload, sources: payload.sources.map((row) => ({ ...row, root_id: null, expected_root_revision: null })) },
  receipt: { ...receipt, request_id: id(21), event_id: id(31), previous_event_id: id(30), workflow_revision: '5',
    sources: receipt.sources.map((row) => ({ ...row, root_id: null, observed_head: null })) } };
const detail = { work_item_id: id(5), patient_id: id(2), organization_id: id(3), assigned_to: id(99), accepted_by: id(99), accepted_at: at,
  transfer_pending_to: null, ownership_revision: '9007199254740993', due_at: due, kind: 'laboratory_order', stage: 'result_received', revision: '5',
  requested_analytes: ['potassium', 'egfr'], request: { kind: 'laboratory_order', source: 'external_documented', purpose: 'Synthetic follow-up',
    evidence: 'Original request', occurred_at: at, next_review_at: due, analytes: ['potassium', 'egfr'] },
  events: [{ id: id(9), actor_id: id(1), revision: '1', event_type: 'request_recorded', occurred_at: at, recorded_at: at }],
  next_action: 'Review missing evidence', next_review_at: due, work_status: 'new', steps: [step, barrier], compositions: [composition, unlink], humans: [],
  exceptions: [{ id: id(12), origin_event_id: id(11), human_origin_event_id: null, code: 'report_missing', reason: 'Synthetic missing report', next_action: 'Review next evidence', next_review_at: due, recorded_at: at }] };

describe('mixed operational and laboratory composition history', () => {
  it('merges the complete chain without equating historical actors/ownership to the current owner', () => {
    const decoded = careWorkflowDetailSchema.parse(detail);
    expect(decoded).toEqual(detail);
    expect(careWorkflowTimeline(decoded).map((item) => [item.kind, item.revision])).toEqual([
      ['step', '2'], ['composition', '3'], ['step', '4'], ['composition', '5'],
    ]);
    expect(decoded.compositions[0].payload.occurred_at).toBe(payload.occurred_at);
    expect(decoded.requested_analytes).toEqual(['potassium', 'egfr']);
  });
  it.each([{ compositions: undefined }, { compositions: [] }, { compositions: [composition] }, { steps: [step] },
    { revision: '4' }, { revision: 'bad' }, { stage: 'collected' }, { steps: [step, { ...barrier, revision: '3' }] },
    { steps: [step, { ...barrier, id: id(30).toUpperCase() }] }, { compositions: [composition, { ...unlink, receipt: { ...unlink.receipt, previous_event_id: id(11) } }] },
    { exceptions: [{ ...detail.exceptions[0], origin_event_id: id(30) }] }])('refuses incomplete, duplicated or inconsistent mixed detail %#', (change) => {
    expect(careWorkflowDetailSchema.safeParse({ ...detail, ...change }).success).toBe(false);
  });
  it.each([{ id: id(999) }, { revision: 'bad' }, { revision: '9007199254740993' }, { ownership_revision: '2' },
    { from_stage: 'requested' }, { to_stage: 'collected' }, { occurred_at: '2026-09-29T12:00:00.123455Z' },
    { recorded_at: '2026-09-29T12:00:00.123455Z' }, { receipt: { ...receipt, work_item_id: id(999) } },
    { receipt: { ...receipt, care_completed: true } }, { payload: { ...payload, sources: payload.sources.slice(1) }, receipt: { ...receipt, sources: receipt.sources.slice(1) } },
    { evidence: 'Unexpected field' }])('refuses altered composition projection %#', (change) => {
    expect(careWorkflowDetailSchema.safeParse({ ...detail, compositions: [{ ...composition, ...change }, unlink] }).success).toBe(false);
  });
  it('rejects a missing source pretending to remain received when the preceding stage was only collected', () => {
    const missing = { ...unlink, revision: '3', from_stage: 'collected', receipt: { ...unlink.receipt, workflow_revision: '3', previous_event_id: null } };
    expect(careWorkflowDetailSchema.safeParse({ ...detail, revision: '3', steps: [step], compositions: [missing], exceptions: [] }).success).toBe(false);
  });
  it('never admits laboratory compositions in referral or medication access history', () => {
    for (const kind of ['referral', 'medication_access']) expect(careWorkflowDetailSchema.safeParse({ ...detail, kind,
      request: { ...detail.request, kind, analytes: [] }, requested_analytes: [] }).success).toBe(false);
  });
  it('allows only an operational barrier after result_received, not a regressive collection', () => {
    expect(availableCareCommands('laboratory_order', 'result_received')).toEqual(['record_exception']);
    expect(careWorkflowDetailSchema.safeParse({ ...detail, steps: [step, { ...barrier, command: 'record_collection', to_stage: 'collected', payload: stepPayload }] }).success).toBe(false);
  });
  it('decodes a recoverable barrier receipt retaining result_received', () => {
    const value = { request_id: id(80), work_item_id: id(5), actor_id: id(1), organization_id: id(3), patient_id: id(2),
      expected_revision: '3', expected_ownership_revision: '1', command: barrier.command, payload: barrier.payload,
      state: 'applied', recorded_at: at, acknowledged_at: null, receipt: { request_id: id(80), work_item_id: id(5), event_id: id(11),
        workflow_revision: '4', ownership_revision: '1', stage: 'result_received', exception_id: id(12), due_at: due, recorded_at: at,
        clinical_review_recorded: false, communication_confirmed: false, care_completed: false } };
    expect(careStepStateSchema.parse(value)).toEqual(value);
  });
});
