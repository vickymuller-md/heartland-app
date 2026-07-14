'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { Filter, Save, Trash2 } from 'lucide-react';
import { deleteQueueView, saveQueueView } from '@/lib/daily-loop/actions';
import type { SavedQueueView } from '@/lib/daily-loop/types';
import { Button } from '@/components/ui/button';

const initialState: { success?: boolean; error?: string } = {};

export function QueueViewControls({
  views,
  selectedViewId,
}: {
  views: SavedQueueView[];
  selectedViewId?: string;
}) {
  const [state, action, pending] = useActionState(saveQueueView, initialState);
  return (
    <section className="rounded-xl border bg-slate-50 p-4" aria-labelledby="queue-view-title">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 id="queue-view-title" className="flex items-center gap-2 font-semibold text-slate-900"><Filter className="size-4" /> Saved queue views</h2>
          <p className="mt-1 text-xs text-slate-600">Filters contain workflow metadata only—never patient identifiers or search text.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/dashboard" className={`rounded-full border px-3 py-1.5 text-xs font-medium ${!selectedViewId ? 'border-blue-600 bg-blue-600 text-white' : 'bg-white text-slate-700'}`}>All assigned work</Link>
            {views.map((view) => (
              <div key={view.id} className="inline-flex items-center overflow-hidden rounded-full border bg-white">
                <Link href={`/dashboard?view=${view.id}`} className={`px-3 py-1.5 text-xs font-medium ${selectedViewId === view.id ? 'bg-blue-600 text-white' : 'text-slate-700'}`}>{view.name}</Link>
                <form action={deleteQueueView}>
                  <input type="hidden" name="viewId" value={view.id} />
                  <button type="submit" aria-label={`Delete ${view.name}`} className="inline-flex min-h-8 min-w-8 items-center justify-center border-l text-slate-500 hover:text-red-700"><Trash2 className="size-3.5" /></button>
                </form>
              </div>
            ))}
          </div>
        </div>

        <form action={action} className="grid gap-2 sm:grid-cols-4 lg:max-w-2xl">
          <input name="name" required minLength={2} maxLength={60} placeholder="View name" className="min-h-10 rounded-md border bg-white px-3 text-sm" />
          <select name="severity" aria-label="Severity filter" className="min-h-10 rounded-md border bg-white px-2 text-sm"><option value="">Any severity</option><option value="critical">Critical</option><option value="warning">Warning</option><option value="informational">Informational</option></select>
          <select name="priority" aria-label="Priority filter" className="min-h-10 rounded-md border bg-white px-2 text-sm"><option value="">Any priority</option><option value="now">Now</option><option value="today">Today</option><option value="week">This week</option><option value="watching">Watching</option></select>
          <select name="sourceType" aria-label="Source filter" className="min-h-10 rounded-md border bg-white px-2 text-sm"><option value="">Any source</option><option value="alert">Alert</option><option value="scheduled_followup">Scheduled follow-up</option><option value="discharge_followup">Discharge follow-up</option><option value="manual">Manual</option><option value="titration">Titration</option><option value="data_quality">Data quality</option></select>
          <div className="flex items-center gap-2 sm:col-span-4 sm:justify-end">
            {state.success && <span className="text-xs text-emerald-700">View saved.</span>}
            {state.error && <span role="alert" className="text-xs text-red-700">{state.error}</span>}
            <Button type="submit" size="sm" disabled={pending}><Save className="mr-1 size-3.5" /> {pending ? 'Saving…' : 'Save view'}</Button>
          </div>
        </form>
      </div>
    </section>
  );
}
