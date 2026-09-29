import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { ClipboardCheck } from 'lucide-react';
import { getTitrationWorklist, type TitrationWorklistRow } from '@/lib/dashboard/worklist-queries';
import { WorklistTable } from './_components/worklist-table';

/**
 * Titration Worklist -- Server Component
 *
 * Shows patients due for titration this week with their latest K+, Cr, SBP.
 * "Due" = no titration note ever, or last titration note >= 7 days ago.
 *
 * Requirements: EFFI-03
 */
export default async function TitrationWorklistPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  let rows: TitrationWorklistRow[] = [];
  let unavailable = false;
  try { rows = await getTitrationWorklist(supabase, user.id); }
  catch { unavailable = true; }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ClipboardCheck className="size-6 text-blue-600" aria-hidden="true" />
        <h1 className="text-2xl font-bold tracking-tight text-gray-900">Titration Worklist</h1>
      </div>
      <p className="text-sm text-gray-500">
        Patients due for a titration call this week (no call in the last 7 days or never titrated).
      </p>
      {unavailable ? (
        <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-900">
          Worklist unavailable. Current laboratory data and follow-up needs could not be verified.
          Reload the page; do not interpret this as no pending work.
        </p>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center">
          <ClipboardCheck className="mx-auto mb-3 size-8 text-gray-300" aria-hidden="true" />
          <p className="text-gray-500">No patients due for titration this week.</p>
        </div>
      ) : (
        <WorklistTable rows={rows} />
      )}
    </div>
  );
}
