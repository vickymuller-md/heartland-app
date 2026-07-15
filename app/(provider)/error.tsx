'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function ProviderError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section role="alert" className="rounded-2xl border border-red-300 bg-red-50 p-6 text-red-950">
      <h1 className="text-xl font-bold">Operational workspace unavailable</h1>
      <p className="mt-2 text-sm">Queue and patient data may be incomplete. Do not treat this screen as “no work.”</p>
      <div className="mt-4 flex flex-wrap gap-3"><Button className="min-h-11" onClick={reset}>Retry</Button><Link href="/downtime" className="inline-flex min-h-11 items-center rounded-lg border border-red-400 px-4 text-sm font-semibold">Open downtime workflow</Link></div>
    </section>
  );
}
