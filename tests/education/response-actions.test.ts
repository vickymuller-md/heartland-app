import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EDUCATION_DOMAINS } from '@/lib/education/constants';
import type { EducationResponseContext, EducationResponseInput } from '@/lib/education/types';
const { authorize, rpc, revalidatePath } = vi.hoisted(() => ({ authorize: vi.fn(), rpc: vi.fn(), revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/authorization', () => ({ authorize }));
vi.mock('next/cache', () => ({ revalidatePath }));
import { readEducationContext, submitEducationResponse, recoverEducationResponse } from '@/lib/education/actions';

const actorId = '58000000-0000-4000-8000-000000000001';
const otherActor = '58000000-0000-4000-8000-000000000002';
const requestId = '58000000-0000-4000-8000-000000000101';
const contentVersion = createHash('sha256').update(JSON.stringify(EDUCATION_DOMAINS.map(({ id, question }) => ({ id, question })))).digest('hex');
const input: EducationResponseInput = { actorId, requestId, contentVersion, domainId: 'daily_weight', selectedOption: 1, expectedRevision: 0 };
const initial: EducationResponseContext = { actorId, domainId: 'daily_weight', contentVersion, revision: 0, attempts: 0, completed: false, lastResponse: null };
function saved(overrides: Partial<EducationResponseContext> = {}): EducationResponseContext {
  return { ...initial, revision: 1, attempts: 1, completed: true,
    lastResponse: { requestId, selectedOption: 1, contentVersion, baseRevision: 0, correct: true }, ...overrides };
}
beforeEach(() => {
  vi.resetAllMocks();
  authorize.mockResolvedValue({ authorized: true, user: { id: actorId }, role: 'patient', supabase: { rpc } });
  rpc.mockResolvedValue({ data: initial, error: null });
});

describe('ED01 content contract', () => {
  it('pins the exact ordered questions/options/answer keys in SQL', () => {
    const sql = readFileSync('supabase/migrations/00056_atomic_education_responses.sql', 'utf8');
    expect(sql).toContain(`'${contentVersion}'`);
    expect(EDUCATION_DOMAINS).toHaveLength(8);
    for (const domain of EDUCATION_DOMAINS) {
      expect(domain.question.options).toHaveLength(4);
      expect(sql).toContain(`('${domain.id}',${domain.question.correctIndex})`);
    }
  });
});

describe('ED01 response actions', () => {
  it('reads through one scoped RPC using the page identity', async () => {
    expect(await readEducationContext(actorId, 'daily_weight')).toEqual({ status: 'ready', context: initial });
    expect(authorize).toHaveBeenCalledWith('patient');
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_education_response_context', { p_expected_actor: actorId, p_domain_id: 'daily_weight' });
  });
  it.each(['missing', '', null])('rejects unknown domain %s before database access', async (domain) => {
    expect((await readEducationContext(actorId, domain as string)).status).toBe('error');
    expect(rpc).not.toHaveBeenCalled();
  });
  it('fails closed on a session switch before read, write and recovery', async () => {
    authorize.mockResolvedValue({ authorized: true, user: { id: otherActor }, supabase: { rpc } });
    expect((await readEducationContext(actorId, 'daily_weight')).status).toBe('error');
    expect((await submitEducationResponse(input)).status).toBe('unconfirmed');
    expect((await recoverEducationResponse(input)).status).toBe('unconfirmed');
    expect(rpc).not.toHaveBeenCalled();
  });
  it('does not access receipts after authorization is withdrawn', async () => {
    authorize.mockResolvedValue({ authorized: false, error: 'Consent required' });
    expect((await submitEducationResponse(input)).status).toBe('unconfirmed');
    expect((await recoverEducationResponse(input)).status).toBe('unconfirmed');
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([null, undefined, {}, { ...initial, actorId: otherActor }, { ...initial, revision: 1 },
    { ...initial, contentVersion: 'old' }, { ...initial, attempts: -1 }])('rejects malformed context %#', async (data) => {
    rpc.mockResolvedValue({ data, error: null });
    expect((await readEducationContext(actorId, 'daily_weight')).status).toBe('error');
  });
  it.each([{ selectedOption: -1 }, { selectedOption: 4 }, { selectedOption: 1.5 }, { expectedRevision: -1 },
    { contentVersion: 'old' }, { requestId: 'not-uuid' }, { domainId: 'unrecognized' }, { actorId: null }])('rejects bad input %#', async (change) => {
    const invalid = { ...input, ...change } as EducationResponseInput;
    expect((await submitEducationResponse(invalid)).status).toBe('unconfirmed');
    expect((await recoverEducationResponse(invalid)).status).toBe('unconfirmed');
    expect(rpc).not.toHaveBeenCalled();
  });
  it('submits one atomic operation with no supplied correctness boolean', async () => {
    rpc.mockResolvedValue({ data: { status: 'saved', context: saved() }, error: null });
    expect((await submitEducationResponse(input)).status).toBe('saved');
    expect(rpc).toHaveBeenCalledExactlyOnceWith('submit_education_response', {
      p_expected_actor: actorId, p_domain_id: 'daily_weight', p_request_id: requestId,
      p_selected_option: 1, p_expected_revision: 0, p_content_version: contentVersion,
    });
    expect(revalidatePath).toHaveBeenCalledWith('/education');
  });
  it('keeps a confirmed receipt when cache refresh fails', async () => {
    rpc.mockResolvedValue({ data: { status: 'saved', context: saved() }, error: null });
    revalidatePath.mockImplementation(() => { throw new Error('cache unavailable'); });
    expect((await submitEducationResponse(input)).status).toBe('saved');
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it.each([null, {}, { success: true }, { status: 'saved' }, { status: 'saved', context: saved({ completed: false }) },
    { status: 'saved', context: saved({ revision: 2 }) }, { status: 'saved', context: saved({ actorId: otherActor }) }])('never infers persistence from malformed success %#', async (data) => {
    rpc.mockResolvedValue({ data, error: null });
    expect((await submitEducationResponse(input)).status).toBe('unconfirmed');
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it('does not confuse prior completion with correctness of a wrong answer', async () => {
    const context = saved({ lastResponse: { requestId, selectedOption: 0, contentVersion, baseRevision: 0, correct: false } });
    rpc.mockResolvedValue({ data: { status: 'saved', context }, error: null });
    expect(await submitEducationResponse({ ...input, selectedOption: 0 })).toEqual({ status: 'saved', context });
    expect((await submitEducationResponse(input)).status).toBe('unconfirmed');
  });
  it('returns conflict without retrying or rebasing', async () => {
    rpc.mockResolvedValue({ data: { status: 'conflict' }, error: null });
    expect((await submitEducationResponse(input)).status).toBe('conflict');
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('recovers a matching committed response with a read only', async () => {
    rpc.mockResolvedValue({ data: saved(), error: null });
    expect((await recoverEducationResponse(input)).status).toBe('saved');
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['get_education_response_context']);
  });
  it('reports absence without submitting', async () => {
    expect(await recoverEducationResponse(input)).toEqual({ status: 'absent' });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['get_education_response_context']);
  });
  it('does not recover a superseded or mismatched response as this answer', async () => {
    rpc.mockResolvedValue({ data: saved({ lastResponse: { ...saved().lastResponse!, requestId: otherActor } }), error: null });
    expect((await recoverEducationResponse(input)).status).toBe('conflict');
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it.each(['throw', 'error'])('handles %s without converting uncertainty to success', async (kind) => {
    if (kind === 'throw') rpc.mockRejectedValue(new Error('response lost'));
    else rpc.mockResolvedValue({ data: saved(), error: { message: 'private database information' } });
    expect((await submitEducationResponse(input)).status).toBe('unconfirmed');
    expect((await recoverEducationResponse(input)).status).toBe('unconfirmed');
    expect((await readEducationContext(actorId, 'daily_weight')).status).toBe('error');
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
