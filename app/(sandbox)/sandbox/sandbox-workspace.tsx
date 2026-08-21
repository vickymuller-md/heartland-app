'use client';

import { useEffect, useRef, useState } from 'react';
import { Activity, BarChart3, BookOpenCheck, ClipboardList, HeartPulse, RotateCcw, Stethoscope, Users } from 'lucide-react';
import { trackProductEvent } from '@/lib/product-analytics/actions';
import { getPublicDisseminationContext } from '@/lib/product-analytics/public-context';
import { SANDBOX_PATHWAYS, SANDBOX_PATIENTS, SANDBOX_SECTIONS, SANDBOX_TASKS } from '@/lib/sandbox/fixtures';
import type { SandboxDemoState, SandboxSectionId, SandboxTask, SandboxTaskState, SandboxTaskStatus } from '@/lib/sandbox/types';
import { Button } from '@/components/ui/button';
import { SandboxCommandCenter } from './_components/sandbox-command-center';
import { SandboxDailyLoop } from './_components/sandbox-daily-loop';
import { SandboxPatientWorkspace } from './_components/sandbox-patient-workspace';
import { SandboxPathways } from './_components/sandbox-pathways';
import { SandboxCoordination } from './_components/sandbox-coordination';
import { SandboxPatientView } from './_components/sandbox-patient-view';
import { SandboxImpact } from './_components/sandbox-impact';

const SANDBOX_STORAGE_KEY = 'heartland_synthetic_sandbox_v2';
const MAX_LOCAL_AGE_MS = 7 * 86_400_000;
const SECTION_ICONS = [Stethoscope, ClipboardList, Activity, BookOpenCheck, Users, HeartPulse, BarChart3];
const TASK_STATUSES: SandboxTaskStatus[] = ['open', 'reviewed', 'actioned', 'awaiting', 'closed'];
const PATIENT_CHECK_IN_IDS = new Set(SANDBOX_PATIENTS.flatMap((patient) =>
  ['weight', 'meds', 'symptoms', 'education', 'message', 'call'].map((suffix) => `${patient.id}-${suffix}`),
));

function trackSandboxEvent(
  eventName: 'sandbox_returned' | 'sandbox_first_action' | 'sandbox_task_completed',
  durationMs?: number,
) {
  void trackProductEvent({
    eventName,
    area: 'sandbox',
    durationMs,
    ...getPublicDisseminationContext(),
  });
}

function initialTaskStates(): Record<string, SandboxTaskState> {
  return Object.fromEntries(SANDBOX_TASKS.map((task) => [task.id, {
    status: 'open' as const,
    owner: task.owner,
    updatedLabel: 'Not yet reviewed',
  }]));
}

function initialDemoState(): SandboxDemoState {
  return {
    taskStates: initialTaskStates(),
    selectedPatientId: SANDBOX_PATIENTS[0].id,
    selectedSection: 'command',
    visitedSections: ['command'],
    exploredPathways: [],
    patientCheckIns: [],
    documentedActions: [],
    savedAt: Date.now(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeString(value: unknown, fallback: string, maxLength = 180): string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength ? value : fallback;
}

function safeStringList(value: unknown, allowed?: Set<string>, limit = 30): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => (
    typeof item === 'string' && item.length > 0 && item.length <= 180 && (!allowed || allowed.has(item))
  )))].slice(0, limit);
}

function restoreDemoState(value: unknown): SandboxDemoState | null {
  if (!isRecord(value) || typeof value.savedAt !== 'number' || value.savedAt <= Date.now() - MAX_LOCAL_AGE_MS) return null;

  const initial = initialDemoState();
  const sectionIds = new Set(SANDBOX_SECTIONS.map((section) => section.id));
  const patientIds = new Set(SANDBOX_PATIENTS.map((patient) => patient.id));
  const pathwayIds = new Set(SANDBOX_PATHWAYS.map((pathway) => pathway.id));
  const selectedSection = typeof value.selectedSection === 'string' && sectionIds.has(value.selectedSection as SandboxSectionId)
    ? value.selectedSection as SandboxSectionId
    : initial.selectedSection;
  const visitedSections = safeStringList(value.visitedSections, sectionIds) as SandboxSectionId[];
  if (!visitedSections.includes(selectedSection)) visitedSections.push(selectedSection);

  const storedTaskStates = isRecord(value.taskStates) ? value.taskStates : {};
  const taskStates = initialTaskStates();
  for (const task of SANDBOX_TASKS) {
    const stored = storedTaskStates[task.id];
    if (!isRecord(stored)) continue;
    const status = typeof stored.status === 'string' && TASK_STATUSES.includes(stored.status as SandboxTaskStatus)
      ? stored.status as SandboxTaskStatus
      : taskStates[task.id].status;
    taskStates[task.id] = {
      status,
      owner: safeString(stored.owner, taskStates[task.id].owner, 100),
      outcome: typeof stored.outcome === 'string' && stored.outcome.length <= 300 ? stored.outcome : undefined,
      updatedLabel: safeString(stored.updatedLabel, taskStates[task.id].updatedLabel, 100),
    };
  }

  return {
    taskStates,
    selectedPatientId: typeof value.selectedPatientId === 'string' && patientIds.has(value.selectedPatientId)
      ? value.selectedPatientId
      : initial.selectedPatientId,
    selectedSection,
    visitedSections,
    exploredPathways: safeStringList(value.exploredPathways, pathwayIds),
    patientCheckIns: safeStringList(value.patientCheckIns, PATIENT_CHECK_IN_IDS),
    documentedActions: safeStringList(value.documentedActions, undefined, 20),
    savedAt: value.savedAt,
  };
}

