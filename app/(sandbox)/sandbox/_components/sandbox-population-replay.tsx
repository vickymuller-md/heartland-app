'use client';

/**
 * The overnight-round theater: replays the deterministic population
 * simulation as something you can WATCH — a dot wall painting one cell per
 * patient, a live feed of rule evaluations, a simulated clock — instead of a
 * bare count-up. Isolated from the command center so the per-frame setState
 * re-renders only this subtree. One virtual clock drives index, clock label,
 * partial counters, and canvas in lockstep; prefers-reduced-motion (and any
 * environment without matchMedia) skips straight to the final result.
 */

import { useEffect, useRef, useState } from 'react';
import { FastForward, Play, SkipForward } from 'lucide-react';
import {
  getPopulationDayEvents,
  simulatePopulationDay,
  type PopulationDayResult,
  type PopulationEvent,
  type PopulationEventCategory,
  type PopulationSize,
} from '@/lib/sandbox/population';
import { Button } from '@/components/ui/button';

const REPLAY_MS = 30_000;
const WINDOW_START_MINUTE = 330; // 05:30
const WINDOW_MINUTES = 120;
const FEED_LINES = 9;

const GRID: Record<PopulationSize, { cols: number; rows: number }> = {
  500: { cols: 25, rows: 20 },
  2500: { cols: 63, rows: 40 },
  5000: { cols: 84, rows: 60 },
};

const CATEGORY_COLORS: Record<PopulationEventCategory, string> = {
  routine: '#34d399',
  retry: '#60a5fa',
  no_answer: '#64748b',
  warning: '#fbbf24',
  critical: '#f87171',
  adherence: '#c084fc',
};
const CATEGORY_CODE: Record<PopulationEventCategory, number> = {
  routine: 1, retry: 2, no_answer: 3, warning: 4, critical: 5, adherence: 6,
};
const CODE_COLORS = ['', CATEGORY_COLORS.routine, CATEGORY_COLORS.retry, CATEGORY_COLORS.no_answer, CATEGORY_COLORS.warning, CATEGORY_COLORS.critical, CATEGORY_COLORS.adherence];

const LEGEND: Array<{ category: PopulationEventCategory; label: string }> = [
  { category: 'routine', label: 'routine' },
  { category: 'retry', label: 'answered on retry' },
  { category: 'no_answer', label: 'unreachable' },
  { category: 'warning', label: 'warning flag' },
  { category: 'critical', label: 'critical flag' },
  { category: 'adherence', label: 'adherence → pharmacist' },
];

interface PartialCounts {
  processed: number;
  routine: number;
  retried: number;
  adherence: number;
  unreachable: number;
  reviewQueue: number;
}

const EMPTY_PARTIAL: PartialCounts = { processed: 0, routine: 0, retried: 0, adherence: 0, unreachable: 0, reviewQueue: 0 };

