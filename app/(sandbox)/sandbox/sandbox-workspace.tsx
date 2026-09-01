'use client';

import { useEffect, useRef, useState } from 'react';
import { Activity, BarChart3, BookOpenCheck, ClipboardList, HeartPulse, PhoneCall, RotateCcw, Sparkles, Stethoscope, Users } from 'lucide-react';
import { trackProductEvent } from '@/lib/product-analytics/actions';
import { getPublicDisseminationContext } from '@/lib/product-analytics/public-context';
import { OUTREACH_TRANSCRIPTS, outreachWorkItems, type SimulatedCallTranscript } from '@/lib/sandbox-ai/fixtures';
import { OUTCOME_KEYS } from '@/lib/sandbox/case-outcomes';
import { clampDayIndex, SANDBOX_DAY_COUNT } from '@/lib/sandbox/day-selectors';
import { DEFAULT_POPULATION_SIZE, POPULATION_SIZES, type PopulationSize } from '@/lib/sandbox/population';
import { SANDBOX_PATHWAYS, SANDBOX_PATIENTS, SANDBOX_SECTIONS, SANDBOX_TASKS } from '@/lib/sandbox/fixtures';
import type { AiOutreachRun, SandboxDayLogEntry, SandboxDemoState, SandboxSectionId, SandboxTask, SandboxTaskState, SandboxTaskStatus } from '@/lib/sandbox/types';
import { RED_FLAG_CRITERIA } from '@/lib/vitals/constants';
import { Button } from '@/components/ui/button';
import { SandboxCommandCenter } from './_components/sandbox-command-center';
import { SandboxDailyLoop } from './_components/sandbox-daily-loop';
import { SandboxOutreach } from './_components/sandbox-outreach';
import { SandboxPatientWorkspace } from './_components/sandbox-patient-workspace';
import { SandboxPathways } from './_components/sandbox-pathways';
import { SandboxCoordination } from './_components/sandbox-coordination';
import { SandboxPatientView } from './_components/sandbox-patient-view';
import { SandboxImpact } from './_components/sandbox-impact';
import { SandboxCopilot } from './_components/sandbox-copilot';

const SANDBOX_STORAGE_KEY = 'heartland_synthetic_sandbox_v2';
const MAX_LOCAL_AGE_MS = 7 * 86_400_000;
const SECTION_ICONS = [Stethoscope, Sparkles, ClipboardList, PhoneCall, Activity, BookOpenCheck, Users, HeartPulse, BarChart3];
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
    aiOutreachRuns: [],
    dayIndex: 0,
    dayLog: [],
    populationSize: DEFAULT_POPULATION_SIZE,
    workedCases: [],
    savedAt: Date.now(),
  };
}

const MAX_OUTREACH_RUNS = 40;
const POPULATION_REVIEWED_ID = /^pop-\d{1,4}-d\d$/;

const OUTREACH_DISPOSITIONS = new Set<AiOutreachRun['disposition']>(['emergency', 'escalated', 'routine', 'no_answer']);
const RED_FLAG_IDS = new Set<string>(Object.keys(RED_FLAG_CRITERIA));

function restoreOutreachRuns(value: unknown): AiOutreachRun[] {
  if (!Array.isArray(value)) return [];
  const runs: AiOutreachRun[] = [];
  for (const item of value.slice(0, MAX_OUTREACH_RUNS)) {
    if (!isRecord(item)) continue;
    if (typeof item.id !== 'string' || !/^ai-run-[a-z0-9]{1,12}$/.test(item.id)) continue;
    if (runs.some((run) => run.id === item.id)) continue;
    if (typeof item.disposition !== 'string' || !OUTREACH_DISPOSITIONS.has(item.disposition as AiOutreachRun['disposition'])) continue;
    runs.push({
      id: item.id,
      disposition: item.disposition as AiOutreachRun['disposition'],
      patientName: safeString(item.patientName, 'Synthetic persona', 60),
      atLabel: safeString(item.atLabel, 'Earlier', 40),
      redFlagIds: safeStringList(item.redFlagIds, RED_FLAG_IDS, 5),
      dayIndex: typeof item.dayIndex === 'number' ? clampDayIndex(item.dayIndex) : 0,
      note: typeof item.note === 'string' && item.note.length > 0 && item.note.length <= 180 ? item.note : undefined,
    });
  }
  return runs;
}

