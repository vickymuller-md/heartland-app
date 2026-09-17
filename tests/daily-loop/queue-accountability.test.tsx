/**
 * Daily Loop accountability surfaces: pending transfers with Accept/Decline, the
 * accountability badges on a work-item card, and the outcome-code selector on close.
 * Server actions are mocked; all ids are synthetic.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DailyLoop } from '@/app/(provider)/dashboard/_components/daily-loop';
import { PendingTransfers } from '@/app/(provider)/dashboard/_components/pending-transfers';
import type { DailyLoopMetrics, PendingTransfer, WorkItem } from '@/lib/daily-loop/types';

const {
  mockAcceptTransfer,
  mockDeclineTransfer,
  mockTransitionWorkItem,
  mockAcceptWorkItem,
  mockAssignWorkItem,
  mockReassignWorkItem,
  mockBulkReview,
} = vi.hoisted(() => ({
  mockAcceptTransfer: vi.fn(),
  mockDeclineTransfer: vi.fn(),
  mockTransitionWorkItem: vi.fn(),
  mockAcceptWorkItem: vi.fn(),
  mockAssignWorkItem: vi.fn(),
  mockReassignWorkItem: vi.fn(),
  mockBulkReview: vi.fn(),
}));

vi.mock('@/lib/daily-loop/actions', () => ({
  acceptTransfer: mockAcceptTransfer,
  declineTransfer: mockDeclineTransfer,
  transitionWorkItem: mockTransitionWorkItem,
  acceptWorkItem: mockAcceptWorkItem,
  assignWorkItem: mockAssignWorkItem,
  reassignWorkItem: mockReassignWorkItem,
  bulkReviewWorkItems: mockBulkReview,
}));

const WORK_ITEM_ID = '00000000-0000-4000-a000-000000000011';
const PATIENT_ID = '00000000-0000-4000-a000-000000000012';
const ORGANIZATION_ID = '00000000-0000-4000-a000-000000000013';
const PROVIDER_ID = '00000000-0000-4000-a000-000000000014';
const NOW = '2026-09-17T12:00:00.000Z';

const METRICS: DailyLoopMetrics = {
  open: 1,
  overdue: 0,
  dueToday: 0,
  closedLast7Days: 0,
  completionRate7Days: null,
  unaccepted: 1,
  awaitingOutcome: 2,
  pendingTransfers: 1,
};

function workItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: WORK_ITEM_ID,
    organization_id: ORGANIZATION_ID,
    patient_id: PATIENT_ID,
    patient_name: 'Synthetic Patient',
    provider_id: PROVIDER_ID,
    assigned_to: PROVIDER_ID,
    owner_name: 'Dr Owner',
    source_type: 'alert',
    source_id: '00000000-0000-4000-a000-000000000015',
    title: 'Review patient alert',
    reason: 'Triggered signals: weight_gain_3lb_2d',
    change_summary: null,
    priority: 'now',
    severity: 'critical',
    status: 'new',
    due_at: NOW,
    freshness_at: NOW,
    data_quality: 'verified',
    created_at: NOW,
    updated_at: NOW,
    accepted_at: null,
    accepted_by: null,
    transfer_pending_to: null,
    transfer_offered_at: null,
    transfer_offered_by: null,
    transfer_recipient_name: null,
    declined_at: null,
    declined_reason: null,
    accountability_source: 'designated',
    underlying_alert_resolved_at: null,
    outcome_code: null,
    ...overrides,
  };
}

function renderQueue(item: WorkItem) {
  return render(
    <DailyLoop
      sections={{ now: [item], today: [], week: [], watching: [] }}
      metrics={METRICS}
      pagination={{ total: 1, limit: 20, offset: 0, hasNext: false, hasPrevious: false }}
      page={1}
      queryString=""
      timeZone="America/Chicago"
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAcceptTransfer.mockResolvedValue({ success: true });
  mockDeclineTransfer.mockResolvedValue({ success: true });
  mockTransitionWorkItem.mockResolvedValue({ success: true });
  mockAcceptWorkItem.mockResolvedValue({ success: true });
  mockAssignWorkItem.mockResolvedValue({ success: true });
  mockReassignWorkItem.mockResolvedValue({ success: true });
  mockBulkReview.mockResolvedValue({ success: true, updated: 0 });
});

describe('transfers awaiting a response', () => {
  const transfer: PendingTransfer = {
    id: WORK_ITEM_ID,
    organization_id: ORGANIZATION_ID,
    patient_id: PATIENT_ID,
    patient_name: 'Synthetic Patient',
    title: 'Review patient alert',
    reason: 'Triggered signals: weight_gain_3lb_2d',
    severity: 'critical',
    status: 'new',
    due_at: NOW,
    transfer_offered_at: NOW,
    offered_by_name: 'Dr Owner',
  };

  it('renders nothing when no transfer is pending', () => {
    render(<PendingTransfers transfers={[]} />);
    expect(screen.queryByTestId('pending-transfers')).toBeNull();
  });

  it('accepts an offered transfer', async () => {
    render(<PendingTransfers transfers={[transfer]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Accept transfer' }));

    expect(mockAcceptTransfer).toHaveBeenCalledWith({
      workItemId: WORK_ITEM_ID,
      patientId: PATIENT_ID,
    });
  });

  it('requires a reason to decline an offered transfer', async () => {
    render(<PendingTransfers transfers={[transfer]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Decline' }));

    const reason = screen.getByLabelText('Why are you declining this transfer?');
    await userEvent.click(screen.getByRole('button', { name: 'Send decline' }));
    expect(mockDeclineTransfer).not.toHaveBeenCalled();

    await userEvent.type(reason, 'Patient is not on my panel');
    await userEvent.click(screen.getByRole('button', { name: 'Send decline' }));
    expect(mockDeclineTransfer).toHaveBeenCalledWith({
      workItemId: WORK_ITEM_ID,
      patientId: PATIENT_ID,
      reason: 'Patient is not on my panel',
    });
  });
});

describe('work-item accountability surface', () => {
  it('shows the accountable provider, the acceptance state and the alert-resolved badge', () => {
    renderQueue(workItem({ underlying_alert_resolved_at: NOW }));
    const card = screen.getByTestId('work-item-card');

    expect(within(card).getByText('Accountable')).toBeInTheDocument();
    expect(within(card).getByText('Dr Owner')).toBeInTheDocument();
    expect(within(card).getByText('Awaiting your acceptance')).toBeInTheDocument();
    expect(within(card).getByText('Underlying alert resolved — outcome required')).toBeInTheDocument();
    expect(screen.getByTestId('accountability-summary')).toHaveTextContent(
      '2 open item(s) have their underlying alert resolved',
    );
  });

  it('never asks for acceptance on a row created before the accountability model', () => {
    renderQueue(workItem({ accountability_source: null }));
    const card = screen.getByTestId('work-item-card');

    expect(within(card).queryByText('Awaiting your acceptance')).not.toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /accept/i })).not.toBeInTheDocument();
    expect(within(card).getByText('No designated owner (legacy)')).toBeInTheDocument();
  });

  it('labels a pending transfer and its addressee', () => {
    renderQueue(workItem({
      transfer_pending_to: '00000000-0000-4000-a000-000000000016',
      transfer_offered_at: NOW,
      transfer_recipient_name: 'Dr Colleague',
    }));

    expect(screen.getByText('Transfer pending · Dr Colleague')).toBeInTheDocument();
  });

  it('accepts the item assigned to this provider', async () => {
    renderQueue(workItem());
    await userEvent.click(screen.getByRole('button', { name: 'Accept' }));

    expect(mockAcceptWorkItem).toHaveBeenCalledWith({
      workItemId: WORK_ITEM_ID,
      patientId: PATIENT_ID,
    });
  });

  it('requires an outcome code to close an item in the accountability model', async () => {
    renderQueue(workItem());
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await userEvent.type(screen.getByLabelText('Outcome required to close'), 'Diuretic increased');

    const selector = screen.getByLabelText('Documented outcome');
    expect(selector).toBeRequired();
    await userEvent.click(screen.getByRole('button', { name: 'Close item' }));
    expect(mockTransitionWorkItem).not.toHaveBeenCalled();

    await userEvent.selectOptions(selector, 'clinical_action_taken');
    await userEvent.click(screen.getByRole('button', { name: 'Close item' }));
    expect(mockTransitionWorkItem).toHaveBeenCalledWith({
      workItemId: WORK_ITEM_ID,
      patientId: PATIENT_ID,
      status: 'closed',
      outcome: 'Diuretic increased',
      outcomeCode: 'clinical_action_taken',
    });
  });

  it('keeps legacy items closable without an outcome code', async () => {
    renderQueue(workItem({ accountability_source: null }));
    expect(screen.getByText('No designated owner (legacy)')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await userEvent.type(screen.getByLabelText('Outcome required to close'), 'Duplicate of yesterday');
    expect(screen.getByLabelText('Documented outcome')).not.toBeRequired();

    await userEvent.click(screen.getByRole('button', { name: 'Close item' }));
    expect(mockTransitionWorkItem).toHaveBeenCalledWith({
      workItemId: WORK_ITEM_ID,
      patientId: PATIENT_ID,
      status: 'closed',
      outcome: 'Duplicate of yesterday',
      outcomeCode: undefined,
    });
  });

  it('offers a transfer to a colleague instead of writing the assignment', async () => {
    const colleagueId = '00000000-0000-4000-a000-000000000017';
    render(
      <DailyLoop
        sections={{ now: [workItem()], today: [], week: [], watching: [] }}
        metrics={METRICS}
        pagination={{ total: 1, limit: 20, offset: 0, hasNext: false, hasPrevious: false }}
        page={1}
        queryString=""
        timeZone="America/Chicago"
        teamMembers={[
          {
            organization_id: ORGANIZATION_ID,
            organization_name: 'Rural Clinic',
            member_id: colleagueId,
            member_name: 'Dr Colleague',
            member_role: 'clinician',
            is_default: true,
            is_self: false,
          },
        ]}
        manageableOrganizationIds={[ORGANIZATION_ID]}
      />,
    );

    await userEvent.selectOptions(
      screen.getByLabelText('Offer Review patient alert to another team member'),
      colleagueId,
    );

    expect(mockAssignWorkItem).toHaveBeenCalledWith({
      workItemId: WORK_ITEM_ID,
      patientId: PATIENT_ID,
      assigneeId: colleagueId,
    });
  });
});