function formatClock(minute: number): string {
  const clamped = Math.min(Math.max(Math.round(minute), WINDOW_START_MINUTE), WINDOW_START_MINUTE + WINDOW_MINUTES);
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

function isExceptionEvent(event: PopulationEvent): boolean {
  return event.category === 'critical' || event.category === 'warning'
    || (event.category === 'no_answer' && event.riskTier === 'High');
}

const numberFormat = new Intl.NumberFormat('en-US');

export function SandboxPopulationReplay({ size, dayIndex, onDone }: {
  size: PopulationSize;
  dayIndex: number;
  onDone: (result: PopulationDayResult | null) => void;
}) {
  const [scene, setScene] = useState<'idle' | 'running' | 'done'>('idle');
  const [frame, setFrame] = useState<{ minute: number; partial: PartialCounts; feed: PopulationEvent[] }>({
    minute: WINDOW_START_MINUTE, partial: EMPTY_PARTIAL, feed: [],
  });
  const [result, setResult] = useState<PopulationDayResult | null>(null);
  const [doubleSpeed, setDoubleSpeed] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cellsRef = useRef<Uint8Array | null>(null);
  const rafRef = useRef<number | null>(null);
  const virtualMsRef = useRef(0);
  const lastTsRef = useRef<number | null>(null);
  const speedRef = useRef(1);
  const eventsRef = useRef<PopulationEvent[]>([]);
  const indexRef = useRef(0);
  const partialRef = useRef<PartialCounts>({ ...EMPTY_PARTIAL });
  const feedRef = useRef<PopulationEvent[]>([]);
  const resultRef = useRef<PopulationDayResult | null>(null);

  // A different day or population size invalidates whatever is on screen.
  useEffect(() => {
    stopLoop();
    setScene('idle');
    setResult(null);
    setDoubleSpeed(false);
    speedRef.current = 1;
    setFrame({ minute: WINDOW_START_MINUTE, partial: EMPTY_PARTIAL, feed: [] });
    onDone(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, dayIndex]);

  useEffect(() => () => stopLoop(), []);

  function stopLoop() {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    lastTsRef.current = null;
  }

  function paintCells(events: PopulationEvent[], from: number, to: number) {
    const canvas = canvasRef.current;
    const cells = cellsRef.current;
    if (!canvas || !cells) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { cols, rows } = GRID[size];
    const cellW = canvas.clientWidth / cols;
    const cellH = canvas.clientHeight / rows;
    for (let index = from; index < to; index += 1) {
      const event = events[index];
      const code = CATEGORY_CODE[event.category];
      cells[event.ordinal] = code;
      const col = event.ordinal % cols;
      const row = Math.floor(event.ordinal / cols);
      ctx.fillStyle = CODE_COLORS[code];
      ctx.fillRect(col * cellW + 0.5, row * cellH + 0.5, Math.max(cellW - 1, 1), Math.max(cellH - 1, 1));
    }
  }

  function repaintAll() {
    const canvas = canvasRef.current;
    const cells = cellsRef.current;
    if (!canvas || !cells) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    const { cols, rows } = GRID[size];
    const cssH = Math.round((cssW * rows) / cols);
    canvas.style.height = `${cssH}px`;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    const cellW = cssW / cols;
    const cellH = cssH / rows;
    for (let ordinal = 0; ordinal < cells.length; ordinal += 1) {
      const code = cells[ordinal];
      if (code === 0) continue;
      ctx.fillStyle = CODE_COLORS[code];
      ctx.fillRect((ordinal % cols) * cellW + 0.5, Math.floor(ordinal / cols) * cellH + 0.5, Math.max(cellW - 1, 1), Math.max(cellH - 1, 1));
    }
  }

  // Keep the wall crisp across container resizes and dpr changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => repaintAll());
    observer.observe(canvas);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, size]);

  function accumulate(event: PopulationEvent) {
    const partial = partialRef.current;
    partial.processed += 1;
    if (event.category === 'routine') partial.routine += 1;
    else if (event.category === 'retry') partial.retried += 1;
    else if (event.category === 'adherence') partial.adherence += 1;
    else if (event.category === 'no_answer') {
      partial.unreachable += 1;
      if (event.riskTier === 'High') partial.reviewQueue += 1;
    }
    if (event.category === 'critical' || event.category === 'warning') partial.reviewQueue += 1;
    feedRef.current.push(event);
    if (feedRef.current.length > FEED_LINES) feedRef.current.shift();
  }

  function finish() {
    stopLoop();
    const final = resultRef.current;
    setScene('done');
    if (final) {
      setFrame({
        minute: WINDOW_START_MINUTE + WINDOW_MINUTES,
        partial: {
          processed: final.counts.total,
          routine: final.counts.routine,
          retried: final.counts.retriedResolved,
          adherence: final.counts.adherenceLapse,
          unreachable: final.counts.unresolvedNoAnswer,
          reviewQueue: final.counts.reviewQueue,
        },
        feed: [...feedRef.current],
      });
      setResult(final);
      onDone(final);
    }
  }

  function tick(timestamp: number) {
    if (lastTsRef.current !== null) {
      virtualMsRef.current += (timestamp - lastTsRef.current) * speedRef.current;
    }
    lastTsRef.current = timestamp;

    const progress = Math.min(virtualMsRef.current / REPLAY_MS, 1);
    const targetMinute = WINDOW_START_MINUTE + WINDOW_MINUTES * progress;
    const events = eventsRef.current;
    const from = indexRef.current;
    let to = from;
    while (to < events.length && events[to].minute <= targetMinute) {
      accumulate(events[to]);
      to += 1;
    }
    if (to > from) paintCells(events, from, to);
    indexRef.current = to;

    setFrame({ minute: targetMinute, partial: { ...partialRef.current }, feed: [...feedRef.current] });

    if (progress >= 1 || to >= events.length) {
      // Consume any stragglers before closing out.
      if (to < events.length) {
        for (let index = to; index < events.length; index += 1) accumulate(events[index]);
        paintCells(events, to, events.length);
        indexRef.current = events.length;
      }
      finish();
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  }

  function run() {
    if (scene === 'running') return;
    stopLoop();

    // Reduced motion (or no matchMedia at all): compute synchronously and land
    // on the final state — never enter the animation loop.
    const reduced = typeof window.matchMedia !== 'function'
      || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      resultRef.current = simulatePopulationDay(size, dayIndex);
      const events = getPopulationDayEvents(size, dayIndex);
      cellsRef.current = new Uint8Array(size);
      feedRef.current = [];
      partialRef.current = { ...EMPTY_PARTIAL };
      for (const event of events.slice(-FEED_LINES)) feedRef.current.push(event);
      for (const event of events) cellsRef.current[event.ordinal] = CATEGORY_CODE[event.category];
      setScene('done');
      finishReducedMotion();
      return;
    }

    setScene('running');
    setDoubleSpeed(false);
    speedRef.current = 1;
    virtualMsRef.current = 0;
    lastTsRef.current = null;
    indexRef.current = 0;
    partialRef.current = { ...EMPTY_PARTIAL };
    feedRef.current = [];
    cellsRef.current = new Uint8Array(size);
    rafRef.current = requestAnimationFrame((timestamp) => {
      // Compute inside the first frame so the "Running…" state paints first.
      eventsRef.current = getPopulationDayEvents(size, dayIndex);
      resultRef.current = simulatePopulationDay(size, dayIndex);
      repaintAll();
      lastTsRef.current = timestamp;
      rafRef.current = requestAnimationFrame(tick);
    });
  }

  function finishReducedMotion() {
    const final = resultRef.current;
    if (!final) return;
    setFrame({
      minute: WINDOW_START_MINUTE + WINDOW_MINUTES,
      partial: {
        processed: final.counts.total,
        routine: final.counts.routine,
        retried: final.counts.retriedResolved,
        adherence: final.counts.adherenceLapse,
        unreachable: final.counts.unresolvedNoAnswer,
        reviewQueue: final.counts.reviewQueue,
      },
      feed: [...feedRef.current],
    });
    setResult(final);
    onDone(final);
    // Paint after the canvas mounts with the done layout.
    requestAnimationFrame?.(() => repaintAll());
  }

  function skip() {
    if (scene !== 'running') return;
    const events = eventsRef.current;
    const from = indexRef.current;
    for (let index = from; index < events.length; index += 1) accumulate(events[index]);
    paintCells(events, from, events.length);
    indexRef.current = events.length;
    finish();
  }

  function toggleSpeed() {
    const next = !doubleSpeed;
    setDoubleSpeed(next);
    speedRef.current = next ? 2.5 : 1;
  }

  const counts = result?.counts ?? null;
  const partial = frame.partial;
  const running = scene === 'running';

  return (
    <div className="rounded-2xl border border-white/15 bg-white/5 p-5" data-testid="population-funnel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-blue-200">
          Overnight round · Day {dayIndex + 1} of 5
          {scene !== 'idle' && (
            <span className="ml-2 rounded bg-white/10 px-1.5 py-0.5 font-mono text-xs text-slate-200" data-testid="population-clock">{formatClock(frame.minute)}</span>
          )}
        </p>
        {/* Speed controls live OUTSIDE the aria-hidden subtree (focusable). */}
        {running && (
          <span className="flex gap-1.5">
            <Button size="sm" variant="ghost" className="min-h-9 border border-white/25 px-2 text-xs text-white hover:bg-white/10 hover:text-white" aria-pressed={doubleSpeed} onClick={toggleSpeed} data-testid="population-speed">
              <FastForward className="mr-1 size-3.5" /> 2×
            </Button>
            <Button size="sm" variant="ghost" className="min-h-9 border border-white/25 px-2 text-xs text-white hover:bg-white/10 hover:text-white" onClick={skip} data-testid="population-skip">
              <SkipForward className="mr-1 size-3.5" /> Skip to results
            </Button>
          </span>
        )}
        {scene === 'idle' && (
          <Button size="sm" className="min-h-11 bg-blue-600 px-4 font-bold text-white hover:bg-blue-500" onClick={run} data-testid="population-run">
            <Play className="mr-1.5 size-4" /> Run the overnight round
          </Button>
        )}
      </div>

      <div aria-hidden={running}>
        {scene !== 'idle' && (
          <>
            <canvas
              ref={canvasRef}
              role="img"
              aria-label={`Dot wall: one cell per synthetic patient, colored as the registered rules process each overnight check-in (${numberFormat.format(size)} patients).`}
              className="mt-3 w-full rounded-lg bg-slate-950/60"
              data-testid="population-wall"
            />
            <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-400" aria-hidden="true">
              {LEGEND.map((entry) => (
                <li key={entry.category} className="flex items-center gap-1">
                  <span className="inline-block size-2 rounded-sm" style={{ backgroundColor: CATEGORY_COLORS[entry.category] }} />
                  {entry.label}
                </li>
              ))}
            </ul>
            <div className="mt-3 space-y-1 font-mono text-[11px] leading-4" data-testid="population-feed" aria-hidden="true">
              {frame.feed.map((event) => (
                <p key={`${event.ordinal}`} className={isExceptionEvent(event) ? 'font-bold text-amber-200' : 'text-slate-400'}>
                  {formatClock(event.minute)} · {event.name} · {event.state} · {event.detail}
                </p>
              ))}
            </div>
          </>
        )}

        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex items-baseline justify-between gap-3"><dt className="text-slate-300">Check-ins processed</dt><dd className="text-xl font-bold tabular-nums">{scene === 'idle' ? '—' : numberFormat.format(partial.processed)}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-slate-300">Routine — auto-documented</dt><dd className="font-bold tabular-nums">{scene === 'idle' ? '—' : numberFormat.format(partial.routine)}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-slate-300">Answered on automated retry</dt><dd className="font-bold tabular-nums">{scene === 'idle' ? '—' : numberFormat.format(partial.retried)}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-slate-300">Adherence gaps → pharmacist workflow</dt><dd className="font-bold tabular-nums">{scene === 'idle' ? '—' : numberFormat.format(partial.adherence)}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-slate-300">Unreachable — retry cadence continues</dt><dd className="font-bold tabular-nums">{scene === 'idle' ? '—' : numberFormat.format(partial.unreachable)}</dd></div>
          <div className="flex items-baseline justify-between gap-3 rounded-lg bg-amber-400/15 px-2 py-1.5"><dt className="font-semibold text-amber-200">Review queue — for the clinician</dt><dd className="text-lg font-bold tabular-nums text-amber-100">{scene === 'idle' ? '—' : numberFormat.format(partial.reviewQueue)}</dd></div>
        </dl>

        {counts && scene === 'done' && (
          <>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/15">
              <div className="h-full rounded-full bg-emerald-400" style={{ width: `${counts.automatedPct}%` }} />
            </div>
            <p className="mt-2 text-sm font-semibold text-emerald-300" data-testid="population-claim">
              {numberFormat.format(counts.reviewQueue)} of {numberFormat.format(counts.total)} synthetic
              check-ins reached the clinician review queue — {counts.automatedPct}% resolved by the
              registered rules.
            </p>
          </>
        )}
        {scene === 'idle' && (
          <p className="mt-4 text-xs text-slate-400">Deterministic simulation — same numbers on every device, all decisions by the registered clinical rules, no AI in the loop. Press run and watch the night shift happen.</p>
        )}
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {scene === 'done' && counts
          ? `Overnight round complete: ${counts.total} synthetic check-ins processed, ${counts.reviewQueue} reached the clinician review queue, ${counts.automatedPct} percent resolved by the registered rules.`
          : ''}
      </p>
      <p className="mt-3 text-[11px] leading-4 text-slate-400" data-testid="population-disclaimer">
        Illustrative workflow demonstration on synthetic data — not a clinical outcome or
        staffing claim.
      </p>
    </div>
  );
}
