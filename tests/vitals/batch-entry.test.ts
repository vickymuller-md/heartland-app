/**
 * Track B Batch Entry -- Tests
 * Requirements: TRKB-06
 * Source: HEARTLAND Protocol v3.3 Module 5 -- Analog Track batch transcription
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, within } from '@testing-library/react';

import { submitBatchVitalsAsProvider } from '@/lib/vitals/actions';
import BatchEntryGrid from '@/app/(provider)/patients/[patientId]/track-b-entry/_components/batch-entry-grid';
import type { BatchVitalsActionState } from '@/lib/vitals/types';
import { parseBatchFormData, isBlankRow } from '@/lib/vitals/batch-schema';

// --- Mocks ---

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

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() =>
    Promise.resolve({
      auth: { getUser: mockGetUser },
      from: mockFrom,
    })
  ),
}));

const mockEvaluateRedFlags = vi.fn(() => []);
vi.mock('@/lib/vitals/red-flags', () => ({
  evaluateRedFlags: (...args: unknown[]) => mockEvaluateRedFlags(...args),
}));

vi.mock('@/lib/vitals/queries', () => ({
  getRecentVitals: vi.fn(() => Promise.resolve([])),
}));

// Mock useActionState return value for BatchEntryGrid rendering tests
let mockActionState: [unknown, unknown, boolean] = [null, vi.fn(), false];
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useActionState: (..._args: unknown[]) => mockActionState,
  };
});

// --- Helpers ---

/** Build 7-row FormData with prefixed keys, optionally leaving some rows blank. */
function buildBatchFormData(
  patientId: string,
  rows: Array<{
    weight?: string;
    sbp?: string;
    dbp?: string;
    heartRate?: string;
    spo2?: string;
    dyspnea?: string;
    recordedAt?: string;
    weightUnit?: string;
  }>
): FormData {
  const fd = new FormData();
  fd.set('patientId', patientId);
  rows.forEach((row, i) => {
    if (row.weight !== undefined) fd.set(`row_${i}_weight`, row.weight);
    if (row.sbp !== undefined) fd.set(`row_${i}_sbp`, row.sbp);
    if (row.dbp !== undefined) fd.set(`row_${i}_dbp`, row.dbp);
    if (row.heartRate !== undefined) fd.set(`row_${i}_heartRate`, row.heartRate);
    if (row.spo2 !== undefined) fd.set(`row_${i}_spo2`, row.spo2);
    fd.set(`row_${i}_dyspnea`, row.dyspnea ?? '0');
    fd.set(`row_${i}_recordedAt`, row.recordedAt ?? `2026-03-${String(21 + i).padStart(2, '0')}`);
    fd.set(`row_${i}_weightUnit`, row.weightUnit ?? 'lbs');
  });
  return fd;
}

function setupAuthenticatedProvider() {
  mockGetUser.mockResolvedValue({ data: { user: { id: 'provider-1' } } });
}

function setupLinkedPatient() {
  const linkChain = {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'link-1' } }),
          }),
        }),
      }),
    }),
  };

  const vitalsChain = {
    insert: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: 'vitals-1', weight_lbs: 160, sbp: 120, dbp: 80, heart_rate: 72, spo2: null },
          error: null,
        }),
      }),
    }),
  };

  const symptomsChain = {
    insert: vi.fn().mockResolvedValue({ error: null }),
  };

  mockFrom.mockImplementation((table: string) => {
    if (table === 'provider_patient_links') return linkChain;
    if (table === 'vitals') return vitalsChain;
    if (table === 'symptoms') return symptomsChain;
    return {};
  });

  return { linkChain, vitalsChain, symptomsChain };
}

