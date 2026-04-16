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

import { createClient } from '@/lib/supabase/server';
import { getPatientSummaryData } from '@/lib/reports/queries';
import type { PatientSummaryData, ReportDateRange } from '@/lib/reports/types';

/**
 * Fetch patient summary data for PDF export.
 * Called from ReportsShell when selectedPatientId changes.
 */
export async function fetchPatientSummary(
  patientId: string,
  from: string,
  to: string
): Promise<PatientSummaryData | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const range: ReportDateRange = { from, to };
  return getPatientSummaryData(supabase, patientId, user.id, range);
}
