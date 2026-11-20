'use client';

import { useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { trackProductEvent } from '@/lib/product-analytics/actions';
import { getPublicDisseminationContext } from '@/lib/product-analytics/public-context';
import { OUTREACH_TRANSCRIPTS, outreachWorkItems, type SimulatedCallTranscript } from '@/lib/sandbox-ai/fixtures';
import { sandboxStateFromUrl, sandboxUrlFromState, selectSandboxSection } from '@/lib/sandbox/navigation';
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
const TASK_STATUSES: SandboxTaskStatus[] = ['open', 'reviewed', 'actioned', 'awaiting', 'closed'];
const PATIENT_CHECK_IN_IDS = new Set(SANDBOX_PATIENTS.flatMap((patient) =>
  ['weight', 'meds', 'symptoms', 'education', 'message', 'message-read', 'call'].map((suffix) => `${patient.id}-${suffix}`),
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
  }).catch(() => undefined);
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
const POPULATION_WORK_ITEM_ID = /^ai-run-pop/;

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

function restoreCompletedRound(value: unknown, size: PopulationSize, dayIndex: number): SandboxDemoState['completedRound'] {
  if (!isRecord(value) || value.size !== size || value.dayIndex !== dayIndex) return undefined;
  const ordinal = value.caseOrdinal;
  const validCase = typeof ordinal === 'number' && Number.isInteger(ordinal) && ordinal >= 0 && ordinal < size;
  return { size, dayIndex, caseOrdinal: validCase ? ordinal : null };
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

  const dayIndex = typeof value.dayIndex === 'number' ? clampDayIndex(value.dayIndex) : 0;
  const populationSize = POPULATION_SIZES.includes(value.populationSize as PopulationSize)
    ? value.populationSize as PopulationSize
    : DEFAULT_POPULATION_SIZE;
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
    dayIndex,
    dayLog: restoreDayLog(value.dayLog),
    populationSize,
    workedCases: restoreWorkedCases(value),
    completedRound: restoreCompletedRound(value.completedRound, populationSize, dayIndex),
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
    || state.aiOutreachRuns.length > 0
    || state.workedCases.length > 0;
}

export function SandboxWorkspace() {
  const [demo, setDemo] = useState<SandboxDemoState>(initialDemoState);
  // Live transcripts are session-local by design (never persisted); only the
  // run metadata in demo.aiOutreachRuns survives a reload.
  const [liveCalls, setLiveCalls] = useState<SimulatedCallTranscript[]>([]);
  const visit = useRef(0);
  const [visitNumber, setVisitNumber] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [navigationRevision, setNavigationRevision] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [dayToast, setDayToast] = useState<string | null>(null);
  const dayToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAt = useRef(0);
  const firstActionTracked = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const focusRequested = useRef(false);
  const restoreCaseFocus = useRef(false);
  const selectedPatient = SANDBOX_PATIENTS.find((patient) => patient.id === demo.selectedPatientId) ?? SANDBOX_PATIENTS[0];
  const currentSectionIndex = SANDBOX_SECTIONS.findIndex((section) => section.id === demo.selectedSection);
  const progress = Math.round((demo.visitedSections.length / SANDBOX_SECTIONS.length) * 100);
  // The day queues only show the current simulation day; older runs stay in history.
  const dayRuns = demo.aiOutreachRuns.filter((run) => run.dayIndex === demo.dayIndex);

  function writeUrl(state: SandboxDemoState, replace = false) {
    const next = sandboxUrlFromState(new URL(window.location.href), state);
    if (next.href !== window.location.href) {
      if (replace) window.history.replaceState(null, '', next);
      else window.history.pushState(null, '', next);
    }
  }

  useEffect(() => {
    startedAt.current = Date.now();
    let saved = initialDemoState();
    try {
      const stored = localStorage.getItem(SANDBOX_STORAGE_KEY);
      const restored = stored ? restoreDemoState(JSON.parse(stored)) : null;
      if (restored) {
        saved = restored;
        firstActionTracked.current = hasMeaningfulAction(restored);
        trackSandboxEvent('sandbox_returned');
      }
    } catch { /* A disabled or stale store must not prevent opening a shared URL. */ }
    const entry = new URL(window.location.href);
    restoreCaseFocus.current = entry.searchParams.has('case');
    const initial = sandboxStateFromUrl(saved, entry);
    setDemo(initial);
    writeUrl(initial, true);
    setHydrated(true);
    function restoreLocation() {
      const url = new URL(window.location.href);
      restoreCaseFocus.current = url.searchParams.has('case');
      setMenuOpen(false);
      setDemo((current) => sandboxStateFromUrl(current, url));
      setNavigationRevision((revision) => revision + 1);
    }
    window.addEventListener('popstate', restoreLocation);
    return () => window.removeEventListener('popstate', restoreLocation);
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

  useEffect(() => {
    // Only explicit navigation requests focus; restoration and data updates do not.
    if (!focusRequested.current) return;
    focusRequested.current = false;
    const content = contentRef.current;
    if (!content) return;
    content.focus({ preventScroll: true });
    const smooth = typeof window.matchMedia === 'function'
      && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    content.scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' });
  }, [demo]);

  useEffect(() => {
    if (!hydrated || !restoreCaseFocus.current || demo.selectedSection !== 'command') return;
    const ordinal = demo.completedRound?.caseOrdinal;
    if (ordinal == null) return;
    const frame = requestAnimationFrame(() => {
      restoreCaseFocus.current = false;
      document.getElementById(`sample-case-${ordinal}`)?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [hydrated, navigationRevision, demo.selectedSection, demo.completedRound]);

  function trackFirstAction() {
    if (firstActionTracked.current) return;
    firstActionTracked.current = true;
    trackSandboxEvent(
      'sandbox_first_action',
      Math.min(Date.now() - startedAt.current, 3_600_000),
    );
  }

  function navigate(section: SandboxSectionId, patientId?: string) {
    const next = selectSandboxSection(demo, section);
    if (patientId) next.selectedPatientId = patientId;
    restoreCaseFocus.current = false;
    focusRequested.current = true;
    setMenuOpen(false);
    writeUrl(next);
    setDemo((current) => ({
      ...selectSandboxSection(current, section),
      selectedPatientId: patientId ?? current.selectedPatientId,
    }));
  }

  function rememberRound(completed: boolean, caseOrdinal: number | null, push: boolean) {
    const completedRound = completed ? { size: demo.populationSize, dayIndex: demo.dayIndex, caseOrdinal } : undefined;
    writeUrl({ ...demo, completedRound }, !push);
    setDemo((current) => ({ ...current, completedRound }));
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
    navigate('patient-360', patientId);
  }

  function choosePatient(selectedPatientId: string) {
    writeUrl({ ...demo, selectedPatientId });
    setDemo((current) => ({ ...current, selectedPatientId }));
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
    if (visitNumber !== visit.current) return;
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
        completedRound: undefined,
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
    if (populationSize === demo.populationSize) return;
    writeUrl({ ...demo, populationSize, completedRound: undefined });
    setDemo((current) => ({ ...current, populationSize, completedRound: undefined }));
  }

  function reassign(taskId: string, owner: string) {
    trackFirstAction();
    setDemo((current) => ({ ...current, taskStates: { ...current.taskStates, [taskId]: { ...current.taskStates[taskId], owner, updatedLabel: 'Reassigned this visit' } } }));
  }

  function reset() {
    visit.current += 1;
    setVisitNumber(visit.current);
    restoreCaseFocus.current = false;
    focusRequested.current = true;
    try { localStorage.removeItem(SANDBOX_STORAGE_KEY); } catch { /* Storage can be unavailable in hardened browsers. */ }
    firstActionTracked.current = false;
    startedAt.current = Date.now();
    const fresh = initialDemoState();
    if (dayToastTimer.current) clearTimeout(dayToastTimer.current);
    setDayToast(null);
    setMenuOpen(false);
    setLiveCalls([]);
    setNavigationRevision((revision) => revision + 1);
    writeUrl(fresh, true);
    setDemo(fresh);
  }

  const sectionContent = (() => {
    switch (demo.selectedSection) {
      case 'copilot': return <SandboxCopilot outreachItems={outreachWorkItems(dayRuns)} dayIndex={demo.dayIndex} dayLog={demo.dayLog} populationSize={demo.populationSize} reviewedCount={demo.workedCases.filter((entry) => entry.dayIndex === demo.dayIndex).length} onAdvanceDay={advanceDay} onRecordRun={recordOutreachRun} onNavigate={navigate} />;
      case 'daily-loop': return <SandboxDailyLoop taskStates={demo.taskStates} onTaskState={updateTask} onOpenPatient={openPatient} onBulkReview={bulkReview} outreachItems={outreachWorkItems(dayRuns)} dayIndex={demo.dayIndex} onOpenOutreach={() => navigate('outreach')} />;
      case 'outreach': return <SandboxOutreach liveCalls={liveCalls} runs={demo.aiOutreachRuns} onLiveCall={recordOutreachRun} />;
      case 'patient-360': return <SandboxPatientWorkspace patient={selectedPatient} documentedActions={demo.documentedActions} onPatientChange={choosePatient} onDocumentAction={documentAction} />;
      case 'pathways': return <SandboxPathways exploredPathways={demo.exploredPathways} onExplore={explorePathway} />;
      case 'coordination': return <SandboxCoordination taskStates={demo.taskStates} onReassign={reassign} onDocumentAction={documentAction} />;
      case 'patient-view': return <SandboxPatientView patient={selectedPatient} patientCheckIns={demo.patientCheckIns} onCheckIn={checkIn} />;
      case 'impact': return <SandboxImpact visitedSections={demo.visitedSections} exploredPathways={demo.exploredPathways} taskStates={demo.taskStates} documentedActions={demo.documentedActions} patientCheckIns={demo.patientCheckIns} dayIndex={demo.dayIndex} dayLog={demo.dayLog} workedCasesCount={demo.workedCases.length} onReset={reset} />;
      default: return <SandboxCommandCenter key={`${hydrated}-${navigationRevision}`} restoredRound={demo.completedRound} onRoundChange={rememberRound} taskStates={demo.taskStates} visitedSections={demo.visitedSections} dayIndex={demo.dayIndex} populationSize={demo.populationSize} workedCases={demo.workedCases} sentWorkItemIds={demo.aiOutreachRuns.map((run) => run.id)} onPopulationSize={setPopulationSize} onWorkCase={workCase} onSendToDailyLoop={addPopulationWorkItem} onNavigate={navigate} automatedCallsCount={OUTREACH_TRANSCRIPTS.length + demo.aiOutreachRuns.filter((run) => !POPULATION_WORK_ITEM_ID.test(run.id)).length} />;
    }
  })();

  const previousSection = currentSectionIndex > 0 ? SANDBOX_SECTIONS[currentSectionIndex - 1] : null;
  const nextSection = currentSectionIndex < SANDBOX_SECTIONS.length - 1 ? SANDBOX_SECTIONS[currentSectionIndex + 1] : null;

  return (
    <fieldset
      aria-label="Interactive sandbox"
      aria-busy={!hydrated}
      disabled={!hydrated}
      className="min-w-0 space-y-4 aria-busy:[&_button]:cursor-wait aria-busy:[&_button]:opacity-60"
    >
      <nav className="border-b border-border py-3" aria-label="Sandbox product navigation">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span aria-label="Sandbox coverage">{demo.visitedSections.length}/{SANDBOX_SECTIONS.length} areas explored</span>
            <span data-testid="sandbox-day-badge" className="border-l border-border pl-4 font-semibold text-foreground">Day {demo.dayIndex + 1} of {SANDBOX_DAY_COUNT}</span>
            <div aria-hidden="true" className="hidden h-1 w-20 overflow-hidden rounded-full bg-border sm:block">
              <div className="h-full bg-primary transition-all motion-reduce:transition-none" style={{ width: `${progress}%` }} />
            </div>
          </div>
          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={reset}>
            <RotateCcw className="size-4" aria-hidden="true" /> Reset
          </Button>
        </div>
        <button type="button" aria-expanded={menuOpen} aria-controls="sandbox-area-list" onClick={() => setMenuOpen(!menuOpen)} className="inline-flex min-h-11 items-center rounded-lg border border-border bg-card px-3 text-sm font-semibold text-foreground hover:border-input lg:hidden">
          {menuOpen ? 'Close areas' : 'Explore all 9 areas'}
        </button>
        <div id="sandbox-area-list" className={`mt-2 grid-cols-[repeat(auto-fit,minmax(min(100%,7rem),1fr))] gap-1 lg:grid lg:grid-cols-9 ${menuOpen ? 'grid' : 'hidden'}`}>
          {SANDBOX_SECTIONS.map((section) => {
            const active = demo.selectedSection === section.id;
            return (
              <button key={section.id} type="button" data-testid={`sandbox-nav-${section.id}`}
                aria-current={active ? 'page' : undefined} onClick={() => navigate(section.id)}
                className={`min-h-11 min-w-0 border-b-2 px-2 py-2 text-sm [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-ring ${active ? 'border-primary font-semibold text-primary' : 'border-transparent text-muted-foreground hover:border-input hover:text-foreground'}`}>
                {section.shortLabel}
              </button>
            );
          })}
        </div>
      </nav>

      <p className="sr-only" role="status" aria-live="polite">
        Now viewing {SANDBOX_SECTIONS[currentSectionIndex]?.title ?? 'the sandbox'}.
      </p>
      <div ref={contentRef} role="region" aria-label={`Sandbox area: ${SANDBOX_SECTIONS[currentSectionIndex]?.title ?? 'the sandbox'}`} tabIndex={-1} className="min-w-0 scroll-mt-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">{sectionContent}</div>

      {dayToast && (
        <div role="status" data-testid="day-toast" className="fixed bottom-4 left-1/2 z-50 w-[min(92vw,32rem)] -translate-x-1/2 rounded-xl border border-border bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-xl">
          {dayToast}
        </div>
      )}

      <nav className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-5" aria-label="Guided sandbox tour">
        <div className="min-w-0 max-w-full">{previousSection && <Button variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal py-2" onClick={() => navigate(previousSection.id)}>← {previousSection.title}</Button>}</div>
        <p className="text-center text-sm font-semibold uppercase tracking-wide text-slate-500">Step {currentSectionIndex + 1} of {SANDBOX_SECTIONS.length}</p>
        <div className="min-w-0 max-w-full">{nextSection ? <Button className="h-auto min-h-11 max-w-full whitespace-normal py-2" onClick={() => navigate(nextSection.id)}>{nextSection.title} →</Button> : <Button className="h-auto min-h-11 max-w-full whitespace-normal py-2" onClick={() => navigate('command')}>Return to Command Center</Button>}</div>
      </nav>
    </fieldset>
  );
}