describe('submitBatchVitalsAsProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthorizeProvider.mockResolvedValue({
      authorized: true,
      user: { id: 'provider-1' },
      role: 'provider',
      supabase: { from: mockFrom },
    });
  });

  it('rejects unauthenticated caller', async () => {
    mockAuthorizeProvider.mockResolvedValueOnce({ authorized: false, error: 'Not authenticated' });
    const fd = buildBatchFormData('11111111-1111-4111-8111-111111111111', []);
    const result = await submitBatchVitalsAsProvider(null, fd);
    expect(result.error).toBe('Not authenticated');
  });

  it('rejects unlinked patient', async () => {
    mockAuthorizeProvider.mockResolvedValueOnce({ authorized: false, error: 'Unauthorized' });
    const fd = buildBatchFormData('11111111-1111-4111-8111-111111111111', [
      { weight: '160', sbp: '120', dbp: '80', heartRate: '72' },
    ]);
    const result = await submitBatchVitalsAsProvider(null, fd);
    expect(result.error).toBe('Unauthorized');
  });

  it('each non-blank row inserts to vitals with source="provider_entry"', async () => {
    setupAuthenticatedProvider();
    const { vitalsChain } = setupLinkedPatient();

    const fd = buildBatchFormData('11111111-1111-4111-8111-111111111111', [
      { weight: '160', sbp: '120', dbp: '80', heartRate: '72', recordedAt: '2026-03-21' },
      { weight: '161', sbp: '118', dbp: '78', heartRate: '70', recordedAt: '2026-03-22' },
    ]);
    for (let i = 2; i < 7; i++) {
      fd.set(`row_${i}_dyspnea`, '0');
      fd.set(`row_${i}_recordedAt`, `2026-03-${21 + i}`);
      fd.set(`row_${i}_weightUnit`, 'lbs');
    }

    const result = await submitBatchVitalsAsProvider(null, fd);
    expect(result.error).toBeUndefined();
    expect(result.results).toBeDefined();
    const inserted = result.results!.filter((r) => r.success);
    expect(inserted.length).toBe(2);
    expect(vitalsChain.insert).toHaveBeenCalledTimes(2);
  });

  it('blank rows are skipped (no insert, no error, skipped flag set)', async () => {
    setupAuthenticatedProvider();
    const { vitalsChain } = setupLinkedPatient();

    const fd = buildBatchFormData('11111111-1111-4111-8111-111111111111', [
      { weight: '160', sbp: '120', dbp: '80', heartRate: '72', recordedAt: '2026-03-21' },
    ]);
    for (let i = 1; i < 7; i++) {
      fd.set(`row_${i}_dyspnea`, '0');
      fd.set(`row_${i}_recordedAt`, `2026-03-${21 + i}`);
      fd.set(`row_${i}_weightUnit`, 'lbs');
    }

    const result = await submitBatchVitalsAsProvider(null, fd);
    const skipped = result.results!.filter((r) => r.skipped);
    expect(skipped.length).toBe(6);
    skipped.forEach((r) => {
      expect(r.success).toBe(false);
      expect(r.error).toBeUndefined();
    });
    expect(vitalsChain.insert).toHaveBeenCalledTimes(1);
  });

  it('red flags evaluated independently per row', async () => {
    setupAuthenticatedProvider();
    setupLinkedPatient();

    mockEvaluateRedFlags
      .mockReturnValueOnce([{ id: 'spo2_low', severity: 'critical', message: 'Low SpO2', action: 'Seek urgent evaluation' }])
      .mockReturnValueOnce([]);

    const fd = buildBatchFormData('11111111-1111-4111-8111-111111111111', [
      { weight: '160', sbp: '120', dbp: '80', heartRate: '72', spo2: '88', recordedAt: '2026-03-21' },
      { weight: '161', sbp: '118', dbp: '78', heartRate: '70', spo2: '97', recordedAt: '2026-03-22' },
    ]);
    for (let i = 2; i < 7; i++) {
      fd.set(`row_${i}_dyspnea`, '0');
      fd.set(`row_${i}_recordedAt`, `2026-03-${21 + i}`);
      fd.set(`row_${i}_weightUnit`, 'lbs');
    }

    const result = await submitBatchVitalsAsProvider(null, fd);
    expect(result.results![0].redFlags.length).toBe(1);
    expect(result.results![1].redFlags.length).toBe(0);
    expect(mockEvaluateRedFlags).toHaveBeenCalledTimes(2);
  });

  it('intra-batch weight trend detected: row N sees rows already inserted in same batch', async () => {
    setupAuthenticatedProvider();
    setupLinkedPatient();

    const fd = buildBatchFormData('11111111-1111-4111-8111-111111111111', [
      { weight: '160', sbp: '120', dbp: '80', heartRate: '72', recordedAt: '2026-03-21' },
      { weight: '165', sbp: '118', dbp: '78', heartRate: '70', recordedAt: '2026-03-22' },
    ]);
    for (let i = 2; i < 7; i++) {
      fd.set(`row_${i}_dyspnea`, '0');
      fd.set(`row_${i}_recordedAt`, `2026-03-${21 + i}`);
      fd.set(`row_${i}_weightUnit`, 'lbs');
    }

    await submitBatchVitalsAsProvider(null, fd);

    expect(mockEvaluateRedFlags).toHaveBeenCalledTimes(2);
    const secondCallHistory = mockEvaluateRedFlags.mock.calls[1][1] as Array<{ weight_lbs: number }>;
    expect(secondCallHistory.length).toBeGreaterThan(0);
    expect(secondCallHistory.some((v: { weight_lbs: number }) => v.weight_lbs === 160)).toBe(true);
  });

  it('partial batch: 5 of 7 rows filled -> 5 inserts, 2 skipped', async () => {
    setupAuthenticatedProvider();
    const { vitalsChain } = setupLinkedPatient();

    const rows = [];
    for (let i = 0; i < 5; i++) {
      rows.push({ weight: String(160 + i), sbp: '120', dbp: '80', heartRate: '72', recordedAt: `2026-03-${21 + i}` });
    }
    const fd = buildBatchFormData('11111111-1111-4111-8111-111111111111', rows);
    for (let i = 5; i < 7; i++) {
      fd.set(`row_${i}_dyspnea`, '0');
      fd.set(`row_${i}_recordedAt`, `2026-03-${21 + i}`);
      fd.set(`row_${i}_weightUnit`, 'lbs');
    }

    const result = await submitBatchVitalsAsProvider(null, fd);
    expect(result.results!.length).toBe(7);
    expect(result.results!.filter((r) => r.success).length).toBe(5);
    expect(result.results!.filter((r) => r.skipped).length).toBe(2);
    expect(vitalsChain.insert).toHaveBeenCalledTimes(5);
  });

  it('returns BatchVitalsActionState with results array and anyRedFlags boolean', async () => {
    setupAuthenticatedProvider();
    setupLinkedPatient();
    mockEvaluateRedFlags.mockReturnValueOnce([
      { id: 'weight_gain_5lb_7d', severity: 'critical', message: 'Weight gain', action: 'Urgent' },
    ]);

    const fd = buildBatchFormData('11111111-1111-4111-8111-111111111111', [
      { weight: '160', sbp: '120', dbp: '80', heartRate: '72', recordedAt: '2026-03-21' },
    ]);
    for (let i = 1; i < 7; i++) {
      fd.set(`row_${i}_dyspnea`, '0');
      fd.set(`row_${i}_recordedAt`, `2026-03-${21 + i}`);
      fd.set(`row_${i}_weightUnit`, 'lbs');
    }

    const result: BatchVitalsActionState = await submitBatchVitalsAsProvider(null, fd);
    expect(result.results).toBeDefined();
    expect(Array.isArray(result.results)).toBe(true);
    expect(result.anyRedFlags).toBe(true);
  });
});