function hasMeaningfulAction(state: SandboxDemoState): boolean {
  return Object.values(state.taskStates).some((task) => task.status !== 'open')
    || state.exploredPathways.length > 0
    || state.patientCheckIns.length > 0
    || state.documentedActions.length > 0;
}

export function SandboxWorkspace() {
  const [demo, setDemo] = useState<SandboxDemoState>(initialDemoState);
  const [hydrated, setHydrated] = useState(false);
  const startedAt = useRef(Date.now());
  const firstActionTracked = useRef(false);
  const selectedPatient = SANDBOX_PATIENTS.find((patient) => patient.id === demo.selectedPatientId) ?? SANDBOX_PATIENTS[0];
  const currentSectionIndex = SANDBOX_SECTIONS.findIndex((section) => section.id === demo.selectedSection);
  const progress = Math.round((demo.visitedSections.length / SANDBOX_SECTIONS.length) * 100);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SANDBOX_STORAGE_KEY);
      if (stored) {
        const restored = restoreDemoState(JSON.parse(stored));
        if (restored) {
          setDemo(restored);
          firstActionTracked.current = hasMeaningfulAction(restored);
          trackSandboxEvent('sandbox_returned');
        }
      }
    } catch {
      try { localStorage.removeItem(SANDBOX_STORAGE_KEY); } catch { /* Storage can be unavailable in hardened browsers. */ }
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(SANDBOX_STORAGE_KEY, JSON.stringify({ ...demo, savedAt: Date.now() }));
    } catch {
      // The sandbox remains fully usable when local persistence is blocked.
    }
  }, [demo, hydrated]);

  function trackFirstAction() {
    if (firstActionTracked.current) return;
    firstActionTracked.current = true;
    trackSandboxEvent(
      'sandbox_first_action',
      Math.min(Date.now() - startedAt.current, 3_600_000),
    );
  }

  function navigate(section: SandboxSectionId) {
    setDemo((current) => ({
      ...current,
      selectedSection: section,
      visitedSections: current.visitedSections.includes(section) ? current.visitedSections : [...current.visitedSections, section],
    }));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function updateTask(task: SandboxTask, status: SandboxTaskStatus, outcome?: string) {
    trackFirstAction();
    setDemo((current) => ({
      ...current,
      taskStates: {
        ...current.taskStates,
        [task.id]: {
          ...current.taskStates[task.id],
          status,
          owner: current.taskStates[task.id]?.owner ?? task.owner,
          outcome,
          updatedLabel: status === 'closed' ? 'Closed this visit' : status === 'awaiting' ? 'Returned with future due date' : 'Updated this visit',
        },
      },
    }));
    if (status === 'closed') trackSandboxEvent('sandbox_task_completed');
  }

  function bulkReview(tasks: SandboxTask[]) {
    if (tasks.length === 0) return;
    trackFirstAction();
    setDemo((current) => {
      const taskStates = { ...current.taskStates };
      for (const task of tasks) taskStates[task.id] = { ...taskStates[task.id], status: 'reviewed', owner: taskStates[task.id]?.owner ?? task.owner, updatedLabel: 'Bulk reviewed this visit' };
      return { ...current, taskStates };
    });
  }

  function openPatient(patientId: string) {
    setDemo((current) => ({
      ...current,
      selectedPatientId: patientId,
      selectedSection: 'patient-360',
      visitedSections: current.visitedSections.includes('patient-360') ? current.visitedSections : [...current.visitedSections, 'patient-360'],
    }));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function explorePathway(pathwayId: string) {
    trackFirstAction();
    setDemo((current) => ({ ...current, exploredPathways: current.exploredPathways.includes(pathwayId) ? current.exploredPathways : [...current.exploredPathways, pathwayId] }));
  }

  function documentAction(action: string) {
    trackFirstAction();
    setDemo((current) => ({ ...current, documentedActions: current.documentedActions.includes(action) ? current.documentedActions : [...current.documentedActions, action] }));
  }

  function checkIn(checkInId: string) {
    trackFirstAction();
    setDemo((current) => ({ ...current, patientCheckIns: current.patientCheckIns.includes(checkInId) ? current.patientCheckIns : [...current.patientCheckIns, checkInId] }));
  }

  function reassign(taskId: string, owner: string) {
    trackFirstAction();
    setDemo((current) => ({ ...current, taskStates: { ...current.taskStates, [taskId]: { ...current.taskStates[taskId], owner, updatedLabel: 'Reassigned this visit' } } }));
  }

  function reset() {
    try { localStorage.removeItem(SANDBOX_STORAGE_KEY); } catch { /* Storage can be unavailable in hardened browsers. */ }
    firstActionTracked.current = false;
    startedAt.current = Date.now();
    setDemo(initialDemoState());
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const sectionContent = (() => {
    switch (demo.selectedSection) {
      case 'daily-loop': return <SandboxDailyLoop taskStates={demo.taskStates} onTaskState={updateTask} onOpenPatient={openPatient} onBulkReview={bulkReview} />;
      case 'patient-360': return <SandboxPatientWorkspace patient={selectedPatient} documentedActions={demo.documentedActions} onPatientChange={(patientId) => setDemo((current) => ({ ...current, selectedPatientId: patientId }))} onDocumentAction={documentAction} />;
      case 'pathways': return <SandboxPathways exploredPathways={demo.exploredPathways} onExplore={explorePathway} />;
      case 'coordination': return <SandboxCoordination taskStates={demo.taskStates} onReassign={reassign} onDocumentAction={documentAction} />;
      case 'patient-view': return <SandboxPatientView patient={selectedPatient} patientCheckIns={demo.patientCheckIns} onCheckIn={checkIn} />;
      case 'impact': return <SandboxImpact visitedSections={demo.visitedSections} exploredPathways={demo.exploredPathways} taskStates={demo.taskStates} documentedActions={demo.documentedActions} patientCheckIns={demo.patientCheckIns} onReset={reset} />;
      default: return <SandboxCommandCenter taskStates={demo.taskStates} visitedSections={demo.visitedSections} onNavigate={navigate} />;
    }
  })();

  const previousSection = currentSectionIndex > 0 ? SANDBOX_SECTIONS[currentSectionIndex - 1] : null;
  const nextSection = currentSectionIndex < SANDBOX_SECTIONS.length - 1 ? SANDBOX_SECTIONS[currentSectionIndex + 1] : null;

  return (
    <div className="space-y-6">
      <section className="sticky top-0 z-20 -mx-4 border-y bg-slate-50/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6" aria-label="Sandbox product navigation">
        <div className="mx-auto max-w-7xl">
          <div className="flex items-center justify-between gap-4">
            <div><p className="text-xs font-semibold uppercase tracking-wide text-violet-700">Sandbox coverage</p><p className="text-sm font-bold text-slate-950">{demo.visitedSections.length}/{SANDBOX_SECTIONS.length} areas explored</p></div>
            <div className="flex items-center gap-3"><div className="hidden h-2 w-40 overflow-hidden rounded-full bg-slate-200 sm:block"><div className="h-full rounded-full bg-violet-600 transition-all" style={{ width: `${progress}%` }} /></div><Button size="sm" variant="ghost" className="min-h-11" onClick={reset}><RotateCcw className="mr-1 size-4" /> Reset</Button></div>
          </div>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {SANDBOX_SECTIONS.map((section, index) => {
              const Icon = SECTION_ICONS[index];
              const active = demo.selectedSection === section.id;
              return <button key={section.id} type="button" data-testid={`sandbox-nav-${section.id}`} aria-current={active ? 'page' : undefined} onClick={() => navigate(section.id)} className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-semibold transition ${active ? 'bg-slate-950 text-white' : 'border bg-white text-slate-700 hover:border-violet-300'}`}><Icon className="size-4" />{section.shortLabel}</button>;
            })}
          </div>
        </div>
      </section>

      <div aria-live="polite">{sectionContent}</div>

      <nav className="flex flex-col gap-3 rounded-2xl border bg-white p-4 sm:flex-row sm:items-center sm:justify-between" aria-label="Guided sandbox tour">
        <div>{previousSection && <Button variant="outline" className="min-h-11" onClick={() => navigate(previousSection.id)}>← {previousSection.title}</Button>}</div>
        <p className="text-center text-xs font-semibold uppercase tracking-wide text-slate-500">Step {currentSectionIndex + 1} of {SANDBOX_SECTIONS.length}</p>
        <div className="sm:text-right">{nextSection ? <Button className="min-h-11" onClick={() => navigate(nextSection.id)}>{nextSection.title} →</Button> : <Button className="min-h-11" onClick={() => navigate('command')}>Return to Command Center</Button>}</div>
      </nav>
    </div>
  );
}
