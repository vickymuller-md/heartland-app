import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { humanContextSchema, humanInputSchema, humanStateSchema, humanInputFromState, humanMatches } from '@/lib/care-workflow/human-types';
import { careExceptionHistory, careWorkflowDetailSchema } from '@/lib/care-workflow/step-types';
const id = (n: number) => `ab000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-09-29T12:00:00.123456Z', recorded = '2026-09-29T12:01:00.123456Z', due = '2026-10-01T12:00:00Z';
const common = { occurred_at: at, evidence: 'Original synthetic barrier', next_action: 'Check remaining barriers', next_review_at: due };
const scope = { actor_id: id(1), organization_id: id(3), patient_id: id(2) };
const target = { exception_id: id(10), origin_event_id: id(11), human_origin_event_id: null, origin_revision: '2', origin_occurred_at: at,
  code: 'report_missing', reason: 'Documented missing report', next_action: common.next_action, next_review_at: due, recorded_at: recorded };
function fixture(kind: 'laboratory_order' | 'referral' | 'medication_access' = 'referral') {
  const basis = { kind, composition_event_id: null, operational_event: null, processing: [], sources: kind === 'laboratory_order' ? [{
    analyte: 'potassium', entry_id: null, root_id: null, authority_organization_id: null, original_lab_result_id: null,
    observed_version_id: null, head: null, evaluation_status: null, quality: 'missing',
  }] : [] };
  const input = { ...scope, request_id: id(20), work_item_id: id(5), command: 'resolve_exception', expected_revision: '2', expected_ownership_revision: '1',
    basis, basis_signature: 'a'.repeat(64), payload: { ...common, details: { exception: { ...target }, disposition: 'barrier_addressed', resolution_reason: 'Received requested information' } } };
  const receipt = { request_id: id(20), work_item_id: id(5), event_id: id(21), command: 'resolve_exception', workflow_revision: '3', ownership_revision: '1',
    stage: 'requested', recorded_at: recorded, basis, basis_signature: input.basis_signature, exception_id: null, resolved_exception_id: id(10),
    resolution_event_id: id(21), due_at: due, clinical_review_recorded: false, addresses_current_review: false, communication_confirmed: false, care_completed: false };
  const state = { ...input, state: 'applied', recorded_at: recorded, acknowledged_at: null, receipt };
  const context = { ...scope, work_item_id: id(5), workflow_revision: '2', ownership_revision: '1', kind, stage: 'requested',
    command: 'resolve_exception', basis, basis_signature: input.basis_signature, latest_review: null, exceptions: [{ ...target }] };
  const analytes = kind === 'laboratory_order' ? ['potassium'] : [];
  const detail = { work_item_id: id(5), patient_id: id(2), organization_id: id(3), assigned_to: id(99), accepted_by: id(99), accepted_at: at,
    transfer_pending_to: null, ownership_revision: '7', due_at: due, kind, stage: 'requested', revision: '3', requested_analytes: analytes,
    request: { kind, source: 'external_documented', purpose: 'Synthetic follow-up', evidence: 'Original request', occurred_at: at, next_review_at: due, analytes },
    events: [{ id: id(9), actor_id: id(1), revision: '1', event_type: 'request_recorded', occurred_at: at, recorded_at: at }],
    next_action: common.next_action, next_review_at: due, work_status: 'awaiting', compositions: [],
    steps: [{ id: id(11), actor_id: id(1), revision: '2', ownership_revision: '1', from_stage: 'requested', to_stage: 'requested',
      command: 'record_exception', payload: { ...common, details: { exception_id: id(10), code: target.code, reason: target.reason } }, occurred_at: at, recorded_at: at }],
    humans: [{ id: id(21), actor_id: id(1), revision: '3', ownership_revision: '1', from_stage: 'requested', to_stage: 'requested',
      occurred_at: at, recorded_at: recorded, request: { ...input, recorded_at: recorded }, receipt }],
    exceptions: [{ id: id(10), origin_event_id: id(11), human_origin_event_id: null, code: target.code, reason: target.reason,
      next_action: common.next_action, next_review_at: due, recorded_at: recorded }] };
  return { input, receipt, state, context, detail };
}
describe('exact exception resolution variants', () => {
  it.each(['laboratory_order', 'referral', 'medication_access'] as const)('accepts %s without inventing report or review evidence', (kind) => {
    const f = fixture(kind);
    expect(humanInputSchema.parse(f.input)).toEqual(f.input);
    expect(humanStateSchema.parse(f.state)).toEqual(f.state);
    expect(humanContextSchema.parse(f.context)).toEqual(f.context);
    const history = careWorkflowDetailSchema.parse(f.detail);
    expect(careExceptionHistory(history)).toEqual([{ exception: history.exceptions[0], resolution: history.humans[0] }]);
    expect(history.exceptions).toHaveLength(1); expect(history.stage).toBe('requested');
  });
  it.each(Object.keys(target))('rejects missing immutable target %s', (key) => {
    const f = fixture(); const snapshot: Record<string, unknown> = { ...target }; delete snapshot[key];
    expect(humanInputSchema.safeParse({ ...f.input, payload: { ...f.input.payload, details: { ...f.input.payload.details, exception: snapshot } } }).success).toBe(false);
  });
  it.each([{ origin_revision: '3' }, { origin_revision: 'NaN' }, { origin_revision: '9223372036854775808' }, { origin_revision: '1' },
    { origin_event_id: null }, { human_origin_event_id: id(99) }, { exception_id: null }, { code: 'completed' },
    { origin_occurred_at: '2026-09-29T12:00:00.123457Z' }, { recorded_at: 'invalid' }, { reason: '  ' }, { extra: true }])('rejects malformed or future origin %#', (change) => {
    const f = fixture(); f.input.payload.details.exception = { ...target, ...change } as typeof target;
    expect(humanInputSchema.safeParse(f.input).success).toBe(false);
  });
  it.each([{ resolved_exception_id: id(99) }, { resolution_event_id: id(99) }, { resolved_exception_id: undefined }, { resolution_event_id: undefined },
    { exception_id: id(10) }, { clinical_review_recorded: true }, { addresses_current_review: true }, { communication_confirmed: true }, { care_completed: true },
    { command: 'record_contact' }, { workflow_revision: '4' }, { stage: 'obtained' }])('rejects incorrect resolution receipt %#', (change) => {
    const f = fixture(); expect(humanStateSchema.safeParse({ ...f.state, receipt: { ...f.receipt, ...change } }).success).toBe(false);
  });
  it('keeps review/contact variants strict and does not add optional resolution fields', () => {
    const f = fixture();
    for (const command of ['record_review', 'record_contact']) {
      expect(humanContextSchema.safeParse({ ...f.context, command }).success).toBe(false);
      expect(humanStateSchema.shape.receipt.safeParse({ ...f.receipt, command }).success).toBe(false);
    }
  });
  it('accepts both dispositions and expires only fresh preparation, not frozen recovery', () => {
    for (const disposition of ['barrier_addressed', 'clinical_non_delivery']) {
      const f = fixture(); f.state.payload.details.disposition = disposition; f.state.payload.next_review_at = '2020-01-01T00:00:00Z';
      const state = humanStateSchema.parse(f.state);
      expect(humanMatches(state, humanInputFromState(state))).toBe(true);
    }
  });
  it('preserves bigint identity above JavaScript integer precision', () => {
    const f = fixture(); f.state.expected_revision = '9007199254740993'; f.state.receipt.workflow_revision = '9007199254740994';
    f.state.payload.details.exception.origin_revision = '9007199254740993';
    expect(humanStateSchema.safeParse(f.state).success).toBe(true);
  });
  it.each([{ exceptions: undefined }, { exceptions: [{ ...target, origin_revision: '3' }] }, { exceptions: [target, target] },
    { exceptions: [{ ...target, exception_id: id(99) }, target] },
    { exceptions: [{ ...target, exception_id: id(99), next_review_at: '2026-10-02T00:00:00Z' }, target] }])('rejects malformed open context %#', (change) => {
    expect(humanContextSchema.safeParse({ ...fixture().context, ...change }).success).toBe(false);
  });
  it('accepts an empty resolution context without treating it as closure', () => {
    expect(humanContextSchema.parse({ ...fixture().context, exceptions: [] }).command).toBe('resolve_exception');
  });
  it.each(['bad', '-1', '1.1', '9223372036854775808'])('fails closed without throwing on malformed revision %s in state/context', (revision) => {
    const f = fixture();
    expect(humanStateSchema.safeParse({ ...f.state, expected_revision: revision }).success).toBe(false);
    expect(humanContextSchema.safeParse({ ...f.context, workflow_revision: revision }).success).toBe(false);
    f.state.payload.details.exception.origin_revision = revision; f.context.exceptions[0].origin_revision = revision;
    expect(humanStateSchema.safeParse(f.state).success).toBe(false); expect(humanContextSchema.safeParse(f.context).success).toBe(false);
  });
});
describe('resolution causality in complete immutable history', () => {
  it.each([{ exception_id: id(99) }, { origin_event_id: id(99) }, { origin_revision: '1' }, { origin_revision: '3' },
    { origin_occurred_at: '2026-09-29T12:00:00.123455Z' }, { code: 'other' }, { reason: 'Changed reason' },
    { next_action: 'Changed action' }, { next_review_at: '2026-10-02T12:00:00Z' }, { recorded_at: at }])('rejects changed target snapshot %#', (change) => {
    const f = fixture(); f.detail.humans[0].request.payload.details.exception = { ...target, ...change };
    expect(careWorkflowDetailSchema.safeParse(f.detail).success).toBe(false);
  });
  it.each([{ code: 'other' }, { reason: 'Changed reason' }, { next_action: 'Changed next action' }, { next_review_at: at }])('requires operational barrier to agree with its origin %#', (change) => {
    const f = fixture(); Object.assign(f.detail.exceptions[0], change); Object.assign(f.detail.humans[0].request.payload.details.exception, change);
    expect(careWorkflowDetailSchema.safeParse(f.detail).success).toBe(false);
  });
  it('rejects missing/duplicated original barriers and preserves distinct origin and barrier timestamps', () => {
    const f = fixture(); expect(careWorkflowDetailSchema.safeParse(f.detail).success).toBe(true);
    expect(careWorkflowDetailSchema.safeParse({ ...f.detail, exceptions: [] }).success).toBe(false);
    expect(careWorkflowDetailSchema.safeParse({ ...f.detail, exceptions: [...f.detail.exceptions, { ...f.detail.exceptions[0], id: id(99) }] }).success).toBe(false);
  });
  it('rejects a second resolution of the same target even with valid new event and request identity', () => {
    const f = fixture(), next = structuredClone(f.detail.humans[0]);
    next.id = next.receipt.event_id = next.receipt.resolution_event_id = id(31);
    next.request.request_id = next.receipt.request_id = id(30); next.revision = next.receipt.workflow_revision = '4'; next.request.expected_revision = '3';
    expect(careWorkflowDetailSchema.safeParse({ ...f.detail, revision: '4', humans: [...f.detail.humans, next] }).success).toBe(false);
  });
  it('rejects a target created later despite internally consistent target data', () => {
    const f = fixture(); f.detail.steps[0].revision = '3'; f.detail.humans[0].revision = f.detail.humans[0].receipt.workflow_revision = '2';
    f.detail.humans[0].request.expected_revision = '1'; f.detail.humans[0].request.payload.details.exception.origin_revision = '3';
    expect(careWorkflowDetailSchema.safeParse(f.detail).success).toBe(false);
  });
  it('does not treat a pending resolution or a missing history entry as resolved', () => {
    const f = fixture(); const detail = careWorkflowDetailSchema.parse({ ...f.detail, revision: '2', humans: [] });
    expect(careExceptionHistory(detail)[0].resolution).toBeNull();
  });
  it('validates assistance denial with a generated barrier ID bidirectionally, without requiring an ID in the original command', () => {
    const f = fixture('medication_access'), origin = f.detail.steps[0];
    const exception = { ...f.detail.exceptions[0], origin_event_id: id(12), code: 'assistance_denied', reason: common.evidence };
    const event = f.detail.humans[0];
    const resolution = { ...event, revision: '4', from_stage: 'response_received', to_stage: 'response_received',
      request: { ...event.request, expected_revision: '3', payload: { ...event.request.payload, details: { ...event.request.payload.details,
        exception: { ...target, origin_event_id: id(12), origin_revision: '3', code: exception.code, reason: exception.reason } } } },
      receipt: { ...event.receipt, workflow_revision: '4', stage: 'response_received' } };
    const history = { ...f.detail, revision: '4', stage: 'response_received', exceptions: [exception], humans: [resolution], steps: [
      { ...origin, command: 'record_assistance_request', to_stage: 'assistance_requested', payload: { ...common, details: { assistance_program: 'Synthetic assistance', request_reference: 'Documented request' } } },
      { ...origin, id: id(12), revision: '3', command: 'record_assistance_response', from_stage: 'assistance_requested', to_stage: 'response_received',
        payload: { ...common, details: { outcome: 'denied', response_reference: 'Documented denial' } } },
    ] };
    expect(careWorkflowDetailSchema.parse(history)).toEqual(history);
    expect(careWorkflowDetailSchema.safeParse({ ...history, exceptions: [] }).success).toBe(false);
    expect(careWorkflowDetailSchema.safeParse({ ...history, exceptions: [exception, { ...exception, id: id(99) }] }).success).toBe(false);
    const wrong = structuredClone(history); wrong.exceptions[0].origin_event_id = wrong.humans[0].request.payload.details.exception.origin_event_id = id(11);
    wrong.humans[0].request.payload.details.exception.origin_revision = '2';
    expect(careWorkflowDetailSchema.safeParse(wrong).success).toBe(false);
    const changed = structuredClone(history); changed.exceptions[0].reason = changed.humans[0].request.payload.details.exception.reason = 'Changed evidence';
    expect(careWorkflowDetailSchema.safeParse(changed).success).toBe(false);
  });
});
if (process.env.HEARTLAND_HUMAN_PROOF_DIR) describe('actual local resolution SQL projections', () => {
  it('decodes all 42 laboratory projections after matching the six saved source hashes', () => {
    const dir = process.env.HEARTLAND_HUMAN_PROOF_DIR!;
    const proof = JSON.parse(readFileSync(join(dir, 'completion.json'), 'utf8')) as { all_ok: boolean; hashes: Record<string, string> };
    expect(proof.all_ok).toBe(true); expect(Object.keys(proof.hashes)).toHaveLength(6);
    for (const [file, hash] of Object.entries(proof.hashes)) expect(createHash('sha256').update(readFileSync(file)).digest('hex'), file).toBe(hash);
    const counts = { CONTEXT: 0, STATE: 0, TIMELINE: 0 };
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.stdout'))) {
      for (const match of readFileSync(join(dir, file), 'utf8').matchAll(/^RESOLVE_(CONTEXT|STATE|TIMELINE):(.*)$/gm)) {
        const kind = match[1] as keyof typeof counts;
        const parsed = (kind === 'CONTEXT' ? humanContextSchema : kind === 'STATE' ? humanStateSchema : careWorkflowDetailSchema).safeParse(JSON.parse(match[2]));
        expect(parsed.success, `${file}: ${parsed.success ? '' : parsed.error.message}`).toBe(true); counts[kind]++;
      }
    }
    expect(counts).toEqual({ CONTEXT: 20, STATE: 14, TIMELINE: 8 });
  });
});
