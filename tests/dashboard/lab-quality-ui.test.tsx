import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { WorklistTable } from '@/app/(provider)/titration-worklist/_components/worklist-table';
import { assessLabAnalyte, worklistLabContext } from '@/lib/labs/quality';

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
});
