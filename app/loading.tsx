export default function AppLoading() {
  return (
    <main id="main-content" className="mx-auto w-full max-w-5xl space-y-4 px-4 py-10" aria-busy="true" aria-live="polite">
      <p className="font-semibold text-slate-700">Loading HEARTLAND…</p>
      <div className="h-24 animate-pulse rounded-2xl bg-slate-100" />
      <div className="grid gap-3 sm:grid-cols-2"><div className="h-40 animate-pulse rounded-2xl bg-slate-100" /><div className="h-40 animate-pulse rounded-2xl bg-slate-100" /></div>
    </main>
  );
}
