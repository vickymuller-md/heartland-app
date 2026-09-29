'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { CareScope } from '@/lib/care-workflow/types';
import { labCollectionMicros } from '@/lib/labs/quality';
import { loadPostclosureHistory, loadPostclosureNeeds, loadPostclosureSuccessors } from '@/lib/care-workflow/postclosure-actions';
import { postclosureHistoryPageSchema, type PostclosureHistoryItem, type PostclosureNeed,
  type PostclosurePatientPage, type PostclosureContext } from '@/lib/care-workflow/postclosure-types';

const button = 'min-h-11 rounded-lg border bg-white px-3 py-2 font-medium disabled:opacity-50';
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const labels: Record<PostclosureNeed['routing_state'], string> = { unrouted: 'Not routed', delegated: 'Delegated — not resolved',
  overdue: 'Successor overdue', responsibility_unavailable: 'Successor responsibility unavailable', successor_closed: 'Successor closed — origin retained' };
const href = (scope: CareScope, work: string) => `/patients/${scope.patient_id}/care/${work}?organization=${scope.organization_id}`;
export function PostclosureOrigin({ snapshot: s }: { snapshot: PostclosureContext['snapshot'] }) {
  return <div aria-label="Immutable post-closure origin" className="space-y-1 break-words">
    <p className="break-all">Source-change record: {s.invalidation_id}</p><p className="break-all">Closed predecessor: {s.predecessor_work_item_id}</p>
    <p>Analyte: {s.analyte} · Source change: {s.change_status} · Source revision: {s.change_revision}</p>
    <p className="break-all">Source root: {s.root_id} · Changed version: {s.change_version_id}</p>
    <p className="break-all">Closure event: {s.closure_event_id} · Recorded: {s.closure_recorded_at}</p>
    <p className="break-all">Composition event: {s.composition_event_id} · Entry: {s.entry_id}</p>
    <p>Source change recorded: {s.change_recorded_at} · Origin recorded: {s.invalidation_recorded_at}</p>
    <p>This origin was outside the closure baseline. It remains visible after routing, replacement or successor closure.</p>
  </div>;
}
// A validated page alone cannot establish continuity with the preceding page.
export function appendPostclosureHistory(prefix: PostclosureHistoryItem[], raw: unknown): PostclosureHistoryItem[] {
  const page = postclosureHistoryPageSchema.parse(raw), all = [...prefix];
  for (const row of page.items) {
    const last = all.at(-1);
    if (all.some((old) => same(old.event_id, row.event_id) || same(old.receipt.request_id, row.receipt.request_id))
      || BigInt(row.receipt.routing_revision) !== BigInt(last?.receipt.routing_revision ?? '0') + BigInt(1)
      || (last ? !same(row.receipt.previous_event_id ?? '', last.event_id)
        || same(row.receipt.work_item_id, last.receipt.work_item_id)
        || JSON.stringify(row.payload.snapshot) !== JSON.stringify(last.payload.snapshot)
        || labCollectionMicros(row.receipt.recorded_at)! < labCollectionMicros(last.receipt.recorded_at)!
        : row.receipt.previous_event_id !== null)) throw new Error('Discontinuous routing history');
    all.push(row);
  }
  return all;
}
function RoutingHistory({ scope, need }: { scope: CareScope; need: PostclosureNeed }) {
  const [rows, setRows] = useState<PostclosureHistoryItem[]>([]), [complete, setComplete] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const generation = useRef(0), inFlight = useRef(false);
  useEffect(() => () => { generation.current++; }, []);
  async function load() {
    if (inFlight.current) return;
    inFlight.current = true; const version = ++generation.current;
    setBusy(true); setError(false); setComplete(false); setRows([]);
    let all: PostclosureHistoryItem[] = [], after: string | null = null;
    try {
      for (let n = 0; n < 128; n++) {
        const result = await loadPostclosureHistory({ ...scope, invalidation_id: need.invalidation_id, after });
        if (generation.current !== version) return;
        if (!result.data || !same(result.data.invalidation_id, need.invalidation_id)
          || result.data.items.some((row) => JSON.stringify(row.payload.snapshot) !== JSON.stringify(need.snapshot))) throw new Error('Unavailable history');
        all = appendPostclosureHistory(all, result.data); setRows(all);
        const next = result.data.next_cursor;
        if (next === null) { setComplete(true); return; }
        if (after !== null && BigInt(next) <= BigInt(after)) throw new Error('Nonforward history');
        after = next;
      }
      throw new Error('Incomplete history');
    } catch { if (generation.current === version) setError(true); }
    finally { if (generation.current === version) { inFlight.current = false; setBusy(false); } }
  }
  return <section aria-label="Routing history" className="space-y-2">
    <button className={button} disabled={busy} onClick={() => void load()}>Read exact routing history</button>
    <p>Append-only routing history, separate from clinical progress. Live pages are not an atomic snapshot of current responsibility.</p>
    {complete && <p>Routing history read complete. {rows.length === 0 ? 'No routing event in this read.' : `${rows.length} historical events verified.`}</p>}
    {error && <p role="alert">Routing history is incomplete. Only the verified prefix below is shown; do not infer missing events or a current destination.</p>}
    {rows.map((row) => <div key={row.event_id} className="rounded-lg border p-3 break-words">
      <p>Historical routing revision: {row.receipt.routing_revision} · Recorded: {row.receipt.recorded_at}</p>
      <p className="break-all">Event: {row.event_id} · Previous event: {row.receipt.previous_event_id ?? 'None (first routing)'}</p>
      <p className="break-all">Actor: {row.actor_id} · Request: {row.receipt.request_id}</p>
      <a className="underline" href={href(scope, row.receipt.work_item_id)}>Open historical successor {row.receipt.work_item_id}</a>
      <p>Reason: {row.payload.reason}</p><p>Evidence: {row.payload.evidence}</p><p>Routing occurred: {row.payload.occurred_at}</p>
      <p>Review time acknowledged at routing: {row.payload.review_at}</p>
      <p>{row.payload.supersession_acknowledged ? 'Replacement explicitly acknowledged; earlier successor not cancelled.' : 'First delegation explicitly acknowledged.'}</p>
      <p>Historical workflow revision: {row.receipt.workflow_revision}. No clinical invalidation resolution, review, confirmed contact or completed care recorded.</p>
    </div>)}
  </section>;
}
type Candidate = NonNullable<Awaited<ReturnType<typeof loadPostclosureSuccessors>>['data']>['items'][number];
function Successors({ scope, need }: { scope: CareScope; need: PostclosureNeed }) {
  const [items, setItems] = useState<Candidate[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const generation = useRef(0), inFlight = useRef(false);
  useEffect(() => () => { generation.current++; }, []);
  async function load(after: string | null) {
    if (inFlight.current) return;
    inFlight.current = true; const version = ++generation.current;
    setBusy(true); setError(false);
    if (after === null) { setItems([]); setLoaded(false); setCursor(null); }
    try {
      const result = await loadPostclosureSuccessors({ ...scope, invalidation_id: need.invalidation_id, after });
      if (version !== generation.current) return;
      const prefix = after ? items : [];
      if (!result.data || result.data.items.some((row) => prefix.some((old) => same(old.work_item_id, row.work_item_id)))
        || after !== null && result.data.next_cursor !== null && result.data.next_cursor.toLowerCase() <= after.toLowerCase()) throw new Error('Incomplete candidates');
      setItems([...prefix, ...result.data.items]); setCursor(result.data.next_cursor); setLoaded(true);
    } catch { if (version === generation.current) setError(true); }
    finally { if (version === generation.current) { inFlight.current = false; setBusy(false); } }
  }
  return <section aria-label="Eligible accepted successors" className="space-y-2">
    <button className={button} disabled={busy} onClick={() => void load(null)}>Find eligible accepted successors</button>
    <p>A successor must already exist and be accepted by you. Create a laboratory follow-up with the existing request controls and accept responsibility in Daily Loop when needed. Nothing is created, assigned or routed automatically.</p>
    {items.map((row) => <p key={row.work_item_id} className="break-all"><a className="underline" href={href(scope, row.work_item_id)}>Open eligible successor {row.work_item_id}</a> · Review: {row.review_at}</p>)}
    {cursor && <button className={button} disabled={busy} onClick={() => void load(cursor)}>Read more eligible successors</button>}
    {loaded && !cursor && !error && <p>Candidate read complete. {items.length === 0 ? 'No eligible accepted successor in this read.' : 'Eligibility must be checked again before routing.'}</p>}
    {error && <p role="alert">Candidate read is incomplete. This does not establish that no eligible successor exists.</p>}
  </section>;
}
export function PostclosureNeedsReader({ scope, onSelect, disabled = false }: {
  scope: CareScope; onSelect?: (need: PostclosureNeed | null) => void; disabled?: boolean;
}) {
  const [items, setItems] = useState<PostclosureNeed[]>([]), [cursor, setCursor] = useState<string | null>(null);
  const [counts, setCounts] = useState<PostclosurePatientPage['organization_counts']>(null);
  const [target, setTarget] = useState(''), [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(false);
  const [invalid, setInvalid] = useState(false), generation = useRef(0), live = useRef(true), inFlight = useRef(false);
  const callback = useRef(onSelect); callback.current = onSelect;
  useEffect(() => {
    live.current = true;
    const { data: { subscription } } = createClient().auth.onAuthStateChange((_event, session) => {
      if (session?.user.id === scope.actor_id) return;
      live.current = false; generation.current += 1; setInvalid(true); setItems([]); setCounts(null); setTarget(''); callback.current?.(null);
    });
    return () => { live.current = false; generation.current += 1; subscription.unsubscribe(); };
  }, [scope.actor_id]);
  async function load(after: string | null) {
    if (!live.current || inFlight.current || disabled) return;
    inFlight.current = true; const version = ++generation.current;
    setBusy(true); setError(false); setTarget(''); callback.current?.(null);
    if (after === null) { setItems([]); setLoaded(false); setCursor(null); setCounts(null); }
    try {
      const result = await loadPostclosureNeeds({ ...scope, after });
      if (!live.current || version !== generation.current) return;
      const prefix = after ? items : [];
      if (!result.data || result.data.items.some((row) => prefix.some((old) => same(old.invalidation_id, row.invalidation_id)))
        || after !== null && result.data.next_cursor !== null && result.data.next_cursor.toLowerCase() <= after.toLowerCase()) throw new Error('Incomplete needs');
      setItems([...prefix, ...result.data.items]); setCursor(result.data.next_cursor); setCounts(result.data.organization_counts); setLoaded(true);
    } catch { if (live.current && version === generation.current) setError(true); }
    finally { if (live.current && version === generation.current) { inFlight.current = false; setBusy(false); } }
  }
  const need = items.find((row) => same(row.invalidation_id, target));
  if (invalid) return <p role="alert">Your session changed. Reload the post-closure needs view.</p>;
  return <div aria-label="Patient post-closure needs" className="space-y-3">
    <button className={button} disabled={disabled || busy} onClick={() => void load(null)}>Read post-closure needs</button>
    <p>Only authorized records for this patient appear here. Organization-wide pages may contain no matching patient records and still have more pages. Live reads are not an atomic snapshot.</p>
    {counts && <div aria-label="Organization-wide routing counts"><p>Organization-wide counts — not this patient&apos;s counts:</p>
      {Object.entries(counts).map(([state, count]) => <p key={state}>{labels[state as keyof typeof labels]}: {count}</p>)}</div>}
    {cursor && <><p>Patient read incomplete — additional organization pages remain.</p><button className={button} disabled={disabled || busy} onClick={() => void load(cursor)}>Read next needs page</button></>}
    {loaded && !cursor && !error && <p>Patient read complete. {items.length === 0 ? 'No matching post-closure need in this read; this does not establish completed care.' : `${items.length} origin records loaded.`}</p>}
    {error && <p role="alert">The needs read is incomplete. Retained records are a partial read, not evidence of absence.</p>}
    {items.length > 0 && <label className="block">Post-closure origin to inspect<select className="mt-1 min-h-11 w-full rounded-md border bg-white px-3 py-2" value={target} disabled={disabled || busy}
      onChange={(event) => { setTarget(event.target.value); callback.current?.(items.find((row) => same(row.invalidation_id, event.target.value)) ?? null); }}>
      <option value="" disabled>Choose an exact source-change origin</option>{items.map((row) => <option key={row.invalidation_id} value={row.invalidation_id}>{row.snapshot.analyte} · {labels[row.routing_state]} · {row.invalidation_id}</option>)}
    </select></label>}
    {need && <div className="space-y-3 rounded-lg border p-3">
      <h3 className="font-semibold">{labels[need.routing_state]} (when loaded)</h3><PostclosureOrigin snapshot={need.snapshot} />
      {need.current_route && <div><a className="underline break-all" href={href(scope, need.current_route.work_item_id)}>Open current successor {need.current_route.work_item_id}</a>
        <p>Current routing revision: {need.current_route.routing_revision} · Due when loaded: {need.current_route.current_due_at}</p>
        <p className="break-all">Assigned responsibility: {need.current_route.assigned_to ?? 'Unassigned'}</p>
        <p className="break-all">Accepted by: {need.current_route.accepted_by ?? 'No acceptance'} · Accepted at: {need.current_route.accepted_at ?? 'Not recorded'}</p>
        {need.current_route.transfer_pending_to && <p className="break-all">Transfer offer pending: {need.current_route.transfer_pending_to}. Responsibility has not yet transferred; the current assignment and acceptance above remain separate from this offer.</p>}
        <p>Delegation is not clinical reconciliation. Closing the successor does not erase this origin.</p></div>}
      <RoutingHistory key={`history:${need.invalidation_id}`} scope={scope} need={need} />
      {!onSelect && <Successors key={`successors:${need.invalidation_id}`} scope={scope} need={need} />}
    </div>}
  </div>;
}
type OverviewProps = { actorId: string; patientId: string; scopeKey: string; organizations: { id: string; name: string }[] };
export function CarePostclosureNeedsPanel(props: OverviewProps) {
  return <OrganizationNeeds key={`${props.scopeKey}:${props.actorId}:${props.patientId}`} {...props} />;
}
function OrganizationNeeds({ actorId, patientId, organizations }: OverviewProps) {
  const [organization, setOrganization] = useState(''), [invalid, setInvalid] = useState(false);
  useEffect(() => {
    const { data: { subscription } } = createClient().auth.onAuthStateChange((_event, session) => {
      if (session?.user.id !== actorId) { setInvalid(true); setOrganization(''); }
    }); return () => subscription.unsubscribe();
  }, [actorId]);
  if (invalid) return <p role="alert">Your session changed. Reload the patient page before continuing.</p>;
  return <section aria-label="Post-closure follow-up overview" className="space-y-4 rounded-xl border border-amber-200 p-4 text-sm">
    <h2 className="text-lg font-bold">Source changes after closure</h2>
    <p>Synthetic information only. Track unchanged origins and explicit successor responsibility separately from clinical resolution, communication and completed care.</p>
    <label className="block">Organization for post-closure follow-up<select className="mt-1 min-h-11 w-full rounded-md border px-3 py-2" value={organization}
      onChange={(event) => setOrganization(event.target.value)}><option value="" disabled>Choose an organization</option>
      {organizations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
    {organization && organizations.some((row) => row.id === organization) && <PostclosureNeedsReader key={organization}
      scope={{ actor_id: actorId, patient_id: patientId, organization_id: organization }} />}
  </section>;
}