function restoreDayLog(value: unknown): SandboxDayLogEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: SandboxDayLogEntry[] = [];
  for (const item of value.slice(0, SANDBOX_DAY_COUNT)) {
    if (!isRecord(item) || typeof item.dayIndex !== 'number' || typeof item.escalations !== 'number') continue;
    const dayIndex = clampDayIndex(item.dayIndex);
    if (entries.some((entry) => entry.dayIndex === dayIndex)) continue;
    entries.push({
      dayIndex,
      escalations: Math.min(Math.max(Math.trunc(item.escalations), 0), 99),
      completedAtLabel: safeString(item.completedAtLabel, 'Earlier', 40),
    });
  }
  return entries;
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
    aiOutreachRuns: restoreOutreachRuns(value.aiOutreachRuns),
    dayIndex: typeof value.dayIndex === 'number' ? clampDayIndex(value.dayIndex) : 0,
    dayLog: restoreDayLog(value.dayLog),
    populationSize: POPULATION_SIZES.includes(value.populationSize as PopulationSize)
      ? value.populationSize as PopulationSize
      : DEFAULT_POPULATION_SIZE,
    workedCases: restoreWorkedCases(value),
    savedAt: value.savedAt,
  };
}

const WORKED_DISPOSITIONS = new Set(['routine', 'escalated', 'emergency', 'no_answer']);

function restoreWorkedCases(value: Record<string, unknown>): SandboxDemoState['workedCases'] {
  const cases: SandboxDemoState['workedCases'] = [];
  const push = (id: string, outcome: string, disposition?: string) => {
    if (!POPULATION_REVIEWED_ID.test(id) || !OUTCOME_KEYS.has(outcome)) return;
    if (cases.some((entry) => entry.id === id)) return;
    cases.push({
      id, outcome,
      dayIndex: clampDayIndex(Number(id.slice(id.lastIndexOf('-d') + 2))),
      disposition: disposition && WORKED_DISPOSITIONS.has(disposition)
        ? disposition as NonNullable<SandboxDemoState['workedCases'][number]['disposition']>
        : undefined,
    });
  };
  if (Array.isArray(value.workedCases)) {
    for (const item of value.workedCases.slice(0, 40)) {
      if (isRecord(item) && typeof item.id === 'string' && typeof item.outcome === 'string') {
        push(item.id, item.outcome, typeof item.disposition === 'string' ? item.disposition : undefined);
      }
    }
    return cases;
  }
  // One-way migration from the v1.7.0 shape: reviewed ids become worked cases.
  if (Array.isArray(value.populationReviewedIds)) {
    for (const id of value.populationReviewedIds.slice(0, 40)) {
      if (typeof id === 'string') push(id, 'reviewed_legacy');
    }
  }
  return cases;
}

function hasMeaningfulAction(state: SandboxDemoState): boolean {
  return Object.values(state.taskStates).some((task) => task.status !== 'open')
    || state.exploredPathways.length > 0
    || state.patientCheckIns.length > 0
    || state.documentedActions.length > 0
    || state.aiOutreachRuns.length > 0;
}

