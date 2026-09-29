import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EffectiveLabObservation } from '@/lib/labs/effective';
import type { SbarData } from '@/lib/sbar/types';

const mocks = vi.hoisted(() => ({
  actor: '65000000-0000-4000-8000-000000000001', authError: false, detail: vi.fn(), labs: vi.fn(), meds: vi.fn(),
  profile: { data: { risk_tier: null, track_assignment: null, facility_tier: null } as Record<string, unknown> | null, error: null as unknown },
  from: vi.fn(), editor: vi.fn(),
}));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`Redirect: ${url}`); } }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: mocks.actor ? { id: mocks.actor } : null }, error: mocks.authError }) },
  from: mocks.from,
}) }));
vi.mock('@/lib/dashboard/queries', () => ({ getPatientDetail: mocks.detail }));
vi.mock('@/lib/medications/queries', () => ({ getPatientMedications: mocks.meds }));
vi.mock('@/lib/labs/effective', async (original) => ({
  ...await original<typeof import('@/lib/labs/effective')>(), getEffectiveLabObservations: mocks.labs,
}));
vi.mock('@/app/(provider)/patients/[patientId]/sbar/_components/sbar-editor', () => ({
  SbarEditor: (props: { initialData: SbarData }) => { mocks.editor(props); return <pre data-testid="draft">{props.initialData.background}</pre>; },
}));
import SbarPage from '@/app/(provider)/patients/[patientId]/sbar/page';
const patientId = '65000000-0000-4000-8000-000000000011';
const resultId = '65000000-0000-4000-8000-000000000101';
const source: EffectiveLabObservation = {
  id: `${resultId}:potassium`, patient_id: patientId, original_lab_result_id: resultId, analyte: 'potassium',
  root_id: null, version_id: null, revision: null, status: 'original', effective_lab_result_id: resultId,
  value: '4.20000000000000001', collected_at: '2025-08-01T12:00:00.000001Z',
  notes: null, lab_facility: null, evaluation_status: 'pending',
};
beforeEach(() => {
  vi.clearAllMocks(); mocks.actor = '65000000-0000-4000-8000-000000000001'; mocks.authError = false;
  mocks.detail.mockReset().mockResolvedValue({ patient: { full_name: 'Synthetic Person' }, vitals: [] });
  mocks.labs.mockReset().mockResolvedValue([source]); mocks.meds.mockReset().mockResolvedValue([]);
  mocks.profile = { data: { risk_tier: null, track_assignment: null, facility_tier: null }, error: null };
  mocks.from.mockImplementation((table: string) => {
    if (table !== 'patients') throw new Error('Unexpected raw-table reader');
    const q = { select: () => q, eq: () => q, single: async () => mocks.profile }; return q;
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
async function page() { render(await SbarPage({ params: Promise.resolve({ patientId }) })); }
describe('SBAR server source boundary', () => {
  it('uses the complete effective reader with actor/patient scope and no raw panels', async () => {
    await page();
    expect(mocks.labs).toHaveBeenCalledWith(expect.anything(), [patientId], mocks.actor);
    expect(mocks.from).toHaveBeenCalledTimes(1); expect(mocks.from).toHaveBeenCalledWith('patients');
    expect(screen.getByTestId('draft')).toHaveTextContent('4.20000000000000001');
    expect(screen.getByTestId('draft')).toHaveTextContent('2025-08-01T12:00:00.000001Z');
    expect(mocks.editor.mock.calls[0][0]).toMatchObject({ providerId: mocks.actor, patientId, sourceReadAt: expect.stringMatching(/Z$/) });
  });
  it('distinguishes a successful empty read from unavailability', async () => {
    mocks.labs.mockResolvedValue([]); await page();
    expect(screen.getByTestId('draft')).toHaveTextContent('Recorded laboratory sources: none available.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('does not label a valid collection during the read as future; retains the earlier read-start timestamp', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-29T12:00:00Z'));
    mocks.labs.mockImplementation(async () => {
      vi.setSystemTime(new Date('2026-09-29T12:00:02Z'));
      return [{ ...source, collected_at: '2026-09-29T12:00:01Z' }];
    });
    await page();
    expect(screen.getByTestId('draft')).toHaveTextContent('Potassium: 4.20000000000000001');
    expect(screen.getByTestId('draft')).not.toHaveTextContent('Future collection');
    expect(mocks.editor.mock.calls[0][0].sourceReadAt).toBe('2026-09-29T12:00:00.000Z');
  });
  it.each(['labs', 'profile-error', 'profile-missing', 'medications', 'wrong-patient', 'malformed'])(
    '%s failure produces no draft or misleading absence', async (kind) => {
      if (kind === 'labs') mocks.labs.mockRejectedValue(new Error('Private details'));
      if (kind === 'profile-error') mocks.profile.error = new Error('Private details');
      if (kind === 'profile-missing') mocks.profile.data = null;
      if (kind === 'medications') mocks.meds.mockRejectedValue(new Error('Private details'));
      if (kind === 'wrong-patient') mocks.labs.mockResolvedValue([{ ...source, patient_id: resultId }]);
      if (kind === 'malformed') mocks.labs.mockResolvedValue([{ ...source, value: 'NaN' }]);
      await page(); expect(screen.getByRole('alert')).toHaveTextContent('no draft was generated');
      expect(mocks.editor).not.toHaveBeenCalled(); expect(screen.queryByText(/Private details/)).not.toBeInTheDocument();
    },
  );
  it('stops before reading laboratories for an unlinked patient', async () => {
    mocks.detail.mockResolvedValue(null);
    await expect(page()).rejects.toThrow('patient_not_found'); expect(mocks.labs).not.toHaveBeenCalled();
  });
  it('stops before any patient read on authentication error', async () => {
    mocks.authError = true;
    await expect(page()).rejects.toThrow('/login'); expect(mocks.detail).not.toHaveBeenCalled();
  });
});
