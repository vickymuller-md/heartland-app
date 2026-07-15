import Link from 'next/link';

export default function NotFound() {
  return (
    <main id="main-content" className="mx-auto max-w-xl px-4 py-16 text-center">
      <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">404</p>
      <h1 className="mt-2 text-3xl font-bold text-slate-950">Page not found</h1>
      <p className="mt-3 text-slate-600">The requested HEARTLAND route does not exist or is no longer available.</p>
      <Link href="/" className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-slate-900 px-5 text-sm font-semibold text-white">Return home</Link>
    </main>
  );
}
