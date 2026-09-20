/**
 * Alert Inbox & Realtime Alerts -- Tests
 * Requirements: DASH-05 (alert inbox), DASH-08 (realtime subscription)
 * Source: HEARTLAND Protocol v3.3
 *
 * Tests for the AlertInbox component rendering, status display,
 * action buttons, and the RealtimeAlertsProvider contract.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AlertInbox } from '@/app/(provider)/alerts/_components/alert-inbox';
import { RealtimeAlertsProvider } from '@/app/(provider)/_components/realtime-alerts-provider';
import type { AlertRow } from '@/lib/dashboard/types';

const mocks = vi.hoisted(() => {
  const channel = { on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() };
  return {
    refresh: vi.fn(), acknowledge: vi.fn(), resolve: vi.fn(), channel,
    supabase: { channel: vi.fn(() => channel), removeChannel: vi.fn() },
    queryClient: { invalidateQueries: vi.fn() },
    showAlertToast: vi.fn(),
  };
});

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }),
}));

// Mock server actions
vi.mock('@/lib/dashboard/actions', () => ({
  acknowledgeAlert: mocks.acknowledge,
  resolveAlert: mocks.resolve,
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => mocks.supabase }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => mocks.queryClient }));
vi.mock('@/app/(provider)/_components/alert-toast', () => ({ showAlertToast: mocks.showAlertToast }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.acknowledge.mockReset().mockResolvedValue({ success: true });
  mocks.resolve.mockReset().mockResolvedValue({ success: true });
});

// ---------- Test Data ----------

const mockAlerts: AlertRow[] = [
  {
    id: 'alert-1',
    patient_id: 'patient-1',
    patient_name: 'John Doe',
    vitals_id: 'vitals-1',
    flags: ['sbp_low', 'spo2_low'],
    severity: 'critical',
    status: 'open',
    acknowledged_by: null,
    acknowledged_at: null,
    resolved_by: null,
    resolved_at: null,
    created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
  },
  {
    id: 'alert-2',
    patient_id: 'patient-2',
    patient_name: 'Jane Smith',
    vitals_id: 'vitals-2',
    flags: ['weight_gain_3lb_2d'],
    severity: 'critical',
    status: 'acknowledged',
    acknowledged_by: 'provider-1',
    acknowledged_at: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
    resolved_by: null,
    resolved_at: null,
    created_at: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(), // 4 hours ago
  },
  {
    id: 'alert-3',
    patient_id: 'patient-3',
    patient_name: 'Robert Johnson',
    vitals_id: 'vitals-3',
    flags: ['dyspnea_severe'],
    severity: 'warning',
    status: 'resolved',
    acknowledged_by: 'provider-1',
    acknowledged_at: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
    resolved_by: 'provider-1',
    resolved_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    created_at: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(), // 8 hours ago
  },
];

// ==========================================================================
// DASH-05: Alert inbox with status transitions
// ==========================================================================

describe('AlertInbox', () => {
  it('renders alerts in reverse chronological order', () => {
    render(<AlertInbox alerts={mockAlerts} statusFilter="all" />);
    const table = screen.getByTestId('alert-list');
    const rows = within(table).getAllByTestId('alert-card');
    expect(rows).toHaveLength(3);
  });

  it('displays patient name, trigger reason, timestamp, severity badge', () => {
    render(<AlertInbox alerts={mockAlerts} statusFilter="all" />);
    const table = screen.getByTestId('alert-list');

    // Patient names
    expect(within(table).getByText('John Doe')).toBeInTheDocument();
    expect(within(table).getByText('Jane Smith')).toBeInTheDocument();
    expect(within(table).getByText('Robert Johnson')).toBeInTheDocument();

    // Flag labels
    expect(
      within(table).getByText(/SBP < 90 mmHg/)
    ).toBeInTheDocument();
    expect(
      within(table).getByText(/Weight gain/)
    ).toBeInTheDocument();

    // Severity badges
    const severityBadges = within(table).getAllByTestId('severity-badge');
    expect(severityBadges.length).toBeGreaterThanOrEqual(3);
  });

  it('shows resolution status: open / acknowledged / resolved', () => {
    render(<AlertInbox alerts={mockAlerts} statusFilter="all" />);
    const table = screen.getByTestId('alert-list');
    const statusBadges = within(table).getAllByTestId('status-badge');

    const statusTexts = statusBadges.map((b) => b.textContent);
    expect(statusTexts).toContain('open');
    expect(statusTexts).toContain('acknowledged');
    expect(statusTexts).toContain('resolved');
  });

  it('acknowledge button appears for open alerts', () => {
    const openAlerts = mockAlerts.filter((a) => a.status === 'open');
    render(<AlertInbox alerts={openAlerts} statusFilter="open" />);
    const table = screen.getByTestId('alert-list');
    expect(within(table).getByTestId('acknowledge-btn')).toBeInTheDocument();
  });

  it('resolve button appears for acknowledged alerts', () => {
    const ackedAlerts = mockAlerts.filter((a) => a.status === 'acknowledged');
    render(<AlertInbox alerts={ackedAlerts} statusFilter="acknowledged" />);
    const table = screen.getByTestId('alert-list');
    expect(within(table).getByTestId('resolve-btn')).toBeInTheDocument();
  });

  it("empty state shows 'No alerts' message", () => {
    render(<AlertInbox alerts={[]} statusFilter="open" />);
    expect(screen.getByText(/No open alerts/)).toBeInTheDocument();
    expect(
      screen.getByText(/query loaded successfully and returned no items/)
    ).toBeInTheDocument();
  });
});

describe('AlertInbox action feedback', () => {
  async function prepare(action: 'acknowledge' | 'resolve') {
    const alert = mockAlerts[action === 'acknowledge' ? 0 : 1];
    const user = userEvent.setup();
    render(<AlertInbox alerts={[alert]} statusFilter={alert.status} />);
    if (action === 'resolve') {
      await user.click(screen.getByRole('button', { name: 'Resolve', exact: true }));
      await user.type(screen.getByLabelText('Resolution outcome'), 'Synthetic review documented');
    }
    return {
      user, alert,
      actionMock: action === 'acknowledge' ? mocks.acknowledge : mocks.resolve,
      submit: screen.getByRole('button', { name: action === 'acknowledge' ? 'Acknowledge' : 'Confirm', exact: true }),
    };
  }

  it.each(['acknowledge', 'resolve'] as const)('%s refreshes only after a confirmed save', async (action) => {
    const { user, submit, actionMock, alert } = await prepare(action);
    await user.click(submit);
    expect(actionMock).toHaveBeenCalledWith(action === 'acknowledge'
      ? alert.id : { alertId: alert.id, resolutionNote: 'Synthetic review documented' });
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('status')).toHaveTextContent(/saved/i);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // Until the refreshed server props arrive, never invent a new clinical status.
    expect(screen.getByTestId('status-badge')).toHaveTextContent(alert.status);
  });

  it.each(['acknowledge', 'resolve'] as const)('%s reports a rejected save without discarding the row or note', async (action) => {
    const { user, submit, actionMock, alert } = await prepare(action);
    actionMock.mockResolvedValueOnce({ success: false, error: 'Alert not found' });
    await user.click(submit);
    expect(await screen.findByRole('alert')).toHaveTextContent('Alert not found');
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(screen.getByTestId('status-badge')).toHaveTextContent(alert.status);
    expect(submit).toBeEnabled();
    if (action === 'resolve') expect(screen.getByLabelText('Resolution outcome')).toHaveValue('Synthetic review documented');
    await user.click(screen.getByRole('button', { name: 'Refresh list', exact: true }));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(actionMock).toHaveBeenCalledTimes(1);
  });

  it.each(['acknowledge', 'resolve'] as const)('%s handles a lost response without claiming failure or success', async (action) => {
    const { user, submit, actionMock, alert } = await prepare(action);
    actionMock.mockRejectedValueOnce(new Error('private transport details'));
    await user.click(submit);
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be confirmed.*refresh.*before trying again/i);
    expect(screen.queryByText(/private transport details/)).not.toBeInTheDocument();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(screen.getByTestId('status-badge')).toHaveTextContent(alert.status);
    if (action === 'resolve') expect(screen.getByLabelText('Resolution outcome')).toHaveValue('Synthetic review documented');
  });

  it.each(['acknowledge', 'resolve'] as const)('%s gives a useful fallback when the server omits its error message', async (action) => {
    const { user, submit, actionMock } = await prepare(action);
    actionMock.mockResolvedValueOnce({ success: false });
    await user.click(submit);
    expect(await screen.findByRole('alert')).toHaveTextContent(/unable to/i);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it.each(['acknowledge', 'resolve'] as const)('%s clears the previous error on a successful retry', async (action) => {
    const { user, submit, actionMock } = await prepare(action);
    actionMock.mockResolvedValueOnce({ success: false, error: 'Unable to save' });
    await user.click(submit);
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to save');
    await user.click(submit);
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/saved/i);
  });

  it.each(['acknowledge', 'resolve'] as const)('%s prevents repeated submission while waiting', async (action) => {
    const { user, submit, actionMock } = await prepare(action);
    let complete!: (value: { success: boolean }) => void;
    actionMock.mockReturnValueOnce(new Promise((resolve) => { complete = resolve; }));
    await user.click(submit);
    expect(submit).toBeDisabled();
    expect(mocks.refresh).not.toHaveBeenCalled();
    await user.click(submit);
    expect(actionMock).toHaveBeenCalledTimes(1);
    if (action === 'resolve') {
      expect(screen.getByLabelText('Resolution outcome')).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
    }
    await act(async () => complete({ success: true }));
    await waitFor(() => expect(submit).toBeEnabled());
  });
});

// ==========================================================================
// Migration 00041: accountable provider and outcome-required marker
// ==========================================================================

describe('AlertInbox accountability markers (00041)', () => {
  const accountableAlert: AlertRow = {
    ...mockAlerts[0],
    id: 'alert-4',
    accountable_provider_id: 'provider-9',
    accountable_provider_name: 'Dana Reyes, NP',
    outcome_required: false,
  };

  it('shows the accountable provider when the work item names one', () => {
    render(<AlertInbox alerts={[accountableAlert]} statusFilter="open" />);
    expect(screen.getByTestId('alert-accountable')).toHaveTextContent(
      'Accountable: Dana Reyes, NP'
    );
  });

  it('shows the outcome-required marker when the alert is resolved but the item is open', () => {
    render(
      <AlertInbox
        alerts={[{ ...accountableAlert, status: 'resolved', outcome_required: true }]}
        statusFilter="resolved"
      />
    );
    expect(screen.getByTestId('alert-outcome-required')).toHaveTextContent(
      'Outcome required'
    );
  });

  it('renders no markers for an alert without accountability data', () => {
    render(<AlertInbox alerts={[mockAlerts[0]]} statusFilter="open" />);
    expect(screen.queryByTestId('alert-accountable')).not.toBeInTheDocument();
    expect(screen.queryByTestId('alert-outcome-required')).not.toBeInTheDocument();
  });
});

// ==========================================================================
// DASH-08: Realtime alerts provider contract
// ==========================================================================

describe('RealtimeAlertsProvider', () => {
  function mount(linkedPatientIds = ['patient-1', 'patient-2']) {
    return render(<RealtimeAlertsProvider providerId="provider-1" linkedPatientIds={linkedPatientIds}><div>Child</div></RealtimeAlertsProvider>);
  }

  it('subscribes to alerts table INSERT events for linked patient IDs', () => {
    mount();
    expect(mocks.supabase.channel).toHaveBeenCalledExactlyOnceWith('provider-alerts-provider-1');
    expect(mocks.channel.on).toHaveBeenCalledWith('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'alerts', filter: 'patient_id=in.(patient-1,patient-2)',
    }, expect.any(Function));
    expect(mocks.channel.subscribe).toHaveBeenCalledTimes(1);
  });

  it('subscribes to alerts table UPDATE events for status changes', () => {
    mount();
    expect(mocks.channel.on).toHaveBeenCalledWith('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'alerts', filter: 'patient_id=in.(patient-1,patient-2)',
    }, expect.any(Function));
    const handler = mocks.channel.on.mock.calls.find((call) => call[1].event === 'UPDATE')![2];
    act(() => handler({ new: { patient_id: 'patient-1', status: 'acknowledged' } }));
    expect(mocks.queryClient.invalidateQueries.mock.calls).toEqual([[{ queryKey: ['alerts'] }], [{ queryKey: ['patients'] }]]);
    expect(mocks.showAlertToast).not.toHaveBeenCalled();
  });

  it('cleans up channel on unmount via removeChannel', () => {
    const { unmount } = mount();
    unmount();
    expect(mocks.supabase.removeChannel).toHaveBeenCalledExactlyOnceWith(mocks.channel);
  });

  it('forwards a new critical alert to the notification presenter', () => {
    mount();
    const handler = mocks.channel.on.mock.calls.find((call) => call[1].event === 'INSERT')![2];
    const alert = { patient_id: 'patient-1', severity: 'critical', flags: ['sbp_low'] };
    act(() => handler({ new: alert }));
    expect(mocks.showAlertToast).toHaveBeenCalledExactlyOnceWith(alert);
  });

  it('invalidates React Query caches on new alert', () => {
    mount();
    const handler = mocks.channel.on.mock.calls.find((call) => call[1].event === 'INSERT')![2];
    act(() => handler({ new: { patient_id: 'patient-1', severity: 'warning', flags: [] } }));
    expect(mocks.queryClient.invalidateQueries.mock.calls).toEqual([
      [{ queryKey: ['alerts'] }], [{ queryKey: ['patients'] }], [{ queryKey: ['patient', 'patient-1'] }],
    ]);
  });

  it('does not subscribe when no patients are linked', () => {
    mount([]);
    expect(screen.getByText('Child')).toBeInTheDocument();
    expect(mocks.supabase.channel).not.toHaveBeenCalled();
  });

  it('replaces the previous subscription when the linked patients change', () => {
    const { rerender } = mount();
    rerender(<RealtimeAlertsProvider providerId="provider-1" linkedPatientIds={['patient-3']}><div>Child</div></RealtimeAlertsProvider>);
    expect(mocks.supabase.removeChannel).toHaveBeenCalledExactlyOnceWith(mocks.channel);
    expect(mocks.channel.subscribe).toHaveBeenCalledTimes(2);
    expect(mocks.channel.on).toHaveBeenCalledWith('postgres_changes', expect.objectContaining({ filter: 'patient_id=in.(patient-3)' }), expect.any(Function));
  });
});
