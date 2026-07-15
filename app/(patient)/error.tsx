'use client';

import { Button } from '@/components/ui/button';

export default function PatientError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <section role="alert" className="rounded-xl border border-red-300 bg-red-50 p-5 text-red-950"><h1 className="text-xl font-bold">Your recorded information could not be loaded</h1><p className="mt-2 text-sm">This does not mean your tasks are complete. Follow the instructions provided by your care team.</p><Button className="mt-4 min-h-11" onClick={reset}>Try again</Button></section>;
}
