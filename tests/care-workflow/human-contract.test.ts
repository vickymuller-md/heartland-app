import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { humanBasisSchema, humanCommandSchema, humanContextSchema, humanInputFromState, humanInputSchema,
  humanMatches, humanPendingPageSchema, humanStateSchema, validateNewHumanInput } from '@/lib/care-workflow/human-types';

const id = (n: number) => `ab000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-09-29T12:00:00.123456Z', due = '2026-10-01T12:00:00Z', signature = 'a'.repeat(64);
const common = { occurred_at: at, evidence: 'Synthetic documented evidence', next_action: 'Review remaining evidence', next_review_at: due };
const review = { ...common, details: { decision: 'Synthetic professional decision', limitations: 'Partial evidence remains incomplete' } };
const contact = { ...common, details: { channel: 'phone', recipient_type: 'patient', recipient_reference: 'Synthetic recipient',
  outcome: 'human_reached', review_event_id: null, review_addressed: false, exception_id: null, reason: null } };
const missing = { analyte: 'egfr', entry_id: id(50), root_id: null, authority_organization_id: null, original_lab_result_id: null,
  observed_version_id: null, head: null, evaluation_status: null, quality: 'missing' };
const source = { analyte: 'potassium', entry_id: id(51), root_id: id(60), authority_organization_id: id(3), original_lab_result_id: id(70),
  observed_version_id: id(80), head: { version_id: id(80), revision: '1', status: 'original', effective_lab_result_id: id(70), value: '4.60', collected_at: at },
  evaluation_status: 'pending', quality: 'available' };
const processing = { lab_result_id: id(70), evaluation: { event_id: id(90), status: 'pending', completed_at: null, source_assessment: null } };
const basis = { kind: 'laboratory_order', composition_event_id: id(40), sources: [missing, source], processing: [processing], operational_event: null };
const input = { request_id: id(10), actor_id: id(1), organization_id: id(3), patient_id: id(2), work_item_id: id(5),
  expected_revision: '3', expected_ownership_revision: '1', command: 'record_review', payload: review, basis, basis_signature: signature };
const receipt = { request_id: id(10), work_item_id: id(5), event_id: id(100), command: 'record_review', workflow_revision: '4', ownership_revision: '1',
  stage: 'result_received', recorded_at: at, basis, basis_signature: signature, exception_id: null, due_at: due,
  clinical_review_recorded: true, addresses_current_review: false, communication_confirmed: false, care_completed: false };
const prepared = { ...input, state: 'prepared', recorded_at: at, acknowledged_at: null, receipt: null };
const applied = { ...prepared, state: 'applied', receipt };
const latest = { event_id: id(100), revision: '4', actor_id: id(1), occurred_at: at, recorded_at: at,
  basis_signature: signature, is_current: true, decision: review.details.decision };
const context = { actor_id: id(1), organization_id: id(3), patient_id: id(2), work_item_id: id(5), workflow_revision: '4', ownership_revision: '1',
  kind: 'laboratory_order', stage: 'result_received', command: 'record_contact', basis, basis_signature: signature, latest_review: latest };
const report = { event_id: id(110), revision: '3', occurred_at: at, recorded_at: at, command: 'record_report',
  payload: { ...common, details: { report_reference: 'Synthetic report' } } };
const referralBasis = { kind: 'referral', composition_event_id: null, sources: [], processing: [], operational_event: report };

describe('frozen human evidence and private recovery contracts', () => {
  it('decodes an exact partial laboratory review without implying completed care', () => {
    expect(humanInputSchema.parse(input)).toEqual(input);
    expect(humanStateSchema.parse(prepared)).toEqual(prepared);
    expect(humanStateSchema.parse(applied)).toEqual(applied);
    expect(humanContextSchema.parse(context)).toEqual(context);
    expect(humanInputFromState(humanStateSchema.parse(applied))).toEqual(input);
  });
  it('permits early contact without an invented result or review', () => {
    const empty = { ...referralBasis, operational_event: null };
    expect(humanContextSchema.safeParse({ ...context, kind: 'referral', stage: 'requested', basis: empty, workflow_revision: '1', latest_review: null }).success).toBe(true);
    expect(humanInputSchema.safeParse({ ...input, basis: empty, command: 'record_contact', payload: contact }).success).toBe(true);
  });
  it('rejects a forged current review of nonexistent evidence', () => {
    expect(humanContextSchema.safeParse({ ...context, kind: 'referral', stage: 'requested', basis: { ...referralBasis, operational_event: null } }).success).toBe(false);
  });
  it('rejects a contact pretending to address a current review of absent evidence', () => {
    const empty = { ...referralBasis, operational_event: null };
    const payload = { ...contact, details: { ...contact.details, review_event_id: id(100), review_addressed: true } };
    expect(humanInputSchema.safeParse({ ...input, basis: empty, command: 'record_contact', payload }).success).toBe(false);
    expect(humanStateSchema.safeParse({ ...applied, basis: empty, command: 'record_contact', payload,
      receipt: { ...receipt, basis: empty, stage: 'requested', command: 'record_contact', clinical_review_recorded: false,
        addresses_current_review: true } }).success).toBe(false);
  });
  it('rejects addressed contact receipt at an earlier factual stage even if it includes evidence', () => {
    const payload = { ...contact, details: { ...contact.details, review_event_id: id(100), review_addressed: true } };
    expect(humanStateSchema.safeParse({ ...applied, command: 'record_contact', payload,
      receipt: { ...receipt, stage: 'requested', command: 'record_contact', clinical_review_recorded: false,
        addresses_current_review: true } }).success).toBe(false);
  });
  it('rejects an operational fact from a later workflow revision', () => {
    const future = { ...referralBasis, operational_event: { ...report, revision: '9' } };
    expect(humanContextSchema.safeParse({ ...context, kind: 'referral', stage: 'report_received', basis: future }).success).toBe(false);
    expect(humanInputSchema.safeParse({ ...input, basis: future }).success).toBe(false);
  });
  it('requires an operational fact to precede the current clinical review', () => {
    expect(humanContextSchema.safeParse({ ...context, kind: 'referral', stage: 'report_received', basis: referralBasis,
      latest_review: { ...latest, revision: '3' } }).success).toBe(false);
  });
  it.each(['bad', '90071992547409930000', '-1', '1e3'])('rejects malformed nested revision %s without throwing', (revision) => {
    expect(humanContextSchema.safeParse({ ...context, latest_review: { ...latest, revision } }).success).toBe(false);
    expect(humanInputSchema.safeParse({ ...input, basis: { ...referralBasis, operational_event: { ...report, revision } } }).success).toBe(false);
  });
  it.each([{ kind: 'referral' }, { sources: [] }, { sources: [source, missing] }, { sources: [source, source] },
    { processing: [] }, { processing: [processing, processing] }, { operational_event: report }, { composition_event_id: null },
    { processing: [{ ...processing, lab_result_id: id(999) }] }, { sources: [{ ...missing, entry_id: null }, source] },
    { sources: [missing, { ...source, evaluation_status: 'recorded' }] },
    { processing: [{ ...processing, evaluation: { ...processing.evaluation, completed_at: at } }] },
    { processing: [{ ...processing, evaluation: { ...processing.evaluation, status: 'recorded' } }] },
    { processing: [{ ...processing, evaluation: { ...processing.evaluation, attempt_count: 1 } }] },
    { operational_event: undefined }])('rejects inconsistent evidence basis %#', (change) => {
    expect(humanBasisSchema.safeParse({ ...basis, ...change }).success).toBe(false);
  });
  it('distinguishes absent evaluation from a legacy terminal evaluation without assessment', () => {
    const absent = { ...basis, sources: [missing, { ...source, evaluation_status: null }], processing: [{ ...processing, evaluation: null }] };
    const legacy = { ...basis, sources: [missing, { ...source, evaluation_status: 'not_required' }],
      processing: [{ ...processing, evaluation: { ...processing.evaluation, status: 'not_required', completed_at: at } }] };
    expect(humanBasisSchema.safeParse(absent).success).toBe(true);
    expect(humanBasisSchema.safeParse(legacy).success).toBe(true);
    expect(humanBasisSchema.safeParse({ ...legacy, processing: [{ ...legacy.processing[0], evaluation: undefined }] }).success).toBe(false);
  });
  it('retains cancelled source quality and does not invent an effective result', () => {
    const cancelled = { ...source, quality: 'cancelled', evaluation_status: null,
      head: { ...source.head, version_id: id(81), revision: '2', status: 'cancelled', effective_lab_result_id: null, value: null } };
    expect(humanBasisSchema.safeParse({ ...basis, sources: [missing, cancelled], processing: [] }).success).toBe(true);
  });
  it.each([{ expected_revision: '0' }, { expected_revision: '9223372036854775807' }, { expected_revision: '1e3' },
    { expected_revision: '0003' }, { expected_ownership_revision: '-1' }, { basis_signature: 'A'.repeat(64) },
    { basis_signature: 'a'.repeat(63) }, { command: 'close_success' }, { payload: contact }, { actor_id: 'invalid' },
    { extra: true }])('rejects malformed input %#', (change) => {
    expect(humanInputSchema.safeParse({ ...input, ...change }).success).toBe(false);
  });
  it.each([{ request_id: id(999) }, { work_item_id: id(999) }, { workflow_revision: '5' }, { ownership_revision: '2' },
    { workflow_revision: 'bad' }, { command: 'record_contact' }, { basis_signature: 'b'.repeat(64) },
    { stage: 'requested' }, { clinical_review_recorded: false }, { communication_confirmed: true }, { care_completed: true },
    { addresses_current_review: true }, { exception_id: id(9) }, { basis: { ...basis, sources: [source] } }])('rejects altered receipt %#', (change) => {
    expect(humanStateSchema.safeParse({ ...applied, receipt: { ...receipt, ...change } }).success).toBe(false);
  });
  it.each([{ state: 'cancelled', receipt }, { state: 'prepared', acknowledged_at: at }, { state: 'applied', receipt: null }])('rejects contradictory terminal state %#', (change) => {
    expect(humanStateSchema.safeParse({ ...prepared, ...change }).success).toBe(false);
  });
  it('accepts bigint revisions without numeric truncation', () => {
    expect(humanStateSchema.safeParse({ ...applied, expected_revision: '9007199254740993',
      receipt: { ...receipt, workflow_revision: '9007199254740994' } }).success).toBe(true);
  });
  it.each([{ review_addressed: true }, { channel: 'automatic_email' }, { outcome: 'delivered' }, { outcome: 'no_answer' },
    { review_addressed: 'true' }, { reason: 'Unexpected barrier' }, { extra: true }, { recipient_reference: '  ' }])('rejects misleading contact payload %#', (change) => {
    expect(humanCommandSchema.safeParse({ command: 'record_contact', payload: { ...contact, details: { ...contact.details, ...change } } }).success).toBe(false);
  });
  it.each(['no_answer', 'refused', 'unable_to_contact'])('retains a distinct %s exception without marking review addressed', (outcome) => {
    const payload = { ...contact, details: { ...contact.details, outcome, exception_id: id(101), reason: 'Documented failed contact' } };
    const value = { ...applied, command: 'record_contact', payload,
      receipt: { ...receipt, command: 'record_contact', clinical_review_recorded: false, exception_id: id(101) } };
    expect(humanStateSchema.safeParse(value).success).toBe(true);
    expect(humanStateSchema.safeParse({ ...value, receipt: { ...value.receipt, exception_id: null } }).success).toBe(false);
  });
  it('matches JSON object key order without trimming evidence or changing array order', () => {
    const a = humanStateSchema.parse(applied), b = humanInputSchema.parse(input);
    expect(humanMatches(a, { ...b, actor_id: b.actor_id.toUpperCase(), payload: { ...review, evidence: review.evidence } })).toBe(true);
    expect(humanMatches(a, { ...b, payload: { ...review, evidence: review.evidence + ' ' } })).toBe(false);
    expect(humanMatches(a, { ...b, basis: { ...b.basis, composition_event_id: id(999) } })).toBe(false);
  });
  it('allows only future next review and actual occurrence, with microsecond precision', () => {
    const now = Date.parse('2026-09-29T12:00:01Z');
    expect(validateNewHumanInput(input, now)).not.toBeNull();
    expect(validateNewHumanInput({ ...input, payload: { ...review, occurred_at: '2026-09-29T12:00:01.000001Z' } }, now)).toBeNull();
    expect(validateNewHumanInput({ ...input, payload: { ...review, next_review_at: '2026-09-29T12:00:01.000001Z' } }, now)).not.toBeNull();
    expect(validateNewHumanInput(input, NaN)).toBeNull();
    expect(humanStateSchema.safeParse(applied).success).toBe(true); // Recovery does not depend on today's date.
  });
  it('checks pending cursor, ordering, duplicates and terminal state without hiding a nonempty tail', () => {
    const rows = Array.from({ length: 25 }, (_, n) => ({ ...prepared, request_id: id(1000 + n) }));
    expect(humanPendingPageSchema.safeParse({ items: rows, next_cursor: id(1024) }).success).toBe(true);
    expect(humanPendingPageSchema.safeParse({ items: rows.slice(0, 2), next_cursor: null }).success).toBe(true);
    for (const value of [ { items: rows, next_cursor: id(1000) }, { items: [rows[0], rows[0]], next_cursor: null },
      { items: [...rows].reverse(), next_cursor: null }, { items: [{ ...prepared, state: 'cancelled' }], next_cursor: null },
      { items: [{ ...applied, acknowledged_at: at }], next_cursor: null } ]) expect(humanPendingPageSchema.safeParse(value).success).toBe(false);
  });
});

// Opt-in readback proof from the disposable concurrency harness, never a hosted connection.
if (process.env.HEARTLAND_HUMAN_PROOF_DIR) describe('actual local PostgreSQL human evidence projections', () => {
  const folder = process.env.HEARTLAND_HUMAN_PROOF_DIR!;
  it('decodes every captured context and private request from the completed rehearsal', () => {
    const completion = JSON.parse(readFileSync(join(folder, 'completion.json'), 'utf8'));
    expect(completion.all_ok).toBe(true);
    for (const [file, digest] of Object.entries(completion.hashes)) {
      expect(createHash('sha256').update(readFileSync(file)).digest('hex'), file).toBe(digest);
    }
    let count = 0;
    for (const file of readdirSync(folder).filter((name) => name.endsWith('.stdout'))) {
      for (const match of readFileSync(join(folder, file), 'utf8').matchAll(/^(CONTEXT|REQUEST|RECEIPT|CANCEL):(.*)$/gm)) {
        const schema = match[1] === 'CONTEXT' ? humanContextSchema : humanStateSchema;
        expect(schema.safeParse(JSON.parse(match[2])).success, file + ': ' + match[1]).toBe(true);
        count++;
      }
    }
    expect(count).toBe(26);
  });
});
