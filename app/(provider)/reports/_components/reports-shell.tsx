'use client';

/**
 * ReportsShell -- Client Component
 *
 * Three sections: (A) Monthly Report, (B) Patient Summary, (C) CSV Export.
 * Uses react-to-print v3 for PDF export and client-side Supabase for CSV data.
 *
 * Requirements: REPT-01 (Monthly PDF), REPT-02 (Patient PDF),
 *               REPT-03 (CSV Export), REPT-04 (Date Range), REPT-05 (Navigation)
 */

import { useRef, useState, useEffect } from 'react';
import { useSessionBoundExport } from '@/lib/exports/use-session-bound-export';
import { DateRangePicker } from './date-range-picker';
import { MonthlyReportPrint } from './monthly-report-print';
import { PatientSummaryPrint } from './patient-summary-print';
import { fetchPatientSummary } from '@/lib/reports/actions';
import {
  downloadCSV,
  buildVitalsCSV,
  buildLabsCSV,
  buildMedsCSV,
} from '@/lib/reports/csv-builders';
import type { MonthlyReportData, PatientSummaryData } from '@/lib/reports/types';
import { getReportLabResults } from '@/lib/reports/lab-results';
import type { PatientWithStatus } from '@/lib/dashboard/types';
import { Printer, Download } from 'lucide-react';

interface ReportsShellProps {
  providerId: string;
  data: MonthlyReportData;
  patients: PatientWithStatus[];
  from: string;
  to: string;
}

export function ReportsShell(props: ReportsShellProps) {
  // A new server context creates an isolated lifetime; old requests cannot populate it.
  return <SessionBoundReports key={JSON.stringify([props.providerId, props.from, props.to, props.patients.map((p) => p.id)])} {...props} />;
}

