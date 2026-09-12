/**
 * The population scene must run entirely from the deterministic engine (the
 * displayed numbers ARE simulatePopulationDay's numbers), show the bounded
 * claim with its illustrative-demonstration disclaimer, and surface only
 * rule-backed exceptions to the review queue.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { SandboxCommandCenter } from '@/app/(sandbox)/sandbox/_components/sandbox-command-center';
import { SandboxPopulationReplay } from '@/app/(sandbox)/sandbox/_components/sandbox-population-replay';
import { getPopulationDayEvents, simulatePopulationDay } from '@/lib/sandbox/population';

vi.mock('@/lib/product-analytics/actions', () => ({
  trackProductEvent: vi.fn().mockResolvedValue(undefined),
}));

const numberFormat = new Intl.NumberFormat('en-US');

describe('SandboxCommandCenter population scene', () => {
  const onNavigate = vi.fn();
  const onPopulationSize = vi.fn();
  const onWorkCase = vi.fn();
  const onSendToDailyLoop = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Reduced motion: the replay lands on the final state without any rAF loop.
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(performance.now());
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    render(
      <SandboxCommandCenter
        taskStates={{}}
        visitedSections={['command']}
        dayIndex={0}
        populationSize={500}
        workedCases={[]}
        sentWorkItemIds={[]}
        onPopulationSize={onPopulationSize}
        onWorkCase={onWorkCase}
        onSendToDailyLoop={onSendToDailyLoop}
        onNavigate={onNavigate}
        automatedCallsCount={4}
      />,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts idle with placeholder counters and the standing disclaimer', () => {
    expect(screen.getByTestId('population-funnel')).toHaveTextContent('—');
    expect(screen.getByTestId('population-disclaimer')).toHaveTextContent(
      'Illustrative workflow demonstration on synthetic data — not a clinical outcome or staffing claim.',
    );
    expect(screen.queryByTestId('population-claim')).toBeNull();
    expect(screen.queryByTestId('population-exceptions')).toBeNull();
  });

  it('runs the round and shows exactly the engine numbers, claim, and review queue', () => {
    fireEvent.click(screen.getByTestId('population-run'));

    const expected = simulatePopulationDay(500, 0);
    const funnel = screen.getByTestId('population-funnel');
    expect(funnel).toHaveTextContent(numberFormat.format(expected.counts.total));
    expect(funnel).toHaveTextContent(String(expected.counts.routine));
    expect(funnel).toHaveTextContent(String(expected.counts.reviewQueue));

    expect(screen.getByTestId('population-claim')).toHaveTextContent(
      `${expected.counts.reviewQueue} of ${numberFormat.format(expected.counts.total)} synthetic check-ins entered the review queue; ${expected.counts.automatedPct}% stayed outside the simulated review queue.`,
    );
    // The metric never phrases capacity as a staffing ratio.
    expect(screen.getByTestId('population-claim')).not.toHaveTextContent('1 clinician');
    expect(screen.getByRole('heading', { level: 1 })).not.toHaveTextContent('One clinician');
    expect(funnel).toHaveTextContent('Outside the queue does not mean resolved.');
    expect(funnel).toHaveTextContent('A retry answer is not a normal clinical classification.');
    expect(screen.getByTestId('population-announcement')).toHaveTextContent('not resolved');
    const categories = screen.getByTestId('population-categories');
    expect(within(categories).getAllByRole('definition')).toHaveLength(6);
    expect(categories).toHaveTextContent('Critical flags');
    expect(categories).toHaveTextContent('Warning flags');
    expect(screen.getByRole('meter', { name: 'Outside the simulated review queue' })).toHaveAttribute('aria-valuenow', String(expected.counts.automatedPct));

    const queue = screen.getByTestId('population-exceptions');
    expect(queue).toHaveTextContent(`Today's review queue (${expected.counts.reviewQueue} of ${numberFormat.format(expected.counts.total)})`);
    expect(queue).toHaveTextContent(expected.exceptions[0].name);
    expect(queue).toHaveTextContent(`Showing 12 examples from ${expected.counts.reviewQueue} eligible cases`);
    expect(screen.getByTestId('queue-progress')).toHaveTextContent('0 of 12 displayed examples have a synthetic selection');
    expect(queue).toHaveTextContent('not proof of human review or delivered care');
    const flagged = expected.exceptions.find((exception) => exception.ruleIds.length > 0);
    if (flagged) expect(queue).toHaveTextContent(`rule ${flagged.ruleIds[0]}`);
  });

  it('opens a case panel with chart, call stage, and protocol outcome actions', () => {
    fireEvent.click(screen.getByTestId('population-run'));

    const firstEntry = screen.getAllByTestId(/^queue-entry-/)[0];
    const ordinal = firstEntry.getAttribute('data-testid')!.replace('queue-entry-', '');
    fireEvent.click(firstEntry);

    const detail = screen.getByTestId(`queue-detail-${ordinal}`);
    expect(detail.textContent).toMatch(/Registered rule|monitoring-gap policy/);
    // The generated chart is on screen: risk score, medications, labs, call stage.
    expect(detail.textContent).toMatch(/Risk score \d+\/18/);
    expect(detail.textContent).toContain('Medications');
    expect(detail.textContent).toContain('Potassium');
    expect(detail).toHaveTextContent('Selections below are simulated; they do not place orders or deliver care.');
    expect(screen.getByTestId(`queue-call-${ordinal}`)).toBeInTheDocument();

    // Fast path: reviewed without a call.
    fireEvent.click(screen.getByTestId(`queue-review-${ordinal}`));
    expect(onWorkCase).toHaveBeenCalledWith(`pop-${ordinal}-d0`, 'reviewed_no_call');

    // Protocol outcome buttons carry whitelisted keys and a disposition.
    const outcomeButton = screen.getAllByTestId(new RegExp(`^queue-outcome-${ordinal}-`))[0];
    const outcomeKey = outcomeButton.getAttribute('data-testid')!.replace(`queue-outcome-${ordinal}-`, '');
    fireEvent.click(outcomeButton);
    expect(onWorkCase).toHaveBeenLastCalledWith(`pop-${ordinal}-d0`, outcomeKey, expect.stringMatching(/escalated|no_answer/));

    fireEvent.click(screen.getByTestId(`queue-send-${ordinal}`));
    expect(onSendToDailyLoop).toHaveBeenCalledTimes(1);
    const run = onSendToDailyLoop.mock.calls[0][0];
    expect(run.id).toBe(`ai-run-pop${ordinal}d0`);
    expect(['escalated', 'no_answer']).toContain(run.disposition);
    expect(run.atLabel).toBe('Overnight round');
    if (run.disposition === 'no_answer') expect(run.note).toBeTruthy();
    else expect(run.redFlagIds.length).toBeGreaterThan(0);
  });

  it('starts the interactive call inline with the population case id', () => {
    fireEvent.click(screen.getByTestId('population-run'));
    const firstEntry = screen.getAllByTestId(/^queue-entry-/)[0];
    const ordinal = firstEntry.getAttribute('data-testid')!.replace('queue-entry-', '');
    fireEvent.click(firstEntry);
    fireEvent.click(screen.getByTestId(`queue-call-${ordinal}`));
    // The live-call component mounts in its ringing phase for this patient.
    expect(screen.getByText(/Decline/)).toBeInTheDocument();
  });

  it('lets the visitor change the population size', () => {
    fireEvent.click(screen.getByTestId('population-size-2500'));
    expect(onPopulationSize).toHaveBeenCalledWith(2500);
    expect(screen.getByTestId('population-size-500')).toHaveAttribute('aria-pressed', 'true');
  });

  it('puts the overnight run before the three guided entry paths', () => {
    const run = screen.getByTestId('population-run');
    const guided = screen.getByTestId('sandbox-guided-demo');
    expect(run.compareDocumentPosition(guided) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Provider workflow/ }));
    expect(onNavigate).toHaveBeenCalledWith('daily-loop');
    fireEvent.click(screen.getByRole('button', { name: /Patient experience/ }));
    expect(onNavigate).toHaveBeenCalledWith('patient-view');
  });
});

describe('population replay counter continuity', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps partial categories additive and lands on the same full queue before resetting scope', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    let nextFrame: FrameRequestCallback | undefined;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { nextFrame = callback; return 1; }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const onDone = vi.fn();
    const { rerender } = render(<SandboxPopulationReplay size={500} dayIndex={0} onDone={onDone} />);
    fireEvent.click(screen.getByTestId('population-run'));
    act(() => nextFrame!(0));
    act(() => nextFrame!(15000));
    const events = getPopulationDayEvents(500, 0).filter((event) => event.minute <= 390);
    const eligible = events.filter((event) => event.category === 'critical' || event.category === 'warning'
      || (event.category === 'no_answer' && event.riskTier === 'High'));
    expect(screen.getByTestId('population-count-processed')).toHaveTextContent(String(events.length));
    expect(screen.getByTestId('population-count-review')).toHaveTextContent(String(eligible.length));
    const values = within(screen.getByTestId('population-categories')).getAllByRole('definition', { hidden: true });
    expect(values.reduce((sum, row) => sum + Number(row.textContent?.replaceAll(',', '')), 0)).toBe(events.length);
    expect(onDone).not.toHaveBeenCalled();
    act(() => nextFrame!(30000));
    const final = simulatePopulationDay(500, 0);
    expect(screen.getByTestId('population-count-review')).toHaveTextContent(String(final.counts.reviewQueue));
    expect(onDone).toHaveBeenCalledExactlyOnceWith(final);
    rerender(<SandboxPopulationReplay size={2500} dayIndex={1} onDone={onDone} />);
    expect(screen.getByTestId('population-count-processed')).toHaveTextContent('—');
    expect(screen.queryByTestId('population-claim')).toBeNull();
    expect(onDone).toHaveBeenLastCalledWith(null);
  });
});
