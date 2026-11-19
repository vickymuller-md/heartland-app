'use server';

/**
 * HEARTLAND Reports -- Server Actions
 *
 * Server Action wrappers for report data fetching.
 * Used by client components that need to fetch data on demand
 * (e.g., patient summary when patient selector changes).
 *
 * Requirement: REPT-02 (Patient Summary PDF)
 */

import { authorize, authorizeProviderForPatient } from '@/lib/auth/authorization';
import { getPatientSummaryData, getReportPatientIds } from '@/lib/reports/queries';
import type { PatientSummaryData, ReportDateRange } from '@/lib/reports/types';
import { z } from 'zod';
import { getReportVitals, getReportMedicationLogs } from './export-data';
import { buildMedsCSV, buildVitalsCSV } from './csv-builders';
import { reportDateBounds } from './date-range';

const reportRequestSchema = z.object({
  patientId: z.string().uuid(),
  from: z.iso.date(),
  to: z.iso.date(),
})
  .refine(({ from, to }) => from <= to, { message: 'Invalid date range' })
  .refine(
    ({ from, to }) => Date.parse(to) - Date.parse(from) <= 366 * 86_400_000,
    { message: 'Date range is too large' },
  );

/**
 * Fetch patient summary data for PDF export.
 * Called from ReportsShell when selectedPatientId changes.
 */
export async function fetchPatientSummary(
  patientId: string,
  from: string,
  to: string
): Promise<PatientSummaryData | null> {
  const parsed = reportRequestSchema.safeParse({ patientId, from, to });
  if (!parsed.success) return null;
  const auth = await authorizeProviderForPatient(parsed.data.patientId);
  if (!auth.authorized) return null;

  const range: ReportDateRange = { from: parsed.data.from, to: parsed.data.to };
  return getPatientSummaryData(
    auth.supabase,
    parsed.data.patientId,
    auth.user.id,
    range,
  );
}

export async function fetchReportCsv(
  kind: 'vitals' | 'medications', patientIds: string[], range: ReportDateRange, expectedProviderId: string, minimized: boolean,
): Promise<string[][]> {
  reportDateBounds(range);
  const scope = [...new Set(z.array(z.uuid()).min(1).parse(patientIds).map(id => id.toLowerCase()))];
  const auth = await authorize('provider');
  if (!auth.authorized || auth.user.id !== expectedProviderId) throw new Error('Report session unavailable.');
  const linked = new Set(await getReportPatientIds(auth.supabase, auth.user.id));
  if (scope.some(id => !linked.has(id))) throw new Error('Panel membership changed.');
  const opts = { deidentify: minimized, patientMap: new Map(scope.map((id, i) => [id, `P${String(i + 1).padStart(3, '0')}`])) };
  if (kind === 'vitals') return buildVitalsCSV(await getReportVitals(auth.supabase, scope, range), opts);
  if (kind === 'medications') return buildMedsCSV(await getReportMedicationLogs(auth.supabase, scope, range), opts);
  throw new Error('Unknown report type.');
}
