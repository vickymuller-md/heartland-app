import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ComparisonTable } from '@/app/(public)/risk-calculator/comparison-table';
import { COMPARISON_TABLE_DATA } from '@/lib/risk-score/constants';

describe('ComparisonTable (RISK-04)', () => {
  it('renders a table with 4 score columns: MAGGIC, GWTG-HF, SHFM, HEARTLAND', () => {
    render(<ComparisonTable />);
    expect(screen.getByText('MAGGIC')).toBeInTheDocument();
    expect(screen.getByText('GWTG-HF')).toBeInTheDocument();
    expect(screen.getByText('SHFM')).toBeInTheDocument();
    expect(screen.getByText('HEARTLAND')).toBeInTheDocument();
  });

  it('renders all 8 characteristic rows', () => {
    render(<ComparisonTable />);
    for (const row of COMPARISON_TABLE_DATA) {
      expect(screen.getByText(row.characteristic)).toBeInTheDocument();
    }
  });

  it('highlights the HEARTLAND column with distinct background', () => {
    render(<ComparisonTable />);
    const heartlandHeader = screen.getByText('HEARTLAND');
    expect(heartlandHeader.className).toMatch(/bg-blue/);
  });

  it('shows "Yes" for distance to care only in HEARTLAND column', () => {
    render(<ComparisonTable />);
    const distanceRow = screen.getByText('Distance to care').closest('tr')!;
    const cells = distanceRow.querySelectorAll('td');
    // cells[0]=characteristic, cells[1]=MAGGIC, cells[2]=GWTG-HF, cells[3]=SHFM, cells[4]=HEARTLAND
    expect(cells[1].textContent).toBe('No');
    expect(cells[2].textContent).toBe('No');
    expect(cells[3].textContent).toBe('No');
    expect(cells[4].textContent).toBe('Yes');
  });

  it('shows "Yes" for social support only in HEARTLAND column', () => {
    render(<ComparisonTable />);
    const socialRow = screen.getByText('Social support').closest('tr')!;
    const cells = socialRow.querySelectorAll('td');
    expect(cells[1].textContent).toBe('No');
    expect(cells[2].textContent).toBe('No');
    expect(cells[3].textContent).toBe('No');
    expect(cells[4].textContent).toBe('Yes');
  });

  it('shows "Yes" for rurality only in HEARTLAND column', () => {
    render(<ComparisonTable />);
    const ruralityRow = screen.getByText('Rurality').closest('tr')!;
    const cells = ruralityRow.querySelectorAll('td');
    expect(cells[1].textContent).toBe('No');
    expect(cells[2].textContent).toBe('No');
    expect(cells[3].textContent).toBe('No');
    expect(cells[4].textContent).toBe('Yes');
  });

  it('shows validation status as "Pragmatic heuristic" for HEARTLAND', () => {
    render(<ComparisonTable />);
    expect(
      screen.getByText(/Pragmatic heuristic \(not yet validated\)/)
    ).toBeInTheDocument();
  });

  it('table is responsive with horizontal scroll on mobile', () => {
    render(<ComparisonTable />);
    const scrollContainer = screen.getByTestId('comparison-table-scroll');
    expect(scrollContainer.className).toMatch(/overflow-x-auto/);
  });
});
