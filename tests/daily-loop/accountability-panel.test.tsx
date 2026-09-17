/**
 * Accountability panel on the patient page: shows the current designation and
 * preselects it, or says that nobody is designated yet. Synthetic ids only.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AccountabilityPanel } from '@/app/(provider)/patients/[patientId]/_components/accountability-panel';
import type { TeamMember } from '@/lib/team/types';

vi.mock('@/lib/daily-loop/actions', () => ({
  designatePatientAccountable: vi.fn(),
}));

const ORG = '00000000-0000-4000-a000-000000000001';
const OWNER = '00000000-0000-4000-a000-000000000011';
const COLLEAGUE = '00000000-0000-4000-a000-000000000012';
const PATIENT = '00000000-0000-4000-a000-000000000099';

const members: TeamMember[] = [
  {
    organization_id: ORG,
    organization_name: 'Rural Clinic',
    member_id: OWNER,
    member_name: 'Dr Owner',
    member_role: 'owner',
    is_default: true,
    is_self: true,
  },
  {
    organization_id: ORG,
    organization_name: 'Rural Clinic',
    member_id: COLLEAGUE,
    member_name: 'Dr Colleague',
    member_role: 'clinician',
    is_default: false,
    is_self: false,
  },
];

describe('AccountabilityPanel', () => {
  it('shows and preselects the current designation', () => {
    render(
      <AccountabilityPanel
        patientId={PATIENT}
        members={members}
        current={{ organizationId: ORG, accountableId: COLLEAGUE, accountableName: 'Dr Colleague' }}
      />,
    );

    expect(screen.getByTestId('accountability-current')).toHaveTextContent('Currently designated: Dr Colleague');
    expect(screen.getByRole('combobox', { name: /accountable provider/i })).toHaveValue(`${ORG}:${COLLEAGUE}`);
  });

  it('says nobody is designated when there is no current designation', () => {
    render(<AccountabilityPanel patientId={PATIENT} members={members} />);

    expect(screen.getByTestId('accountability-current')).toHaveTextContent('No accountable provider designated yet.');
    expect(screen.getByRole('combobox', { name: /accountable provider/i })).toHaveValue('');
  });
});
