import { describe, expect, it } from 'vitest';
import { compositionDetailSchema, compositionHistorySchema, compositionInputFromState, compositionInputSchema,
  compositionInvalidationPageSchema, compositionMatches, compositionPendingPageSchema, compositionRoutingPageSchema,
  compositionStateSchema, validateNewComposition } from '@/lib/care-workflow/composition-types';

const id = (n: number) => `68000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-09-01T12:00:00.123456-04:00';
const payload = { occurred_at: at, next_review_at: '2026-10-01T12:00:00.123456-04:00', evidence: '  Synthetic evidence  ',
  reason: '  Exact source mapping  ', next_action: 'Review missing evidence', sources: [
    { analyte: 'egfr', root_id: null, expected_root_revision: null },
    { analyte: 'potassium', root_id: id(400), expected_root_revision: '1' },
  ], intent_resolutions: [] };
const input = { actor_id: id(1), organization_id: id(90), patient_id: id(11), work_item_id: id(100), request_id: id(200),
  expected_revision: '1', expected_ownership_revision: '1', payload };
const prepared = { ...input, state: 'prepared', recorded_at: at, acknowledged_at: null, receipt: null };
const head = { version_id: id(500), revision: '1', status: 'original', effective_lab_result_id: id(600), value: '4.600', collected_at: at };
const receipt = { request_id: id(200), work_item_id: id(100), event_id: id(300), previous_event_id: null, workflow_revision: '2',
  ownership_revision: '1', stage: 'result_received', recorded_at: at, due_at: at,
  sources: [{ analyte: 'egfr', root_id: null, observed_head: null }, { analyte: 'potassium', root_id: id(400), observed_head: head }],
  intent_resolutions: [], clinical_review_recorded: false, communication_confirmed: false, care_completed: false };
const applied = { ...prepared, state: 'applied', receipt };
const detail = { actor_id: id(1), organization_id: id(90), patient_id: id(11), work_item_id: id(100), workflow_revision: '2', ownership_revision: '1',
  stage: 'result_received', composition_event_id: id(300), pending_intent_count: '0', invalidation_count: '0',
  clinical_review_recorded: false, communication_confirmed: false, care_completed: false,
  sources: [{ analyte: 'egfr', entry_id: id(700), root_id: null, authority_organization_id: null, original_lab_result_id: null,
    observed_version_id: null, head: null, evaluation_status: null, quality: 'missing' },
  { analyte: 'potassium', entry_id: id(701), root_id: id(400), authority_organization_id: id(90), original_lab_result_id: id(600),
    observed_version_id: id(500), head, evaluation_status: 'pending', quality: 'available' }] };
describe('versioned laboratory composition contract', () => {
  it('preserves a partial mapping, frozen whitespace, decimal spelling and microseconds', () => {
    expect(compositionStateSchema.parse(prepared)).toEqual(prepared);
    expect(compositionStateSchema.parse(applied)).toEqual(applied);
    expect(compositionInputFromState(compositionStateSchema.parse(applied))).toEqual(input);
    expect(compositionDetailSchema.parse(detail)).toEqual(detail);
  });
  it.each(['actor_id', 'organization_id', 'patient_id', 'work_item_id', 'request_id'] as const)('matches frozen %s', (key) => {
    const state = compositionStateSchema.parse(applied);
    expect(compositionMatches(state, compositionInputSchema.parse(input))).toBe(true);
    expect(compositionMatches(state, compositionInputSchema.parse({ ...input, [key]: id(999) }))).toBe(false);
  });
  it.each([{ reason: payload.reason.trim() }, { evidence: payload.evidence.trim() },
    { next_action: 'Another next action' }, { occurred_at: '2026-09-01T16:00:00.123456Z' }])('does not rewrite frozen payload %#', (change) => {
    expect(compositionMatches(compositionStateSchema.parse(applied), compositionInputSchema.parse({ ...input, payload: { ...payload, ...change } }))).toBe(false);
  });
  it.each([[], [...payload.sources].reverse(), [payload.sources[1], payload.sources[1]],
    [{ ...payload.sources[0], expected_root_revision: '1' }], [{ ...payload.sources[1], expected_root_revision: null }],
    [{ ...payload.sources[1], expected_root_revision: '9223372036854775808' }], [{ ...payload.sources[1], analyte: 'other' }]])('rejects ambiguous source map %#', (sources) => {
    expect(compositionInputSchema.safeParse({ ...input, payload: { ...payload, sources } }).success).toBe(false);
  });
  it.each(['0', '01', 'bad', '1.5', '9223372036854775807', '999999999999999999999'])('rejects invalid expected revision %s without throwing', (expected_revision) => {
    expect(compositionStateSchema.safeParse({ ...applied, expected_revision }).success).toBe(false);
  });
  it.each([{ request_id: id(999) }, { work_item_id: id(999) }, { workflow_revision: '1' }, { workflow_revision: 'bad' },
    { ownership_revision: '2' }, { previous_event_id: id(300) }, { clinical_review_recorded: true }, { communication_confirmed: true },
    { care_completed: true }, { stage: 'reviewed' }, { sources: [receipt.sources[0]] }, { stage: 'requested' }])('rejects changed or overclaiming receipt %#', (change) => {
    expect(compositionStateSchema.safeParse({ ...applied, receipt: { ...receipt, ...change } }).success).toBe(false);
  });
  it('does not round workflow or source revisions above Number precision', () => {
    const value = { ...applied, expected_revision: '9007199254740993', receipt: { ...receipt, workflow_revision: '9007199254740994' } };
    expect(compositionStateSchema.parse(value)).toEqual(value);
  });
  it('supports explicit all-missing not-used without asserting result_received', () => {
    const resolutions = [{ intent_id: id(800), disposition: 'not_used', reason: 'Saved source intentionally not used' }];
    const value = { ...applied, payload: { ...payload, sources: payload.sources.map((row) => ({ ...row, root_id: null, expected_root_revision: null })), intent_resolutions: resolutions },
      receipt: { ...receipt, stage: 'requested', sources: receipt.sources.map((row) => ({ ...row, root_id: null, observed_head: null })),
        intent_resolutions: [{ ...resolutions[0], lab_result_id: id(600), matched_analytes: [], missing_analytes: ['egfr'] }] } };
    expect(compositionStateSchema.parse(value)).toEqual(value);
    expect(compositionStateSchema.safeParse({ ...value, receipt: { ...value.receipt, intent_resolutions: [{ ...value.receipt.intent_resolutions[0], matched_analytes: ['potassium'] }] } }).success).toBe(false);
  });
  it('retains linked subset and missing intended analytes separately', () => {
    const resolution = { intent_id: id(800), disposition: 'linked', reason: 'Exact saved source linked' };
    const value = { ...applied, payload: { ...payload, intent_resolutions: [resolution] }, receipt: { ...receipt,
      intent_resolutions: [{ ...resolution, lab_result_id: id(600), matched_analytes: ['potassium'], missing_analytes: ['egfr'] }] } };
    expect(compositionStateSchema.parse(value)).toEqual(value);
    for (const change of [{ matched_analytes: [] }, { missing_analytes: ['potassium'] }, { reason: 'Changed reason' },
      { intent_id: id(999) }, { matched_analytes: ['bnp'] }]) expect(compositionStateSchema.safeParse({ ...value, receipt: { ...value.receipt,
        intent_resolutions: [{ ...value.receipt.intent_resolutions[0], ...change }] } }).success).toBe(false);
  });
  it('rejects linked intent receipts that point to an explicitly missing source, including shared history', () => {
    const resolution = { intent_id: id(800), disposition: 'linked', reason: 'Exact saved source linked' };
    const value = { ...applied, payload: { ...payload, intent_resolutions: [resolution] }, receipt: { ...receipt,
      intent_resolutions: [{ ...resolution, lab_result_id: id(600), matched_analytes: ['egfr'], missing_analytes: [] }] } };
    expect(compositionStateSchema.safeParse(value).success).toBe(false);
    expect(compositionHistorySchema.safeParse({ work_item_id: id(100), items: [{ payload: value.payload, receipt: value.receipt }], next_cursor: null }).success).toBe(false);
  });
  it.each(['matched_analytes', 'missing_analytes'])('rejects non-intention analytes in %s even when mapped', (key) => {
    const resolution = { intent_id: id(800), disposition: 'linked', reason: 'Exact saved source linked' };
    const value = { ...applied, payload: { ...payload, sources: [{ ...payload.sources[1], analyte: 'bnp' }, ...payload.sources], intent_resolutions: [resolution] },
      receipt: { ...receipt, sources: [{ ...receipt.sources[1], analyte: 'bnp' }, ...receipt.sources],
        intent_resolutions: [{ ...resolution, lab_result_id: id(600), matched_analytes: ['potassium'], missing_analytes: [], [key]: ['bnp'] }] } };
    expect(compositionStateSchema.safeParse(value).success).toBe(false);
  });
  it('denies an initial all-missing receipt without not-used but permits historical unlinking', () => {
    const value = { ...applied, payload: { ...payload, sources: payload.sources.map((row) => ({ ...row, root_id: null, expected_root_revision: null })) },
      receipt: { ...receipt, sources: receipt.sources.map((row) => ({ ...row, root_id: null, observed_head: null })) } };
    expect(compositionStateSchema.safeParse(value).success).toBe(false);
    expect(compositionStateSchema.safeParse({ ...value, receipt: { ...value.receipt, previous_event_id: id(299) } }).success).toBe(true);
  });
  it.each([{ root_id: null }, { observed_version_id: null }, { authority_organization_id: null }, { quality: 'missing' },
    { head: null }, { evaluation_status: 'normal' }, { head: { ...head, value: '-1' } }])('rejects contradictory current source detail %#', (change) => {
    expect(compositionDetailSchema.safeParse({ ...detail, sources: [detail.sources[0], { ...detail.sources[1], ...change }] }).success).toBe(false);
  });
  it('shows invalid values as text and cancellation without fallback, neither as normal', () => {
    const invalid = { ...detail, sources: [detail.sources[0], { ...detail.sources[1], quality: 'invalid', head: { ...head, value: '-1' } }] };
    expect(compositionDetailSchema.parse(invalid)).toEqual(invalid);
    const cancelled = { ...detail, sources: [detail.sources[0], { ...detail.sources[1], quality: 'cancelled', evaluation_status: null,
      head: { ...head, revision: '2', version_id: id(501), status: 'cancelled', value: null, effective_lab_result_id: null } }] };
    expect(compositionDetailSchema.parse(cancelled)).toEqual(cancelled);
  });
  it('keeps immutable history with noncontiguous workflow revisions after other operational steps', () => {
    const history = { work_item_id: id(100), items: [{ payload, receipt }, { payload, receipt: { ...receipt, event_id: id(301), previous_event_id: id(300), workflow_revision: '8' } }], next_cursor: null };
    expect(compositionHistorySchema.parse(history)).toEqual(history);
    expect(compositionHistorySchema.safeParse({ ...history, items: [...history.items].reverse() }).success).toBe(false);
    expect(compositionHistorySchema.safeParse({ ...history, work_item_id: id(999) }).success).toBe(false);
  });
  it('checks complete pending25+tail and refuses ACKed, duplicated or shortened recovery', () => {
    const items = Array.from({ length: 25 }, (_, n) => ({ ...prepared, request_id: id(1000 + n) }));
    expect(compositionPendingPageSchema.parse({ items, next_cursor: id(1024) }).items).toHaveLength(25);
    for (const page of [{ items, next_cursor: id(1025) }, { items: items.slice(1), next_cursor: id(1024) },
      { items: [prepared, prepared], next_cursor: null }, { items: [{ ...applied, acknowledged_at: at }], next_cursor: null }]) {
      expect(compositionPendingPageSchema.safeParse(page).success).toBe(false);
    }
  });
  it('decodes minimized routing but rejects private fields or a reconciled obligation', () => {
    const row = { intent_id: id(800), recorded_at: at, intended_analytes: ['potassium', 'egfr'], submission: { status: 'saved_not_linked',
      lab_result_id: id(600), event_id: id(900), evaluation_status: 'pending', saved_at: at, acknowledged_at: at,
      recorded_analytes: ['potassium'], missing_analytes: ['egfr'] } };
    const page = { work_item_id: id(100), items: [row], next_cursor: null };
    expect(compositionRoutingPageSchema.parse(page)).toEqual(page);
    for (const change of [{ evidence: 'Private' }, { submission_request_id: id(999) }, { intended_analytes: ['potassium', 'potassium'] },
      { submission: { ...row.submission, status: 'saved_reconciled' } }, { submission: { ...row.submission, missing_analytes: [] } }]) {
      expect(compositionRoutingPageSchema.safeParse({ ...page, items: [{ ...row, ...change }] }).success).toBe(false);
    }
  });
  it('ties invalidation to exact composition entry and source-change version, never an auto-resolution', () => {
    const row = { id: id(800), entry_id: id(700), change_version_id: id(501), recorded_at: at, analyte: 'potassium', root_id: id(400), event_id: id(300), resolution: null };
    const page = { work_item_id: id(100), items: [row], next_cursor: null };
    expect(compositionInvalidationPageSchema.parse(page)).toEqual(page);
    expect(compositionInvalidationPageSchema.safeParse({ ...page, items: [{ ...row, resolved: true }] }).success).toBe(false);
    expect(compositionInvalidationPageSchema.safeParse({ ...page, items: [row, row] }).success).toBe(false);
    const resolution = { event_id: id(801), revision: '5', recorded_at: at, disposition: 'no_longer_used' };
    expect(compositionInvalidationPageSchema.parse({ ...page, items: [{ ...row, resolution }] }).items[0].resolution).toEqual(resolution);
    for (const changed of [undefined, {}, { ...resolution, disposition: 'complete' }, { ...resolution, revision: 'bad' }, { ...resolution, private_reason: 'Private' }]) {
      expect(compositionInvalidationPageSchema.safeParse({ ...page, items: [{ ...row, resolution: changed }] }).success).toBe(false);
    }
  });
  it('validates fresh deadlines without rewriting historical receipts', () => {
    const now = Date.parse('2026-09-29T12:00:00Z'); expect(validateNewComposition(input, now)).toEqual(input);
    for (const change of [{ occurred_at: '2026-09-29T12:00:00.000001Z' }, { next_review_at: '2026-09-29T12:00:00Z' },
      { occurred_at: '2026-02-30T00:00:00Z' }, { occurred_at: '2026-09-01T12:00:00.1234567Z' }]) {
      expect(validateNewComposition({ ...input, payload: { ...payload, ...change } }, now)).toBeNull();
    }
    expect(validateNewComposition(input, NaN)).toBeNull();
    expect(compositionStateSchema.parse(applied)).toEqual(applied);
  });
});