export function SandboxWorkspace() {
  const [demo, setDemo] = useState<SandboxDemoState>(initialDemoState);
  // Live transcripts are session-local by design (never persisted); only the
  // run metadata in demo.aiOutreachRuns survives a reload.
  const [liveCalls, setLiveCalls] = useState<SimulatedCallTranscript[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [dayToast, setDayToast] = useState<string | null>(null);
  const dayToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt = useRef(Date.now());
  const firstActionTracked = useRef(false);
  const selectedPatient = SANDBOX_PATIENTS.find((patient) => patient.id === demo.selectedPatientId) ?? SANDBOX_PATIENTS[0];
  const currentSectionIndex = SANDBOX_SECTIONS.findIndex((section) => section.id === demo.selectedSection);
  const progress = Math.round((demo.visitedSections.length / SANDBOX_SECTIONS.length) * 100);
  // The day queues only show the current simulation day; older runs stay in history.
  const dayRuns = demo.aiOutreachRuns.filter((run) => run.dayIndex === demo.dayIndex);

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

  useEffect(() => () => {
    if (dayToastTimer.current) clearTimeout(dayToastTimer.current);
  }, []);

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

  function recordOutreachRun(transcript: SimulatedCallTranscript) {
    trackFirstAction();
    setLiveCalls((current) => [transcript, ...current].slice(0, 10));
    setDemo((current) => ({
      ...current,
      aiOutreachRuns: [{
        id: transcript.id,
        patientName: transcript.patientName,
        disposition: transcript.disposition,
        redFlagIds: transcript.redFlags.map((flag) => flag.id),
        atLabel: 'This visit',
        dayIndex: current.dayIndex,
      }, ...current.aiOutreachRuns].slice(0, MAX_OUTREACH_RUNS),
    }));
  }

  /** Sends one population review-queue entry into the day's work queues (dedup by id). */
  function addPopulationWorkItem(run: AiOutreachRun) {
    trackFirstAction();
    setDemo((current) => {
      if (current.aiOutreachRuns.some((existing) => existing.id === run.id)) return current;
      return {
        ...current,
        aiOutreachRuns: [run, ...current.aiOutreachRuns].slice(0, MAX_OUTREACH_RUNS),
      };
    });
  }

  /** Documents (or re-documents) one population case; the latest outcome wins. */
  function workCase(caseId: string, outcome: string, disposition?: SandboxDemoState['workedCases'][number]['disposition']) {
    trackFirstAction();
    setDemo((current) => ({
      ...current,
      workedCases: [
        ...current.workedCases.filter((entry) => entry.id !== caseId),
        { id: caseId, outcome, dayIndex: current.dayIndex, disposition },
      ].slice(-40),
    }));
  }

  function advanceDay(escalations: number) {
    trackFirstAction();
    setDemo((current) => {
      if (current.dayIndex >= SANDBOX_DAY_COUNT - 1) return current;
      const nextDay = current.dayIndex + 1;
      const mariaNote = nextDay === 1 ? ' Maria Santos crossed the 5 lb/7-day rule.' : '';
      showDayToast(`Day ${nextDay + 1} — population and queues re-simulated by the registered rules.${mariaNote}`);
      return {
        ...current,
        dayIndex: nextDay,
        dayLog: [
          ...current.dayLog.filter((entry) => entry.dayIndex !== current.dayIndex),
          { dayIndex: current.dayIndex, escalations, completedAtLabel: 'This visit' },
        ].slice(-SANDBOX_DAY_COUNT),
      };
    });
  }

  function showDayToast(message: string) {
    if (dayToastTimer.current) clearTimeout(dayToastTimer.current);
    setDayToast(message);
    dayToastTimer.current = setTimeout(() => setDayToast(null), 7000);
  }

  function setPopulationSize(populationSize: PopulationSize) {
    setDemo((current) => ({ ...current, populationSize }));
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
      case 'copilot': return <SandboxCopilot outreachItems={outreachWorkItems(dayRuns)} dayIndex={demo.dayIndex} dayLog={demo.dayLog} populationSize={demo.populationSize} reviewedCount={demo.workedCases.filter((entry) => entry.dayIndex === demo.dayIndex).length} onAdvanceDay={advanceDay} onRecordRun={recordOutreachRun} onNavigate={navigate} />;
      case 'daily-loop': return <SandboxDailyLoop taskStates={demo.taskStates} onTaskState={updateTask} onOpenPatient={openPatient} onBulkReview={bulkReview} outreachItems={outreachWorkItems(dayRuns)} dayIndex={demo.dayIndex} onOpenOutreach={() => navigate('outreach')} />;
      case 'outreach': return <SandboxOutreach liveCalls={liveCalls} runs={demo.aiOutreachRuns} onLiveCall={recordOutreachRun} />;
      case 'patient-360': return <SandboxPatientWorkspace patient={selectedPatient} documentedActions={demo.documentedActions} onPatientChange={(patientId) => setDemo((current) => ({ ...current, selectedPatientId: patientId }))} onDocumentAction={documentAction} />;
      case 'pathways': return <SandboxPathways exploredPathways={demo.exploredPathways} onExplore={explorePathway} />;
      case 'coordination': return <SandboxCoordination taskStates={demo.taskStates} onReassign={reassign} onDocumentAction={documentAction} />;
      case 'patient-view': return <SandboxPatientView patient={selectedPatient} patientCheckIns={demo.patientCheckIns} onCheckIn={checkIn} />;
      case 'impact': return <SandboxImpact visitedSections={demo.visitedSections} exploredPathways={demo.exploredPathways} taskStates={demo.taskStates} documentedActions={demo.documentedActions} patientCheckIns={demo.patientCheckIns} dayIndex={demo.dayIndex} dayLog={demo.dayLog} workedCasesCount={demo.workedCases.length} onReset={reset} />;
      default: return <SandboxCommandCenter taskStates={demo.taskStates} visitedSections={demo.visitedSections} dayIndex={demo.dayIndex} populationSize={demo.populationSize} workedCases={demo.workedCases} sentWorkItemIds={demo.aiOutreachRuns.map((run) => run.id)} onPopulationSize={setPopulationSize} onWorkCase={workCase} onSendToDailyLoop={addPopulationWorkItem} onNavigate={navigate} automatedCallsCount={OUTREACH_TRANSCRIPTS.length + demo.aiOutreachRuns.length} />;
    }
  })();

  const previousSection = currentSectionIndex > 0 ? SANDBOX_SECTIONS[currentSectionIndex - 1] : null;
  const nextSection = currentSectionIndex < SANDBOX_SECTIONS.length - 1 ? SANDBOX_SECTIONS[currentSectionIndex + 1] : null;

  return (
    <div className="space-y-6">
      <section className="sticky top-0 z-20 -mx-4 border-y bg-slate-50/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6" aria-label="Sandbox product navigation">
        <div className="mx-auto max-w-7xl">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div><p className="text-xs font-semibold uppercase tracking-wide text-violet-700">Sandbox coverage</p><p className="text-sm font-bold text-slate-950">{demo.visitedSections.length}/{SANDBOX_SECTIONS.length} areas explored</p></div>
              <span data-testid="sandbox-day-badge" className="inline-flex shrink-0 items-center rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-bold text-violet-800">Day {demo.dayIndex + 1} of {SANDBOX_DAY_COUNT}</span>
            </div>
            <div className="flex items-center gap-3"><div className="hidden h-2 w-40 overflow-hidden rounded-full bg-slate-200 sm:block"><div className="h-full rounded-full bg-violet-600 transition-all" style={{ width: `${progress}%` }} /></div><Button size="sm" variant="ghost" className="min-h-11" onClick={reset}><RotateCcw className="mr-1 size-4" /> Reset</Button></div>
          </div>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {SANDBOX_SECTIONS.map((section, index) => {
              const Icon = SECTION_ICONS[index];
              const active = demo.selectedSection === section.id;
              return <button key={section.id} type="button" data-testid={`sandbox-nav-${section.id}`} aria-current={active ? 'page' : undefined} onClick={() => navigate(section.id)} className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-semibold transition ${active ? 'bg-slate-950 text-white' : 'border bg-white text-slate-700 hover:border-violet-300'}`}><Icon className="size-4" />{section.shortLabel}{section.id === 'copilot' && !demo.visitedSections.includes('copilot') && <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-800">NEW</span>}</button>;
            })}
          </div>
        </div>
      </section>

      <div aria-live="polite">{sectionContent}</div>

      {dayToast && (
        <div role="status" data-testid="day-toast" className="fixed bottom-4 left-1/2 z-50 w-[min(92vw,32rem)] -translate-x-1/2 rounded-xl border border-violet-300 bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-xl">
          {dayToast}
        </div>
      )}

      <nav className="flex flex-col gap-3 rounded-2xl border bg-white p-4 sm:flex-row sm:items-center sm:justify-between" aria-label="Guided sandbox tour">
        <div>{previousSection && <Button variant="outline" className="min-h-11" onClick={() => navigate(previousSection.id)}>← {previousSection.title}</Button>}</div>
        <p className="text-center text-xs font-semibold uppercase tracking-wide text-slate-500">Step {currentSectionIndex + 1} of {SANDBOX_SECTIONS.length}</p>
        <div className="sm:text-right">{nextSection ? <Button className="min-h-11" onClick={() => navigate(nextSection.id)}>{nextSection.title} →</Button> : <Button className="min-h-11" onClick={() => navigate('command')}>Return to Command Center</Button>}</div>
      </nav>
    </div>
  );
}
