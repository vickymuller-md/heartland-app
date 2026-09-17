/**
 * Teach-back state on the provider education surface (migration 00040).
 *
 * `get_education_teachback_state` returns nothing for a domain with no event,
 * and the screen must derive `pending` for it -- never `completed`, whatever
 * the patient self-assessment says. The two records stay separate on screen.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { EducationTeachback } from '@/app/(provider)/patients/[patientId]/_components/education-teachback';
import { EducationSummary } from '@/app/(provider)/patients/[patientId]/_components/education-summary';
import { EDUCATION_DOMAINS } from '@/lib/education/constants';
import type { EducationTeachback as EducationTeachbackRecord } from '@/lib/education/types';
import { getEducationTeachbackState } from '@/lib/education/queries';

vi.mock('@/lib/education/teachback-actions', () => ({ recordTeachBack: vi.fn() }));

const PATIENT_ID = '00000000-0000-4000-a000-000000000001';

const verifiedWeight: EducationTeachbackRecord = {
  domain_id: 'daily_weight',
  outcome: 'verified',
  reason: null,
  verified_by: '00000000-0000-4000-a000-000000000002',
  verified_by_name: 'Dana Reyes, RN',
  method: 'telephone',
  caregiver_present: null,
  occurred_at: '2026-09-16T15:00:00Z',
  event_count: 2,
};

const deferredMeds: EducationTeachbackRecord = {
  domain_id: 'medications',
  outcome: 'deferred',
  reason: 'Interpreter unavailable at this visit',
  verified_by: '00000000-0000-4000-a000-000000000002',
  verified_by_name: 'Dana Reyes, RN',
  method: null,
  caregiver_present: null,
  occurred_at: '2026-09-16T15:10:00Z',
  event_count: 1,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('derived teach-back state', () => {
  it('shows pending for every domain with no teach-back event', () => {
    render(
      <EducationTeachback patientId={PATIENT_ID} teachbacks={[]} canRecord={false} />,
    );

    for (const domain of EDUCATION_DOMAINS) {
      expect(screen.getByTestId(`teachback-state-${domain.id}`)).toHaveTextContent(
        'Teach-back pending',
      );
    }
  });

  it('shows the verifier and the reassessment count for a verified domain', () => {
    render(
      <EducationTeachback
        patientId={PATIENT_ID}
        teachbacks={[verifiedWeight]}
        canRecord
      />,
    );

    expect(screen.getByTestId('teachback-state-daily_weight')).toHaveTextContent('Verified');
    const row = screen.getByTestId('teachback-row-daily_weight');
    expect(within(row).getByText(/Teach-back verified by Dana Reyes, RN/)).toBeInTheDocument();
    expect(within(row).getByText(/reassessed 2 times/)).toBeInTheDocument();
    expect(screen.getByTestId('teachback-state-medications')).toHaveTextContent(
      'Teach-back pending',
    );
  });

  it('keeps a deferred domain visible with its documented reason', () => {
    render(
      <EducationTeachback
        patientId={PATIENT_ID}
        teachbacks={[deferredMeds]}
        canRecord
      />,
    );

    const row = screen.getByTestId('teachback-row-medications');
    expect(within(row).getByText('Deferred')).toBeInTheDocument();
    expect(
      within(row).getByText('Reason: Interpreter unavailable at this visit'),
    ).toBeInTheDocument();
  });

  it('hides the recording control without the educate authorization', () => {
    render(
      <EducationTeachback patientId={PATIENT_ID} teachbacks={[]} canRecord={false} />,
    );

    expect(screen.queryByRole('button', { name: 'Record teach-back' })).toBeNull();
    expect(
      screen.getByText(/do not hold the education authorization/i),
    ).toBeInTheDocument();
  });
});

describe('self-assessment and teach-back are never merged', () => {
  it('a completed module is still a pending teach-back', () => {
    render(
      <EducationSummary
        patientId={PATIENT_ID}
        educationProgress={{
          domains: [
            { domain: 'daily_weight', label: 'Daily Weight Monitoring', completed: true },
          ],
        }}
        teachbacks={[]}
        canRecordTeachback
      />,
    );

    expect(screen.getByText('Patient self-assessment')).toBeInTheDocument();
    expect(screen.getByTestId('teachback-state-daily_weight')).toHaveTextContent(
      'Teach-back pending',
    );
  });

  it('shows the teach-back panel even when the patient has not started education', () => {
    render(
      <EducationSummary
        patientId={PATIENT_ID}
        educationProgress={null}
        teachbacks={[verifiedWeight]}
        canRecordTeachback={false}
      />,
    );

    expect(screen.getByText('Education not started')).toBeInTheDocument();
    expect(screen.getByTestId('teachback-state-daily_weight')).toHaveTextContent('Verified');
  });
});

describe('getEducationTeachbackState', () => {
  it('reads the RPC and returns the rows unchanged', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [verifiedWeight], error: null });

    const result = await getEducationTeachbackState(
      { rpc } as never,
      PATIENT_ID,
    );

    expect(rpc).toHaveBeenCalledWith('get_education_teachback_state', {
      p_patient_id: PATIENT_ID,
    });
    expect(result).toEqual({ teachbacks: [verifiedWeight], error: null });
  });

  it('reports a read failure instead of pretending no teach-back exists', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'denied' } });

    const result = await getEducationTeachbackState({ rpc } as never, PATIENT_ID);

    expect(result.teachbacks).toEqual([]);
    expect(result.error).toBe('Teach-back records could not be loaded.');
  });
});
