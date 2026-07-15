'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, Clock3, RotateCcw, ShieldCheck } from 'lucide-react';
import { trackProductEvent } from '@/lib/product-analytics/actions';
import { SANDBOX_PATIENTS, SANDBOX_TASKS, type SandboxTask } from '@/lib/sandbox/fixtures';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

type TaskState = 'open' | 'reviewed' | 'closed';
const SANDBOX_STORAGE_KEY = 'heartland_synthetic_sandbox_v1';

export function SandboxWorkspace() {
  const [states, setStates] = useState<Record<string, TaskState>>({});
  const [hydrated, setHydrated] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState(SANDBOX_PATIENTS[0].id);
  const selectedPatient = SANDBOX_PATIENTS.find((patient) => patient.id === selectedPatientId) ?? SANDBOX_PATIENTS[0];
  const openTasks = useMemo(
    () => SANDBOX_TASKS.filter((task) => states[task.id] !== 'closed'),
    [states],
  );

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SANDBOX_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as { states?: Record<string, TaskState>; savedAt?: number };
        if (parsed.states && parsed.savedAt && parsed.savedAt > Date.now() - 7 * 86_400_000) {
          setStates(parsed.states);
          void trackProductEvent({ eventName: 'sandbox_returned', area: 'sandbox' });
        }
      }
    } catch {
      localStorage.removeItem(SANDBOX_STORAGE_KEY);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(SANDBOX_STORAGE_KEY, JSON.stringify({ states, savedAt: Date.now() }));
  }, [hydrated, states]);

  function updateTask(task: SandboxTask, next: TaskState, elapsedMs?: number) {
    const isFirstAction = Object.keys(states).length === 0;
    setStates((current) => ({ ...current, [task.id]: next }));
    if (isFirstAction) {
      void trackProductEvent({
        eventName: 'sandbox_first_action',
        area: 'sandbox',
        durationMs: Math.min(Math.max(Math.round(elapsedMs ?? 0), 0), 3_600_000),
      });
    }
    if (next === 'closed') {
      void trackProductEvent({ eventName: 'sandbox_task_completed', area: 'sandbox' });
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-violet-200 bg-violet-50 p-5" aria-labelledby="sandbox-title">
        <p className="text-sm font-semibold uppercase tracking-wide text-violet-800">Interactive synthetic workspace</p>
        <h1 id="sandbox-title" className="mt-1 text-3xl font-bold tracking-tight text-slate-950">See the next action, not another alert pile.</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700">
          Everything here is synthetic. Actions stay in this browser session, send no clinical message, and never touch a patient record.
        </p>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Synthetic queue metrics">
        {[
          ['Open', openTasks.length],
          ['Needs action now', openTasks.filter((task) => task.priority === 'now').length],
          ['Persistent signals', openTasks.filter((task) => task.occurrences > 1).length],
          ['Completed this visit', SANDBOX_TASKS.length - openTasks.length],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border bg-white p-4">
            <p className="text-2xl font-bold text-slate-950">{value}</p>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
          </div>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(280px,0.8fr)]">
        <section aria-labelledby="next-actions-title" className="space-y-3">
          <div>
            <h2 id="next-actions-title" className="text-xl font-bold text-slate-950">Top five next actions</h2>
            <p className="text-sm text-slate-600">Repeated signals are coalesced into one evolving work item.</p>
          </div>
          {openTasks.length === 0 ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-8 text-center">
              <CheckCircle2 className="mx-auto size-8 text-emerald-700" aria-hidden="true" />
              <h3 className="mt-3 font-bold text-emerald-950">Synthetic queue complete</h3>
              <Button className="mt-4 min-h-11" variant="outline" onClick={() => setStates({})}>
                <RotateCcw className="mr-2 size-4" /> Reset demonstration
              </Button>
            </div>
          ) : openTasks.map((task) => {
            const state = states[task.id] ?? 'open';
            return (
              <article key={task.id} className="rounded-2xl border bg-white p-4 shadow-sm">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button className="min-h-11 font-semibold text-blue-700 hover:underline" onClick={() => setSelectedPatientId(task.patientId)}>
                        {task.patientName}
                      </button>
                      <Badge variant="outline">{task.severity}</Badge>
                      {task.occurrences > 1 && <Badge variant="secondary">{task.occurrences} observations</Badge>}
                    </div>
                    <h3 className="mt-1 font-bold text-slate-950">{task.title}</h3>
                    <p className="mt-1 text-sm text-slate-600">{task.reason}</p>
                    <p className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-amber-800">
                      <AlertTriangle className="size-3.5" aria-hidden="true" /> {task.signal}
                    </p>
                  </div>
                  <button onClick={() => setSelectedPatientId(task.patientId)} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white">
                    Open brief <ChevronRight className="size-4" aria-hidden="true" />
                  </button>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3">
                  <span className="mr-auto inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-slate-600">
                    <Clock3 className="size-4" aria-hidden="true" /> {task.dueLabel}
                  </span>
                  {state === 'open' && (
                    <Button className="min-h-11" variant="outline" onClick={(event) => updateTask(task, 'reviewed', event.timeStamp)}>
                      <ShieldCheck className="mr-1 size-4" /> Mark reviewed
                    </Button>
                  )}
                  <Button className="min-h-11" onClick={(event) => updateTask(task, 'closed', event.timeStamp)}>
                    <CheckCircle2 className="mr-1 size-4" /> Complete
                  </Button>
                </div>
              </article>
            );
          })}
        </section>

        <aside className="h-fit rounded-2xl border bg-white p-5 lg:sticky lg:top-6" aria-labelledby="brief-title">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Synthetic patient brief</p>
          <h2 id="brief-title" className="mt-1 text-xl font-bold text-slate-950">{selectedPatient.name}</h2>
          <p className="text-sm text-slate-600">Age {selectedPatient.age} · {selectedPatient.region}</p>
          <dl className="mt-5 space-y-4 text-sm">
            <div><dt className="font-semibold text-slate-500">Risk tier</dt><dd className="font-bold text-slate-950">{selectedPatient.riskTier}</dd></div>
            <div><dt className="font-semibold text-slate-500">Latest signal</dt><dd className="font-medium text-slate-950">{selectedPatient.latestSignal}</dd></div>
            <div><dt className="font-semibold text-slate-500">Data freshness</dt><dd className="font-medium text-emerald-800">{selectedPatient.dataAsOf}</dd></div>
          </dl>
          <div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
            Educational implementation support only. This synthetic brief does not diagnose, prescribe, or replace clinical judgment.
          </div>
        </aside>
      </div>
    </div>
  );
}
