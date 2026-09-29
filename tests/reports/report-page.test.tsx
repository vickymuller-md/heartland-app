/**
 * Report Page Smoke Tests -- REPT-01, REPT-02, REPT-04, REPT-05
 * Requirements: REPT-04 (Date Range), REPT-05 (Sidebar Link)
 * Source: HEARTLAND Protocol v3.3 -- Phase 21 Reports & Data Export
 *
 * Smoke tests for report page rendering, date range selector,
 * and sidebar navigation link. Uses file-content tests (fs.readFileSync)
 * for structural verification (consistent with Phase 11 pattern).
 */

import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'fs';
import path from 'path';
import { StrictMode } from 'react';
import type { LabResultRow, MonthlyReportData, PatientSummaryData } from '@/lib/reports/types';
import { PatientSummaryPrint } from '@/app/(provider)/reports/_components/patient-summary-print';

const mocks = vi.hoisted(() => ({
  download: vi.fn(), fetchSummary: vi.fn(), failure: false, page: 0, selection: '',
  labGate: null as Promise<void> | null,
  actor: '64000000-0000-4000-8000-000000000001',
  listeners: new Set<(event: string, session: { user: { id: string } } | null) => void>(),
  printGate: null as Promise<void> | null, printed: vi.fn(), printStarted: vi.fn(),
  authGate: null as Promise<void> | null, authActors: [] as string[],
  cloneGate: null as Promise<void> | null, loadGate: null as Promise<void> | null,
  beforeClone: vi.fn(), afterAppend: null as (() => void) | null,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('react-to-print', () => ({ useReactToPrint: (options: {
  contentRef: { current: HTMLElement | null };
  onBeforePrint: () => Promise<void>; print: (frame: HTMLIFrameElement) => Promise<void>;
  onAfterPrint?: () => void; onPrintError: (location: string, error: Error) => void;
}) => (currentContent?: () => HTMLElement | null) => {
  void (async () => {
    let frame: HTMLIFrameElement | null = null;
    try {
      await options.onBeforePrint();
      mocks.beforeClone();
      if (mocks.cloneGate) await mocks.cloneGate;
      const root = currentContent ? currentContent() : options.contentRef.current;
      if (!root) return;
      const clone = root.cloneNode(true);
      frame = document.createElement('iframe'); frame.id = 'printWindow'; document.body.append(frame);
      mocks.afterAppend?.();
      if (mocks.loadGate) await mocks.loadGate;
      frame.contentDocument!.body.append(clone);
      Object.defineProperty(frame.contentWindow, 'print', { value: mocks.printed });
      Object.defineProperty(frame.contentWindow, 'focus', { value: vi.fn() });
      frame.dispatchEvent(new Event('load'));
      mocks.printStarted();
      if (mocks.printGate) await mocks.printGate;
      await options.print(frame);
      options.onAfterPrint?.();
    } catch (error) { options.onPrintError('print', error as Error); }
    finally { frame?.remove(); }
  })();
} }));
vi.mock('@/lib/reports/actions', () => ({ fetchPatientSummary: mocks.fetchSummary }));
vi.mock('@/lib/reports/csv-builders', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/reports/csv-builders')>(), downloadCSV: mocks.download,
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: vi.fn(async () => {
        const actor = mocks.authActors.shift() ?? mocks.actor;
        if (mocks.authGate) await mocks.authGate;
        return { data: { user: { id: actor } }, error: null };
      }),
      onAuthStateChange: (listener: (event: string, session: { user: { id: string } } | null) => void) => {
        mocks.listeners.add(listener);
        return { data: { subscription: { unsubscribe: () => mocks.listeners.delete(listener) } } };
      },
    },
    rpc: vi.fn(async () => {
      if (mocks.labGate) await mocks.labGate;
      return { data: { actor_id: mocks.actor, patient_ids: ['64000000-0000-4000-8000-000000000011'],
        snapshot: 'a'.repeat(64), next_cursor: null,
        items: ['egfr', 'potassium'].map((analyte) => ({
          id: `64000000-0000-4000-8000-000000000101:${analyte}`, original_lab_result_id: '64000000-0000-4000-8000-000000000101',
          patient_id: '64000000-0000-4000-8000-000000000011', analyte, root_id: null, version_id: null, revision: null,
          status: 'original', effective_lab_result_id: '64000000-0000-4000-8000-000000000101',
          value: analyte === 'potassium' ? '6.2' : '50', collected_at: '2025-08-01T13:15:00Z',
          notes: null, lab_facility: null, evaluation_status: null,
        })),
      }, error: mocks.failure ? { message: 'Private database detail' } : null };
    }),
    from: () => {
      const query = { select: () => query, in: () => query, gte: () => query, lte: () => query, order: () => query,
        then: (resolve: (value: unknown) => void) => resolve({ data: [], error: mocks.failure ? { message: 'Private database detail' } : null }) };
      return query;
    },
  }),
}));
import { ReportsShell } from '@/app/(provider)/reports/_components/reports-shell';

