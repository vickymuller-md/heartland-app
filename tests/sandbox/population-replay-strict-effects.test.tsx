/**
 * The replay loop must survive React replaying effects without unmounting.
 *
 * Reproduces the intermittent E2E stall (clock frozen at 05:30, empty feed):
 * a click that starts the round in the same task as the hydration commit runs
 * before React flushed the initial passive effects. React then flushes them —
 * including StrictMode's dev-only cleanup + re-run — before rendering the
 * "running" update, and a cleanup that only cancels the pending frame leaves a
 * running scene with no frame scheduled.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, useLayoutEffect, type ReactNode } from 'react';
import { act, render, screen } from '@testing-library/react';
import { SandboxPopulationReplay } from '@/app/(sandbox)/sandbox/_components/sandbox-population-replay';
import { getPopulationDayEvents } from '@/lib/sandbox/population';

function installFrameStub() {
  let nextId = 1;
  const pending = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    const id = nextId++;
    pending.set(id, callback);
    return id;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => { pending.delete(id); }));
  return {
    flush(timestamp: number) {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback(timestamp);
    },
    pendingCount: () => pending.size,
  };
}

// Starts the round from a layout effect of the initial mount: the click lands
// after the DOM is committed but before the mount's passive effects flushed.
// StrictMode replays layout effects too, so guard against a second click that
// would restart the loop and mask the defect.
let started = false;
function StartRoundDuringMount({ children }: { children: ReactNode }) {
  useLayoutEffect(() => {
    if (started) return;
    started = true;
    screen.getByTestId('population-run').click();
  }, []);
  return children;
}

describe('population replay under replayed effects', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the loop alive when the round starts before the initial passive effects flush', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    const frames = installFrameStub();
    const onDone = vi.fn();

    render(
      <StrictMode>
        <StartRoundDuringMount>
          <SandboxPopulationReplay size={500} dayIndex={0} onDone={onDone} />
        </StartRoundDuringMount>
      </StrictMode>,
    );

    // The scene is running and a frame must still be scheduled.
    expect(screen.queryByTestId('population-run')).toBeNull();
    expect(screen.getByTestId('population-clock')).toHaveTextContent('05:30');
    expect(frames.pendingCount()).toBeGreaterThan(0);

    act(() => frames.flush(0));
    act(() => frames.flush(1000));

    // 1 s of a 30 s replay = 4 simulated minutes: every 05:30–05:34 event is processed.
    const expected = getPopulationDayEvents(500, 0).filter((event) => event.minute <= 334).length;
    expect(expected).toBeGreaterThan(0);
    expect(screen.getByTestId('population-count-processed')).toHaveTextContent(String(expected));
    expect(screen.getByTestId('population-feed').querySelectorAll('p').length).toBeGreaterThan(0);
    expect(frames.pendingCount()).toBe(1);
    expect(onDone).not.toHaveBeenCalled();
  });
});