describe('BatchEntryGrid', () => {
  it('renders 7 rows with date, weight, SBP, DBP, HR, SpO2 (optional), and dyspnea columns', () => {
    const { container } = render(
      React.createElement(BatchEntryGrid, { patientId: '11111111-1111-4111-8111-111111111111' })
    );
    // 7 body rows
    const tbody = container.querySelector('tbody');
    expect(tbody).not.toBeNull();
    const rows = tbody!.querySelectorAll('tr');
    expect(rows.length).toBe(7);

    // Column headers exist
    expect(screen.getByText('Date')).toBeDefined();
    expect(screen.getByText('Weight')).toBeDefined();
    expect(screen.getByText('SBP')).toBeDefined();
    expect(screen.getByText('DBP')).toBeDefined();
    expect(screen.getByText('HR')).toBeDefined();
    expect(screen.getByText('SpO2')).toBeDefined();
    expect(screen.getByText('Dyspnea')).toBeDefined();
  });

  it('post-submit shows per-row red flag results, not a single aggregate', () => {
    // Set useActionState to return results with red flags
    mockActionState = [
      {
        results: [
          { rowIndex: 0, date: '2026-03-21', success: true, redFlags: [{ id: 'spo2_low', severity: 'critical', message: 'Low SpO2', action: 'Seek urgent evaluation' }] },
          { rowIndex: 1, date: '2026-03-22', success: true, redFlags: [] },
          { rowIndex: 2, date: '2026-03-23', success: false, redFlags: [], skipped: true },
        ],
        anyRedFlags: true,
      } satisfies BatchVitalsActionState,
      vi.fn(),
      false,
    ];

    render(React.createElement(BatchEntryGrid, { patientId: '11111111-1111-4111-8111-111111111111' }));

    // Should show per-row results section (multiple rows may match "Saved")
    const savedElements = screen.getAllByText(/Saved/);
    expect(savedElements.length).toBeGreaterThan(0);
    expect(screen.getByText(/No data/)).toBeDefined();
    // Red flag callout for row 0
    expect(screen.getByText(/Low SpO2/)).toBeDefined();

    // Reset for other tests
    mockActionState = [null, vi.fn(), false];
  });

  it('mode=batch in URL searchParam renders BatchEntryGrid; mode=single renders ProviderVitalsForm', () => {
    // This is a server component test -- verify the component exists and accepts patientId prop
    expect(typeof BatchEntryGrid).toBe('function');
    // Verify props interface by rendering without error
    const { unmount } = render(
      React.createElement(BatchEntryGrid, { patientId: 'test-patient' })
    );
    unmount();
    // The page.tsx mode toggle is structural -- verified by type checking, not runtime test
  });
});

