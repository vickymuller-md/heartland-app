/**
 * Discharge Index -- Interstitial Page
 * Shows instruction to select a patient from Patients list.
 */

import { ClipboardList, Users } from 'lucide-react';
import Link from 'next/link';

export default function DischargeIndexPage() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <ClipboardList className="h-12 w-12 text-gray-300 mb-4" />
      <h1 className="text-xl font-semibold text-gray-900 mb-2">
        Discharge Checklist
      </h1>
      <p className="text-sm text-gray-500 max-w-md mb-6">
        Select a patient from the Patients list to access their discharge
        checklist, follow-up schedule, and printable instructions.
      </p>
      <Link
        href="/patients"
        className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 transition-colors"
      >
        <Users className="h-4 w-4" />
        Go to Patients
      </Link>
    </div>
  );
}