function SessionBoundReports({ data, patients, from, to, providerId }: ReportsShellProps) {
  const { supabase, alive, epoch, sessionReady, sessionError, isCurrent, verifySession,
    invalidateSession, invalidateContent, beginPrint: printDocument, printBusy, printError } = useSessionBoundExport(providerId);
  const monthlyPrintRef = useRef<HTMLDivElement>(null);
  const patientPrintRef = useRef<HTMLDivElement>(null);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [patientSummaryData, setPatientSummaryData] = useState<PatientSummaryData | null>(null);
  const [patientSummaryError, setPatientSummaryError] = useState<string | null>(null);
  const [patientSummaryLoading, setPatientSummaryLoading] = useState(false);
  const [csvType, setCsvType] = useState<'vitals' | 'labs' | 'medications'>('vitals');
  const [deidentify, setDeidentify] = useState(false);
  const [csvLoading, setCsvLoading] = useState(false);
  const [csvError, setCsvError] = useState<string | null>(null);
  const linkedPatientIds = patients.map((p) => p.id);
  const printablePatientSummary = patientSummaryData?.patient.id === selectedPatientId
    && patientSummaryData?.dateRange.from === from && patientSummaryData?.dateRange.to === to
    ? patientSummaryData : null;

  useEffect(() => {
    let obsolete = false;
    setPatientSummaryData(null); setPatientSummaryError(null);
    setPatientSummaryLoading(Boolean(sessionReady && selectedPatientId));
    if (!sessionReady || !selectedPatientId) return;
    const ticket = epoch.current;
    const loadSummary = async () => {
      try {
        await verifySession(ticket);
        const result = await fetchPatientSummary(selectedPatientId, from, to);
        await verifySession(ticket);
        if (obsolete || !isCurrent(ticket)) return;
        setPatientSummaryData(result);
        if (!result) setPatientSummaryError('Unable to load patient summary. Please try again.');
      } catch {
        if (obsolete || !isCurrent(ticket)) return;
        setPatientSummaryData(null);
        setPatientSummaryError('Unable to load patient summary. Please try again.');
      } finally {
        if (!obsolete && isCurrent(ticket)) setPatientSummaryLoading(false);
      }
    };
    void loadSummary();
    return () => { obsolete = true; };
  }, [selectedPatientId, from, to, sessionReady, verifySession, isCurrent, epoch]);

  const beginPrint = (kind: 'monthly' | 'patient') => {
    if (kind === 'patient' && !printablePatientSummary) return;
    printDocument(kind === 'monthly' ? monthlyPrintRef.current : patientPrintRef.current,
      kind === 'monthly' ? `HEARTLAND-Monthly-${data.month}` : 'HEARTLAND-Patient-Summary');
  };

  const handleCsvDownload = async () => {
    if (!sessionReady || csvLoading || linkedPatientIds.length === 0) return;
    const ticket = epoch.current;
    setCsvLoading(true); setCsvError(null);
    try {
      await verifySession(ticket);
      const patientMap = new Map(patients.map((p, i) => [p.id, `P${String(i + 1).padStart(3, '0')}`]));
      const opts = { deidentify, patientMap };
      let rows: string[][];
      if (csvType === 'labs') {
        rows = buildLabsCSV(await getReportLabResults(supabase, linkedPatientIds, { from, to }, providerId), opts);
      } else if (csvType === 'vitals') {
        const { data: vitals, error } = await supabase.from('vitals')
          .select('patient_id, recorded_at, weight_lbs, sbp, dbp, heart_rate, spo2')
          .in('patient_id', linkedPatientIds).gte('recorded_at', from).lte('recorded_at', to)
          .order('recorded_at', { ascending: false });
        if (error) throw error;
        rows = buildVitalsCSV(vitals ?? [], opts);
      } else {
        const { data: meds, error } = await supabase.from('medication_logs')
          .select('patient_id, medications(name, dose, frequency), taken_at, taken')
          .in('patient_id', linkedPatientIds).gte('taken_at', from).lte('taken_at', to)
          .order('taken_at', { ascending: false });
        if (error) throw error;
        rows = buildMedsCSV((meds ?? []).map((m: Record<string, unknown>) => {
          const med = m.medications as Record<string, unknown> | null;
          return { patient_id: m.patient_id as string, medication_name: (med?.name as string) ?? '',
            dose: (med?.dose as string) ?? '', frequency: (med?.frequency as string) ?? '',
            taken_at: m.taken_at as string, taken: m.taken as boolean };
        }), opts);
      }
      await verifySession(ticket);
      if (!isCurrent(ticket)) return;
      downloadCSV(`heartland-${csvType}-${from}-to-${to}.csv`, rows);
    } catch {
      if (isCurrent(ticket)) setCsvError('Unable to export data. Please try again.');
    } finally {
      if (alive.current) setCsvLoading(false);
    }
  };

  if (!sessionReady) return <p role={sessionError ? 'alert' : 'status'}>{sessionError
    ? 'Report session changed or unavailable. Reload this page before exporting.'
    : 'Verifying report session…'}</p>;
  return (
    <div className="space-y-8">
      {/* Date Range Picker */}
      <DateRangePicker from={from} to={to} onRangeChange={invalidateSession} />
      {printError && <p role="alert">{printError}</p>}
      <p className="text-xs text-gray-600">
        Lab reports use UTC calendar dates and include the full final day. Collection timestamps are retained unless privacy-minimized export is selected.
      </p>

      {/* Section A: Monthly Report */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Monthly Usage Report</h2>
          <button
            type="button"
            className="flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            disabled={printBusy}
            onClick={() => beginPrint('monthly')}
          >
            <Printer className="size-4" />
            Export Monthly PDF
          </button>
        </div>

        {/* Metric cards grid */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <MetricCard label="Patients Monitored" value={data.totalPatients} />
          <MetricCard label="Active in Period" value={data.activePatientsInPeriod} />
          <MetricCard label="Alerts Generated" value={data.alertsGenerated} />
          <MetricCard label="Critical Alerts" value={data.alertsCritical} />
          <MetricCard
            label="Titrations Completed"
            value={data.titrationNotesCount}
          />
          <MetricCard
            label="Check-In Compliance"
            value={`${data.avgCheckInCompliance.toFixed(1)}%`}
          />
          <MetricCard
            label="GDMT Optimization Rate"
            value={
              data.gdmtOptimizationRate !== null
                ? `${data.gdmtOptimizationRate.toFixed(1)}%`
                : 'Pending'
            }
          />
        </div>

        {/* Print layout -- always mounted, hidden on screen */}
        <MonthlyReportPrint ref={monthlyPrintRef} data={data} />
      </section>

      {/* Section B: Patient Summary */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Patient Summary Report</h2>
          <button
            type="button"
            className="flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            disabled={!printablePatientSummary || patientSummaryLoading || printBusy}
            onClick={() => beginPrint('patient')}
          >
            <Printer className="size-4" />
            Export Patient PDF
          </button>
        </div>

        <div className="flex items-center gap-4 mb-4">
          <label htmlFor="patient-select" className="text-sm font-medium text-gray-700">
            Select Patient
          </label>
          <select
            id="patient-select"
            className="rounded border border-gray-300 px-3 py-2 text-sm"
            value={selectedPatientId ?? ''}
            onChange={(e) => {
              invalidateContent(); setPatientSummaryData(null);
              setSelectedPatientId(e.target.value || null);
            }}
          >
            <option value="">-- Choose a patient --</option>
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </select>
          {patientSummaryLoading && (
            <span className="text-sm text-gray-500">Loading...</span>
          )}
        </div>

        {patientSummaryError && <p role="alert" className="mb-4 text-sm text-red-600">{patientSummaryError}</p>}

        {/* Print layout -- always mounted, hidden on screen */}
        <PatientSummaryPrint ref={patientPrintRef} data={printablePatientSummary} />
      </section>

      {/* Section C: CSV Export */}
      <section>
        <h2 className="text-lg font-semibold mb-4">CSV Data Export</h2>

        <div className="flex items-center gap-2 mb-4">
          {(['vitals', 'labs', 'medications'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              disabled={csvLoading}
              className={`rounded px-3 py-1 text-sm font-medium capitalize disabled:opacity-50 ${
                csvType === tab
                  ? 'bg-gray-900 text-white'
                  : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
              onClick={() => setCsvType(tab)}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-start sm:gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={deidentify}
              disabled={csvLoading}
              onChange={(e) => setDeidentify(e.target.checked)}
              aria-describedby="privacy-minimized-export-note"
              className="rounded border-gray-300"
            />
            Privacy-minimized research export
          </label>

          <button
            type="button"
            className="flex items-center gap-2 rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            disabled={csvLoading || linkedPatientIds.length === 0}
            onClick={handleCsvDownload}
          >
            <Download className="size-4" />
            {csvLoading ? 'Downloading...' : 'Download CSV'}
          </button>
        </div>
        <p id="privacy-minimized-export-note" className="mt-3 max-w-3xl text-xs leading-5 text-gray-600">
          When selected, patient IDs are replaced with local export labels and dates are reduced to year only; laboratory source identifiers are omitted. These transformations do not independently establish de-identification or HIPAA compliance; authorized reviewers must assess the complete dataset and intended disclosure.
        </p>
        {csvError && <p role="alert" className="mt-3 text-sm text-red-600">{csvError}</p>}
      </section>
    </div>
  );
}

// Simple metric display card
function MetricCard({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
    </div>
  );
}
