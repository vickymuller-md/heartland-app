export default function PatientLoading() {
  return <div className="space-y-4" aria-busy="true" aria-live="polite"><p className="font-semibold text-slate-700">Loading your recorded plan…</p><div className="h-28 animate-pulse rounded-xl bg-slate-100" /><div className="h-56 animate-pulse rounded-xl bg-slate-100" /></div>;
}
