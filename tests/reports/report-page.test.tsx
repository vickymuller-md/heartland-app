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
import type { MonthlyReportData, PatientSummaryData } from '@/lib/reports/types';
import { PatientSummaryPrint } from '@/app/(provider)/reports/_components/patient-summary-print';

const mocks = vi.hoisted(() => ({
  download: vi.fn(), fetchSummary: vi.fn(), failure: false, page: 0, selection: '',
  labGate: null as Promise<void> | null,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('react-to-print', () => ({ useReactToPrint: () => vi.fn() }));
vi.mock('@/lib/reports/actions', () => ({ fetchPatientSummary: mocks.fetchSummary }));
vi.mock('@/lib/reports/csv-builders', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/reports/csv-builders')>(), downloadCSV: mocks.download,
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => {
    const query = {
      select: (columns: string) => { mocks.selection = columns; return query; },
      in: () => query, gte: () => query, lt: () => query, lte: () => query,
      gt: () => query, order: () => query, limit: () => query,
      then: (resolve: (result: unknown) => void) => {
        const finish = () => {
          if (mocks.failure || /test_name|\bvalue\b/.test(mocks.selection)) {
            return resolve({ data: null, error: { message: 'Private database detail' } });
          }
          return resolve({ data: mocks.page++ === 0 ? [{
            id: 'lab-1', patient_id: 'patient-1', potassium: 6.2, egfr: 50,
            collected_at: '2025-08-01T13:15:00Z',
          }] : [], error: null });
        };
        return mocks.labGate ? mocks.labGate.then(finish) : finish();
      },
    };
    return { from: () => query };
  },
}));
import { ReportsShell } from '@/app/(provider)/reports/_components/reports-shell';

const summary: PatientSummaryData = {
  patient: { id: 'patient-1', full_name: 'Synthetic Patient', risk_tier: null, track_assignment: null },
  vitals: [], symptoms: [], adherenceSummary: null, educationProgress: null, notes: [], openAlerts: [],
  dateRange: { from: '2025-08-01', to: '2025-08-31' }, labs: [],
};
const monthly: MonthlyReportData = {
  month: '2025-08', from: '2025-08-01', to: '2025-08-31', totalPatients: 1,
  activePatientsInPeriod: 0, alertsGenerated: 0, alertsCritical: 0, titrationNotesCount: 0,
  avgCheckInCompliance: 0, gdmtOptimizationRate: null,
};

const patients = [{
  id: 'patient-1', full_name: 'Synthetic Patient', risk_tier: null, track_assignment: null,
  status: 'stable' as const, open_alert_count: 0, last_vitals_at: null, latest_flags: null, setup_complete: true,
}, {
  id: 'patient-2', full_name: 'Second Synthetic Patient', risk_tier: null, track_assignment: null,
  status: 'stable' as const, open_alert_count: 0, last_vitals_at: null, latest_flags: null, setup_complete: true,
}];

beforeEach(() => {
  vi.clearAllMocks(); mocks.fetchSummary.mockReset().mockResolvedValue(null);
  mocks.failure = false; mocks.page = 0; mocks.selection = ''; mocks.labGate = null;
});
afterEach(cleanup);

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
    const labs = Array.from({ length: 13 }, (_, index) => ({
      id: `lab-1:analyte-${index}`, patient_id: 'patient-1', test_name: `Analyte ${index}`,
      value: index, unit: 'stored unit', collected_at: '2025-08-01T09:15:00-04:00', flag: null,
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
      id: 'lab-1:potassium', patient_id: 'patient-1', test_name: 'Potassium', value: 4.5,
      unit: 'mEq/L', collected_at: '2025-08-01T13:15:00Z', flag: 'normal',
    }] }} />);
    expect(within(screen.getByTestId('patient-summary-print')).getByText('Normal')).toBeInTheDocument();
  });

  it('does not replace the selected patient with an older response arriving out of order', async () => {
    let resolveFirst!: (data: PatientSummaryData | null) => void;
    const first = new Promise<PatientSummaryData | null>((resolve) => { resolveFirst = resolve; });
    const second = { ...summary, patient: { ...summary.patient, id: 'patient-2', full_name: 'Second Synthetic Patient' } };
    mocks.fetchSummary.mockReturnValueOnce(first).mockResolvedValueOnce(second);
    render(<ReportsShell data={monthly} from="2025-08-01" to="2025-08-31" patients={patients} />);
    fireEvent.change(screen.getByLabelText('Select Patient'), { target: { value: 'patient-1' } });
    await waitFor(() => expect(mocks.fetchSummary).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Select Patient'), { target: { value: 'patient-2' } });
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
    const second = { ...summary, patient: { ...summary.patient, id: 'patient-2', full_name: 'Second Synthetic Patient' } };
    mocks.fetchSummary.mockReturnValueOnce(first).mockResolvedValueOnce(second);
    render(<ReportsShell data={monthly} from="2025-08-01" to="2025-08-31" patients={patients} />);
    fireEvent.change(screen.getByLabelText('Select Patient'), { target: { value: 'patient-1' } });
    await waitFor(() => expect(mocks.fetchSummary).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Select Patient'), { target: { value: 'patient-2' } });
    try {
      await waitFor(() => expect(screen.getByRole('button', { name: 'Export Patient PDF' })).toBeEnabled());
      expect(within(screen.getByTestId('patient-summary-print')).getByText('Second Synthetic Patient')).toBeInTheDocument();
    } finally {
      await act(async () => { resolveFirst(summary); });
    }
  });

  it('clears the previous printable report on error and never exposes backend details', async () => {
    mocks.fetchSummary.mockResolvedValueOnce(summary).mockRejectedValueOnce(new Error('Private laboratory detail'));
    render(<ReportsShell data={monthly} from="2025-08-01" to="2025-08-31" patients={patients} />);
    fireEvent.change(screen.getByLabelText('Select Patient'), { target: { value: 'patient-1' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export Patient PDF' })).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Select Patient'), { target: { value: 'patient-2' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load patient summary');
    expect(screen.getByRole('button', { name: 'Export Patient PDF' })).toBeDisabled();
    expect(within(screen.getByTestId('patient-summary-print')).queryByText('Synthetic Patient', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('Private laboratory detail')).not.toBeInTheDocument();
  });

  it('keeps patient export disabled when the authorized action returns no accessible summary', async () => {
    render(<ReportsShell data={monthly} from="2025-08-01" to="2025-08-31" patients={patients} />);
    fireEvent.change(screen.getByLabelText('Select Patient'), { target: { value: 'patient-1' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load patient summary');
    expect(screen.getByRole('button', { name: 'Export Patient PDF' })).toBeDisabled();
  });

  it('clears the old period immediately and only prints the newly requested date range', async () => {
    let resolveNext!: (data: PatientSummaryData | null) => void;
    const next = new Promise<PatientSummaryData | null>((resolve) => { resolveNext = resolve; });
    mocks.fetchSummary.mockResolvedValueOnce(summary).mockReturnValueOnce(next);
    const { rerender } = render(<ReportsShell data={monthly} from="2025-08-01" to="2025-08-31" patients={patients} />);
    fireEvent.change(screen.getByLabelText('Select Patient'), { target: { value: 'patient-1' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export Patient PDF' })).toBeEnabled());
    rerender(<ReportsShell data={monthly} from="2025-09-01" to="2025-09-30" patients={patients} />);
    expect(screen.getByRole('button', { name: 'Export Patient PDF' })).toBeDisabled();
    expect(within(screen.getByTestId('patient-summary-print')).queryByText('Synthetic Patient', { exact: true })).not.toBeInTheDocument();
    await act(async () => { resolveNext({ ...summary, dateRange: { from: '2025-09-01', to: '2025-09-30' } }); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export Patient PDF' })).toBeEnabled());
    expect(within(screen.getByTestId('patient-summary-print')).getByText(/2025-09-01.*2025-09-30/)).toBeInTheDocument();
  });

  it('ignores an obsolete request error after the newly selected summary succeeds', async () => {
    let rejectFirst!: (error: Error) => void;
    const first = new Promise<PatientSummaryData | null>((_resolve, reject) => { rejectFirst = reject; });
    const second = { ...summary, patient: { ...summary.patient, id: 'patient-2', full_name: 'Second Synthetic Patient' } };
    mocks.fetchSummary.mockReturnValueOnce(first).mockResolvedValueOnce(second);
    render(<ReportsShell data={monthly} from="2025-08-01" to="2025-08-31" patients={patients} />);
    fireEvent.change(screen.getByLabelText('Select Patient'), { target: { value: 'patient-1' } });
    await waitFor(() => expect(mocks.fetchSummary).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Select Patient'), { target: { value: 'patient-2' } });
    await waitFor(() => expect(mocks.fetchSummary).toHaveBeenCalledTimes(2));
    await act(async () => { rejectFirst(new Error('Private obsolete error')); });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Export Patient PDF' })).toBeEnabled());
    expect(within(screen.getByTestId('patient-summary-print')).getByText('Second Synthetic Patient')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('REPT-03 laboratory CSV interaction', () => {
  function openLabExport() {
    render(<ReportsShell data={monthly} from="2025-08-01" to="2025-08-31" patients={patients.slice(0, 1)} />);
    fireEvent.click(screen.getByRole('button', { name: 'labs', exact: true }));
  }

  it('downloads recorded analytes from the real table shape with collection timestamps', async () => {
    openLabExport();
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    await waitFor(() => expect(mocks.download).toHaveBeenCalledTimes(1));
    const rows = mocks.download.mock.calls[0][1];
    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual(['patient-1', 'Potassium', '6.2', 'mEq/L', '2025-08-01T13:15:00Z', '']);
    expect(screen.getByText(/Lab reports use UTC calendar dates/)).toBeInTheDocument();
  });

  it('retains privacy-minimized ID and year reduction', async () => {
    openLabExport();
    fireEvent.click(screen.getByRole('checkbox', { name: /Privacy-minimized/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    await waitFor(() => expect(mocks.download).toHaveBeenCalledTimes(1));
    expect(mocks.download.mock.calls[0][1][1]).toEqual(['P001', 'Potassium', '6.2', 'mEq/L', '2025', '']);
  });

  it('does not download a misleading empty CSV or expose database details on error', async () => {
    mocks.failure = true;
    openLabExport();
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to export data');
    expect(mocks.download).not.toHaveBeenCalled();
    expect(screen.queryByText('Private database detail')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeEnabled();
  });

  it('does not allow an export without any linked patients', () => {
    render(<ReportsShell data={monthly} from="2025-08-01" to="2025-08-31" patients={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'labs', exact: true }));
    const download = screen.getByRole('button', { name: 'Download CSV' });
    expect(download).toBeDisabled();
    fireEvent.click(download);
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it('locks the privacy choice and CSV type while an export is pending', async () => {
    let finish!: () => void;
    mocks.labGate = new Promise<void>((resolve) => { finish = resolve; });
    openLabExport();
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
    expect(mocks.download.mock.calls[0][1][1][0]).toBe('patient-1');
    expect(screen.getByRole('checkbox', { name: /Privacy-minimized/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'labs', exact: true })).toBeEnabled();
  });
});
