import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SANDBOX_PATHWAYS, SANDBOX_PATIENTS, SANDBOX_SECTIONS, SANDBOX_TASKS } from '@/lib/sandbox/fixtures';
import { SandboxWorkspace } from '@/app/(sandbox)/sandbox/sandbox-workspace';

vi.mock('@/lib/product-analytics/actions', () => ({
  trackProductEvent: vi.fn().mockResolvedValue(undefined),
}));

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

  it('completes a work item only after a synthetic outcome is selected', () => {
    render(<SandboxWorkspace />);
    fireEvent.click(screen.getByTestId('sandbox-nav-daily-loop'));

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
    for (const link of toolLinks) expect(link.getAttribute('href')).toMatch(/^\//);
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
    }));
    render(<SandboxWorkspace />);
    const badges = await screen.findAllByTestId('sandbox-day-badge');
    expect(badges.at(-1)).toHaveTextContent('Day 5 of 5');
  });
});
