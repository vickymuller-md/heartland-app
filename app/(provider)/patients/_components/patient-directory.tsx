import Link from 'next/link';
import { Search, User, Mail, Phone, Shield, Radio, Building2 } from 'lucide-react';

interface PatientEntry {
  id: string;
  code: string;
  full_name: string;
  email: string;
  phone: string;
  risk_tier: string | null;
  track_assignment: string | null;
  facility_tier: number | null;
  linked_at: string | null;
}

const TIER_COLORS: Record<string, string> = {
  low: 'bg-green-100 text-green-800',
  moderate: 'bg-amber-100 text-amber-800',
  high: 'bg-red-100 text-red-800',
};
const TRACK_LABELS: Record<string, string> = { A: 'Digital', B: 'Analog', hybrid: 'Hybrid' };

export function PatientDirectory({
  patients,
  query,
  total,
  page,
  pageSize,
}: {
  patients: PatientEntry[];
  query: string;
  total: number;
  page: number;
  pageSize: number;
}) {
  const suffix = query ? `&q=${encodeURIComponent(query)}` : '';
  return (
    <div className="space-y-4">
      <form method="get" className="flex gap-2" role="search">
        <label className="relative flex-1">
          <span className="sr-only">Search linked patients</span>
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
          <input name="q" defaultValue={query} maxLength={80} placeholder="Name, email, phone, or patient code" className="min-h-12 w-full rounded-lg border pl-10 pr-3 text-base" />
        </label>
        <button type="submit" className="min-h-12 rounded-lg bg-slate-900 px-5 text-sm font-semibold text-white">Search</button>
      </form>
      {query && <p className="text-sm text-gray-500">{total} result{total === 1 ? '' : 's'} for “{query}” · <Link href="/patients" className="font-semibold text-blue-700">Clear</Link></p>}

      {patients.length === 0 ? (
        <div className="py-12 text-center text-gray-500"><User className="mx-auto mb-3 size-10 text-gray-300" aria-hidden="true" /><p>No linked patients match this search.</p></div>
      ) : (
        <div className="divide-y divide-gray-100 rounded-lg border bg-white">
          {patients.map((patient) => (
            <Link key={patient.id} href={`/patients/${patient.id}`} className="flex min-h-24 items-start gap-4 p-4 transition-colors hover:bg-gray-50">
              <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-slate-100 text-lg font-semibold text-slate-600">{patient.full_name.split(' ').map((name) => name[0]).join('').slice(0, 2).toUpperCase()}</div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><span className="truncate font-semibold text-gray-900">{patient.full_name}</span><span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-500">{patient.code}</span></div>
                <div className="mt-1.5 grid gap-x-6 gap-y-1 text-sm text-gray-500 sm:grid-cols-2"><span className="flex items-center gap-1.5 truncate"><Mail className="size-3.5" aria-hidden="true" />{patient.email}</span><span className="flex items-center gap-1.5"><Phone className="size-3.5" aria-hidden="true" />{patient.phone}</span></div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {patient.risk_tier && <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${TIER_COLORS[patient.risk_tier] ?? 'bg-gray-100 text-gray-700'}`}><Shield className="size-3" aria-hidden="true" />{patient.risk_tier} risk</span>}
                  {patient.track_assignment && <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800"><Radio className="size-3" aria-hidden="true" />Track {patient.track_assignment} ({TRACK_LABELS[patient.track_assignment] ?? patient.track_assignment})</span>}
                  {patient.facility_tier && <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800"><Building2 className="size-3" aria-hidden="true" />Tier {patient.facility_tier}</span>}
                </div>
              </div>
              <span aria-hidden="true" className="self-center text-gray-400">→</span>
            </Link>
          ))}
        </div>
      )}

      {total > pageSize && <nav className="flex items-center justify-between rounded-lg border bg-white p-3" aria-label="Patient pages">{page > 1 ? <Link href={`/patients?page=${page - 1}${suffix}`} className="inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-semibold">Previous</Link> : <span />}<span className="text-sm font-semibold">Page {page} of {Math.ceil(total / pageSize)}</span>{page * pageSize < total ? <Link href={`/patients?page=${page + 1}${suffix}`} className="inline-flex min-h-11 items-center rounded-md bg-slate-900 px-4 text-sm font-semibold text-white">Next</Link> : <span />}</nav>}
    </div>
  );
}
