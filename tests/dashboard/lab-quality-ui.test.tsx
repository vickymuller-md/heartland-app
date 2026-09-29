import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { WorklistTable } from '@/app/(provider)/titration-worklist/_components/worklist-table';
import { assessLabAnalyte, assessEffectiveLab, worklistLabContext } from '@/lib/labs/quality';
import type { EffectiveLabObservation } from '@/lib/labs/effective';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/dashboard/worklist-queries', () => ({ getTitrationWorklist: vi.fn() }));

describe('Laboratory worklist evidence labels', () => {
  it('renders each collection and its own missing/stale/current state without a Normal claim', () => {
    const context = worklistLabContext(new Date('2026-09-29T12:00:00Z'));
    const panels = [
      { id: 'old', collected_at: '2026-08-01T12:00:00Z', potassium: 4.2 },
      { id: 'recent', collected_at: '2026-09-28T08:00:00.123456-04:00', creatinine: 1.1 },
    ];
    render(<WorklistTable rows={[{ patient_id: 'p', full_name: 'Synthetic Example', risk_tier: null,
      last_sbp: null, last_titration_at: null, due_this_week: true, labs: {
        potassium: assessLabAnalyte(panels, 'potassium', context),
        creatinine: assessLabAnalyte(panels, 'creatinine', context),
        egfr: assessLabAnalyte(panels, 'egfr', context),
      } }]} />);
    const potassium = within(screen.getByLabelText('Potassium data quality'));
    expect(potassium.getByText('Stale (advisory)')).toBeInTheDocument();
    expect(potassium.getByText(/2026-08-01T12:00:00.000Z/)).toBeInTheDocument();
    expect(within(screen.getByLabelText('Creatinine data quality')).getByText('Current (advisory)')).toBeInTheDocument();
    expect(within(screen.getByLabelText('Creatinine data quality')).getByText(/2026-09-28T12:00:00.123456Z/)).toBeInTheDocument();
    expect(within(screen.getByLabelText('eGFR data quality')).getByText('Missing')).toBeInTheDocument();
    expect(screen.queryByText(/^Normal$/)).not.toBeInTheDocument();
    expect(screen.getByText(/not a medication-specific clearance/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start Call' })).toHaveAttribute('href', '/titration-checklist?patient=p');
  });
  it('shows a read failure rather than saying no patients are due', async () => {
    const { createClient } = await import('@/lib/supabase/server');
    const { getTitrationWorklist } = await import('@/lib/dashboard/worklist-queries');
    vi.mocked(createClient).mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: 'provider' } } }) } } as never);
    vi.mocked(getTitrationWorklist).mockRejectedValue(new Error('private error must not be rendered'));
    const { default: Page } = await import('@/app/(provider)/titration-worklist/page');
    render(await Page());
    expect(screen.getByRole('alert')).toHaveTextContent('Worklist unavailable');
    expect(screen.queryByText('No patients due for titration this week.')).not.toBeInTheDocument();
    expect(screen.queryByText(/private error/)).not.toBeInTheDocument();
  });
  it('labels cancelled and corrected sources separately from recency and processing', () => {
    const context = worklistLabContext(new Date('2026-09-29T12:00:00Z'));
    const source: EffectiveLabObservation = { id: 'source:potassium', original_lab_result_id: 'source', patient_id: 'p', analyte: 'potassium',
      root_id: 'root', version_id: 'version', revision: '2', status: 'cancelled', effective_lab_result_id: null, value: null,
      collected_at: '2026-09-28T12:00:00.123456Z', notes: null, lab_facility: null, evaluation_status: null };
    const corrected = { ...source, id: 'source:creatinine', analyte: 'creatinine' as const, status: 'corrected' as const,
      effective_lab_result_id: 'amendment', value: '1.2300000000000001', evaluation_status: 'pending' as const };
    render(<WorklistTable rows={[{ patient_id: 'p', full_name: 'Synthetic Example', risk_tier: null, last_sbp: null,
      last_titration_at: null, due_this_week: true, labs: {
        potassium: assessEffectiveLab([source, corrected], 'p', 'potassium', context),
        creatinine: assessEffectiveLab([source, corrected], 'p', 'creatinine', context),
        egfr: assessEffectiveLab([source, corrected], 'p', 'egfr', context),
      } }]} />);
    expect(within(screen.getByLabelText('Potassium data quality')).getByText('Cancelled — reconcile source')).toBeInTheDocument();
    expect(within(screen.getByLabelText('Potassium data quality')).getByText(/Source: cancelled · revision 2/)).toBeInTheDocument();
    expect(screen.getByText('1.2300000000000001')).toBeInTheDocument();
    expect(screen.getByText(/Source: corrected · revision 2.*Alert processing pending/)).toBeInTheDocument();
    expect(screen.queryByText(/^Normal$/)).not.toBeInTheDocument();
  });
});
