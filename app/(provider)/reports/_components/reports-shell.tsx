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

import { useRef, useState, useTransition, useEffect } from 'react';
import { useReactToPrint } from 'react-to-print';
import { DateRangePicker } from './date-range-picker';
import { MonthlyReportPrint } from './monthly-report-print';
import { PatientSummaryPrint } from './patient-summary-print';
import { fetchPatientSummary } from '@/lib/reports/actions';
import { createClient } from '@/lib/supabase/client';
import {
  downloadCSV,
  buildVitalsCSV,
  buildLabsCSV,
  buildMedsCSV,
} from '@/lib/reports/csv-builders';
import type { MonthlyReportData, PatientSummaryData } from '@/lib/reports/types';
import type { PatientWithStatus } from '@/lib/dashboard/types';
import { Printer, Download } from 'lucide-react';

interface ReportsShellProps {
  data: MonthlyReportData;
  patients: PatientWithStatus[];
  from: string;
  to: string;
}

export function ReportsShell({ data, patients, from, to }: ReportsShellProps) {
  // Print refs -- always mounted (never conditionally rendered)
  const monthlyPrintRef = useRef<HTMLDivElement>(null);
  const patientPrintRef = useRef<HTMLDivElement>(null);

  // react-to-print v3 hooks
  const handleMonthlyPrint = useReactToPrint({
    contentRef: monthlyPrintRef,
    documentTitle: `HEARTLAND-Monthly-${data.month}`,
  });

  const handlePatientPrint = useReactToPrint({
    contentRef: patientPrintRef,
    documentTitle: 'HEARTLAND-Patient-Summary',
  });

  // Patient summary state
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null);
  const [patientSummaryData, setPatientSummaryData] = useState<PatientSummaryData | null>(null);
  const [isPending, startTransition] = useTransition();

  // Fetch patient data when selection changes
  useEffect(() => {
    if (!selectedPatientId) {
      setPatientSummaryData(null);
      return;
    }

    startTransition(async () => {
      const result = await fetchPatientSummary(selectedPatientId, from, to);
      setPatientSummaryData(result);
    });
  }, [selectedPatientId, from, to]);

  // CSV export state
  const [csvType, setCsvType] = useState<'vitals' | 'labs' | 'medications'>('vitals');
  const [deidentify, setDeidentify] = useState(false);
  const [csvLoading, setCsvLoading] = useState(false);

  const linkedPatientIds = patients.map((p) => p.id);

  const handleCsvDownload = async () => {
    if (linkedPatientIds.length === 0) return;

    setCsvLoading(true);
    try {
      const supabase = createClient();

      // Build local export labels for identifier substitution.
      const patientMap = new Map<string, string>();
      patients.forEach((p, i) => {
        patientMap.set(p.id, `P${String(i + 1).padStart(3, '0')}`);
      });
      const opts = { deidentify, patientMap };

      if (csvType === 'vitals') {
        const { data: vitals } = await supabase
          .from('vitals')
          .select('patient_id, recorded_at, weight_lbs, sbp, dbp, heart_rate, spo2')
          .in('patient_id', linkedPatientIds)
          .gte('recorded_at', from)
          .lte('recorded_at', to)
          .order('recorded_at', { ascending: false });

        const rows = buildVitalsCSV(vitals ?? [], opts);
        downloadCSV(`heartland-vitals-${from}-to-${to}.csv`, rows);
      } else if (csvType === 'labs') {
        const { data: labs } = await supabase
          .from('lab_results')
          .select('id, patient_id, test_name, value, unit, collected_at, flag')
          .in('patient_id', linkedPatientIds)
          .gte('collected_at', from)
          .lte('collected_at', to)
          .order('collected_at', { ascending: false });

        const rows = buildLabsCSV(labs ?? [], opts);
        downloadCSV(`heartland-labs-${from}-to-${to}.csv`, rows);
      } else {
        // medications: join medication_logs with medications
        const { data: meds } = await supabase
          .from('medication_logs')
          .select('patient_id, medications(name, dose, frequency), taken_at, taken')
          .in('patient_id', linkedPatientIds)
          .gte('taken_at', from)
          .lte('taken_at', to)
          .order('taken_at', { ascending: false });

        const rows = buildMedsCSV(
          (meds ?? []).map((m: Record<string, unknown>) => {
            const med = m.medications as Record<string, unknown> | null;
            return {
              patient_id: m.patient_id as string,
              medication_name: (med?.name as string) ?? '',
              dose: (med?.dose as string) ?? '',
              frequency: (med?.frequency as string) ?? '',
              taken_at: m.taken_at as string,
              taken: m.taken as boolean,
            };
          }),
          opts
        );
        downloadCSV(`heartland-medications-${from}-to-${to}.csv`, rows);
      }
    } finally {
      setCsvLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Date Range Picker */}
      <DateRangePicker from={from} to={to} />

      {/* Section A: Monthly Report */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Monthly Usage Report</h2>
          <button
            type="button"
            className="flex items-center gap-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            onClick={() => handleMonthlyPrint()}
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
            disabled={!patientSummaryData || isPending}
            onClick={() => handlePatientPrint()}
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
            onChange={(e) =>
              setSelectedPatientId(e.target.value || null)
            }
          >
            <option value="">-- Choose a patient --</option>
            {patients.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name}
              </option>
            ))}
          </select>
          {isPending && (
            <span className="text-sm text-gray-500">Loading...</span>
          )}
        </div>

        {/* Print layout -- always mounted, hidden on screen */}
        <PatientSummaryPrint ref={patientPrintRef} data={patientSummaryData} />
      </section>

      {/* Section C: CSV Export */}
      <section>
        <h2 className="text-lg font-semibold mb-4">CSV Data Export</h2>

        <div className="flex items-center gap-2 mb-4">
          {(['vitals', 'labs', 'medications'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              className={`rounded px-3 py-1 text-sm font-medium capitalize ${
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
          When selected, patient IDs are replaced with local export labels and dates are reduced to year only. These transformations do not independently establish de-identification or HIPAA compliance; authorized reviewers must assess the complete dataset and intended disclosure.
        </p>
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