const summary: PatientSummaryData = {
  patient: { id: '64000000-0000-4000-8000-000000000011', full_name: 'Synthetic Patient', risk_tier: null, track_assignment: null },
  vitals: [], symptoms: [], adherenceSummary: null, educationProgress: null, notes: [], openAlerts: [],
  dateRange: { from: '2025-08-01', to: '2025-08-31' }, labs: [],
};
const monthly: MonthlyReportData = {
  month: '2025-08', from: '2025-08-01', to: '2025-08-31', totalPatients: 1,
  activePatientsInPeriod: 0, alertsGenerated: 0, alertsCritical: 0, titrationNotesCount: 0,
  avgCheckInCompliance: 0, gdmtOptimizationRate: null,
};

const patients = [{
  id: '64000000-0000-4000-8000-000000000011', full_name: 'Synthetic Patient', risk_tier: null, track_assignment: null,
  status: 'stable' as const, open_alert_count: 0, last_vitals_at: null, latest_flags: null, setup_complete: true,
}, {
  id: '64000000-0000-4000-8000-000000000012', full_name: 'Second Synthetic Patient', risk_tier: null, track_assignment: null,
  status: 'stable' as const, open_alert_count: 0, last_vitals_at: null, latest_flags: null, setup_complete: true,
}];

beforeEach(() => {
  vi.clearAllMocks(); mocks.fetchSummary.mockReset().mockResolvedValue(null);
  mocks.actor = '64000000-0000-4000-8000-000000000001'; mocks.printGate = null;
  mocks.authGate = null; mocks.authActors = [];
  mocks.cloneGate = null; mocks.loadGate = null; mocks.afterAppend = null;
  mocks.failure = false; mocks.page = 0; mocks.selection = ''; mocks.labGate = null;
});
afterEach(cleanup);

function switchActor(actor: string | null) {
  mocks.actor = actor ?? '';
  mocks.listeners.forEach((listener) => listener(actor ? 'SIGNED_IN' : 'SIGNED_OUT', actor ? { user: { id: actor } } : null));
}

describe('REPT-05 sidebar Reports link', () => {
  it('provider-shell.tsx contains href for /reports', () => {
    const shellPath = path.resolve(
      __dirname,
      '../../app/(provider)/_components/provider-shell.tsx'
    );
    const content = readFileSync(shellPath, 'utf-8');
    // This test will fail RED since /reports is not yet in navItems
    expect(content).toContain("href: '/reports'");
  });
});

describe('REPT-04 DateRangePicker', () => {
  it.todo('preset "Last 30 days" sets from to today minus 30 days');
  it.todo('custom from/to inputs push URL searchParams on change');
});

describe('REPT-01 monthly report render', () => {
  it.todo('MonthlyReportPrint renders all metric sections');
});

