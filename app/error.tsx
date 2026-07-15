'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[ui-boundary] route failed', error.digest ?? 'no-digest');
  }, [error.digest]);

  return (
    <main id="main-content" className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="text-2xl font-bold text-slate-950">This page could not be loaded</h1>
      <p className="mt-3 text-sm text-slate-600">Do not interpret a failed screen as an empty queue or complete record. Retry, then use the documented downtime workflow if the problem continues.</p>
      <div className="mt-6 flex justify-center gap-3">
        <Button className="min-h-11" onClick={reset}>Try again</Button>
        <Link href="/downtime" className="inline-flex min-h-11 items-center rounded-lg border px-4 text-sm font-semibold">Downtime guide</Link>
      </div>
    </main>
  );
}
