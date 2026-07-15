/**
 * Track B: Provider Data Entry -- Tests
 * Requirements: TRKB-02 (provider vitals entry form), TRKB-03 (server action with source='provider_entry')
 * Source: HEARTLAND Protocol v3.3 Module 5 -- Analog Track
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

// --- Mocks for submitVitalsAsProvider ---

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const { mockAuthorizeProvider } = vi.hoisted(() => ({
  mockAuthorizeProvider: vi.fn(),
}));

vi.mock('@/lib/auth/authorization', () => ({
  authorizeProviderForPatient: mockAuthorizeProvider,
  authorize: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    rpc: vi.fn().mockResolvedValue({ data: [{ alert_id: 'a-1', created: true }], error: null }),
    from: () => ({
      select: () => ({
        eq: () => ({ in: vi.fn().mockResolvedValue({ data: [], error: null }) }),
      }),
      insert: vi.fn().mockResolvedValue({ error: null }),
    }),
  },
}));

// Track calls for assertion
let insertCalls: Record<string, unknown>[] = [];
let linkResult: { data: unknown; error: unknown };
let vitalsResult: { data: unknown; error: unknown };
let symptomsResult: { error: unknown };

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      from: mockFrom,
    })
  ),
}));

vi.mock('@/lib/vitals/red-flags', () => ({
  evaluateRedFlags: vi.fn(() => []),
}));

vi.mock('@/lib/vitals/queries', () => ({
  getRecentVitals: vi.fn(() => Promise.resolve([])),
}));

function setupChain() {
  insertCalls = [];
  linkResult = { data: null, error: null };
  vitalsResult = { data: { id: 'v-1', patient_id: '11111111-1111-4111-8111-111111111111', source: 'provider_entry' }, error: null };
  symptomsResult = { error: null };

  // Build chainable eq mock
  function makeEq(resolveWith: () => { data: unknown; error: unknown }) {
    const eqFn: ReturnType<typeof vi.fn> = vi.fn(() => ({
      eq: eqFn,
      maybeSingle: () => Promise.resolve(resolveWith()),
      single: () => Promise.resolve(resolveWith()),
    }));
    return eqFn;
  }

  mockFrom.mockImplementation((table: string) => {
    if (table === 'provider_patient_links') {
      const eq = makeEq(() => linkResult);
      return { select: () => ({ eq }), insert: vi.fn() };
    }
    if (table === 'vitals') {
      return {
        insert: (row: Record<string, unknown>) => {
          insertCalls.push(row);
          const eq = makeEq(() => vitalsResult);
          return { select: () => ({ eq, single: () => Promise.resolve(vitalsResult) }) };
        },
      };
    }
    if (table === 'symptoms') {
      return {
        insert: (row: Record<string, unknown>) => {
          insertCalls.push(row);
          return Promise.resolve(symptomsResult);
        },
      };
    }
    // Default: profiles table etc.
    const eq = makeEq(() => ({ data: null, error: null }));
    return { select: () => ({ eq }), insert: vi.fn() };
  });
}

function makeFormData(overrides: Record<string, string> = {}): FormData {
  const defaults: Record<string, string> = {
    patientId: '11111111-1111-4111-8111-111111111111',
    weight: '165',
    weightUnit: 'lbs',
    sbp: '120',
    dbp: '80',
    heartRate: '72',
    spo2: '97',
    dyspnea: '0',
    edema: '0',
    orthopnea: 'false',
    fatigue: '0',
  };
  const fd = new FormData();
  for (const [k, v] of Object.entries({ ...defaults, ...overrides })) {
    fd.set(k, v);
  }
  return fd;
}

describe('Track B: Provider Data Entry (TRKB-02, TRKB-03)', () => {
  describe('submitVitalsAsProvider', () => {
    let submitVitalsAsProvider: typeof import('@/lib/vitals/actions').submitVitalsAsProvider;

    beforeEach(async () => {
      vi.clearAllMocks();
      setupChain();
      mockAuthorizeProvider.mockResolvedValue({
        authorized: true,
        user: { id: 'provider-1' },
        role: 'provider',
        supabase: { from: mockFrom },
      });
      const mod = await import('@/lib/vitals/actions');
      submitVitalsAsProvider = mod.submitVitalsAsProvider;
    });

    it('returns error when not authenticated', async () => {
      mockAuthorizeProvider.mockResolvedValueOnce({ authorized: false, error: 'Not authenticated' });
      const result = await submitVitalsAsProvider(null, makeFormData());
      expect(result.error).toBe('Not authenticated');
    });

    it('returns error when patient not linked to provider', async () => {
      mockAuthorizeProvider.mockResolvedValueOnce({ authorized: false, error: 'Unauthorized' });
      const result = await submitVitalsAsProvider(null, makeFormData());
      expect(result.error).toBe('Unauthorized');
    });

    it('inserts vitals with source = "provider_entry"', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'provider-1' } } });
      linkResult = { data: { id: 'link-1' }, error: null };
      vitalsResult = { data: { id: 'v-1', patient_id: '11111111-1111-4111-8111-111111111111', source: 'provider_entry' }, error: null };

      await submitVitalsAsProvider(null, makeFormData());

      // First insertCalls entry = vitals
      expect(insertCalls.length).toBeGreaterThanOrEqual(1);
      expect(insertCalls[0]).toMatchObject({
        patient_id: '11111111-1111-4111-8111-111111111111',
        source: 'provider_entry',
      });
    });

    it('uses formData patientId as patient_id (not the provider user.id)', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'provider-1' } } });
      linkResult = { data: { id: 'link-1' }, error: null };
      vitalsResult = { data: { id: 'v-1', patient_id: '22222222-2222-4222-8222-222222222222' }, error: null };

      await submitVitalsAsProvider(null, makeFormData({ patientId: '22222222-2222-4222-8222-222222222222' }));

      expect(insertCalls[0].patient_id).toBe('22222222-2222-4222-8222-222222222222');
      expect(insertCalls[0].patient_id).not.toBe('provider-1');
    });

    it('evaluates red flags using evaluateRedFlags engine', async () => {
      const { evaluateRedFlags } = await import('@/lib/vitals/red-flags');
      mockGetUser.mockResolvedValue({ data: { user: { id: 'provider-1' } } });
      linkResult = { data: { id: 'link-1' }, error: null };

      await submitVitalsAsProvider(null, makeFormData());

      expect(evaluateRedFlags).toHaveBeenCalled();
    });

    it('returns redFlags array in success state when thresholds exceeded', async () => {
      const { evaluateRedFlags } = await import('@/lib/vitals/red-flags');
      const mockFlags = [{ id: 'spo2_low', severity: 'critical', message: 'Low SpO2', action: 'Seek care' }];
      (evaluateRedFlags as ReturnType<typeof vi.fn>).mockReturnValue(mockFlags);

      mockGetUser.mockResolvedValue({ data: { user: { id: 'provider-1' } } });
      linkResult = { data: { id: 'link-1' }, error: null };

      const result = await submitVitalsAsProvider(null, makeFormData());

      expect(result.success).toBe(true);
      expect(result.redFlags).toEqual(mockFlags);
    });

    it('inserts symptoms row with same recorded_at as vitals row', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'provider-1' } } });
      linkResult = { data: { id: 'link-1' }, error: null };

      await submitVitalsAsProvider(null, makeFormData());

      // insertCalls: [0] = vitals, [1] = symptoms
      expect(insertCalls.length).toBe(2);
      expect((insertCalls[1] as Record<string, unknown>).recorded_at).toBe(
        (insertCalls[0] as Record<string, unknown>).recorded_at
      );
    });

    it('uses recordedAt from formData if provided', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'provider-1' } } });
      linkResult = { data: { id: 'link-1' }, error: null };

      await submitVitalsAsProvider(null, makeFormData({ recordedAt: '2026-03-20T12:00:00Z' }));

      expect((insertCalls[0] as Record<string, unknown>).recorded_at).toBe('2026-03-20T12:00:00Z');
    });
  });

  describe('ProviderVitalsForm', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('renders weight, BP, HR, SpO2 fields plus date picker', async () => {
      const { default: ProviderVitalsForm } = await import(
        '@/app/(provider)/patients/[patientId]/track-b-entry/_components/provider-vitals-form'
      );
      render(<ProviderVitalsForm patientId="p-1" />);
      expect(screen.getByLabelText(/weight/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/systolic/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/diastolic/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/heart rate/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/spo2/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/date/i)).toBeInTheDocument();
    });

    it('renders all symptom fields (dyspnea, edema, orthopnea, fatigue)', async () => {
      const { default: ProviderVitalsForm } = await import(
        '@/app/(provider)/patients/[patientId]/track-b-entry/_components/provider-vitals-form'
      );
      render(<ProviderVitalsForm patientId="p-1" />);
      expect(screen.getByText(/shortness of breath/i)).toBeInTheDocument();
      expect(screen.getByText(/swelling/i)).toBeInTheDocument();
      expect(screen.getByText(/breathing lying down/i)).toBeInTheDocument();
      expect(screen.getByText(/tiredness/i)).toBeInTheDocument();
    });

    it('renders hidden patientId field in the form', async () => {
      const { default: ProviderVitalsForm } = await import(
        '@/app/(provider)/patients/[patientId]/track-b-entry/_components/provider-vitals-form'
      );
      const { container } = render(<ProviderVitalsForm patientId="p-1" />);
      const hidden = container.querySelector('input[name="patientId"][type="hidden"]') as HTMLInputElement;
      expect(hidden).toBeInTheDocument();
      expect(hidden.value).toBe('p-1');
    });

    it('renders a submit button with accessible label', async () => {
      const { default: ProviderVitalsForm } = await import(
        '@/app/(provider)/patients/[patientId]/track-b-entry/_components/provider-vitals-form'
      );
      render(<ProviderVitalsForm patientId="p-1" />);
      expect(screen.getByRole('button', { name: /save vitals/i })).toBeInTheDocument();
    });

    it('renders lbs/kg unit toggle', async () => {
      const { default: ProviderVitalsForm } = await import(
        '@/app/(provider)/patients/[patientId]/track-b-entry/_components/provider-vitals-form'
      );
      render(<ProviderVitalsForm patientId="p-1" />);
      expect(screen.getByText('lbs')).toBeInTheDocument();
      expect(screen.getByText('kg')).toBeInTheDocument();
    });
  });
});
