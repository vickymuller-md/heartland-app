'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { createManualWorkItem, type CreateWorkItemState } from '@/lib/daily-loop/actions';
import { Button } from '@/components/ui/button';
import { ClipboardList, FileText, MessageSquare, PhoneCall } from 'lucide-react';

export function ActionCenter({ patientId }: { patientId: string }) {
  const [state, action, pending] = useActionState<CreateWorkItemState, FormData>(
    createManualWorkItem,
    {},
  );

  return (
    <section className="rounded-2xl border border-blue-200 bg-blue-50/40 p-5" aria-labelledby="action-center-heading">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Action Center</p>
        <h2 id="action-center-heading" className="text-lg font-bold text-slate-950">Act without losing the follow-up</h2>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <Link href={`/patients/${patientId}/sbar`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border bg-white px-3 text-sm font-medium text-slate-800">
          <FileText className="size-4" /> Structured handoff
        </Link>
        <Link href={`/discharge/${patientId}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border bg-white px-3 text-sm font-medium text-slate-800">
          <ClipboardList className="size-4" /> Discharge workflow
        </Link>
        <a href="#patient-record-tabs" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border bg-white px-3 text-sm font-medium text-slate-800">
          <MessageSquare className="size-4" /> Note or message
        </a>
      </div>

      <form action={action} className="mt-4 grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-2">
        <input type="hidden" name="patientId" value={patientId} />
        <label className="text-sm font-medium text-slate-800 sm:col-span-2">
          Follow-up task
          <input name="title" required minLength={3} maxLength={160} placeholder="Call patient after lab review" className="mt-1 min-h-11 w-full rounded-md border px-3" />
        </label>
        <label className="text-sm font-medium text-slate-800 sm:col-span-2">
          Why this work is needed
          <textarea name="reason" required minLength={3} maxLength={1000} rows={2} className="mt-1 w-full rounded-md border px-3 py-2" />
        </label>
        <label className="text-sm font-medium text-slate-800">
          Time horizon
          <select name="priority" defaultValue="today" className="mt-1 min-h-11 w-full rounded-md border px-3">
            <option value="now">Now</option><option value="today">Today</option><option value="week">This week</option><option value="watching">Watching</option>
          </select>
        </label>
        <label className="text-sm font-medium text-slate-800">
          Operational severity
          <select name="severity" defaultValue="informational" className="mt-1 min-h-11 w-full rounded-md border px-3">
            <option value="critical">Critical</option><option value="warning">Warning</option><option value="informational">Informational</option>
          </select>
        </label>
        <label className="text-sm font-medium text-slate-800 sm:col-span-2">
          Due date
          <input name="dueAt" type="datetime-local" required className="mt-1 min-h-11 w-full rounded-md border px-3" />
        </label>
        {state.error && <p role="alert" className="text-sm text-red-700 sm:col-span-2">{state.error}</p>}
        {state.success && <p role="status" className="text-sm text-emerald-700 sm:col-span-2">Added to Daily Loop.</p>}
        <Button type="submit" disabled={pending} className="sm:col-span-2">
          <PhoneCall className="mr-2 size-4" /> {pending ? 'Adding…' : 'Add work with owner and deadline'}
        </Button>
      </form>
    </section>
  );
}
