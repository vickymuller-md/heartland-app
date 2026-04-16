/**
 * TaskShiftingTable -- Tests
 * Requirement: DSCH-02 (8-task matrix with role columns)
 * Source: HEARTLAND Protocol v3.3 Module 4 -- Discharge Bundle & Post-Discharge Follow-Up
 */

import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { TaskShiftingTable } from '@/app/(provider)/discharge/[patientId]/_components/TaskShiftingTable';

describe('TaskShiftingTable', () => {
  it('renders all 8 task rows', () => {
    render(<TaskShiftingTable />);
    const table = screen.getByTestId('task-shifting-table');
    const rows = within(table).getAllByRole('row');
    // 1 header row + 8 data rows = 9
    expect(rows).toHaveLength(9);
  });

  it('shows Optimal, Alternatives, and No-CHW columns', () => {
    render(<TaskShiftingTable />);
    expect(screen.getByText('Optimal')).toBeInTheDocument();
    expect(screen.getByText('Alternatives')).toBeInTheDocument();
    expect(screen.getByText('No-CHW Setting')).toBeInTheDocument();
  });

  it('all rows have non-empty content in each column', () => {
    render(<TaskShiftingTable />);
    const table = screen.getByTestId('task-shifting-table');
    const dataRows = within(table).getAllByRole('row').slice(1); // skip header

    dataRows.forEach((row) => {
      const cells = within(row).getAllByRole('cell');
      expect(cells).toHaveLength(4); // Task + Optimal + Alternatives + No-CHW
      cells.forEach((cell) => {
        expect(cell.textContent?.trim().length).toBeGreaterThan(0);
      });
    });
  });
});
