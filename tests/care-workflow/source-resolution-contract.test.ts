import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { humanContextSchema, humanInputSchema, humanStateSchema, humanInputFromState, humanMatches, sourceResolutionReady } from '@/lib/care-workflow/human-types';
import { compositionInvalidationPageSchema } from '@/lib/care-workflow/composition-types';
import { careWorkflowDetailSchema } from '@/lib/care-workflow/step-types';
const id = (n: number) => `ab000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const time = (n: number) => `2026-09-29T12:0${n}:00.123456Z`, due = '2026-10-01T12:00:00Z';
function fixture() {
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
describe('exact changed-source client contract', () => {
  it('accepts an explicit attestation, distinct version/change timestamps and uppercase historical review reference', () => {
    const f = fixture(); expect(humanInputSchema.parse(f.input)).toEqual(f.input); expect(humanStateSchema.parse(f.state)).toEqual(f.state);
    expect(sourceResolutionReady(humanContextSchema.parse(f.context))).toBe(true); expect(careWorkflowDetailSchema.parse(f.detail)).toEqual(f.detail);
  });
  it.each(Object.keys(fixture().target))('requires exact target field %s', (key) => {
    const f = fixture(); delete (f.target as Record<string, unknown>)[key]; expect(humanInputSchema.safeParse(f.input).success).toBe(false);
  });
  it.each(Object.keys(fixture().input.payload.details))('requires attestation detail %s', (key) => {
    const f = fixture(); delete (f.input.payload.details as Record<string, unknown>)[key]; expect(humanInputSchema.safeParse(f.input).success).toBe(false);
  });
  it.each([{ source_reviewed: false }, { change_addressed_in_contact: false }, { source_reviewed: 'true' }, { source_review_evidence: '  ' },
    { source_communication_evidence: null }, { disposition: 'complete' }, { disposition: 'no_longer_used' }, { review_event_id: id(71) }, { extra: true }])('rejects incomplete or mismatched attestation %#', (change) => {
    const f = fixture(); Object.assign(f.input.payload.details, change); expect(humanInputSchema.safeParse(f.input).success).toBe(false);
  });
  it.each([{ composition_revision: 'bad' }, { composition_revision: '4' }, { composition_revision: '9223372036854775808' }, { change_revision: 'bad' },
    { change_revision: '3' }, { observed_version_id: id(46) }, { change_version_id: id(99) }, { change_status: 'cancelled' }, { recorded_at: time(0) }])('rejects inconsistent target %# without throwing', (change) => {
    const f = fixture(); Object.assign(f.target, change);
    expect(humanInputSchema.safeParse(f.input).success).toBe(false); expect(humanStateSchema.safeParse(f.state).success).toBe(false);
  });
  it.each([{ resolved_invalidation_id: id(99) }, { resolution_event_id: id(99) }, { resolved_invalidation_id: undefined }, { source_review_attested: false },
    { source_contact_attested: undefined }, { communication_confirmed: true }, { care_completed: true }, { clinical_review_recorded: true },
    { addresses_current_review: true }, { stage: 'requested' }, { exception_id: id(90) }, { resolved_exception_id: id(50) }])('rejects incorrect receipt %#', (change) => {
    const f = fixture(); Object.assign(f.state.receipt, change); expect(humanStateSchema.safeParse(f.state).success).toBe(false);
  });
  it('reads missing or old prerequisites honestly without declaring them ready', () => {
    const f = fixture();
    expect(sourceResolutionReady(humanContextSchema.parse({ ...f.context, latest_review: null, contact: null }))).toBe(false);
    const old = { ...f.context, latest_review: { ...f.context.latest_review, occurred_at: time(0) }, contact: { ...f.context.contact, occurred_at: time(0) } };
    expect(sourceResolutionReady(humanContextSchema.parse(old))).toBe(false);
    expect(sourceResolutionReady(humanContextSchema.parse({ ...f.context, contact: null }))).toBe(false);
  });
  it.each([{ review_event_id: id(99) }, { basis_signature: 'b'.repeat(64) }, { revision: '5' }, { revision: '3' }, { revision: 'bad' }, { occurred_at: time(0) }])('rejects inconsistent qualified contact %#', (change) => {
    const f = fixture(); Object.assign(f.context.contact, change); expect(humanContextSchema.safeParse(f.context).success).toBe(false);
  });
  it('keeps prior command contexts strict and rejects a non-laboratory target', () => {
    const f = fixture(); for (const command of ['record_review', 'record_contact', 'resolve_exception']) expect(humanContextSchema.safeParse({ ...f.context, command }).success).toBe(false);
    f.input.basis.kind = 'referral'; expect(humanInputSchema.safeParse(f.input).success).toBe(false);
  });
  it('preserves terminal recovery with expired deadlines and retained or removed sources', () => {
    const f = fixture(); f.input.payload.next_review_at = '2020-01-01T00:00:00Z';
    expect(humanMatches(humanStateSchema.parse(f.state), humanInputFromState(humanStateSchema.parse(f.state)))).toBe(true);
    f.input.basis.sources[0].root_id = id(99); f.input.basis.composition_event_id = id(98); f.input.payload.details.disposition = 'no_longer_used';
    expect(humanInputSchema.safeParse(f.input).success).toBe(true);
  });
  it('retains cancellation as unusable, not resolved care', () => {
    const f = fixture(); Object.assign(f.target.head, { status: 'cancelled', value: null, effective_lab_result_id: null });
    f.target.change_status = 'cancelled'; f.input.basis.sources[0].quality = 'cancelled'; f.input.basis.processing = [];
    expect(humanStateSchema.safeParse(f.state).success).toBe(true); expect(f.state.receipt.care_completed).toBe(false);
  });
});
describe('source attestation in complete immutable history', () => {
  it('tracks a removed historical root across two distinct resolutions without regressing its head', () => {
    const f = fixture(), composition = structuredClone(f.detail.compositions[0]), review = f.detail.humans[0], contact = f.detail.humans[1], event = f.detail.humans[2];
    // Add an explicit replacement before review. All later records use the same replacement basis.
    composition.id = composition.receipt.event_id = id(140); composition.revision = composition.receipt.workflow_revision = '3';
    composition.from_stage = 'result_received'; composition.receipt.previous_event_id = id(40);
    composition.recorded_at = composition.receipt.recorded_at = time(2); composition.payload.sources[0].root_id = composition.receipt.sources[0].root_id = id(142);
    const basis = f.input.basis; basis.composition_event_id = id(140); basis.sources[0].root_id = id(142);
    basis.sources[0].head = structuredClone(composition.receipt.sources[0].observed_head); basis.processing = [{ lab_result_id: id(43), evaluation: null }];
    for (const [n, row] of [review, contact, event].entries()) {
      row.revision = row.receipt.workflow_revision = String(n + 4); row.request.expected_revision = String(n + 3);
    }
    f.input.payload.details.disposition = 'no_longer_used'; f.target.head = { ...f.target.head, revision: '4', version_id: id(146) };
    const second = structuredClone(event), details = second.request.payload.details as typeof f.input.payload.details;
    second.id = second.receipt.event_id = id(172); Object.assign(second.receipt, { resolution_event_id: id(172), resolved_invalidation_id: id(150), request_id: id(160), workflow_revision: '7' });
    second.revision = '7'; second.request.expected_revision = '6'; second.request.request_id = id(160);
    details.invalidation.invalidation_id = id(150); details.invalidation.change_revision = '3'; details.invalidation.change_version_id = id(145);
    const history = { ...f.detail, revision: '7', compositions: [...f.detail.compositions, composition], humans: [...f.detail.humans, second] };
    expect(careWorkflowDetailSchema.parse(history)).toEqual(history);
    details.invalidation.head = { ...details.invalidation.head, revision: '3', version_id: id(145) };
    expect(careWorkflowDetailSchema.safeParse(history).success).toBe(false);
  });
  it.each([{ composition_event_id: id(99) }, { composition_revision: '3' }, { root_id: id(99) }, { observed_version_id: id(99) },
    { recorded_at: time(4) }, { head_recorded_at: time(4) }])('rejects inconsistent historical target %#', (change) => {
    const f = fixture(); Object.assign(f.target, change); expect(careWorkflowDetailSchema.safeParse(f.detail).success).toBe(false);
  });
  it.each([{ review_event_id: id(99) }, { contact_event_id: id(99) }, { contact_event_id: id(72) }])('rejects foreign/later references %#', (change) => {
    const f = fixture(); Object.assign(f.input.payload.details, change); expect(careWorkflowDetailSchema.safeParse(f.detail).success).toBe(false);
  });
  it('requires the exact prior contact to address the latest review with unchanged evidence', () => {
    for (const change of [{ review_addressed: false }, { review_event_id: null }, { outcome: 'no_answer', exception_id: id(97), reason: 'No response' }]) {
      const f = fixture(); Object.assign(f.detail.humans[1].request.payload.details, change); f.detail.humans[1].receipt.addresses_current_review = false;
      expect(careWorkflowDetailSchema.safeParse(f.detail).success).toBe(false);
    }
    const f = fixture(); f.detail.humans[1].request.basis_signature = f.detail.humans[1].receipt.basis_signature = 'b'.repeat(64);
    expect(careWorkflowDetailSchema.safeParse(f.detail).success).toBe(false);
  });
  it('rejects a second unique request resolving the same target', () => {
    const f = fixture(), next = structuredClone(f.detail.humans[2]); next.id = next.receipt.event_id = id(80);
    Object.assign(next.receipt, { resolution_event_id: id(80), request_id: id(81), workflow_revision: '6' });
    next.request.request_id = id(81); next.request.expected_revision = '5'; next.revision = '6';
    expect(careWorkflowDetailSchema.safeParse({ ...f.detail, revision: '6', humans: [...f.detail.humans, next] }).success).toBe(false);
  });
});
if (process.env.HEARTLAND_SOURCE_PROOF_DIR) describe('actual local source-resolution PostgreSQL projections', () => {
  it('decodes all 93 projections after matching the seven source hashes', () => {
    const dir = process.env.HEARTLAND_SOURCE_PROOF_DIR!;
    const proof = JSON.parse(readFileSync(join(dir, 'completion.json'), 'utf8')) as { all_ok: boolean; hashes: Record<string, string> };
    expect(proof.all_ok).toBe(true); expect(Object.keys(proof.hashes)).toHaveLength(7);
    for (const [file, hash] of Object.entries(proof.hashes)) expect(createHash('sha256').update(readFileSync(file)).digest('hex'), file).toBe(hash);
    const counts = { CONTEXT: 0, STATE: 0, HISTORY: 0, INVALIDATIONS: 0 };
    const schemas = { CONTEXT: humanContextSchema, STATE: humanStateSchema, HISTORY: careWorkflowDetailSchema, INVALIDATIONS: compositionInvalidationPageSchema };
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.stdout'))) {
      for (const match of readFileSync(join(dir, file), 'utf8').matchAll(/^SOURCE_(CONTEXT|STATE|HISTORY|INVALIDATIONS):(.*)$/gm)) {
        const kind = match[1] as keyof typeof counts, value = JSON.parse(match[2]), parsed = schemas[kind].safeParse(value);
        expect(parsed.success, `${file}: ${parsed.success ? '' : parsed.error.message}`).toBe(true); counts[kind]++;
      }
    }
    expect(counts).toEqual({ CONTEXT: 18, STATE: 41, HISTORY: 19, INVALIDATIONS: 15 });
  });
});
