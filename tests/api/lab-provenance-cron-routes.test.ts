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

function chain(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'lte', 'order', 'limit']) {
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

describe('GET /api/lab-alert-drain', () => {
  it('rejects a wrong cron secret', async () => {
    const { GET } = await import('@/app/api/lab-alert-drain/route');
    const response = await GET(cronRequest('nope'));
    expect(response.status).toBe(401);
  });

  it('processes pending evaluations in order and tallies terminal states', async () => {
    mockFrom.mockReturnValue(chain({
      data: [
        { id: 'ev-1', lab_result_id: 'lab-1', attempt_count: 0 },
        { id: 'ev-2', lab_result_id: 'lab-2', attempt_count: 1 },
        { id: 'ev-3', lab_result_id: 'lab-3', attempt_count: 2 },
      ],
      error: null,
    }));
    mockRpc
      .mockResolvedValueOnce({ data: [{ lab_result_id: 'lab-1', event_id: 'ev-1', status: 'recorded' }], error: null })
      .mockResolvedValueOnce({ data: [{ lab_result_id: 'lab-2', event_id: 'ev-2', status: 'not_required' }], error: null })
      .mockResolvedValueOnce({ data: [{ lab_result_id: 'lab-3', event_id: 'ev-3', status: 'pending' }], error: null });

    const { GET } = await import('@/app/api/lab-alert-drain/route');
    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ pending: 3, recorded: 1, not_required: 1, still_pending: 1, exhausted: 0, rpc_failed: 0 });
    expect(mockRpc).toHaveBeenNthCalledWith(1, 'process_lab_alert_event', { p_lab_result_id: 'lab-1' });
    expect(mockRpc).toHaveBeenNthCalledWith(3, 'process_lab_alert_event', { p_lab_result_id: 'lab-3' });
  });

  it('leaves exhausted evaluations to an operator and answers 500', async () => {
    mockFrom.mockReturnValue(chain({
      data: [
        { id: 'ev-old', lab_result_id: 'lab-old', attempt_count: 5 },
        { id: 'ev-new', lab_result_id: 'lab-new', attempt_count: 0 },
      ],
      error: null,
    }));
    mockRpc.mockResolvedValueOnce({ data: [{ lab_result_id: 'lab-new', event_id: 'ev-new', status: 'recorded' }], error: null });

    const { GET } = await import('@/app/api/lab-alert-drain/route');
    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({ pending: 2, recorded: 1, exhausted: 1, exhausted_ids: ['ev-old'] });
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it('answers 500 when the processing RPC itself fails', async () => {
    mockFrom.mockReturnValue(chain({ data: [{ id: 'ev-1', lab_result_id: 'lab-1', attempt_count: 0 }], error: null }));
    mockRpc.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'Laboratory operation not authorized' } });

    const { GET } = await import('@/app/api/lab-alert-drain/route');
    const response = await GET(cronRequest());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({ rpc_failed: 1, rpc_failed_ids: ['ev-1'] });
  });

  it('answers 500 when the pending query fails', async () => {
    mockFrom.mockReturnValue(chain({ data: null, error: { message: 'boom' } }));
    const { GET } = await import('@/app/api/lab-alert-drain/route');
    const response = await GET(cronRequest());
    expect(response.status).toBe(500);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
