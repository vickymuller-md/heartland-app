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

import { authorizeProviderForPatient } from '@/lib/auth/authorization';
import { getPatientSummaryData } from '@/lib/reports/queries';
import type { PatientSummaryData, ReportDateRange } from '@/lib/reports/types';
import { z } from 'zod';

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
