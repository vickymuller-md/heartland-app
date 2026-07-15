export default function ProviderLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-live="polite">
      <p className="font-semibold text-slate-700">Loading operational workspace…</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{Array.from({ length: 5 }, (_, index) => <div key={index} className="h-20 animate-pulse rounded-xl bg-slate-100" />)}</div>
      <div className="h-64 animate-pulse rounded-2xl bg-slate-100" />
    </div>
  );
}