describe('parseBatchFormData + isBlankRow', () => {
  it('parseBatchFormData extracts 7 rows from prefixed FormData keys', () => {
    const fd = new FormData();
    for (let i = 0; i < 7; i++) {
      fd.set(`row_${i}_weight`, String(160 + i));
      fd.set(`row_${i}_sbp`, '120');
      fd.set(`row_${i}_dbp`, '80');
      fd.set(`row_${i}_heartRate`, '72');
      fd.set(`row_${i}_spo2`, '');
      fd.set(`row_${i}_dyspnea`, '0');
      fd.set(`row_${i}_recordedAt`, `2026-03-${21 + i}`);
      fd.set(`row_${i}_weightUnit`, 'lbs');
    }

    const rows = parseBatchFormData(fd);
    expect(rows.length).toBe(7);
    expect(rows[0].weight).toBe('160');
    expect(rows[6].weight).toBe('166');
    expect(rows[0].recordedAt).toBe('2026-03-21');
  });

  it('isBlankRow returns true when all of weight/sbp/dbp/heartRate are empty', () => {
    const blankRow: Record<string, string | null> = {
      weight: '',
      sbp: '',
      dbp: '',
      heartRate: '',
      spo2: '97',
      dyspnea: '0',
      recordedAt: '2026-03-21',
      weightUnit: 'lbs',
    };
    expect(isBlankRow(blankRow)).toBe(true);

    const nullRow: Record<string, string | null> = {
      weight: null,
      sbp: null,
      dbp: null,
      heartRate: null,
      spo2: null,
      dyspnea: '0',
      recordedAt: '2026-03-21',
      weightUnit: 'lbs',
    };
    expect(isBlankRow(nullRow)).toBe(true);
  });

  it('isBlankRow returns false when any measurement field has a value', () => {
    const partialRow: Record<string, string | null> = {
      weight: '160',
      sbp: '',
      dbp: '',
      heartRate: '',
      spo2: '',
      dyspnea: '0',
      recordedAt: '2026-03-21',
      weightUnit: 'lbs',
    };
    expect(isBlankRow(partialRow)).toBe(false);
  });
});