describe('REPT-02 patient summary render', () => {
  it('prints all thirteen lab rows and their collection timestamps without inventing normal flags', () => {
    const labs: LabResultRow[] = Array.from({ length: 13 }, (_, index) => ({
      id: `lab-1:analyte-${index}`, patient_id: '64000000-0000-4000-8000-000000000011', test_name: `Analyte ${index}`,
      value: String(index), unit: 'stored unit', collected_at: '2025-08-01T09:15:00-04:00', flag: null,
      source_status: 'original', root_id: null, version_id: null, revision: null, original_lab_result_id: 'original',
      effective_lab_result_id: 'original', evaluation_status: null, data_quality: 'recorded', quality_reason: 'Recorded source.',
    }));
    render(<PatientSummaryPrint data={{ ...summary, labs }} />);
    const report = within(screen.getByTestId('patient-summary-print'));
    expect(report.getByText('Analyte 12')).toBeInTheDocument();
    expect(report.getAllByText('Not recorded')).toHaveLength(13);
    expect(report.queryByText('Normal')).not.toBeInTheDocument();
    expect(report.getAllByText('2025-08-01T13:15:00.000Z')).toHaveLength(13);
    expect(report.getByText(/Collected at \(UTC\)/)).toBeInTheDocument();
  });

  it('shows Normal only when the supplied flag explicitly records normal', () => {
    render(<PatientSummaryPrint data={{ ...summary, labs: [{
      id: 'lab-1:potassium', patient_id: '64000000-0000-4000-8000-000000000011', test_name: 'Potassium', value: '4.5',
      unit: 'mEq/L', collected_at: '2025-08-01T13:15:00Z', flag: 'normal',
      source_status: 'original', root_id: null, version_id: null, revision: null, original_lab_result_id: 'original',
      effective_lab_result_id: 'original', evaluation_status: null, data_quality: 'recorded', quality_reason: 'Recorded source.',
    }] }} />);
    expect(within(screen.getByTestId('patient-summary-print')).getByText('Normal')).toBeInTheDocument();
  });

  it('caps a printed risk tier with the non-validated heuristic caveat', () => {
    render(<PatientSummaryPrint data={{ ...summary, patient: { ...summary.patient, risk_tier: 'high' } }} />);
    const report = within(screen.getByTestId('patient-summary-print'));
    expect(report.getByText(/proposed, non-validated heuristic/i)).toBeInTheDocument();
    expect(report.getByText(/not a prediction of events/i)).toBeInTheDocument();
  });

  it('omits the risk tier caveat when no tier was assessed', () => {
    render(<PatientSummaryPrint data={summary} />);
    const report = within(screen.getByTestId('patient-summary-print'));
    expect(report.getByText('Not assessed')).toBeInTheDocument();
    expect(report.queryByText(/non-validated heuristic/i)).not.toBeInTheDocument();
  });

  it('does not replace the selected patient with an older response arriving out of order', async () => {
    let resolveFirst!: (data: PatientSummaryData | null) => void;
    const first = new Promise<PatientSummaryData | null>((resolve) => { resolveFirst = resolve; });
    const second = { ...summary, patient: { ...summary.patient, id: '64000000-0000-4000-8000-000000000012', full_name: 'Second Synthetic Patient' } };
    mocks.fetchSummary.mockReturnValueOnce(first).mockResolvedValueOnce(second);
    await act(async () => { render(<ReportsShell providerId="64000000-0000-4000-8000-000000000001" data={monthly} from="2025-08-01" to="2025-08-31" patients={patients} />); });
    fireEvent.change(screen.getByLabelText('Select Patient'), { target: { value: '64000000-0000-4000-8000-000000000011' } });
    await waitFor(() => expect(mocks.fetchSummary).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Select Patient'), { target: { value: '64000000-0000-4000-8000-000000000012' } });
    await waitFor(() => expect(mocks.fetchSummary).toHaveBeenCalledTimes(2));
    await act(async () => { resolveFirst(summary); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export Patient PDF' })).toBeEnabled());
    const printed = within(screen.getByTestId('patient-summary-print'));
    expect(printed.getByText('Second Synthetic Patient')).toBeInTheDocument();
    expect(printed.queryByText('Synthetic Patient', { exact: true })).not.toBeInTheDocument();
  });

  it('allows the current patient PDF before an obsolete request finishes', async () => {
    let resolveFirst!: (data: PatientSummaryData | null) => void;
    const first = new Promise<PatientSummaryData | null>((resolve) => { resolveFirst = resolve; });
    const second = { ...summary, patient: { ...summary.patient, id: '64000000-0000-4000-8000-000000000012', full_name: 'Second Synthetic Patient' } };
    mocks.fetchSummary.mockReturnValueOnce(first).mockResolvedValueOnce(second);
    await act(async () => { render(<ReportsShell providerId="64000000-0000-4000-8000-000000000001" data={monthly} from="2025-08-01" to="2025-08-31" patients={patients} />); });
    fireEvent.change(screen.getByLabelText('Select Patient'), { target: { value: '64000000-0000-4000-8000-000000000011' } });
    await waitFor(() => expect(mocks.fetchSummary).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Select Patient'), { target: { value: '64000000-0000-4000-8000-000000000012' } });
    try {
      await waitFor(() => expect(screen.getByRole('button', { name: 'Export Patient PDF' })).toBeEnabled());
      expect(within(screen.getByTestId('patient-summary-print')).getByText('Second Synthetic Patient')).toBeInTheDocument();
    } finally {
      await act(async () => { resolveFirst(summary); });
    }
  });

  it('clears the previous printable report on error and never exposes backend details', async () => {
    mocks.fetchSummary.mockResolvedValueOnce(summary).mockRejectedValueOnce(new Error('Private laboratory detail'));
    await act(async () => { render(<ReportsShell providerId="64000000-0000-4000-8000-000000000001" data={monthly} from="2025-08-01" to="2025-08-31" patients={patients} />); });
    fireEvent.change(screen.getByLabelText('Select Patient'), { target: { value: '64000000-0000-4000-8000-000000000011' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export Patient PDF' })).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Select Patient'), { target: { value: '64000000-0000-4000-8000-000000000012' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load patient summary');
    expect(screen.getByRole('button', { name: 'Export Patient PDF' })).toBeDisabled();
    expect(within(screen.getByTestId('patient-summary-print')).queryByText('Synthetic Patient', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('Private laboratory detail')).not.toBeInTheDocument();
  });

  it('keeps patient export disabled when the authorized action returns no accessible summary', async () => {
    await act(async () => { render(<ReportsShell providerId="64000000-0000-4000-8000-000000000001" data={monthly} from="2025-08-01" to="2025-08-31" patients={patients} />); });
    fireEvent.change(screen.getByLabelText('Select Patient'), { target: { value: '64000000-0000-4000-8000-000000000011' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load patient summary');
    expect(screen.getByRole('button', { name: 'Export Patient PDF' })).toBeDisabled();
  });

  it('clears the old period immediately and only prints the newly requested date range', async () => {
    let resolveNext!: (data: PatientSummaryData | null) => void;
    const next = new Promise<PatientSummaryData | null>((resolve) => { resolveNext = resolve; });
    mocks.fetchSummary.mockResolvedValueOnce(summary).mockReturnValueOnce(next);
    let rerender!: ReturnType<typeof render>['rerender'];
    await act(async () => { ({ rerender } = render(<ReportsShell providerId="64000000-0000-4000-8000-000000000001" data={monthly} from="2025-08-01" to="2025-08-31" patients={patients} />)); });
    fireEvent.change(screen.getByLabelText('Select Patient'), { target: { value: '64000000-0000-4000-8000-000000000011' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export Patient PDF' })).toBeEnabled());
    await act(async () => { rerender(<ReportsShell providerId="64000000-0000-4000-8000-000000000001" data={monthly} from="2025-09-01" to="2025-09-30" patients={patients} />); });
    fireEvent.change(screen.getByLabelText('Select Patient'), { target: { value: '64000000-0000-4000-8000-000000000011' } });
    expect(screen.getByRole('button', { name: 'Export Patient PDF' })).toBeDisabled();
    expect(within(screen.getByTestId('patient-summary-print')).queryByText('Synthetic Patient', { exact: true })).not.toBeInTheDocument();
    await act(async () => { resolveNext({ ...summary, dateRange: { from: '2025-09-01', to: '2025-09-30' } }); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export Patient PDF' })).toBeEnabled());
    expect(within(screen.getByTestId('patient-summary-print')).getByText(/2025-09-01.*2025-09-30/)).toBeInTheDocument();
  });

  it('ignores an obsolete request error after the newly selected summary succeeds', async () => {
    let rejectFirst!: (error: Error) => void;
    const first = new Promise<PatientSummaryData | null>((_resolve, reject) => { rejectFirst = reject; });
    const second = { ...summary, patient: { ...summary.patient, id: '64000000-0000-4000-8000-000000000012', full_name: 'Second Synthetic Patient' } };
    mocks.fetchSummary.mockReturnValueOnce(first).mockResolvedValueOnce(second);
    await act(async () => { render(<ReportsShell providerId="64000000-0000-4000-8000-000000000001" data={monthly} from="2025-08-01" to="2025-08-31" patients={patients} />); });
    fireEvent.change(screen.getByLabelText('Select Patient'), { target: { value: '64000000-0000-4000-8000-000000000011' } });
    await waitFor(() => expect(mocks.fetchSummary).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Select Patient'), { target: { value: '64000000-0000-4000-8000-000000000012' } });
    await waitFor(() => expect(mocks.fetchSummary).toHaveBeenCalledTimes(2));
    await act(async () => { rejectFirst(new Error('Private obsolete error')); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export Patient PDF' })).toBeEnabled());
    expect(within(screen.getByTestId('patient-summary-print')).getByText('Second Synthetic Patient')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('REPT-03 laboratory CSV interaction', () => {
  async function openLabExport() {
    await act(async () => { render(<ReportsShell providerId="64000000-0000-4000-8000-000000000001" data={monthly} from="2025-08-01" to="2025-08-31" patients={patients.slice(0, 1)} />); });
    fireEvent.click(screen.getByRole('button', { name: 'labs', exact: true }));
  }

  it('downloads recorded analytes from the real table shape with collection timestamps', async () => {
    await openLabExport();
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    await waitFor(() => expect(mocks.download).toHaveBeenCalledTimes(1));
    const rows = mocks.download.mock.calls[0][1];
    expect(rows).toHaveLength(3);
    expect(rows.find((row: string[]) => row[1] === 'Potassium').slice(0, 6)).toEqual(['64000000-0000-4000-8000-000000000011', 'Potassium', '6.2', 'mEq/L', '2025-08-01T13:15:00Z', '']);
    expect(screen.getByText(/Lab reports use UTC calendar dates/)).toBeInTheDocument();
  });

  it('retains privacy-minimized ID and year reduction', async () => {
    await openLabExport();
    fireEvent.click(screen.getByRole('checkbox', { name: /Privacy-minimized/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    await waitFor(() => expect(mocks.download).toHaveBeenCalledTimes(1));
    expect(mocks.download.mock.calls[0][1].find((row: string[]) => row[1] === 'Potassium').slice(0, 6)).toEqual(['P001', 'Potassium', '6.2', 'mEq/L', '2025', '']);
  });

  it('does not download a misleading empty CSV or expose database details on error', async () => {
    mocks.failure = true;
    await openLabExport();
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to export data');
    expect(mocks.download).not.toHaveBeenCalled();
    expect(screen.queryByText('Private database detail')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeEnabled();
  });

  it('does not allow an export without any linked patients', async () => {
    await act(async () => { render(<ReportsShell providerId="64000000-0000-4000-8000-000000000001" data={monthly} from="2025-08-01" to="2025-08-31" patients={[]} />); });
    fireEvent.click(screen.getByRole('button', { name: 'labs', exact: true }));
    const download = screen.getByRole('button', { name: 'Download CSV' });
    expect(download).toBeDisabled();
    fireEvent.click(download);
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it('locks the privacy choice and CSV type while an export is pending', async () => {
    let finish!: () => void;
    mocks.labGate = new Promise<void>((resolve) => { finish = resolve; });
    await openLabExport();
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    try {
      expect(screen.getByRole('checkbox', { name: /Privacy-minimized/ })).toBeDisabled();
      expect(screen.getByRole('checkbox', { name: /Privacy-minimized/ })).not.toBeChecked();
      for (const name of ['vitals', 'labs', 'medications']) {
        expect(screen.getByRole('button', { name, exact: true })).toBeDisabled();
      }
      expect(mocks.download).not.toHaveBeenCalled();
    } finally {
      await act(async () => { finish(); });
    }
    await waitFor(() => expect(mocks.download).toHaveBeenCalledTimes(1));
    expect(mocks.download.mock.calls[0][1][1][0]).toBe('64000000-0000-4000-8000-000000000011');
    expect(screen.getByRole('checkbox', { name: /Privacy-minimized/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'labs', exact: true })).toBeEnabled();
  });

  it.each(['account', 'logout', 'range', 'patient', 'unmount'])('discards a pending laboratory CSV after %s changes', async (change) => {
    let finish!: () => void;
    mocks.labGate = new Promise<void>((resolve) => { finish = resolve; });
    await openLabExport();
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    await act(async () => { await Promise.resolve(); });
    if (change === 'account') act(() => { switchActor('64000000-0000-4000-8000-000000000009'); switchActor('64000000-0000-4000-8000-000000000001'); });
    if (change === 'logout') act(() => switchActor(null));
    if (change === 'range') fireEvent.change(screen.getByLabelText('From'), { target: { value: '2025-08-02' } });
    if (change === 'patient') fireEvent.change(screen.getByLabelText('Select Patient'), { target: { value: '64000000-0000-4000-8000-000000000011' } });
    if (change === 'unmount') cleanup();
    await act(async () => { finish(); });
    expect(mocks.download).not.toHaveBeenCalled();
    if (change === 'account' || change === 'logout' || change === 'range') {
      expect(screen.getByRole('alert')).toHaveTextContent('Reload this page');
      expect(screen.queryByTestId('patient-summary-print')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Export Monthly PDF' })).not.toBeInTheDocument();
    }
  });
});

describe('Report session and final PDF fence', () => {
  it('does not clone stale data when the session changes after onBeforePrint resolves', async () => {
    let clone!: () => void;
    mocks.cloneGate = new Promise<void>((resolve) => { clone = resolve; });
    await act(async () => { render(<ReportsShell providerId="64000000-0000-4000-8000-000000000001" data={monthly} from="2025-08-01" to="2025-08-31" patients={patients} />); });
    fireEvent.click(screen.getByRole('button', { name: 'Export Monthly PDF' }));
    await waitFor(() => expect(mocks.beforeClone).toHaveBeenCalledTimes(1));
    act(() => switchActor(null));
    await act(async () => { clone(); });
    expect(document.getElementById('printWindow')).toBeNull();
    expect(mocks.printStarted).not.toHaveBeenCalled();
    expect(mocks.printed).not.toHaveBeenCalled();
  });

  it('removes an owned clone loaded after synchronous invalidation discarded its pending append notification', async () => {
    let load!: () => void; let resources!: () => void;
    mocks.loadGate = new Promise<void>((resolve) => { load = resolve; });
    mocks.printGate = new Promise<void>((resolve) => { resources = resolve; });
    mocks.afterAppend = () => switchActor(null); // Same task as append: observer has not run.
    await act(async () => { render(<ReportsShell providerId="64000000-0000-4000-8000-000000000001" data={monthly} from="2025-08-01" to="2025-08-31" patients={patients} />); });
    fireEvent.click(screen.getByRole('button', { name: 'Export Monthly PDF' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Report session changed'));
    const emptyFrame = document.getElementById('printWindow') as HTMLIFrameElement;
    expect(emptyFrame).not.toBeNull(); expect(emptyFrame.contentDocument!.body.textContent).toBe('');
    await act(async () => { load(); });
    expect(emptyFrame.isConnected).toBe(false); // Removed before styles/resources resolve.
    expect(mocks.printed).not.toHaveBeenCalled();
    await act(async () => { resources(); });
    expect(mocks.printed).not.toHaveBeenCalled();
  });

  it('ignores an obsolete initial authentication response during StrictMode remount', async () => {
    let finish!: () => void;
    mocks.authGate = new Promise<void>((resolve) => { finish = resolve; });
    mocks.authActors = ['64000000-0000-4000-8000-000000000009', '64000000-0000-4000-8000-000000000001'];
    render(<StrictMode><ReportsShell providerId="64000000-0000-4000-8000-000000000001" data={monthly} from="2025-08-01" to="2025-08-31" patients={patients} /></StrictMode>);
    expect(screen.getByRole('status')).toHaveTextContent('Verifying report session');
    await act(async () => { finish(); });
    expect(screen.getByRole('button', { name: 'Export Monthly PDF' })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not reveal reports under an actor different from the server context', async () => {
    mocks.actor = '64000000-0000-4000-8000-000000000009';
    await act(async () => { render(<ReportsShell providerId="64000000-0000-4000-8000-000000000001" data={monthly} from="2025-08-01" to="2025-08-31" patients={patients} />); });
    expect(screen.getByRole('alert')).toHaveTextContent('Report session changed');
    expect(screen.queryByTestId('patient-summary-print')).not.toBeInTheDocument();
  });

  it('discards a late patient summary after A→B→A even when the final account matches', async () => {
    let finish!: (value: PatientSummaryData) => void;
    mocks.fetchSummary.mockReturnValue(new Promise<PatientSummaryData>((resolve) => { finish = resolve; }));
    await act(async () => { render(<ReportsShell providerId="64000000-0000-4000-8000-000000000001" data={monthly} from="2025-08-01" to="2025-08-31" patients={patients} />); });
    fireEvent.change(screen.getByLabelText('Select Patient'), { target: { value: summary.patient.id } });
    await waitFor(() => expect(mocks.fetchSummary).toHaveBeenCalledTimes(1));
    act(() => { switchActor('64000000-0000-4000-8000-000000000009'); switchActor('64000000-0000-4000-8000-000000000001'); });
    await act(async () => { finish(summary); });
    expect(screen.getByRole('alert')).toHaveTextContent('Reload this page');
    expect(screen.queryByTestId('patient-summary-print')).not.toBeInTheDocument();
  });

  it.each(['account', 'range', 'patient', 'unmount', 'none'])('revalidates a prepared patient PDF after %s changes', async (change) => {
    let finish!: () => void;
    mocks.printGate = new Promise<void>((resolve) => { finish = resolve; });
    mocks.fetchSummary.mockResolvedValue(summary);
    await act(async () => { render(<ReportsShell providerId="64000000-0000-4000-8000-000000000001" data={monthly} from="2025-08-01" to="2025-08-31" patients={patients} />); });
    fireEvent.change(screen.getByLabelText('Select Patient'), { target: { value: summary.patient.id } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export Patient PDF' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Export Patient PDF' }));
    await waitFor(() => expect(mocks.printStarted).toHaveBeenCalledTimes(1));
    const preparedFrame = document.getElementById('printWindow') as HTMLIFrameElement;
    expect(preparedFrame.contentDocument!.body.textContent).toContain('Synthetic Patient');
    if (change === 'account') act(() => { switchActor('64000000-0000-4000-8000-000000000009'); switchActor('64000000-0000-4000-8000-000000000001'); });
    if (change === 'range') fireEvent.click(screen.getByRole('button', { name: 'Last 30 Days' }));
    if (change === 'patient') fireEvent.change(screen.getByLabelText('Select Patient'), { target: { value: '64000000-0000-4000-8000-000000000012' } });
    if (change === 'unmount') cleanup();
    if (change !== 'none') expect(preparedFrame.isConnected).toBe(false);
    await act(async () => { finish(); });
    expect(mocks.printed).toHaveBeenCalledTimes(change === 'none' ? 1 : 0);
  });

  it('protects monthly PDF preparation with the same account fence', async () => {
    let finish!: () => void;
    mocks.printGate = new Promise<void>((resolve) => { finish = resolve; });
    await act(async () => { render(<ReportsShell providerId="64000000-0000-4000-8000-000000000001" data={monthly} from="2025-08-01" to="2025-08-31" patients={patients} />); });
    fireEvent.click(screen.getByRole('button', { name: 'Export Monthly PDF' }));
    await waitFor(() => expect(mocks.printStarted).toHaveBeenCalledTimes(1));
    act(() => switchActor(null));
    await act(async () => { finish(); });
    expect(mocks.printed).not.toHaveBeenCalled();
  });

  it('removes only the owned clone and an obsolete callback cannot clear a newer print', async () => {
    let finishOld!: () => void;
    mocks.printGate = new Promise<void>((resolve) => { finishOld = resolve; });
    mocks.fetchSummary.mockImplementation(async (patientId: string) => ({ ...summary, patient: { ...summary.patient, id: patientId } }));
    await act(async () => { render(<ReportsShell providerId="64000000-0000-4000-8000-000000000001" data={monthly} from="2025-08-01" to="2025-08-31" patients={patients} />); });
    fireEvent.change(screen.getByLabelText('Select Patient'), { target: { value: summary.patient.id } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export Patient PDF' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Export Patient PDF' }));
    await waitFor(() => expect(mocks.printStarted).toHaveBeenCalledTimes(1));
    const oldFrame = document.getElementById('printWindow')!;
    const unrelated = document.createElement('iframe'); unrelated.id = 'unrelated-print'; document.body.append(unrelated);
    fireEvent.change(screen.getByLabelText('Select Patient'), { target: { value: '64000000-0000-4000-8000-000000000012' } });
    expect(oldFrame.isConnected).toBe(false); expect(unrelated.isConnected).toBe(true);
    let finishNew!: () => void;
    mocks.printGate = new Promise<void>((resolve) => { finishNew = resolve; });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export Patient PDF' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Export Patient PDF' }));
    await waitFor(() => expect(mocks.printStarted).toHaveBeenCalledTimes(2));
    const newFrame = document.getElementById('printWindow')!;
    await act(async () => { finishOld(); });
    expect(newFrame.isConnected).toBe(true);
    expect(screen.getByRole('button', { name: 'Export Patient PDF' })).toBeDisabled();
    await act(async () => { finishNew(); });
    expect(mocks.printed).toHaveBeenCalledTimes(1);
    unrelated.remove();
  });

  it('prints corrected/cancelled/invalid source labels with full collection precision and no misleading Normal', () => {
    const base: LabResultRow = { id: 'one', patient_id: summary.patient.id, test_name: 'BNP', value: '-1', unit: 'pg/mL',
      collected_at: '2025-08-01T13:15:00.123456Z', flag: 'normal', source_status: 'corrected', root_id: 'root',
      version_id: 'version', revision: '2', original_lab_result_id: 'original', effective_lab_result_id: 'amendment',
      evaluation_status: 'pending', data_quality: 'invalid', quality_reason: 'Invalid recorded value; verify the source.' };
    render(<PatientSummaryPrint data={{ ...summary, labs: [base, { ...base, id: 'two', test_name: 'Potassium', value: null,
      source_status: 'cancelled', data_quality: 'cancelled', effective_lab_result_id: null, evaluation_status: null,
      quality_reason: 'Cancelled source; reconcile.' }] }} />);
    const report = within(screen.getByTestId('patient-summary-print'));
    expect(report.getByText('corrected · revision 2')).toBeInTheDocument();
    expect(report.getByText('cancelled · revision 2')).toBeInTheDocument();
    expect(report.getAllByText('2025-08-01T13:15:00.123456Z')).toHaveLength(2);
    expect(report.getAllByText('Not usable — reconcile source')).toHaveLength(2);
    expect(report.getByText('No current value')).toBeInTheDocument();
    expect(report.getByText('Alert processing pending')).toBeInTheDocument();
    expect(report.queryByText('Normal')).not.toBeInTheDocument();
  });
});
