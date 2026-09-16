import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SANDBOX_PATHWAYS, SANDBOX_PATIENTS, SANDBOX_SECTIONS, SANDBOX_TASKS, SANDBOX_TEAM } from '@/lib/sandbox/fixtures';
import { SandboxWorkspace } from '@/app/(sandbox)/sandbox/sandbox-workspace';
import { requestAssist } from '@/lib/sandbox-ai/assist-client';

vi.mock('@/lib/product-analytics/actions', () => ({
  trackProductEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/sandbox-ai/assist-client', () => ({ requestAssist: vi.fn().mockResolvedValue(null) }));

describe('complete synthetic sandbox dataset', () => {
  it('covers the product journey with deep patient and workflow fixtures', () => {
    expect(SANDBOX_SECTIONS.map((section) => section.id)).toEqual([
      'command', 'copilot', 'daily-loop', 'outreach', 'patient-360', 'pathways', 'coordination', 'patient-view', 'impact',
    ]);
    expect(SANDBOX_TASKS).toHaveLength(8);
    expect(new Set(SANDBOX_TASKS.map((task) => task.priority))).toEqual(new Set(['now', 'today', 'week', 'watching']));
    expect(SANDBOX_PATHWAYS.length).toBeGreaterThanOrEqual(6);
    for (const patient of SANDBOX_PATIENTS) {
      expect(patient.vitals.length).toBeGreaterThanOrEqual(3);
      expect(patient.medications.length).toBeGreaterThanOrEqual(2);
      expect(patient.timeline.length).toBeGreaterThanOrEqual(3);
      expect(patient.carePlan.length).toBeGreaterThanOrEqual(4);
      expect(patient.access.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('SandboxWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('No network in navigation tests')));
    vi.stubGlobal('matchMedia', vi.fn().mockImplementation((media: string) => ({
      media, matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })));
    Element.prototype.scrollIntoView = vi.fn();
    const store = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
        clear: () => store.clear(),
      },
    });
    window.scrollTo = vi.fn();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('keeps nine native controls in order and focuses the newly selected content', async () => {
    const user = userEvent.setup();
    render(<SandboxWorkspace />);
    const navigation = screen.getByRole('navigation', { name: 'Sandbox product navigation' });
    const buttons = within(navigation).getAllByRole('button').filter((button) => button.dataset.testid?.startsWith('sandbox-nav-'));
    expect(buttons.map((button) => button.dataset.testid)).toEqual(SANDBOX_SECTIONS.map((section) => `sandbox-nav-${section.id}`));
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();

    for (const section of SANDBOX_SECTIONS) {
      const button = within(navigation).getByRole('button', { name: section.shortLabel, exact: true });
      await user.click(button);
      expect(button).toHaveAttribute('aria-current', 'page');
      expect(navigation.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
      expect(screen.getByRole('region', { name: `Sandbox area: ${section.title}` })).toHaveFocus();
      expect(screen.getByText(`Now viewing ${section.title}.`)).toBeInTheDocument();
    }
    // Daily Loop retains its existing automatic assist, but only through a mock.
    expect(requestAssist).toHaveBeenCalledWith(expect.objectContaining({ kind: 'morning_brief' }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not activate areas on focus or arrow keys; Enter and Space activate natively', async () => {
    const user = userEvent.setup();
    render(<SandboxWorkspace />);
    screen.getByTestId('sandbox-nav-command').focus();
    await user.tab();
    expect(screen.getByTestId('sandbox-nav-copilot')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByTestId('sandbox-nav-command')).toHaveAttribute('aria-current', 'page');
    expect(requestAssist).not.toHaveBeenCalled();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('region', { name: 'Sandbox area: Copilot' })).toHaveFocus();
    expect(requestAssist).not.toHaveBeenCalled();
    screen.getByTestId('sandbox-nav-daily-loop').focus();
    await user.tab({ shift: true });
    expect(screen.getByTestId('sandbox-nav-copilot')).toHaveFocus();
    await user.tab();
    await user.keyboard(' ');
    expect(screen.getByRole('region', { name: 'Sandbox area: Daily Loop' })).toHaveFocus();
    expect(requestAssist).toHaveBeenCalledTimes(1);
  });

  it('focuses the final area after guided navigation, same-area activation, and rapid navigation', async () => {
    const user = userEvent.setup();
    render(<SandboxWorkspace />);
    const tour = () => within(screen.getByRole('navigation', { name: 'Guided sandbox tour' }));
    await user.click(tour().getByRole('button', { name: 'Copilot →' }));
    expect(screen.getByRole('region', { name: 'Sandbox area: Copilot' })).toHaveFocus();
    await user.click(tour().getByRole('button', { name: '← Command Center' }));
    expect(screen.getByRole('region', { name: 'Sandbox area: Command Center' })).toHaveFocus();
    await user.click(screen.getByTestId('sandbox-nav-command'));
    expect(screen.getByRole('region', { name: 'Sandbox area: Command Center' })).toHaveFocus();
    act(() => {
      fireEvent.click(screen.getByTestId('sandbox-nav-pathways'));
      fireEvent.click(screen.getByTestId('sandbox-nav-impact'));
    });
    expect(screen.getByRole('region', { name: 'Sandbox area: Impact & Reports' })).toHaveFocus();
    await user.click(tour().getByRole('button', { name: 'Return to Command Center' }));
    expect(screen.getByRole('region', { name: 'Sandbox area: Command Center' })).toHaveFocus();
  });

  it.each([false, true])('coordinates focus and scrolling for navigation, patient opening and Reset (reduced motion: %s)', async (reduced) => {
    vi.mocked(window.matchMedia).mockImplementation((media: string) => ({
      media, matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }) as unknown as MediaQueryList);
    const user = userEvent.setup();
    render(<SandboxWorkspace />);
    for (const action of [
      () => user.click(screen.getByTestId('sandbox-nav-daily-loop')),
      () => user.click(screen.getAllByRole('button', { name: 'Open Patient 360' })[0]),
      () => user.click(screen.getByRole('button', { name: 'Reset', exact: true })),
      () => user.click(screen.getByRole('button', { name: 'Reset', exact: true })),
    ]) {
      vi.mocked(Element.prototype.scrollIntoView).mockClear();
      await action();
      expect(screen.getByRole('region', { name: /^Sandbox area:/ })).toHaveFocus();
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
      expect(window.scrollTo).not.toHaveBeenCalled();
    }
  });

  it('preserves restored parent state and user focus until explicit navigation; Reset retains its existing demo contract', async () => {
    const user = userEvent.setup();
    const first = render(<SandboxWorkspace />);
    const restored = JSON.parse(localStorage.getItem('heartland_synthetic_sandbox_v2')!);
    first.unmount();
    Object.assign(restored, {
      selectedSection: 'patient-360', selectedPatientId: SANDBOX_PATIENTS[1].id,
      populationSize: 500, dayIndex: 1, workedCases: [{ id: 'pop-7-d1', outcome: 'reviewed_no_call', dayIndex: 1 }],
    });
    restored.taskStates[SANDBOX_TASKS[0].id].status = 'reviewed';
    localStorage.setItem('heartland_synthetic_sandbox_v2', JSON.stringify(restored));
    render(<button>Existing focus</button>);
    const sentinel = screen.getByRole('button', { name: 'Existing focus' });
    sentinel.focus();
    render(<SandboxWorkspace />);
    expect(screen.getByTestId('sandbox-patient-360')).toBeInTheDocument();
    expect(sentinel).toHaveFocus();
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    const choice = within(screen.getByRole('region', { name: 'Choose a synthetic patient' })).getAllByRole('button')[2];
    await user.click(choice);
    expect(choice).toHaveFocus();
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    for (const section of ['impact', 'command', 'patient-360']) await user.click(screen.getByTestId(`sandbox-nav-${section}`));
    const saved = JSON.parse(localStorage.getItem('heartland_synthetic_sandbox_v2')!);
    expect(saved).toMatchObject({ populationSize: 500, dayIndex: 1, selectedPatientId: SANDBOX_PATIENTS[2].id, workedCases: restored.workedCases, taskStates: restored.taskStates });
    await user.click(screen.getByRole('button', { name: 'Reset', exact: true }));
    expect(JSON.parse(localStorage.getItem('heartland_synthetic_sandbox_v2')!)).toMatchObject({ selectedSection: 'command', dayIndex: 0, populationSize: 2500, workedCases: [] });
    expect(screen.getByRole('region', { name: 'Sandbox area: Command Center' })).toHaveFocus();
  });

  it('does not steal focus when the automatic brief completes or population changes', async () => {
    let resolveBrief!: (value: null) => void;
    vi.mocked(requestAssist).mockImplementationOnce(() => new Promise((resolve) => { resolveBrief = resolve; }));
    const user = userEvent.setup();
    render(<SandboxWorkspace />);
    await user.click(screen.getByTestId('sandbox-nav-daily-loop'));
    const review = screen.getAllByRole('button', { name: 'Review' })[0];
    review.focus();
    vi.mocked(Element.prototype.scrollIntoView).mockClear();
    await act(async () => resolveBrief(null));
    expect(review).toHaveFocus();
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('sandbox-nav-command'));
    vi.mocked(Element.prototype.scrollIntoView).mockClear();
    const population = screen.getByTestId('population-size-500');
    await user.click(population);
    expect(population).toHaveFocus();
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it('keeps navigation and Reset usable without storage or matchMedia', async () => {
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => { throw new Error('Storage blocked'); } });
    vi.stubGlobal('matchMedia', undefined);
    const user = userEvent.setup();
    render(<SandboxWorkspace />);
    await user.click(screen.getByTestId('sandbox-nav-impact'));
    expect(screen.getByRole('region', { name: 'Sandbox area: Impact & Reports' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Reset', exact: true }));
    expect(screen.getByRole('region', { name: 'Sandbox area: Command Center' })).toHaveFocus();
    expect(Element.prototype.scrollIntoView).toHaveBeenLastCalledWith({ block: 'start', behavior: 'auto' });
  });

  it('ignores a departed area’s late brief and focuses Command Center after the Impact reset', async () => {
    let resolveBrief!: (value: null) => void;
    vi.mocked(requestAssist).mockImplementationOnce(() => new Promise((resolve) => { resolveBrief = resolve; }));
    const user = userEvent.setup();
    render(<SandboxWorkspace />);
    await user.click(screen.getByTestId('sandbox-nav-daily-loop'));
    await user.click(screen.getByTestId('sandbox-nav-impact'));
    const reset = screen.getByRole('button', { name: 'Reset sandbox' });
    reset.focus();
    vi.mocked(Element.prototype.scrollIntoView).mockClear();
    await act(async () => resolveBrief(null));
    expect(reset).toHaveFocus();
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    await user.click(reset);
    expect(screen.getByRole('region', { name: 'Sandbox area: Command Center' })).toHaveFocus();
    expect(requestAssist).toHaveBeenCalledTimes(1);
  });

  it('navigates across the full product experience without a clinical backend', () => {
    render(<SandboxWorkspace />);
    expect(screen.getByTestId('sandbox-command-center')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('sandbox-nav-daily-loop'));
    expect(screen.getByTestId('sandbox-daily-loop')).toBeInTheDocument();
    expect(screen.getByTestId('daily-loop-outreach')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('sandbox-nav-outreach'));
    expect(screen.getByTestId('sandbox-outreach')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('sandbox-nav-patient-360'));
    expect(screen.getByTestId('sandbox-patient-360')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('sandbox-nav-pathways'));
    expect(screen.getByTestId('sandbox-pathways')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('sandbox-nav-coordination'));
    expect(screen.getByTestId('sandbox-coordination')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('sandbox-nav-patient-view'));
    expect(screen.getByTestId('sandbox-patient-view')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('sandbox-nav-impact'));
    expect(screen.getByTestId('sandbox-impact')).toBeInTheDocument();
  });

  it('completes a work item only after a synthetic outcome is selected', async () => {
    const user = userEvent.setup();
    render(<SandboxWorkspace />);
    await user.click(screen.getByTestId('sandbox-nav-daily-loop'));

    fireEvent.click(screen.getAllByRole('button', { name: 'Review' })[0]);
    expect(screen.getAllByText('reviewed').length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole('button', { name: /Close with outcome/ })[0]);
    expect(screen.getByText('Choose a synthetic outcome')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Patient contacted; follow-up scheduled' }));

    expect(screen.getByText('Outcome:')).toBeInTheDocument();
    expect(screen.getAllByText('closed').length).toBeGreaterThan(0);
    expect(screen.getByText('Closed this visit')).toBeInTheDocument();
  });

  it('links every pathway to a real public HEARTLAND tool', () => {
    render(<SandboxWorkspace />);
    fireEvent.click(screen.getByTestId('sandbox-nav-pathways'));

    const toolLinks = screen.getAllByRole('link', { name: /Open interactive tool/ });
    expect(toolLinks).toHaveLength(SANDBOX_PATHWAYS.length);
    expect(toolLinks.map((link) => link.getAttribute('href'))).toEqual([
      '/risk-calculator', '/gdmt-pathway', '/titration-checklist', '/remote-monitoring', '/tier-selector', '/pocket-cards',
    ]);
    for (const button of screen.getAllByRole('button', { name: 'Mark explored' })) {
      fireEvent.click(button);
      fireEvent.click(button);
    }
    expect(screen.getAllByRole('button', { name: 'Explored' })).toHaveLength(6);
    expect(JSON.parse(window.localStorage.getItem('heartland_synthetic_sandbox_v2')!).exploredPathways).toEqual(SANDBOX_PATHWAYS.map((item) => item.id));
  });

  it.each(SANDBOX_PATIENTS)('preserves $name sources across all record panels', async (patient) => {
    const user = userEvent.setup();
    render(<SandboxWorkspace />);
    await user.click(screen.getByTestId('sandbox-nav-patient-360'));
    await user.click(within(screen.getByRole('region', { name: 'Choose a synthetic patient' })).getByRole('button', { name: new RegExp(patient.name) }));
    const region = screen.getByRole('region', { name: 'Synthetic vital history, horizontally scrollable' });
    expect(region).toHaveAttribute('tabindex', '0');
    const table = within(region).getByRole('table', { name: 'Synthetic vital history' });
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['When', 'Weight', 'SBP', 'Heart rate', 'SpO₂']);
    expect(within(table).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent))).toEqual(
      patient.vitals.map((point) => [point.label, `${point.weight} lb`, `${point.sbp}`, `${point.heartRate}`, `${point.spo2}%`]),
    );
    const chart = screen.getByRole('img', { name: /^Weight trend from/ });
    expect(Array.from(chart.querySelectorAll('circle title')).map((title) => title.textContent)).toEqual(patient.vitals.map((point) => `${point.label}: ${point.weight} lb`));
    const tabs = within(screen.getByRole('tablist', { name: 'Synthetic patient record sections' }));
    tabs.getByRole('tab', { name: 'Monitoring', exact: true }).focus();
    await user.keyboard('{ArrowRight}');
    expect(tabs.getByRole('tab', { name: 'Medications & labs' })).toHaveFocus();
    await user.keyboard('{Enter}');
    for (const lab of patient.labs) expect(within(screen.getByRole('tabpanel')).getAllByText(`Collected ${lab.collected}`).length).toBeGreaterThan(0);
    await user.click(tabs.getByRole('tab', { name: 'Timeline', exact: true }));
    for (const event of patient.timeline) expect(within(screen.getByRole('tabpanel')).getByText(event.title)).toBeInTheDocument();
    await user.click(tabs.getByRole('tab', { name: 'Plan & access' }));
    for (const item of patient.carePlan) expect(within(screen.getByRole('tabpanel')).getByText(item)).toBeInTheDocument();
    await user.click(tabs.getByRole('tab', { name: 'Monitoring', exact: true }));
    expect(screen.getByRole('table', { name: 'Synthetic vital history' })).toBeInTheDocument();
  });

  it('keeps all four actions per persona local and deduplicated', async () => {
    const user = userEvent.setup();
    render(<SandboxWorkspace />);
    await user.click(screen.getByTestId('sandbox-nav-patient-360'));
    const actions = [['Document contact', 'contact outcome documented'], ['Schedule follow-up', 'follow-up scheduled'], ['Route to team', 'routed to clinical owner'], ['Generate SBAR', 'synthetic SBAR prepared']];
    const expected: string[] = [];
    for (const patient of SANDBOX_PATIENTS) {
      await user.click(within(screen.getByRole('region', { name: 'Choose a synthetic patient' })).getByRole('button', { name: new RegExp(patient.name) }));
      for (const [label, outcome] of actions) {
        await user.click(screen.getByRole('button', { name: label, exact: true }));
        await user.click(screen.getByRole('button', { name: label, exact: true }));
        expected.push(`${patient.name}: ${outcome}`);
      }
    }
    expect(JSON.parse(window.localStorage.getItem('heartland_synthetic_sandbox_v2')!).documentedActions).toEqual(expected);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves five queue filters and all three explicit closure outcomes', async () => {
    const user = userEvent.setup();
    render(<SandboxWorkspace />);
    await user.click(screen.getByTestId('sandbox-nav-daily-loop'));
    const area = screen.getByTestId('sandbox-daily-loop');
    for (const [name, count] of [['All work', 8], ['Now', 2], ['Today', 3], ['This week', 2], ['Watching', 1]] as const) {
      const filter = within(area).getByRole('button', { name, exact: true });
      await user.click(filter);
      expect(filter).toHaveAttribute('aria-pressed', 'true');
      expect(within(area).getAllByRole('article')).toHaveLength(count);
    }
    await user.click(within(area).getByRole('button', { name: 'All work', exact: true }));
    const outcomes = ['Patient contacted; follow-up scheduled', 'Source verified; no escalation required', 'Routed to clinical owner for independent review'];
    for (const [index, outcome] of outcomes.entries()) {
      const article = within(within(area).getAllByRole('article')[index]);
      await user.click(article.getByRole('button', { name: 'Close with outcome' }));
      await user.click(article.getByRole('button', { name: outcome }));
      expect(article.getByText(outcome)).toBeInTheDocument();
      expect(article.queryByRole('button', { name: 'Close with outcome' })).not.toBeInTheDocument();
    }
  });

  it('reassigns only the active item and records coordination without implying delivery', async () => {
    const user = userEvent.setup();
    render(<SandboxWorkspace />);
    await user.click(screen.getByTestId('sandbox-nav-coordination'));
    const before = JSON.parse(window.localStorage.getItem('heartland_synthetic_sandbox_v2')!);
    const task = SANDBOX_TASKS.find((item) => before.taskStates[item.id].status !== 'closed')!;
    const member = SANDBOX_TEAM.find((item) => item.name !== before.taskStates[task.id].owner)!;
    const assign = screen.getByRole('button', { name: `Assign to ${member.name.split(',')[0]}` });
    await user.click(assign);
    expect(assign).toBeDisabled();
    const after = JSON.parse(window.localStorage.getItem('heartland_synthetic_sandbox_v2')!);
    expect(after.taskStates[task.id]).toMatchObject({ owner: member.name, status: before.taskStates[task.id].status });
    for (const other of SANDBOX_TASKS.filter((item) => item.id !== task.id)) expect(after.taskStates[other.id]).toEqual(before.taskStates[other.id]);
    await user.click(screen.getByRole('button', { name: 'Confirm next milestone' }));
    await user.click(screen.getByRole('button', { name: 'Generate synthetic handoff' }));
    expect(JSON.parse(window.localStorage.getItem('heartland_synthetic_sandbox_v2')!).documentedActions).toEqual(['James Walker: Day 14 follow-up confirmed', 'Maria Santos: synthetic SBAR handoff generated']);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps portal progress at three of four until a symptom check-in is completed', async () => {
    const user = userEvent.setup();
    render(<SandboxWorkspace />);
    await user.click(screen.getByTestId('sandbox-nav-patient-view'));
    const area = within(screen.getByTestId('sandbox-patient-view'));
    for (const name of ['Record today’s weight', 'Confirm medications', 'Review next education item']) {
      const button = area.getByRole('button', { name: new RegExp(name) });
      await user.click(button);
      await user.click(button);
    }
    await user.click(area.getByRole('button', { name: 'Message care team' }));
    await user.click(area.getByRole('button', { name: 'View contact plan' }));
    expect(area.getByText('3/4', { exact: true })).toBeInTheDocument();
    expect(new Set(JSON.parse(window.localStorage.getItem('heartland_synthetic_sandbox_v2')!).patientCheckIns).size).toBe(5);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('recovers safely from tampered local sandbox state', async () => {
    window.localStorage.setItem('heartland_synthetic_sandbox_v2', JSON.stringify({
      savedAt: Date.now(),
      selectedSection: 'patient-360',
      selectedPatientId: '<script>not-a-patient</script>',
      visitedSections: 'not-an-array',
      taskStates: { 'task-weight': { status: 'invented', owner: '<img>', updatedLabel: '' } },
      exploredPathways: [null, 'not-a-pathway'],
      patientCheckIns: ['not-a-check-in'],
      documentedActions: { unsafe: true },
    }));

    render(<SandboxWorkspace />);
    await waitFor(() => expect(screen.getByTestId('sandbox-patient-360')).toBeInTheDocument());
    expect(screen.getAllByText('Maria Santos').length).toBeGreaterThan(0);
    expect(screen.queryByText('<script>not-a-patient</script>')).not.toBeInTheDocument();
  });

  it('restores a legacy payload without dayIndex to simulation day 1 and clamps tampered days', async () => {
    window.localStorage.setItem('heartland_synthetic_sandbox_v2', JSON.stringify({
      savedAt: Date.now(),
      selectedSection: 'command',
      aiOutreachRuns: [{ id: 'ai-run-abc123', patientName: 'Persona', disposition: 'routine', redFlagIds: [], atLabel: 'Earlier' }],
    }));

    render(<SandboxWorkspace />);
    await waitFor(() => expect(screen.getByTestId('sandbox-day-badge')).toHaveTextContent('Day 1 of 5'));

    window.localStorage.setItem('heartland_synthetic_sandbox_v2', JSON.stringify({
      savedAt: Date.now(),
      selectedSection: 'command',
      dayIndex: 99,
      dayLog: [{ dayIndex: 42, escalations: -5, completedAtLabel: 'x' }],
      populationSize: 1234,
      populationReviewedIds: ['pop-3-d0', '<script>', 'pop-99999-d1', 42],
    }));
    render(<SandboxWorkspace />);
    const badges = await screen.findAllByTestId('sandbox-day-badge');
    expect(badges.at(-1)).toHaveTextContent('Day 5 of 5');

    // v1.7 reviewed ids migrate one-way into worked cases; garbage is dropped.
    await waitFor(() => {
      const saved = JSON.parse(window.localStorage.getItem('heartland_synthetic_sandbox_v2')!);
      expect(saved.workedCases).toEqual([{ id: 'pop-3-d0', outcome: 'reviewed_legacy', dayIndex: 0 }]);
      expect(saved.populationReviewedIds).toBeUndefined();
    });
  });

  it('restores worked cases and rejects unknown outcome keys', async () => {
    window.localStorage.setItem('heartland_synthetic_sandbox_v2', JSON.stringify({
      savedAt: Date.now(),
      selectedSection: 'command',
      workedCases: [
        { id: 'pop-7-d1', outcome: 'diuretic_adjustment_24h', disposition: 'escalated' },
        { id: 'pop-7-d1', outcome: 'nurse_visit_same_day' },
        { id: 'pop-8-d0', outcome: 'made_up_outcome' },
        { id: 'not-a-case', outcome: 'reviewed_no_call' },
      ],
    }));
    render(<SandboxWorkspace />);
    await waitFor(() => {
      const saved = JSON.parse(window.localStorage.getItem('heartland_synthetic_sandbox_v2')!);
      expect(saved.workedCases).toEqual([
        { id: 'pop-7-d1', outcome: 'diuretic_adjustment_24h', dayIndex: 1, disposition: 'escalated' },
      ]);
    });
  });
});
