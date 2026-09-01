import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SandboxImpact } from '@/app/(sandbox)/sandbox/_components/sandbox-impact';

describe('SandboxImpact', () => {
  it('labels worked-case state as documented outcomes without claiming a call occurred', () => {
    render(
      <SandboxImpact
        visitedSections={[]}
        exploredPathways={[]}
        taskStates={{}}
        documentedActions={[]}
        patientCheckIns={[]}
        dayIndex={0}
        dayLog={[]}
        workedCasesCount={2}
        onReset={vi.fn()}
      />,
    );

    const metric = screen.getByText('Cases documented').closest('div');
    expect(metric).not.toBeNull();
    expect(metric).toHaveTextContent('2');
    expect(metric).toHaveTextContent('a call is not required');
    expect(screen.queryByText(/opened, called, and documented/i)).not.toBeInTheDocument();
  });
});
