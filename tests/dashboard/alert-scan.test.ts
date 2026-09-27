/**
 * Alert Scan Cron Route -- Tests
 * Requirements: ALRT-01 through ALRT-05, ALRT-07
 *
 * Tests the batch alert scan endpoint and query helpers.
 * Route-level tests mock Supabase admin; query helper tests verify logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
const { mockDrain } = vi.hoisted(() => ({ mockDrain: vi.fn() }));
vi.mock('@/lib/dashboard/scan-runner', () => ({ drainAlertScan: mockDrain }));

// Mock server-only (throws in non-server context)
vi.mock('server-only', () => ({}));

// Mock next/cache (revalidatePath not available in test)
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

// Mock the admin client used by the route
const mockFrom = vi.fn();
const mockAdminClient = {
  from: mockFrom,
};
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: mockAdminClient,
}));

// Mock getAdherenceData
vi.mock('@/lib/medications/queries', () => ({
  getAdherenceData: vi.fn().mockResolvedValue([]),
  getPatientMedications: vi.fn().mockResolvedValue([]),
  getTodayLogs: vi.fn().mockResolvedValue([]),
  computeAdherenceDay: vi.fn(),
}));

// ---------- getAlertPreferences ----------

describe('getAlertPreferences', () => {
  it('returns muted alert types for a provider-patient pair', async () => {
    const mockSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({
          data: [
            { alert_type: 'no_checkin', muted: true },
            { alert_type: 'low_adherence', muted: false },
          ],
          error: null,
        }),
      }),
    });
    const mockSupabase = { from: vi.fn().mockReturnValue({ select: mockSelect }) } as any;

    const { getAlertPreferences } = await import('@/lib/dashboard/queries');
    const prefs = await getAlertPreferences(mockSupabase, 'provider-1', 'patient-1');

    expect(prefs).toEqual([
      { alert_type: 'no_checkin', muted: true },
      { alert_type: 'low_adherence', muted: false },
    ]);
    expect(mockSupabase.from).toHaveBeenCalledWith('alert_preferences');
  });

  it('returns empty array when no preferences exist', async () => {
    const mockSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({
          data: [],
          error: null,
        }),
      }),
    });
    const mockSupabase = { from: vi.fn().mockReturnValue({ select: mockSelect }) } as any;

    const { getAlertPreferences } = await import('@/lib/dashboard/queries');
    const prefs = await getAlertPreferences(mockSupabase, 'provider-1', 'patient-1');

    expect(prefs).toEqual([]);
  });
});

// ---------- getPatientNoCheckinStatus ----------

describe('getPatientNoCheckinStatus', () => {
  it('returns map with lastVitalsAt and createdAt per patient', async () => {
    const fromMap: Record<string, any> = {
      vitals: {
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: [
                { patient_id: 'p1', recorded_at: '2026-03-25T10:00:00Z' },
                { patient_id: 'p1', recorded_at: '2026-03-24T10:00:00Z' },
              ],
              error: null,
            }),
          }),
        }),
      },
      patients: {
        select: vi.fn().mockReturnValue({
          in: vi.fn().mockResolvedValue({
            data: [
              { id: 'p1', created_at: '2026-03-01T00:00:00Z' },
              { id: 'p2', created_at: '2026-03-20T00:00:00Z' },
            ],
            error: null,
          }),
        }),
      },
    };
    const mockSupabase = {
      from: vi.fn((table: string) => fromMap[table]),
    } as any;

    const { getPatientNoCheckinStatus } = await import('@/lib/dashboard/queries');
    const result = await getPatientNoCheckinStatus(mockSupabase, ['p1', 'p2']);

    expect(result.get('p1')).toEqual({
      lastVitalsAt: '2026-03-25T10:00:00Z',
      createdAt: '2026-03-01T00:00:00Z',
    });
    expect(result.get('p2')).toEqual({
      lastVitalsAt: null,
      createdAt: '2026-03-20T00:00:00Z',
    });
  });
});

// ---------- Alert Scan Route Auth ----------

describe('Alert Scan Route - Authorization', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    mockFrom.mockReset();
    mockDrain.mockReset();
  });

  it('returns 401 when Authorization header is missing', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret-123');

    const { GET } = await import('@/app/api/alert-scan/route');
    const request = new Request('http://localhost:3000/api/alert-scan');
    const response = await GET(request);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 401 when Authorization header has wrong secret', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret-123');

    const { GET } = await import('@/app/api/alert-scan/route');
    const request = new Request('http://localhost:3000/api/alert-scan', {
      headers: { Authorization: 'Bearer wrong-secret' },
    });
    const response = await GET(request);

    expect(response.status).toBe(401);
  });

  it('returns 200 only after the durable runner confirms no unresolved work', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret-123');
    vi.stubEnv('ALERT_SCAN_RECOVERY_ENABLED', 'true');
    mockDrain.mockResolvedValue({ complete: true, receipts_visited: 0, processing_errors: 0,
      budget_exhausted: false, status: { patients: 0, capture_pending: 0, capture_blocked: 0,
        rules_pending: 0, rules_blocked: 0, routing_exceptions: 0, rules_complete: 0 } });

    const { GET } = await import('@/app/api/alert-scan/route');
    const request = new Request('http://localhost:3000/api/alert-scan', {
      headers: { Authorization: 'Bearer test-secret-123' },
    });
    const response = await GET(request);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.complete).toBe(true);
    expect(body.receipts_visited).toBe(0);
    expect(mockFrom).not.toHaveBeenCalled();
  });
  it('fails visibly while cutover is not enabled, with no legacy fallback', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret-123');
    const { GET } = await import('@/app/api/alert-scan/route');
    const response = await GET(new Request('http://localhost/api/alert-scan', { headers: { Authorization: 'Bearer test-secret-123' } }));
    expect(response.status).toBe(503); expect(mockDrain).not.toHaveBeenCalled(); expect(mockFrom).not.toHaveBeenCalled();
  });
  it('returns503 on unresolved processing without exposing source errors', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret-123'); vi.stubEnv('ALERT_SCAN_RECOVERY_ENABLED', 'true');
    mockDrain.mockResolvedValue({ complete: false, receipts_visited: 1, processing_errors: 1, status: null });
    const { GET } = await import('@/app/api/alert-scan/route');
    expect((await GET(new Request('http://localhost/api/alert-scan', { headers: { Authorization: 'Bearer test-secret-123' } }))).status).toBe(503);
    mockDrain.mockRejectedValue(new Error('Synthetic private source details must not be returned'));
    const response = await GET(new Request('http://localhost/api/alert-scan', { headers: { Authorization: 'Bearer test-secret-123' } }));
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('Synthetic private');
  });
  it('returns503 with no service work if CRON_SECRET is missing', async () => {
    const { GET } = await import('@/app/api/alert-scan/route');
    expect((await GET(new Request('http://localhost/api/alert-scan'))).status).toBe(503);
    expect(mockDrain).not.toHaveBeenCalled();
  });
});
