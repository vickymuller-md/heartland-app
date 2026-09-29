import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { humanContextSchema, humanInputSchema, humanStateSchema, humanInputFromState, humanMatches, closureReady, validateNewHumanInput } from '@/lib/care-workflow/human-types';
import { careWorkflowDetailSchema } from '@/lib/care-workflow/step-types';
const id = (n: number) => `ab000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const time = (n: number) => `2026-09-29T12:0${n}:00.123456Z`, due = '2026-10-01T12:00:00Z';
function sourceFixture() {
  const scope = { actor_id: id(1), patient_id: id(2), organization_id: id(3) };
  const common = { occurred_at: time(4), evidence: 'Synthetic source evidence', next_action: 'Review outstanding evidence', next_review_at: due };
  const original = { version_id: id(44), revision: '1', status: 'original', effective_lab_result_id: id(43), value: '4.6', collected_at: time(0) };
  const head = { ...original, version_id: id(46), revision: '2', status: 'corrected', effective_lab_result_id: id(47), value: '4.2' };
  const basis = { kind: 'laboratory_order', composition_event_id: id(40), operational_event: null,
    sources: [{ analyte: 'potassium', entry_id: id(41), root_id: id(42), authority_organization_id: id(3), original_lab_result_id: id(43),
      observed_version_id: id(44), head, evaluation_status: null, quality: 'available' }], processing: [{ lab_result_id: id(47), evaluation: null }] };
  const target = { invalidation_id: id(50), entry_id: id(41), composition_event_id: id(40), composition_revision: '2', analyte: 'potassium',
    root_id: id(42), observed_version_id: id(44), change_version_id: id(46), change_revision: '2', change_status: 'corrected',
    change_recorded_at: time(1), recorded_at: time(2), head, head_recorded_at: '2026-09-29T12:01:00.123455Z' };
  const input = { ...scope, request_id: id(60), work_item_id: id(5), expected_revision: '4', expected_ownership_revision: '1',
    command: 'resolve_source_invalidation', basis, basis_signature: 'a'.repeat(64), payload: { ...common, details: {
      invalidation: target, review_event_id: id(70), contact_event_id: id(71), disposition: 'retained_in_current_composition',
      resolution_reason: 'Corrected source explicitly reconciled', source_reviewed: true, change_addressed_in_contact: true,
      source_review_evidence: 'Reviewed this exact correction', source_communication_evidence: 'Discussed this exact correction' } } };
  const receipt = { request_id: id(60), work_item_id: id(5), event_id: id(72), command: input.command, workflow_revision: '5', ownership_revision: '1',
    stage: 'result_received', recorded_at: time(4), basis, basis_signature: input.basis_signature, exception_id: null, due_at: due,
    clinical_review_recorded: false, addresses_current_review: false, communication_confirmed: false, care_completed: false,
    resolved_invalidation_id: id(50), resolution_event_id: id(72), source_review_attested: true, source_contact_attested: true };
  const state = { ...input, state: 'applied', recorded_at: time(4), acknowledged_at: null, receipt };
  const context = { ...scope, work_item_id: id(5), workflow_revision: '4', ownership_revision: '1', kind: 'laboratory_order', stage: 'result_received',
    command: input.command, basis, basis_signature: input.basis_signature, invalidation: target,
    latest_review: { event_id: id(70), actor_id: id(1), revision: '3', occurred_at: time(3), recorded_at: time(3),
      basis_signature: input.basis_signature, is_current: true, decision: 'Synthetic decision on partial evidence' },
    contact: { event_id: id(71), actor_id: id(1), revision: '4', occurred_at: time(3), recorded_at: time(3), review_event_id: id(70),
      basis_signature: input.basis_signature, channel: 'phone', recipient_type: 'patient', recipient_reference: 'Synthetic recipient' } };
  const human = (command: string, n: number, rev: string, details: unknown) => ({ id: id(n), actor_id: id(1), revision: rev, ownership_revision: '1',
    from_stage: 'result_received', to_stage: 'result_received', occurred_at: time(3), recorded_at: time(3),
    request: { ...input, request_id: id(n + 100), command, expected_revision: String(BigInt(rev) - BigInt(1)), recorded_at: time(3), payload: { ...common, occurred_at: time(3), details } },
    receipt: { request_id: id(n + 100), work_item_id: id(5), event_id: id(n), command, workflow_revision: rev, ownership_revision: '1',
      stage: 'result_received', recorded_at: time(3), basis, basis_signature: input.basis_signature, exception_id: null, due_at: due,
      clinical_review_recorded: command === 'record_review', addresses_current_review: command === 'record_contact', communication_confirmed: false, care_completed: false } });
  const detail = { work_item_id: id(5), patient_id: id(2), organization_id: id(3), assigned_to: id(1), accepted_by: id(1), accepted_at: time(0),
    transfer_pending_to: null, ownership_revision: '1', due_at: due, kind: 'laboratory_order', stage: 'result_received', revision: '5',
    requested_analytes: ['potassium'], request: { kind: 'laboratory_order', source: 'external_documented', purpose: 'Synthetic follow-up',
      evidence: 'Original evidence', occurred_at: time(0), next_review_at: due, analytes: ['potassium'] },
    events: [{ id: id(9), actor_id: id(1), revision: '1', event_type: 'request_recorded', occurred_at: time(0), recorded_at: time(0) }],
    next_action: common.next_action, next_review_at: due, work_status: 'awaiting', steps: [], exceptions: [],
    compositions: [{ id: id(40), actor_id: id(1), revision: '2', ownership_revision: '1', from_stage: 'requested', to_stage: 'result_received',
      occurred_at: time(0), recorded_at: time(0), payload: { ...common, occurred_at: time(0), reason: 'Initial source association',
        sources: [{ analyte: 'potassium', root_id: id(42), expected_root_revision: '1' }], intent_resolutions: [] },
      receipt: { request_id: id(90), work_item_id: id(5), event_id: id(40), previous_event_id: null, workflow_revision: '2', ownership_revision: '1',
        stage: 'result_received', recorded_at: time(0), due_at: due, sources: [{ analyte: 'potassium', root_id: id(42), observed_head: original }],
        intent_resolutions: [], clinical_review_recorded: false, communication_confirmed: false, care_completed: false } }],
    humans: [human('record_review', 70, '3', { decision: context.latest_review.decision, limitations: 'Partial evidence remains' }),
      human('record_contact', 71, '4', { channel: 'phone', recipient_type: 'patient', recipient_reference: 'Synthetic recipient', outcome: 'human_reached',
        review_event_id: id(70).toUpperCase(), review_addressed: true, exception_id: null, reason: null }),
      { id: id(72), actor_id: id(1), revision: '5', ownership_revision: '1', from_stage: 'result_received', to_stage: 'result_received',
        occurred_at: time(4), recorded_at: time(4), request: { ...input, recorded_at: time(4) }, receipt }] };
  return { input, state, context, detail, target };
}
function fixture(success = true) {
  const f = sourceFixture();
  const basis = { ...f.input.basis, sources: f.input.basis.sources.map((row) => ({ ...row, evaluation_status: 'not_required' })),
    processing: [{ lab_result_id: id(47), evaluation: { event_id: id(180), status: 'not_required', completed_at: time(2), source_assessment: null } }] };
  for (const h of f.detail.humans) { h.request.basis = basis; h.receipt.basis = basis; }
  const snapshot = { exceptions: [], invalidations: [], known_invalidation_ids: [id(50)], prepared_intents: [] };
  const input = { ...f.input, basis, request_id: id(200), expected_revision: '5', command: success ? 'close_success' : 'close_without_completion',
    payload: { occurred_at: time(5), evidence: 'Synthetic closure evidence', details: { snapshot, outcome: 'Documented synthetic outcome',
      ...(success ? { review_event_id: id(70), contact_event_id: id(71), workflow_completed: true, review_contact_accepted: true }
        : { disposition: 'not_performed', reason: 'Documented non-delivery rationale', declarations: [] }) } } };
  const receipt = { request_id: id(200), work_item_id: id(5), event_id: id(201), command: input.command,
    workflow_revision: '6', ownership_revision: '1', stage: 'result_received', recorded_at: time(5), basis, basis_signature: input.basis_signature,
    work_closed: true, closed_at: time(5), clinical_review_recorded: false, addresses_current_review: false, communication_confirmed: false,
    care_completed: success, completion_outcome: success ? 'documented_workflow_completion' : 'not_performed' };
  const state = { ...input, state: 'applied', recorded_at: time(5), acknowledged_at: null, receipt };
  const { invalidation: _target, ...previousContext } = f.context;
  const context = { ...previousContext, command: input.command, basis, workflow_revision: '5', snapshot };
  const event = { id: id(201), actor_id: id(1), revision: '6', ownership_revision: '1', from_stage: 'result_received', to_stage: 'result_received',
    occurred_at: time(5), recorded_at: time(5), request: { ...input, recorded_at: time(5) }, receipt };
  return { input, state, context, snapshot, detail: { ...f.detail, work_status: 'closed', revision: '6', humans: [...f.detail.humans, event] } };
}
function unresolvedFixture() {
  const f = fixture(false), target = sourceFixture().target;
  f.detail.humans.splice(2, 1); f.detail.revision = '5';
  f.input.expected_revision = f.state.expected_revision = '4'; f.context.workflow_revision = '4';
  f.state.receipt.workflow_revision = '5'; f.detail.humans.at(-1)!.revision = '5';
  f.detail.humans.at(-1)!.request.expected_revision = '4';
  Object.assign(f.snapshot, { invalidations: [target] });
  Object.assign(f.input.payload.details, { declarations: [{ target_type: 'source_invalidation', target_id: target.invalidation_id,
    reason: 'Exact source change retained without delivery', non_delivery_acknowledged: true }] });
  return f;
}
describe('explicit closure contract', () => {
  it.each([true, false])('decodes complete historical baseline and explicit outcome success=%s', (success) => {
    const f = fixture(success);
    expect(humanInputSchema.parse(f.input)).toEqual(f.input); expect(humanStateSchema.parse(f.state)).toEqual(f.state);
    expect(closureReady(humanContextSchema.parse(f.context))).toBe(true);
    expect(careWorkflowDetailSchema.parse(f.detail)).toEqual(f.detail);
    expect(validateNewHumanInput(f.input, Date.parse(time(6)))).toEqual(f.input);
  });
  it.each(['occurred_at', 'evidence', 'details'])('requires closure payload field %s', (key) => {
    const f = fixture(); delete (f.input.payload as Record<string, unknown>)[key]; expect(humanInputSchema.safeParse(f.input).success).toBe(false);
  });
  it.each(['snapshot', 'outcome', 'review_event_id', 'contact_event_id', 'workflow_completed', 'review_contact_accepted'])('requires successful closure detail %s', (key) => {
    const f = fixture(); delete (f.input.payload.details as Record<string, unknown>)[key]; expect(humanInputSchema.safeParse(f.input).success).toBe(false);
  });
  it.each([{ workflow_completed: false }, { review_contact_accepted: false }, { workflow_completed: 'true' }, { outcome: ' ' },
    { contact_event_id: id(70) }, { review_event_id: null }, { extra: true }])('rejects implicit or inconsistent closure %#', (change) => {
    const f = fixture(); Object.assign(f.input.payload.details, change); expect(humanStateSchema.safeParse(f.state).success).toBe(false);
  });
  it.each([{ next_action: 'Invented obligation' }, { next_review_at: due }, { details: {} }])('forbids inherited closure follow-up fields %#', (change) => {
    const f = fixture(); Object.assign(f.input.payload, change); expect(humanInputSchema.safeParse(f.input).success).toBe(false);
  });
  it.each([{ closed_at: '2026-09-29T12:05:00.123455Z' }, { care_completed: false }, { completion_outcome: 'transferred' },
    { work_closed: false }, { communication_confirmed: true }, { clinical_review_recorded: true }, { addresses_current_review: true },
    { due_at: due }, { exception_id: null }, { stage: 'requested' }, { workflow_revision: '7' }])('rejects inconsistent successful receipt %#', (change) => {
    const f = fixture(); Object.assign(f.state.receipt, change); expect(humanStateSchema.safeParse(f.state).success).toBe(false);
  });
  it('non-completion cannot masquerade as success or a different disposition', () => {
    for (const change of [{ care_completed: true }, { completion_outcome: 'cancelled' }]) {
      const f = fixture(false); Object.assign(f.state.receipt, change); expect(humanStateSchema.safeParse(f.state).success).toBe(false);
    }
  });
  it.each(['referral', 'medication_access'])('supports both closure outcomes for %s without laboratory artifacts', (kind) => {
    for (const success of [true, false]) {
      const f = fixture(success), command = kind === 'referral' ? 'record_report' : 'record_obtained';
      const stage = kind === 'referral' ? 'report_received' : 'obtained';
      const basis = { kind, composition_event_id: null, sources: [], processing: [], operational_event: {
        event_id: id(250), revision: '2', occurred_at: time(1), recorded_at: time(1), command,
        payload: { occurred_at: time(1), evidence: 'Exact operational evidence', next_action: 'Review evidence', next_review_at: due,
          details: kind === 'referral' ? { report_reference: 'Original referral report' } : { source: 'professional_verification' } } } };
      f.snapshot.known_invalidation_ids = [];
      Object.assign(f.input, { basis }); Object.assign(f.state, { basis }); Object.assign(f.state.receipt, { basis, stage });
      Object.assign(f.context, { basis, stage, kind });
      expect(humanInputSchema.safeParse(f.input).success).toBe(true);
      expect(humanStateSchema.safeParse(f.state).success).toBe(true);
      expect(closureReady(humanContextSchema.parse(f.context))).toBe(true);
      f.snapshot.known_invalidation_ids = [id(50)]; expect(humanInputSchema.safeParse(f.input).success).toBe(false);
    }
  });
  it.each(['snapshot', 'outcome', 'disposition', 'reason', 'declarations'])('requires non-completion field %s', (key) => {
    const f = fixture(false); delete (f.input.payload.details as Record<string, unknown>)[key];
    expect(humanInputSchema.safeParse(f.input).success).toBe(false);
  });
  it('requires the exact complete set of individually acknowledged non-delivery targets', () => {
    const f = unresolvedFixture();
    expect(humanStateSchema.safeParse(f.state).success).toBe(true);
    expect(careWorkflowDetailSchema.parse(f.detail)).toEqual(f.detail);
    const declaration = { target_type: 'source_invalidation', target_id: id(50), reason: 'Explicit reason', non_delivery_acknowledged: true };
    for (const declarations of [[], [declaration, declaration], [{ ...declaration, target_id: id(51) }],
      [{ ...declaration, target_type: 'exception' }], [{ ...declaration, non_delivery_acknowledged: false }], [{ ...declaration, reason: ' ' }]]) {
      Object.assign(f.input.payload.details, { declarations }); expect(humanInputSchema.safeParse(f.input).success).toBe(false);
    }
  });
  it('terminal recovery does not require fresh closure context or a new future deadline', () => {
    const f = fixture(), state = humanStateSchema.parse(f.state);
    expect(humanMatches(state, humanInputFromState(state))).toBe(true);
    expect(validateNewHumanInput(f.input, Date.parse('2020-01-01T00:00:00Z'))).toBeNull();
    expect(humanStateSchema.safeParse(f.state).success).toBe(true);
  });
  it.each(['pending', 'invalidated', null])('does not make incomplete processing ready (%s)', (status) => {
    const f = fixture(); const row = f.context.basis.processing[0];
    Object.assign(row, { evaluation: status === null ? null : { ...row.evaluation, status, completed_at: status === 'pending' ? null : time(2) } });
    f.context.basis.sources[0].evaluation_status = status;
    const parsed = humanContextSchema.safeParse(f.context);
    // Invalidated + NULL assessment is itself contradictory, not a valid legacy terminal proof.
    if (status === 'invalidated') expect(parsed.success).toBe(false);
    else { expect(parsed.success).toBe(true); if (parsed.success) expect(closureReady(parsed.data)).toBe(false); }
    expect(humanInputSchema.safeParse(f.input).success).toBe(false);
  });
  it('shows missing contact/review and prepared intentions without enabling new closure', () => {
    const f = fixture();
    expect(closureReady(humanContextSchema.parse({ ...f.context, latest_review: null, contact: null }))).toBe(false);
    const snapshot = { ...f.snapshot, prepared_intents: [{ intent_id: id(220), state: 'prepared', recorded_at: time(4) }] };
    expect(closureReady(humanContextSchema.parse({ ...f.context, snapshot }))).toBe(false);
    Object.assign(f.input.payload.details, { snapshot }); expect(humanInputSchema.safeParse(f.input).success).toBe(false);
  });
  it.each(['exceptions', 'invalidations', 'known_invalidation_ids', 'prepared_intents'])('requires entire snapshot field %s', (key) => {
    const f = fixture(); delete (f.snapshot as Record<string, unknown>)[key]; expect(humanContextSchema.safeParse(f.context).success).toBe(false);
  });
  it('rejects duplicate/unordered baseline IDs and any leaked private intent payload', () => {
    for (const ids of [[id(50), id(50)], [id(51), id(50)]]) {
      const f = fixture(); f.snapshot.known_invalidation_ids = ids; expect(humanContextSchema.safeParse(f.context).success).toBe(false);
    }
    const f = fixture(); Object.assign(f.snapshot, { prepared_intents: [{ intent_id: id(220), state: 'prepared', recorded_at: time(4), payload: 'Private' }] });
    expect(humanContextSchema.safeParse(f.context).success).toBe(false);
  });
});
describe('complete immutable closure history', () => {
  it.each(['entry_id', 'composition_event_id', 'observed_version_id', 'root_id'])('rejects changed-source origin substitution at closure (%s)', (key) => {
    const f = unresolvedFixture();
    const target = (f.snapshot as unknown as { invalidations: Record<string, unknown>[] }).invalidations[0];
    target[key] = id(299); expect(careWorkflowDetailSchema.safeParse(f.detail).success).toBe(false);
  });
  it('retains unresolved change identity and rejects treating an already resolved change as unresolved again', () => {
    const f = fixture(false), target = sourceFixture().target;
    Object.assign(f.snapshot, { invalidations: [target] });
    Object.assign(f.input.payload.details, { declarations: [{ target_type: 'source_invalidation', target_id: id(50),
      reason: 'Duplicate non-delivery', non_delivery_acknowledged: true }] });
    expect(humanInputSchema.safeParse(f.input).success).toBe(true);
    expect(careWorkflowDetailSchema.safeParse(f.detail).success).toBe(false);
  });
  it.each([{ work_status: 'awaiting' }, { work_status: 'due' }])('requires closed projection %#', (change) => {
    const f = fixture(); Object.assign(f.detail, change); expect(careWorkflowDetailSchema.safeParse(f.detail).success).toBe(false);
  });
  it('rejects generic closed status without typed closure', () => {
    const f = sourceFixture(); f.detail.work_status = 'closed'; expect(careWorkflowDetailSchema.safeParse(f.detail).success).toBe(false);
  });
  it('cannot omit a previously resolved source identity from the all-known baseline', () => {
    const f = fixture(); f.snapshot.known_invalidation_ids = []; expect(humanStateSchema.safeParse(f.state).success).toBe(true);
    expect(careWorkflowDetailSchema.safeParse(f.detail).success).toBe(false);
  });
  it('rejects an unexplained baseline identity without unresolved snapshot or preceding resolution', () => {
    const f = fixture(); f.snapshot.known_invalidation_ids.push(id(51)); expect(careWorkflowDetailSchema.safeParse(f.detail).success).toBe(false);
  });
  it.each([{ review_event_id: id(99) }, { contact_event_id: id(99) }, { contact_event_id: id(201) }])('requires preceding exact review and contact %#', (change) => {
    const f = fixture(); Object.assign(f.input.payload.details, change); expect(careWorkflowDetailSchema.safeParse(f.detail).success).toBe(false);
  });
  it('forbids closing before the latest nonclinical or human occurrence', () => {
    const f = fixture(); f.input.payload.occurred_at = f.detail.humans.at(-1)!.occurred_at = time(3);
    expect(careWorkflowDetailSchema.safeParse(f.detail).success).toBe(false);
  });
  it('forbids any additional human event after a valid closure', () => {
    const f = fixture(); const extra = structuredClone(f.detail.humans[0]);
    extra.id = extra.receipt.event_id = id(251); extra.revision = extra.receipt.workflow_revision = '7';
    extra.request.request_id = extra.receipt.request_id = id(252); extra.request.expected_revision = '6';
    expect(careWorkflowDetailSchema.safeParse({ ...f.detail, revision: '7', humans: [...f.detail.humans, extra] }).success).toBe(false);
  });
});
if (process.env.HEARTLAND_CLOSURE_PROOF_DIR) describe('actual local closure PostgreSQL projections', () => {
  it('decodes every saved closure projection after verifying all seven source hashes', () => {
    const dir = process.env.HEARTLAND_CLOSURE_PROOF_DIR!;
    const proof = JSON.parse(readFileSync(join(dir, 'completion.json'), 'utf8')) as { all_ok: boolean; source_sha256: Record<string, string> };
    expect(proof.all_ok).toBe(true); expect(Object.keys(proof.source_sha256)).toHaveLength(7);
    for (const [file, hash] of Object.entries(proof.source_sha256)) expect(createHash('sha256').update(readFileSync(file)).digest('hex'), file).toBe(hash);
    const counts = { CONTEXT: 0, STATE: 0, HISTORY: 0 };
    const schemas = { CONTEXT: humanContextSchema, STATE: humanStateSchema, HISTORY: careWorkflowDetailSchema };
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.stdout'))) {
      for (const match of readFileSync(join(dir, file), 'utf8').matchAll(/^CLOSURE_(CONTEXT|STATE|HISTORY):(.*)$/gm)) {
        const kind = match[1] as keyof typeof counts, parsed = schemas[kind].safeParse(JSON.parse(match[2]));
        expect(parsed.success, `${file}: ${parsed.success ? '' : parsed.error.message}`).toBe(true); counts[kind]++;
      }
    }
    expect(counts).toEqual({ CONTEXT: 13, STATE: 32, HISTORY: 13 });
  });
});
