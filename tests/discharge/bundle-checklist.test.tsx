/**
 * DischargeBundleChecklist -- Tests
 * Requirement: DSCH-01 (tier-aware discharge bundle checklist)
 * Source: HEARTLAND Protocol v3.3 Module 4 -- Discharge Bundle & Post-Discharge Follow-Up
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { DischargeBundleChecklist } from '@/app/(provider)/discharge/[patientId]/_components/DischargeBundleChecklist';

describe('DischargeBundleChecklist', () => {
  it('renders all 4 bundle components', () => {
    render(<DischargeBundleChecklist tier={1} />);
    const list = screen.getByTestId('bundle-list');
    const items = within(list).getAllByRole('button');
    expect(items).toHaveLength(4);
  });

  it('tier 1 shows "If available" for case management', () => {
    render(<DischargeBundleChecklist tier={1} />);
    const item = screen.getByTestId('bundle-item-case_management');
    expect(item).toHaveTextContent('If available');
  });

  it('tier 1 shows "3 core domains" for teach-back', () => {
    render(<DischargeBundleChecklist tier={1} />);
    const item = screen.getByTestId('bundle-item-teach_back');
    expect(item).toHaveTextContent('3 core domains');
  });

  it('tier 2 shows "Required" for case management', () => {
    render(<DischargeBundleChecklist tier={2} />);
    const item = screen.getByTestId('bundle-item-case_management');
    expect(item).toHaveTextContent('Required');
  });

  it('tier 2 shows "8 domains" for teach-back', () => {
    render(<DischargeBundleChecklist tier={2} />);
    const item = screen.getByTestId('bundle-item-teach_back');
    expect(item).toHaveTextContent('8 domains');
  });

  it('clicking an item toggles its checked state', async () => {
    const user = userEvent.setup();
    render(<DischargeBundleChecklist tier={1} />);
    const item = screen.getByTestId('bundle-item-case_management');

    // Initially unchecked -- no CheckCircle
    expect(item).toHaveTextContent('Case Management Assessment');

    // Click to check
    await user.click(item);

    // After click -- should update completed count
    expect(screen.getByText(/1 of 4/)).toBeInTheDocument();

    // Click again to uncheck
    await user.click(item);
    expect(screen.getByText(/0 of 4/)).toBeInTheDocument();
  });
});
