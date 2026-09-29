/**
 * Sandbox cleanup and lab alert drain cron routes.
 * Both run with the service-role client; both must surface failures as non-2xx
 * responses so scheduled runs never report a silent success.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const mockFrom = vi.fn();
const mockRpc = vi.fn();
const mockDeleteUser = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: { from: mockFrom, rpc: mockRpc, auth: { admin: { deleteUser: mockDeleteUser } } },
}));

function chain(result: { data: unknown; error: unknown; count?: number | null }) {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'lte', 'lt', 'gte', 'order', 'limit']) {
    builder[method] = vi.fn().mockReturnValue(builder);
  }
  builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return builder;
}

function cronRequest(secret = 'test-secret') {
  return new Request('http://localhost/api/cron', { headers: { authorization: `Bearer ${secret}` } });
}

beforeEach(() => {
  vi.resetAllMocks();
  process.env.CRON_SECRET = 'test-secret';
});

describe('GET /api/sandbox-cleanup', () => {
  it('rejects a missing or wrong cron secret', async () => {
    const { GET } = await import('@/app/api/sandbox-cleanup/route');
    const response = await GET(new Request('http://localhost/api/cron'));
    expect(response.status).toBe(401);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('erases provenance before deleting each expired tester and reports success', async () => {
    mockFrom.mockReturnValue(chain({ data: [{ id: 'tester-1' }, { id: 'tester-2' }], error: null }));
    mockRpc.mockResolvedValue({ data: [{ receipts_deleted: 1, attempts_deleted: 2, evaluations_detached: 0 }], error: null });
    mockDeleteUser.mockResolvedValue({ data: {}, error: null });

    const { GET } = await import('@/app/api/sandbox-cleanup/route');
    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ expired: 2, deleted: 2, failed: 0, failures: [] });
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(mockRpc).toHaveBeenNthCalledWith(1, 'purge_expired_tester_provenance', { p_actor_id: 'tester-1' });
    expect(mockDeleteUser).toHaveBeenCalledTimes(2);
    // Erasure always precedes deletion for the same account.
    expect(mockRpc.mock.invocationCallOrder[0]).toBeLessThan(mockDeleteUser.mock.invocationCallOrder[0]);
  });

  it('skips deletion and answers 500 when the erasure is refused', async () => {
    mockFrom.mockReturnValue(chain({ data: [{ id: 'tester-1' }], error: null }));
    mockRpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'Laboratory erasure is limited to expired tester accounts' } });

    const { GET } = await import('@/app/api/sandbox-cleanup/route');
    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.failed).toBe(1);
    expect(body.failures).toEqual([{ id: 'tester-1', stage: 'purge', code: '42501' }]);
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });

  it('answers 500 and names the account when the auth deletion fails', async () => {
    mockFrom.mockReturnValue(chain({ data: [{ id: 'tester-1' }], error: null }));
    mockRpc.mockResolvedValue({ data: [], error: null });
    mockDeleteUser.mockResolvedValue({ data: null, error: { code: 'unexpected_failure', message: 'boom' } });

    const { GET } = await import('@/app/api/sandbox-cleanup/route');
    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({ expired: 1, deleted: 0, failed: 1 });
    expect(body.failures[0]).toMatchObject({ id: 'tester-1', stage: 'delete' });
  });

  it('answers 200 with zero work when nothing expired', async () => {
    mockFrom.mockReturnValue(chain({ data: [], error: null }));
    const { GET } = await import('@/app/api/sandbox-cleanup/route');
    const response = await GET(cronRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ expired: 0, deleted: 0, failed: 0, failures: [] });
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

const guid = (n: number) => `65000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function drainBatch(rows: Array<{ id: string; lab_result_id: string; attempt_count: number }>, exhaustedCount = 0) {
  const queries: Array<Record<string, unknown>> = [];
  mockFrom.mockImplementation(() => {
    const exhausted = queries.length % 2 === 1;
    const query = chain({ data: exhausted ? Array.from({ length: Math.min(exhaustedCount, 50) }, (_, n) => ({ id: guid(1000 + n) })) : rows,
      error: null, count: exhausted ? exhaustedCount : null });
    queries.push(query); return query;
  });
  return queries;
}
const candidate = (n = 1, attempt_count = 0) => ({ id: guid(n), lab_result_id: guid(n + 100), attempt_count });
const receipt = (n = 1, status = 'recorded') => ({ data: [{ event_id: guid(n), lab_result_id: guid(n + 100), status }], error: null });

describe('GET /api/lab-alert-drain', () => {
  it('rejects wrong or missing configuration before touching the queue', async () => {
    const { GET } = await import('@/app/api/lab-alert-drain/route');
    expect((await GET(cronRequest('nope'))).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await GET(cronRequest())).status).toBe(503);
    expect(mockFrom).not.toHaveBeenCalled();
  });
  it('tallies all terminal states and marks still-pending processing as a failed run', async () => {
    drainBatch([candidate(1), candidate(2, 1), candidate(3, 2), candidate(4)]);
    mockRpc.mockResolvedValueOnce(receipt(1)).mockResolvedValueOnce(receipt(2, 'not_required'))
      .mockResolvedValueOnce(receipt(3, 'invalidated')).mockResolvedValueOnce(receipt(4, 'pending'));
    const { GET } = await import('@/app/api/lab-alert-drain/route');
    const response = await GET(cronRequest());
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ pending: 4, recorded: 1, not_required: 1, invalidated: 1, still_pending: 1, exhausted: 0, rpc_failed: 0 });
    expect(mockRpc).toHaveBeenNthCalledWith(4, 'process_lab_alert_event', { p_lab_result_id: guid(104) });
  });
  it('fifty older exhausted events do not starve a new eligible event', async () => {
    const queries = drainBatch([candidate()], 50); mockRpc.mockResolvedValue(receipt());
    const { GET } = await import('@/app/api/lab-alert-drain/route');
    const response = await GET(cronRequest()); const body = await response.json();
    expect(response.status).toBe(500);
    expect(body).toMatchObject({ pending: 1, recorded: 1, exhausted: 50, exhausted_sample_truncated: false });
    expect(body.exhausted_ids).toHaveLength(50);
    expect(queries[0].lt).toHaveBeenCalledWith('attempt_count', 5);
    expect(queries[1].gte).toHaveBeenCalledWith('attempt_count', 5);
    expect(queries[0].limit).toHaveBeenCalledWith(50);
    expect(queries[1].select).toHaveBeenCalledWith('id', { count: 'exact' });
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });
  it('keeps the exhausted sample bounded while retaining the full count', async () => {
    drainBatch([], 1001);
    const { GET } = await import('@/app/api/lab-alert-drain/route');
    const response = await GET(cronRequest()); const body = await response.json();
    expect(response.status).toBe(500); expect(body.exhausted).toBe(1001);
    expect(body.exhausted_ids).toHaveLength(50); expect(body.exhausted_sample_truncated).toBe(true);
    expect(mockRpc).not.toHaveBeenCalled();
  });
  it.each([
    { data: null, error: null }, { data: [], error: null },
    { data: [{ event_id: guid(9), lab_result_id: guid(101), status: 'recorded' }], error: null },
    { data: [{ event_id: guid(1), lab_result_id: guid(109), status: 'invalidated' }], error: null },
    { data: [receipt().data[0], receipt().data[0]], error: null },
    receipt(1, 'complete'), { data: null, error: { code: '42501', message: 'private detail' } },
  ])('reports malformed or unconfirmed processing %# without success', async (result) => {
    drainBatch([candidate()]); mockRpc.mockResolvedValue(result);
    const { GET } = await import('@/app/api/lab-alert-drain/route');
    const response = await GET(cronRequest()); const body = await response.json();
    expect(response.status).toBe(500);
    expect(body).toMatchObject({ recorded: 0, invalidated: 0, rpc_failed: 1, rpc_failed_ids: [guid(1)] });
    expect(JSON.stringify(body)).not.toContain('private detail');
  });
  it('continues a bounded batch after a transport exception', async () => {
    drainBatch([candidate(1), candidate(2)]);
    mockRpc.mockRejectedValueOnce(new Error('private')).mockResolvedValueOnce(receipt(2, 'invalidated'));
    const { GET } = await import('@/app/api/lab-alert-drain/route');
    const response = await GET(cronRequest());
    expect(response.status).toBe(500); expect(await response.json()).toMatchObject({ rpc_failed: 1, invalidated: 1 });
  });
  it.each([null, [{ id: 'bad', lab_result_id: guid(101), attempt_count: 0 }], [candidate(1, 5)], [candidate(), candidate()]])(
    'fails closed on malformed query data %#', async (data) => {
      mockFrom.mockReturnValue(chain({ data, error: null, count: 0 }));
      const { GET } = await import('@/app/api/lab-alert-drain/route');
      expect((await GET(cronRequest())).status).toBe(500); expect(mockRpc).not.toHaveBeenCalled();
    });
  it('fails closed when a query fails or exact exhausted count is unavailable', async () => {
    const { GET } = await import('@/app/api/lab-alert-drain/route');
    for (const value of [{ data: null, error: { message: 'private' } }, { data: [], error: null }]) {
      mockFrom.mockReturnValue(chain(value));
      expect((await GET(cronRequest())).status).toBe(500);
    }
    expect(mockRpc).not.toHaveBeenCalled();
  });
  it('reports a successfully empty bounded batch with explicit zero counts', async () => {
    drainBatch([]);
    const { GET } = await import('@/app/api/lab-alert-drain/route');
    const response = await GET(cronRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ pending: 0, recorded: 0, not_required: 0, invalidated: 0, still_pending: 0,
      exhausted: 0, rpc_failed: 0, exhausted_ids: [], exhausted_sample_truncated: false, rpc_failed_ids: [] });
  });
});
