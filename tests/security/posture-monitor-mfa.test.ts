/**
 * Security posture monitor: MFA count must come from the MFA admin API.
 * The admin user listing returns no factors, which made every snapshot report
 * zero verified providers and a permanently degraded gate.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const mockFrom = vi.fn();
const mockListFactors = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: { from: mockFrom, auth: { admin: { mfa: { listFactors: mockListFactors } } } },
}));

function table(result: { data?: unknown; error?: unknown; count?: number | null }) {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'neq', 'lt', 'insert']) builder[method] = vi.fn().mockReturnValue(builder);
  builder.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve({ data: result.data ?? null, error: result.error ?? null, count: result.count ?? null }).then(resolve);
  return builder;
}

function wireTables(inserted: unknown[]) {
  mockFrom.mockImplementation((name: string) => {
    switch (name) {
      case 'profiles': return table({ data: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }] });
      case 'organizations': return table({ data: [{ id: 'o1' }] });
      case 'access_reviews': return table({ data: [{ organization_id: 'o1' }] });
      case 'notification_deliveries': return table({ count: 0 });
      case 'work_items': return table({ count: 7 });
      case 'security_posture_snapshots': {
        const builder = table({ data: null });
        builder.insert = vi.fn((row: unknown) => { inserted.push(row); return builder; });
        return builder;
      }
      default: throw new Error(`unexpected table ${name}`);
    }
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  process.env.CRON_SECRET = 'test-secret';
});

describe('GET /api/security-monitor MFA counting', () => {
  it('asks the MFA admin API per provider and counts verified TOTP factors', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    wireTables(inserted);
    mockListFactors
      .mockResolvedValueOnce({ data: { factors: [{ factor_type: 'totp', status: 'verified' }] }, error: null })
      .mockResolvedValueOnce({ data: { factors: [{ factor_type: 'totp', status: 'unverified' }] }, error: null })
      .mockResolvedValueOnce({ data: { factors: [] }, error: null });

    const { GET } = await import('@/app/api/security-monitor/route');
    const response = await GET(new Request('http://localhost/api/security-monitor', { headers: { authorization: 'Bearer test-secret' } }));

    expect(response.status).toBe(200);
    expect(mockListFactors).toHaveBeenCalledTimes(3);
    expect(mockListFactors).toHaveBeenNthCalledWith(1, { userId: 'p1' });
    expect(inserted[0]).toMatchObject({ provider_count: 3, providers_with_verified_mfa: 1, gate_status: 'degraded', overdue_work_item_count: 7 });
  });

  it('passes the gate when every provider has a verified TOTP factor and nothing else is pending', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    wireTables(inserted);
    mockListFactors.mockResolvedValue({ data: { factors: [{ factor_type: 'totp', status: 'verified' }] }, error: null });

    const { GET } = await import('@/app/api/security-monitor/route');
    const response = await GET(new Request('http://localhost/api/security-monitor', { headers: { authorization: 'Bearer test-secret' } }));

    expect(response.status).toBe(200);
    expect(inserted[0]).toMatchObject({ provider_count: 3, providers_with_verified_mfa: 3, gate_status: 'pass' });
  });

  it('fails the run instead of under-counting when the MFA admin API errors', async () => {
    const inserted: Array<Record<string, unknown>> = [];
    wireTables(inserted);
    mockListFactors.mockResolvedValue({ data: null, error: { message: 'boom' } });

    const { GET } = await import('@/app/api/security-monitor/route');
    const response = await GET(new Request('http://localhost/api/security-monitor', { headers: { authorization: 'Bearer test-secret' } }));

    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(inserted).toHaveLength(0);
  });
});
