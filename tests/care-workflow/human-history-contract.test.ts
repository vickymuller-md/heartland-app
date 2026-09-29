import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { careWorkflowDetailSchema, careWorkflowTimeline } from '@/lib/care-workflow/step-types';
const id = (n: number) => `ab000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-09-29T12:00:00.123456Z', due = '2026-10-01T12:00:00Z';
const common = { occurred_at: at, evidence: 'Synthetic source evidence', next_action: 'Review missing evidence', next_review_at: due };
const basis = { kind: 'laboratory_order', composition_event_id: id(30), operational_event: null,
  sources: [ { analyte: 'egfr', entry_id: id(50), root_id: null, authority_organization_id: null, original_lab_result_id: null,
    observed_version_id: null, head: null, evaluation_status: null, quality: 'missing' },
  { analyte: 'potassium', entry_id: id(51), root_id: id(40), authority_organization_id: id(3), original_lab_result_id: id(60),
    observed_version_id: id(70), head: { version_id: id(71), revision: '2', status: 'corrected', effective_lab_result_id: id(61), value: '4.20', collected_at: at },
    evaluation_status: 'pending', quality: 'available' } ],
  processing: [{ lab_result_id: id(61), evaluation: { event_id: id(80), status: 'pending', completed_at: null, source_assessment: null } }] };
const composition = { id: id(30), revision: '2', ownership_revision: '1', actor_id: id(1), from_stage: 'requested', to_stage: 'result_received',
  occurred_at: at, recorded_at: at, payload: { ...common, reason: 'Exact source selection', sources: [
    { analyte: 'egfr', root_id: null, expected_root_revision: null }, { analyte: 'potassium', root_id: id(40), expected_root_revision: '1' } ], intent_resolutions: [] },
  receipt: { request_id: id(20), work_item_id: id(5), event_id: id(30), previous_event_id: null, workflow_revision: '2', ownership_revision: '1',
    stage: 'result_received', recorded_at: at, due_at: due, sources: [{ analyte: 'egfr', root_id: null, observed_head: null },
      { analyte: 'potassium', root_id: id(40), observed_head: { version_id: id(70), revision: '1', status: 'original', effective_lab_result_id: id(60), value: '4.60', collected_at: at } }],
    intent_resolutions: [], clinical_review_recorded: false, communication_confirmed: false, care_completed: false } };
function human(revision: number, command = 'record_review', details: Record<string, unknown> = { decision: 'Synthetic human decision', limitations: 'Partial panel remains partial' }) {
  return { id: id(100 + revision), revision: String(revision), ownership_revision: '1', actor_id: id(1), from_stage: 'result_received', to_stage: 'result_received',
    occurred_at: at, recorded_at: at,
    request: { request_id: id(200 + revision), actor_id: id(1), organization_id: id(3), patient_id: id(2), work_item_id: id(5),
      expected_revision: String(revision - 1), expected_ownership_revision: '1', recorded_at: at,
      command, payload: { ...common, details }, basis, basis_signature: 'a'.repeat(64) },
    receipt: { request_id: id(200 + revision), work_item_id: id(5), event_id: id(100 + revision), command, workflow_revision: String(revision), ownership_revision: '1',
      stage: 'result_received', recorded_at: at, basis, basis_signature: 'a'.repeat(64), exception_id: details.exception_id ?? null, due_at: due,
      clinical_review_recorded: command === 'record_review', addresses_current_review: details.review_addressed ?? false,
      communication_confirmed: false, care_completed: false } };
}
const contact = { channel: 'phone', recipient_type: 'patient', recipient_reference: 'Synthetic recipient', outcome: 'no_answer',
  review_event_id: null, review_addressed: false, exception_id: id(300), reason: 'Documented no answer' };
const addressed = { ...contact, outcome: 'human_reached', review_event_id: id(103), review_addressed: true, exception_id: null, reason: null };
const detail = { work_item_id: id(5), patient_id: id(2), organization_id: id(3), assigned_to: id(99), accepted_by: id(99), accepted_at: at,
  transfer_pending_to: null, ownership_revision: '9007199254740993', due_at: due, kind: 'laboratory_order', stage: 'result_received', revision: '5',
  requested_analytes: ['potassium', 'egfr'], request: { kind: 'laboratory_order', source: 'external_documented', purpose: 'Synthetic follow-up',
    evidence: 'Original request', occurred_at: at, next_review_at: due, analytes: ['potassium', 'egfr'] },
  events: [{ id: id(9), actor_id: id(1), revision: '1', event_type: 'request_recorded', occurred_at: at, recorded_at: at }],
  next_action: common.next_action, next_review_at: due, work_status: 'awaiting', steps: [], compositions: [composition],
  humans: [human(3), human(4, 'record_contact', contact), human(5, 'record_contact', addressed)],
  exceptions: [{ id: id(300), origin_event_id: null, human_origin_event_id: id(104), code: 'no_answer', reason: contact.reason,
    next_action: common.next_action, next_review_at: due, recorded_at: at }] };

describe('shared immutable human journal', () => {
  it('accepts exact corrected evidence after linking, and preserves earlier author after transfer', () => {
    const parsed = careWorkflowDetailSchema.parse(detail);
    expect(parsed).toEqual(detail);
    expect(careWorkflowTimeline(parsed).map((row) => [row.kind, row.revision])).toEqual([
      ['composition', '2'], ['human', '3'], ['human', '4'], ['human', '5'],
    ]);
    expect(parsed.humans[0].request.basis.sources[1].head?.value).toBe('4.20');
    expect(parsed.compositions[0].receipt.sources[1].observed_head?.value).toBe('4.60');
  });
  it.each([{ humans: undefined }, { humans: [] }, { humans: detail.humans.slice(1) }, { humans: [...detail.humans, detail.humans[0]] },
    { compositions: [] }, { revision: '4' }, { revision: 'bad' }, { exceptions: [] },
    { humans: [{ ...detail.humans[0], id: id(30) }, ...detail.humans.slice(1)] }])('rejects incomplete or duplicate human chain %#', (change) => {
    expect(careWorkflowDetailSchema.safeParse({ ...detail, ...change }).success).toBe(false);
  });
  it.each([{ human_origin_event_id: null }, { human_origin_event_id: id(103) }, { human_origin_event_id: id(999) },
    { origin_event_id: id(30) }, { id: id(999) }, { code: 'refused' }, { reason: 'Changed reason' },
    { next_action: 'Changed action' }, { next_review_at: '2026-10-02T12:00:00Z' }])('rejects mismatched human barrier %#', (change) => {
    expect(careWorkflowDetailSchema.safeParse({ ...detail, exceptions: [{ ...detail.exceptions[0], ...change }] }).success).toBe(false);
  });
  it.each([{ actor_id: id(99) }, { revision: '99' }, { revision: 'bad' }, { ownership_revision: '2' }, { from_stage: 'requested' },
    { occurred_at: '2026-09-29T12:00:00.123455Z' }, { recorded_at: '2026-09-29T12:00:00.123455Z' }])('rejects altered human event %#', (change) => {
    expect(careWorkflowDetailSchema.safeParse({ ...detail, humans: [{ ...detail.humans[0], ...change }, ...detail.humans.slice(1)] }).success).toBe(false);
  });
  it.each([{ patient_id: id(99) }, { organization_id: id(99) }, { work_item_id: id(99) }, { expected_revision: '1' },
    { acknowledged_at: at }, { state: 'applied' }, { recorded_at: 'invalid' }])('rejects mismatched or private recovery request projection %#', (change) => {
    expect(careWorkflowDetailSchema.safeParse({ ...detail, humans: [{ ...detail.humans[0], request: { ...detail.humans[0].request, ...change } }, ...detail.humans.slice(1)] }).success).toBe(false);
  });
  it.each([{ composition_event_id: id(999) }, { sources: basis.sources.slice(1) },
    { sources: [basis.sources[0], { ...basis.sources[1], root_id: id(999) }] },
    { sources: [basis.sources[0], { ...basis.sources[1], observed_version_id: id(999) }] }])('rejects human basis unrelated to preceding composition %#', (change) => {
    const b = { ...basis, ...change }, first = detail.humans[0];
    expect(careWorkflowDetailSchema.safeParse({ ...detail, humans: [{ ...first, request: { ...first.request, basis: b }, receipt: { ...first.receipt, basis: b } }, ...detail.humans.slice(1)] }).success).toBe(false);
  });
  it('requires qualified contact to address the latest preceding review, not a future or foreign event', () => {
    for (const reference of [id(106), id(999), id(104)]) {
      expect(careWorkflowDetailSchema.safeParse({ ...detail, humans: [...detail.humans.slice(0, 2), human(5, 'record_contact', { ...addressed, review_event_id: reference })] }).success).toBe(false);
    }
    const newer = { ...detail, revision: '7', humans: [...detail.humans, human(6), human(7, 'record_contact', addressed)] };
    expect(careWorkflowDetailSchema.safeParse(newer).success).toBe(false);
    expect(careWorkflowDetailSchema.safeParse({ ...newer, humans: [...newer.humans.slice(0, -1), human(7, 'record_contact', { ...addressed, review_addressed: false })] }).success).toBe(true);
  });
  it('rejects a human head that predates the version observed at association', () => {
    const comp = structuredClone(composition);
    comp.payload.sources[1].expected_root_revision = '3';
    comp.receipt.sources[1].observed_head = { version_id: id(70), revision: '3', status: 'corrected', effective_lab_result_id: id(62), value: '4.80', collected_at: at };
    expect(careWorkflowDetailSchema.safeParse({ ...detail, compositions: [comp] }).success).toBe(false);
  });
  it('rejects conflicting identities for the same root revision in association and human evidence', () => {
    const comp = structuredClone(composition);
    comp.payload.sources[1].expected_root_revision = '2';
    comp.receipt.sources[1].observed_head = { version_id: id(70), revision: '2', status: 'corrected', effective_lab_result_id: id(61), value: '4.80', collected_at: at };
    expect(careWorkflowDetailSchema.safeParse({ ...detail, compositions: [comp] }).success).toBe(false);
  });
  it.each(['value', 'collected_at'])('rejects changed immutable source %s with identical version and revision', (key) => {
    const value = structuredClone(detail), comp = value.compositions[0];
    comp.payload.sources[1].expected_root_revision = '2';
    comp.receipt.sources[1].observed_head = { ...value.humans[0].request.basis.sources[1].head!,
      [key]: key === 'value' ? '4.80' : '2026-09-29T12:00:00.123455Z' };
    for (const event of value.humans) {
      event.request.basis.sources[1].observed_version_id = id(71);
      event.receipt.basis.sources[1].observed_version_id = id(71);
    }
    expect(careWorkflowDetailSchema.safeParse(value).success).toBe(false);
  });
  it('rejects a later review reverting below a source version already seen by an earlier human', () => {
    const next = structuredClone(human(6));
    const old = { ...next.request.basis, sources: [basis.sources[0], { ...basis.sources[1],
      head: composition.receipt.sources[1].observed_head! }],
      processing: [{ ...basis.processing[0], lab_result_id: id(60) }] };
    next.request.basis = next.receipt.basis = old;
    expect(careWorkflowDetailSchema.safeParse({ ...detail, revision: '6', humans: [...detail.humans, next] }).success).toBe(false);
  });
  it('requires the same exact review basis for a qualified contact, despite matching workflow identity', () => {
    const last = structuredClone(detail.humans[2]);
    last.request.basis_signature = last.receipt.basis_signature = 'b'.repeat(64);
    expect(careWorkflowDetailSchema.safeParse({ ...detail, humans: [...detail.humans.slice(0, 2), last] }).success).toBe(false);
  });
  it('accepts reordered arrays by revision but rejects a contact occurrence before its addressed review', () => {
    expect(careWorkflowDetailSchema.safeParse({ ...detail, humans: [...detail.humans].reverse() }).success).toBe(true);
    const last = structuredClone(detail.humans[2]);
    last.occurred_at = last.request.payload.occurred_at = '2026-09-29T12:00:00.123455Z';
    expect(careWorkflowDetailSchema.safeParse({ ...detail, humans: [...detail.humans.slice(0, 2), last] }).success).toBe(false);
  });
});
if (process.env.HEARTLAND_HUMAN_PROOF_DIR) describe('actual human history SQL projections', () => {
  it('decodes shared history captured by the concurrency rehearsal', () => {
    let count = 0; const kinds = new Set<string>();
    for (const file of readdirSync(process.env.HEARTLAND_HUMAN_PROOF_DIR!).filter((name) => name.endsWith('.stdout'))) {
      for (const match of readFileSync(join(process.env.HEARTLAND_HUMAN_PROOF_DIR!, file), 'utf8').matchAll(/^HISTORY:(.*)$/gm)) {
        const parsed = careWorkflowDetailSchema.safeParse(JSON.parse(match[1]));
        expect(parsed.success, file).toBe(true); if (parsed.success) kinds.add(parsed.data.kind); count++;
      }
    }
    expect(count).toBeGreaterThanOrEqual(4);
    expect([...kinds].sort()).toEqual(['laboratory_order', 'medication_access', 'referral']);
  });
});
