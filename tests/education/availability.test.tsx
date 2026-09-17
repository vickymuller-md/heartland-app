/**
 * Education Availability Tests
 * Requirements: EDUC-01, EDUC-02
 *
 * Every education domain is offered at every facility tier, including when the
 * tier is unknown. The facility tier governs delivery format and support, not
 * whether a domain exists.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import EducationPage from '@/app/(patient)/education/page';
import { EDUCATION_DOMAINS } from '@/lib/education/constants';

const { createClient, redirect, getEducationProgress } = vi.hoisted(() => ({
  createClient: vi.fn(),
  redirect: vi.fn(),
  getEducationProgress: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient }));
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('@/lib/education/queries', () => ({ getEducationProgress }));

function mockPatient(facilityTier: number | null) {
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: 'patient-1' } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { track_assignment: 'B', facility_tier: facilityTier },
          }),
        }),
      }),
    }),
  });
  getEducationProgress.mockResolvedValue([]);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Education availability by facility tier', () => {
  it.each([1, 2, 3, null])(
    'facility_tier %s shows all 8 education domains',
    async (facilityTier) => {
      mockPatient(facilityTier);
      render(await EducationPage());

      for (const domain of EDUCATION_DOMAINS) {
        expect(screen.getByText(domain.title)).toBeInTheDocument();
      }
    },
  );

  it('does not read facility_tier when selecting patient columns', async () => {
    const select = vi.fn(() => ({
      eq: () => ({
        single: async () => ({ data: { track_assignment: 'B' } }),
      }),
    }));
    createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: 'patient-1' } } }) },
      from: () => ({ select }),
    });
    getEducationProgress.mockResolvedValue([]);

    render(await EducationPage());

    expect(select).toHaveBeenCalledWith('track_assignment');
  });
});

describe('Education completion rate denominator', () => {
  it('counts completion over the domains the patient was offered', async () => {
    const { getEducationSummary } = await vi.importActual<
      typeof import('@/lib/education/queries')
    >('@/lib/education/queries');

    const supabase = {
      from: () => ({
        select: () => ({
          eq: async () => ({
            data: [
              {
                id: 'p1',
                patient_id: 'patient-1',
                domain_id: 'daily_weight',
                completed: true,
                completed_at: null,
                attempts: 1,
                created_at: '2026-01-01T00:00:00Z',
              },
            ],
            error: null,
          }),
        }),
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const offered = EDUCATION_DOMAINS.slice(0, 2);
    const summary = await getEducationSummary(supabase, 'patient-1', offered);

    expect(summary.totalDomains).toBe(2);
    expect(summary.completedDomains).toBe(1);
    expect(summary.completionRate).toBe(50);
  });

  it('defaults to the full domain set when no offered set is given', async () => {
    const { getEducationSummary } = await vi.importActual<
      typeof import('@/lib/education/queries')
    >('@/lib/education/queries');

    const supabase = {
      from: () => ({
        select: () => ({ eq: async () => ({ data: [], error: null }) }),
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const summary = await getEducationSummary(supabase, 'patient-1');
    expect(summary.totalDomains).toBe(EDUCATION_DOMAINS.length);
  });
});
