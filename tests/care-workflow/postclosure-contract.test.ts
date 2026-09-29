import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { postclosureContextSchema, postclosureInputFromState, postclosureInputSchema, postclosureMatches,
  postclosureNeedsPageSchema, postclosurePendingPageSchema, postclosureStateSchema, postclosureHistoryPageSchema,
  postclosureSuccessorsPageSchema, validateNewPostclosure } from '@/lib/care-workflow/postclosure-types';

const id = (n: number) => `c1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = (n: number) => `2026-09-29T12:0${n}:00.123456Z`;
function fixture(replacement = false) {
  const scope = { actor_id: id(1), organization_id: id(2), patient_id: id(3) };
  const snapshot = { invalidation_id: id(4), organization_id: id(2), patient_id: id(3), predecessor_work_item_id: id(5),
    closure_event_id: id(6), closure_recorded_at: at(0), entry_id: id(7), composition_event_id: id(8),
    analyte: 'potassium', root_id: id(9), change_version_id: id(10), change_revision: '2', change_status: 'corrected',
    change_recorded_at: at(1), invalidation_recorded_at: at(1) };
  const input = { ...scope, request_id: id(11), invalidation_id: id(4), predecessor_work_item_id: id(5), work_item_id: id(12),
    expected_revision: '1', expected_ownership_revision: '1', expected_routing_revision: replacement ? '1' : '0', previous_event_id: replacement ? id(99) : null,
    payload: { snapshot, occurred_at: at(3), evidence: '  Frozen source evidence  ', reason: 'Explicit routing decision', review_at: at(9),
      responsibility_acknowledged: true, supersession_acknowledged: replacement } };
  const receipt = { request_id: id(11), event_id: id(13), invalidation_id: id(4), predecessor_work_item_id: id(5), work_item_id: id(12),
    previous_event_id: input.previous_event_id, routing_revision: replacement ? '2' : '1', workflow_revision: '1', ownership_revision: '1',
    recorded_at: at(5), review_at: at(9), delegated: true, clinical_invalidation_resolved: false,
    clinical_review_recorded: false, communication_confirmed: false, care_completed: false };
  const state = { ...input, state: 'applied', recorded_at: at(4), acknowledged_at: null, receipt };
  const prepared = { ...input, state: 'prepared', recorded_at: at(4), acknowledged_at: null, receipt: null };
  const context = { ...scope, work_item_id: id(12), workflow_revision: '1', ownership_revision: '1', routing_revision: input.expected_routing_revision,
    previous_event_id: input.previous_event_id, previous_work_item_id: replacement ? id(98) : null,
    successor_created_at: at(2), successor_accepted_at: at(0), review_at: at(9), snapshot };
  const need = { invalidation_id: id(4), patient_id: id(3), predecessor_work_item_id: id(5), recorded_at: at(1), snapshot,
    current_route: null, routing_state: 'unrouted' };
  const needs = { organization_id: id(2), items: [need], next_cursor: null,
    counts: { unrouted: 1, delegated: 0, overdue: 0, responsibility_unavailable: 0, successor_closed: 0 } };
  const history = { invalidation_id: id(4), items: [{ event_id: id(13), actor_id: id(1), payload: input.payload, receipt }], next_cursor: null };
  const successors = { invalidation_id: id(4), items: [{ work_item_id: id(12), created_at: at(2), accepted_at: at(0),
    ownership_revision: '1', workflow_revision: '1', review_at: at(9) }], next_cursor: null };
  return { scope, input, receipt, state, prepared, context, snapshot, need, needs, history, successors };
}

describe('strict post-closure routing contract', () => {
  it.each([false, true])('decodes initial/replacement frozen state %s', (replacement) => {
    const f = fixture(replacement), state = postclosureStateSchema.parse(f.state), input = postclosureInputSchema.parse(f.input);
    expect(postclosureInputFromState(state)).toEqual(input); expect(postclosureMatches(state, input)).toBe(true);
    expect(postclosureContextSchema.parse(f.context)).toEqual(f.context);
    expect(postclosureHistoryPageSchema.parse(f.history)).toEqual(f.history);
    expect(postclosureNeedsPageSchema.parse(f.needs)).toEqual(f.needs);
    expect(postclosureSuccessorsPageSchema.parse(f.successors)).toEqual(f.successors);
  });
  it('does not invent temporal ordering of ALL-known baseline or legacy acceptance', () => {
    const f = fixture(); f.snapshot.closure_recorded_at = at(2);
    expect(postclosureContextSchema.safeParse(f.context).success).toBe(true);
    expect(postclosureStateSchema.safeParse(f.state).success).toBe(true);
  });
  it.each(['organization_id', 'patient_id', 'invalidation_id', 'predecessor_work_item_id'])('rejects substituted input %s', (key) => {
    const f = fixture(); expect(postclosureInputSchema.safeParse({ ...f.input, [key]: id(88) }).success).toBe(false);
  });
  it.each(['request_id', 'invalidation_id', 'predecessor_work_item_id', 'work_item_id', 'ownership_revision', 'workflow_revision',
    'routing_revision', 'previous_event_id'])('rejects substituted receipt %s', (key) => {
    const f = fixture(); Object.assign(f.receipt, { [key]: key.endsWith('revision') ? '9' : id(88) });
    expect(postclosureStateSchema.safeParse(f.state).success).toBe(false);
  });
  it.each(['delegated', 'clinical_invalidation_resolved', 'clinical_review_recorded', 'communication_confirmed', 'care_completed'])('refuses invented %s', (key) => {
    const f = fixture(); Object.assign(f.receipt, { [key]: key !== 'delegated' });
    expect(postclosureStateSchema.safeParse(f.state).success).toBe(false);
  });
  it.each(['-1', '01', '1.1', 'NaN', 'bad', '9223372036854775808', '9'.repeat(100)])('invalid bigint fails without throwing %s', (value) => {
    const f = fixture();
    for (const key of ['expected_routing_revision', 'expected_ownership_revision', 'expected_revision']) {
      expect(postclosureInputSchema.safeParse({ ...f.input, [key]: value }).success).toBe(false);
      expect(postclosureStateSchema.safeParse({ ...f.state, [key]: value }).success).toBe(false);
    }
    expect(postclosureStateSchema.safeParse({ ...f.state, receipt: { ...f.receipt, routing_revision: value } }).success).toBe(false);
  });
  it('increments a full-range routing bigint without number rounding', () => {
    const f = fixture(true); f.input.expected_routing_revision = '9223372036854775806';
    f.state.expected_routing_revision = f.input.expected_routing_revision; f.receipt.routing_revision = '9223372036854775807';
    expect(postclosureStateSchema.safeParse(f.state).success).toBe(true);
    f.state.expected_routing_revision = '9223372036854775807'; expect(postclosureStateSchema.safeParse(f.state).success).toBe(false);
  });
  it.each([false, true])('requires correct predecessor and explicit supersession %s', (replacement) => {
    const f = fixture(replacement);
    expect(postclosureInputSchema.safeParse({ ...f.input, previous_event_id: replacement ? null : id(99) }).success).toBe(false);
    expect(postclosureInputSchema.safeParse({ ...f.input, payload: { ...f.input.payload, supersession_acknowledged: !replacement } }).success).toBe(false);
    expect(postclosureInputSchema.safeParse({ ...f.input, work_item_id: id(5) }).success).toBe(false);
  });
  it.each(['evidence', 'reason'])('keeps frozen %s and does not trim recovery', (key) => {
    const f = fixture(), input = postclosureInputSchema.parse(f.input), state = postclosureStateSchema.parse(f.state);
    Object.assign(input.payload, { [key]: 'Changed text' }); expect(postclosureMatches(state, input)).toBe(false);
    Object.assign(f.input.payload, { [key]: '  ' }); expect(postclosureInputSchema.safeParse(f.input).success).toBe(false);
  });
  it('fresh eligibility is separate from historical decoding, including superseded overdue receipt', () => {
    const f = fixture(true); expect(postclosureStateSchema.safeParse(f.state).success).toBe(true);
    expect(validateNewPostclosure(f.input, Date.parse('2026-09-29T12:08:00Z'))).not.toBeNull();
    expect(validateNewPostclosure(f.input, Date.parse('2026-10-01T00:00:00Z'))).toBeNull();
    expect(validateNewPostclosure(f.input, Date.parse('2020-01-01T00:00:00Z'))).toBeNull();
    expect(validateNewPostclosure(f.input, NaN)).toBeNull();
    expect(postclosureMatches(postclosureStateSchema.parse(f.state), postclosureInputSchema.parse(f.input))).toBe(true);
  });
  it('uses microsecond timestamp equivalence and rejects malformed precision', () => {
    const f = fixture(); f.receipt.review_at = '2026-09-29T08:09:00.123456-04:00';
    expect(postclosureStateSchema.safeParse(f.state).success).toBe(true);
    f.receipt.review_at = '2026-09-29T08:09:00.123455-04:00'; expect(postclosureStateSchema.safeParse(f.state).success).toBe(false);
    f.context.successor_created_at = '2026-09-29T12:02:00.1234567Z'; expect(postclosureContextSchema.safeParse(f.context).success).toBe(false);
  });
  it.each(['prepared', 'cancelled'])('never accepts receipt or ACK on %s', (state) => {
    const f = fixture(); expect(postclosureStateSchema.safeParse({ ...f.state, state }).success).toBe(false);
    expect(postclosureStateSchema.safeParse({ ...f.prepared, state, acknowledged_at: at(6) }).success).toBe(false);
    expect(postclosureStateSchema.safeParse({ ...f.prepared, state }).success).toBe(true);
  });
  it('strictly rejects invented values, missing acknowledgements and clinical fields', () => {
    const f = fixture();
    for (const extra of [{ responsibility_acknowledged: false }, { next_action: 'invented' }, { care_completed: true }])
      expect(postclosureInputSchema.safeParse({ ...f.input, payload: { ...f.input.payload, ...extra } }).success).toBe(false);
    expect(postclosureContextSchema.safeParse({ ...f.context, snapshot: { ...f.snapshot, value: 4.2 } }).success).toBe(false);
  });
  it('requires historical chronology without imposing current eligibility', () => {
    const f = fixture();
    expect(postclosureStateSchema.safeParse({ ...f.prepared, payload: { ...f.input.payload, review_at: at(3) } }).success).toBe(false);
    expect(postclosureStateSchema.safeParse({ ...f.prepared, recorded_at: at(9) }).success).toBe(false);
    expect(postclosureContextSchema.safeParse({ ...fixture(true).context, previous_work_item_id: id(5) }).success).toBe(false);
  });
  it('rejects internally impossible routing states without recalculating a server deadline', () => {
    const f = fixture(), route = { event_id: id(13), routing_revision: '1', work_item_id: id(12), recorded_at: at(5),
      assigned_to: id(1), accepted_by: id(1), accepted_at: at(0), transfer_pending_to: null, work_status: 'new', current_due_at: at(9) };
    for (const routing_state of ['delegated', 'overdue', 'responsibility_unavailable']) {
      const page = { ...f.needs, items: [{ ...f.need, routing_state, current_route: route }] };
      expect(postclosureNeedsPageSchema.safeParse(page).success).toBe(true);
    }
    expect(postclosureNeedsPageSchema.safeParse({ ...f.needs, items: [{ ...f.need, routing_state: 'delegated', current_route: { ...route, accepted_by: id(88) } }] }).success).toBe(false);
    expect(postclosureNeedsPageSchema.safeParse({ ...f.needs, items: [{ ...f.need, routing_state: 'successor_closed', current_route: route }] }).success).toBe(false);
  });
  it('validates history continuity/predecessor and independent author, not live routing head', () => {
    const f = fixture(), g = fixture(true); g.receipt.previous_event_id = f.receipt.event_id; g.receipt.event_id = id(14);
    g.receipt.request_id = id(15); g.receipt.work_item_id = id(16);
    g.history.items[0].event_id = id(14); g.history.items[0].actor_id = id(77);
    const page = { ...f.history, items: [f.history.items[0], g.history.items[0]] };
    expect(postclosureHistoryPageSchema.safeParse(page).success).toBe(true);
    g.receipt.previous_event_id = id(66); expect(postclosureHistoryPageSchema.safeParse(page).success).toBe(false);
    g.receipt.previous_event_id = f.receipt.event_id; g.receipt.routing_revision = '3';
    expect(postclosureHistoryPageSchema.safeParse(page).success).toBe(false);
  });
  it('requires distinct adjacent successors, case-insensitively, but permits A to B to A', () => {
    const a = fixture(), b = fixture(true), c = fixture(true);
    b.receipt.previous_event_id = a.receipt.event_id; b.receipt.event_id = id(14); b.receipt.request_id = id(15); b.history.items[0].event_id = id(14);
    const page = { ...a.history, items: [a.history.items[0], b.history.items[0]] };
    expect(postclosureHistoryPageSchema.safeParse(page).success).toBe(false);
    b.receipt.work_item_id = a.receipt.work_item_id.toUpperCase();
    expect(postclosureHistoryPageSchema.safeParse(page).success).toBe(false);
    b.receipt.work_item_id = id(16);
    c.receipt.previous_event_id = b.receipt.event_id; c.receipt.event_id = id(17); c.receipt.request_id = id(18);
    c.receipt.routing_revision = '3'; c.history.items[0].event_id = id(17);
    expect(postclosureHistoryPageSchema.safeParse({ ...page, items: [...page.items, c.history.items[0]] }).success).toBe(true);
  });
  it.each([at(1), at(2)])('context and candidate review must follow creation without using wall time: %s', (review_at) => {
    const f = fixture();
    expect(postclosureContextSchema.safeParse({ ...f.context, review_at }).success).toBe(false);
    expect(postclosureSuccessorsPageSchema.safeParse({ ...f.successors, items: [{ ...f.successors.items[0], review_at }] }).success).toBe(false);
    expect(postclosureContextSchema.safeParse({ ...f.context, successor_accepted_at: at(9) }).success).toBe(false);
    expect(postclosureSuccessorsPageSchema.safeParse({ ...f.successors, items: [{ ...f.successors.items[0], accepted_at: at(9) }] }).success).toBe(false);
  });
  it('enforces canonical raw cursors, duplicate rejection and recovery state', () => {
    const f = fixture();
    expect(postclosureNeedsPageSchema.safeParse({ ...f.needs, next_cursor: id(4) }).success).toBe(false);
    expect(postclosureNeedsPageSchema.safeParse({ ...f.needs, items: [f.need, f.need] }).success).toBe(false);
    expect(postclosurePendingPageSchema.safeParse({ items: [{ ...f.state, acknowledged_at: at(6) }], next_cursor: null }).success).toBe(false);
    expect(postclosureHistoryPageSchema.safeParse({ ...f.history, next_cursor: '1' }).success).toBe(false);
    expect(postclosureSuccessorsPageSchema.safeParse({ ...f.successors, items: [...f.successors.items, ...f.successors.items] }).success).toBe(false);
  });
});
if (process.env.HEARTLAND_POSTCLOSURE_PROOF_DIR) describe('actual PostgreSQL routing projections', () => {
  it('decodes 41 projections after verifying all five source hashes', () => {
    const dir = process.env.HEARTLAND_POSTCLOSURE_PROOF_DIR!;
    const proof = JSON.parse(readFileSync(join(dir, 'completion.json'), 'utf8')) as { all_ok: boolean; hashes: Record<string, string> };
    expect(proof.all_ok).toBe(true); expect(Object.keys(proof.hashes)).toHaveLength(5);
    for (const [file, hash] of Object.entries(proof.hashes)) expect(createHash('sha256').update(readFileSync(file)).digest('hex'), file).toBe(hash);
    const schemas = { CONTEXT: postclosureContextSchema, STATE: postclosureStateSchema, HISTORY: postclosureHistoryPageSchema, NEEDS: postclosureNeedsPageSchema };
    const counts = { CONTEXT: 0, STATE: 0, HISTORY: 0, NEEDS: 0 };
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.stdout'))) {
      for (const match of readFileSync(join(dir, file), 'utf8').matchAll(/^ROUTING_(CONTEXT|STATE|HISTORY|NEEDS):(.*)$/gm)) {
        const kind = match[1] as keyof typeof counts, parsed = schemas[kind].safeParse(JSON.parse(match[2]));
        expect(parsed.success, file + ': ' + (parsed.success ? '' : parsed.error.message)).toBe(true); counts[kind]++;
      }
    }
    expect(counts).toEqual({ CONTEXT: 14, STATE: 23, HISTORY: 2, NEEDS: 2 });
  });
});
