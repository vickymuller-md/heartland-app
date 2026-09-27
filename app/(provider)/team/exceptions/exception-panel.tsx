'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { WorkReassignment } from '@/components/work-reassignment';
import { loadOperationalExceptions } from '@/lib/team/exception-actions';
import { EXCEPTION_CATEGORIES, EXCEPTION_LABELS, EXCEPTION_REASONS, EXCEPTION_LOAD_ERROR,
  type ExceptionResult } from '@/lib/team/operational-exceptions';

interface ExceptionPanelProps {
  organizations: { id: string; name: string }[]; initial: ExceptionResult;
  snapshotId: string;
}

export function ExceptionPanel(props: ExceptionPanelProps) {
  // A new authenticated server render invalidates both rows and in-flight client reads.
  // The opaque key contains no clinical data. Old responses target an unmounted instance.
  return <ExceptionPanelState key={props.snapshotId} {...props} />;
}

function ExceptionPanelState({ organizations, initial, snapshotId }: ExceptionPanelProps) {
  const [organization, setOrganization] = useState(organizations[0]?.id ?? '');
  const [result, setResult] = useState<ExceptionResult | null>(initial);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);

  async function load(id: string, after: string | null) {
    const current = ++generation.current;
    setOrganization(id);
    // Never keep a previous team's clinical rows or counts visible during a switch/failure.
    setResult(null);
    setBusy(true);
    try {
      const response = await loadOperationalExceptions({ organizationId: id, after });
      if (current === generation.current) setResult(response);
    } catch {
      if (current === generation.current) setResult({ data: null, error: EXCEPTION_LOAD_ERROR });
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }

  if (organizations.length === 0) return <p>No active organization is available for this view.</p>;
  const data = result?.data;
  return (
    <section className="space-y-5" aria-label="Operational exceptions" aria-busy={busy}>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm font-medium">Organization
          <select value={organization} onChange={(event) => void load(event.target.value, null)}
            className="min-h-11 rounded-lg border bg-white px-3">
            {organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
          </select>
        </label>
        <button type="button" disabled={busy} onClick={() => void load(organization, null)}
          className="min-h-11 rounded-lg border px-4 text-sm font-medium disabled:opacity-50">Refresh from first page</button>
      </div>
      <p className="text-sm text-slate-600">Live technical records, not a count of patients or a clinical priority order.
        Pending does not mean failed. A recorded signal does not prove notification delivery, patient contact or completed care.</p>
      {busy && <p role="status">Loading the current authorized view…</p>}
      {result?.error && <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-900">{result.error}</p>}
      {data?.counts && <section aria-label="Administrative totals" className="space-y-2">
        <h2 className="text-lg font-semibold">Organization totals</h2>
        <p className="text-sm text-slate-600">Administrative counts contain no patient identifiers. Your detail list may be smaller because patient access is checked separately.</p>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {EXCEPTION_CATEGORIES.map((category) => <div key={category} className="rounded-lg border bg-white p-4">
            <dt className="text-sm text-slate-600">{EXCEPTION_LABELS[category]}</dt>
            <dd className="text-2xl font-bold">{data.counts![category]}</dd>
          </div>)}
        </dl>
      </section>}
      {data && !data.detail_authorized && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-4">
        Patient details require current monitoring authorization and patient access. No authorization was granted by opening this page.
      </p>}
      {data?.detail_authorized && <section className="space-y-3" aria-label="Authorized details">
        <h2 className="text-lg font-semibold">Your authorized details</h2>
        {data.items.length === 0 ? <p>No exceptions are visible in this page and your current scope. This is not an organization-wide all-clear.</p>
          : <ul className="space-y-3">{data.items.map((item) => <li key={item.key} className="rounded-xl border bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">{EXCEPTION_LABELS[item.category]}</h3>
              <span className="rounded-full bg-amber-50 px-3 py-1 text-sm text-amber-900">{item.state.replaceAll('_', ' ')}</span>
            </div>
            {item.category === 'notification' && <p className="mt-2 text-sm text-slate-600">
              Unsent intent only. These reasons describe capture time, not current authorization or a delivery attempt.
              Automated transport is inactive; this record does not promise a future send.
            </p>}
            {item.category === 'notification_routing' && <p className="mt-2 text-sm text-slate-600">
              Separate routing evidence, not a new episode or message. Reading this record does not resolve it or confirm patient contact.
            </p>}
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{item.reasons.map((reason) => <li key={reason}>{EXCEPTION_REASONS[reason]}</li>)}</ul>
            <p className="mt-2 text-xs text-slate-500">Record time: <time dateTime={item.recorded_at}>{item.recorded_at}</time></p>
            <Link prefetch={false} href={`/patients/${item.patient_id}`} className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-blue-700 underline">Open patient workspace</Link>
            {data.counts && item.category === 'ownership' && item.work_item_id && <WorkReassignment scopeKey={snapshotId} workItemId={item.work_item_id} />}
          </li>)}</ul>}
        {data.next_cursor && <button type="button" disabled={busy} onClick={() => void load(organization, data.next_cursor)}
          className="min-h-11 rounded-lg border px-4 text-sm font-medium">Next page</button>}
      </section>}
      <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        Ownership repair requires a separate manager review, current patient access and an eligible recipient.
        This view does not replay processing, reopen closed episodes or send messages. Automated repair and notification cutover remain disabled.
      </p>
    </section>
  );
}
