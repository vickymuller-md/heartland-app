import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExceptionPanel } from '@/app/(provider)/team/exceptions/exception-panel';
import { EXCEPTION_LOAD_ERROR, type ExceptionPage, type ExceptionResult } from '@/lib/team/operational-exceptions';

const { load } = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/lib/team/exception-actions', () => ({ loadOperationalExceptions: load }));
const organizations = [{ id: 'org-a', name: 'Team A' }, { id: 'org-b', name: 'Team B' }];
const counts = { ownership: 4, vitals: 2, laboratory: 1, scan_capture: 3, scan_rule: 7, scan_routing: 1, notification: 2, notification_routing: 1 };
const empty: ExceptionPage = { items: [], next_cursor: null, counts: null, detail_authorized: true };
const item: ExceptionPage['items'][number] = { key: 'ownership:item-a', category: 'ownership',
  patient_id: 'patient-a', work_item_id: 'item-a', state: 'needs_review', reasons: ['no_active_link'], recorded_at: '2026-09-24T12:00:00Z' };
const success = (data: ExceptionPage): ExceptionResult => ({ data, error: null });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('operational exceptions presentation', () => {
  it('distinguishes aggregate access from patient detail and offers no mutation', () => {
    render(<ExceptionPanel snapshotId="snapshot-1" organizations={organizations} initial={success({ ...empty, detail_authorized: false, counts })} />);
    expect(screen.getByRole('region', { name: 'Administrative totals' })).toBeTruthy();
    expect(screen.getByText(/Patient details require current monitoring authorization/)).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Authorized details' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open patient workspace' })).toBeNull();
    expect(screen.getByText(/Ownership repair requires a separate manager review/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /reassign|retry|send/i })).toBeNull();
  });
  it('renders safe reasons and patient workspace links without inferring delivery', () => {
    render(<ExceptionPanel snapshotId="snapshot-1" organizations={organizations} initial={success({ ...empty, items: [item] })} />);
    expect(screen.getByText('Assigned member no longer has an active patient link')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open patient workspace' }).getAttribute('href')).toBe('/patients/patient-a');
    expect(screen.getByText(/does not prove notification delivery/)).toBeTruthy();
  });
  it('offers separate manager repair only for an ownership detail, not for scan or aggregate records', () => {
    render(<ExceptionPanel snapshotId="manager-repair" organizations={organizations} initial={success({ ...empty, counts, items: [item,
      { ...item, key: 'scan_rule:one', category: 'scan_rule', work_item_id: null, reasons: ['rule_blocked'] }] })} />);
    expect(screen.getAllByRole('button', { name: 'Reassign' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Reassign item' })).toBeNull();
  });
  it('separates captured notification reasons and routing evidence with no mutation control', () => {
    render(<ExceptionPanel snapshotId="notifications" organizations={organizations} initial={success({ ...empty, counts, items: [
      { ...item, key: 'notification:pending', category: 'notification', state: 'pending', reasons: ['critical_created'] },
      { ...item, key: 'notification:blocked', category: 'notification', state: 'blocked', reasons: ['critical_reassigned', 'captured_no_active_link'] },
      { ...item, key: 'notification_routing:closed', category: 'notification_routing', reasons: ['closed_work_later_signal'] },
      { ...item, key: 'notification_routing:flag', category: 'notification_routing', reasons: ['critical_new_flag'] },
    ] })} />);
    expect(screen.getAllByText(/Unsent intent only/)).toHaveLength(2);
    expect(screen.getAllByText(/Automated transport is inactive/)).toHaveLength(2);
    expect(screen.getByText('At capture: assigned member had no active patient link')).toBeTruthy();
    expect(screen.getAllByText(/Reading this record does not resolve it/)).toHaveLength(2);
    expect(screen.getByText(/additional flag reached already-critical work/)).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Open patient workspace' })).toHaveLength(4);
    expect(screen.queryByRole('button', { name: /reassign|retry|send|acknowledge|resolve/i })).toBeNull();
    expect(screen.getByRole('region', { name: 'Administrative totals' }).querySelectorAll('dt')).toHaveLength(8);
  });
  it('clears notification history and totals before switching scope and after failed refresh', async () => {
    let finish!: (r: ExceptionResult) => void;
    load.mockImplementationOnce(() => new Promise<ExceptionResult>((resolve) => { finish = resolve; }));
    render(<ExceptionPanel snapshotId="notification-scope" organizations={organizations} initial={success({ ...empty, counts, items: [
      { ...item, key: 'notification:blocked', category: 'notification', state: 'blocked', reasons: ['critical_created', 'captured_blocked_preference'] },
    ] })} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'org-b' } });
    expect(screen.queryByText(/At capture:/)).toBeNull();
    expect(screen.queryByRole('region', { name: 'Administrative totals' })).toBeNull();
    await act(async () => finish({ data: null, error: EXCEPTION_LOAD_ERROR }));
    expect(screen.getByRole('alert').textContent).toBe(EXCEPTION_LOAD_ERROR);
    expect(screen.queryByText(/No exceptions are visible/)).toBeNull();
  });
  it('does not turn an unavailable read into a zero count or empty success', () => {
    render(<ExceptionPanel snapshotId="snapshot-1" organizations={organizations} initial={{ data: null, error: EXCEPTION_LOAD_ERROR }} />);
    expect(screen.getByRole('alert').textContent).toContain('unavailable');
    expect(screen.queryByText(/No exceptions are visible/)).toBeNull();
    expect(screen.queryByRole('region', { name: 'Administrative totals' })).toBeNull();
  });
  it('uses the server cursor and refreshes from the first page explicitly', async () => {
    load.mockResolvedValue(success(empty));
    render(<ExceptionPanel snapshotId="snapshot-1" organizations={organizations} initial={success({ ...empty, items: [item], next_cursor: 'cursor-25' })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(load).toHaveBeenCalledWith({ organizationId: 'org-a', after: 'cursor-25' }));
    await waitFor(() => expect(screen.getByText(/No exceptions are visible/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Refresh from first page' }));
    await waitFor(() => expect(load).toHaveBeenLastCalledWith({ organizationId: 'org-a', after: null }));
  });
  it('clears previous-team details immediately and ignores out-of-order responses', async () => {
    let finishB!: (r: ExceptionResult) => void;
    let finishA!: (r: ExceptionResult) => void;
    load.mockImplementationOnce(() => new Promise<ExceptionResult>((resolve) => { finishB = resolve; }))
      .mockImplementationOnce(() => new Promise<ExceptionResult>((resolve) => { finishA = resolve; }));
    render(<ExceptionPanel snapshotId="snapshot-1" organizations={organizations} initial={success({ ...empty, items: [item], counts })} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'org-b' } });
    expect(screen.queryByRole('link', { name: 'Open patient workspace' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Administrative totals' })).toBeNull();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'org-a' } });
    await act(async () => finishA(success(empty)));
    await act(async () => finishB(success({ ...empty, items: [{ ...item, patient_id: 'patient-b' }] })));
    expect(screen.getByText(/No exceptions are visible/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open patient workspace' })).toBeNull();
  });
  it('clears stale rows on refresh and shows thrown transport failure as unavailable', async () => {
    load.mockRejectedValue(new Error('private failure'));
    render(<ExceptionPanel snapshotId="snapshot-1" organizations={organizations} initial={success({ ...empty, items: [item] })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh from first page' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(EXCEPTION_LOAD_ERROR));
    expect(screen.queryByRole('link', { name: 'Open patient workspace' })).toBeNull();
  });
  it('remounts on a new authenticated server snapshot after organization access is lost', () => {
    const view = render(<ExceptionPanel snapshotId="before" organizations={organizations} initial={success({ ...empty, items: [item], counts })} />);
    view.rerender(<ExceptionPanel snapshotId="after" organizations={[organizations[1]]} initial={{ data: null, error: EXCEPTION_LOAD_ERROR }} />);
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('org-b');
    expect(screen.queryByRole('link', { name: 'Open patient workspace' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Administrative totals' })).toBeNull();
    expect(screen.getByRole('alert').textContent).toBe(EXCEPTION_LOAD_ERROR);
  });
  it('ignores an old client response after a new server snapshot revoked its scope', async () => {
    let finish!: (r: ExceptionResult) => void;
    load.mockImplementationOnce(() => new Promise<ExceptionResult>((resolve) => { finish = resolve; }));
    const view = render(<ExceptionPanel snapshotId="before" organizations={organizations} initial={success({ ...empty, items: [item] })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh from first page' }));
    view.rerender(<ExceptionPanel snapshotId="after" organizations={[organizations[1]]} initial={success(empty)} />);
    await act(async () => finish(success({ ...empty, items: [item], counts })));
    expect(screen.getByText(/No exceptions are visible/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open patient workspace' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Administrative totals' })).toBeNull();
  });
});
