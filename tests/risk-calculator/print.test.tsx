import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PrintHeader } from '@/app/(public)/risk-calculator/print-header';
import { CalculatorForm } from '@/app/(public)/risk-calculator/calculator-form';

// Mock window.print
vi.stubGlobal('print', vi.fn());

describe('Print Layout (RISK-06)', () => {
  it('print header has print:block class (hidden on screen, visible in print)', () => {
    render(<PrintHeader />);
    const header = screen.getByTestId('print-header');
    expect(header.className).toMatch(/hidden/);
    expect(header.className).toMatch(/print:block/);
  });

  it('form toggles have print:hidden class', () => {
    render(<CalculatorForm />);
    const toggleSection = screen.getByTestId('toggle-section');
    expect(toggleSection.className).toMatch(/print:hidden/);
  });

  it('result card is visible in print (no print:hidden)', () => {
    render(<CalculatorForm />);
    const resultCard = screen.getByTestId('result-card');
    expect(resultCard.className).not.toMatch(/print:hidden/);
  });

  it('score breakdown is visible in print', () => {
    render(<CalculatorForm />);
    const breakdown = screen.getByTestId('score-breakdown');
    expect(breakdown.className).not.toMatch(/print:hidden/);
  });

  it('risk score disclaimer is visible in print', () => {
    render(<CalculatorForm />);
    const disclaimer = screen.getByTestId('disclaimer');
    expect(disclaimer.className).not.toMatch(/print:hidden/);
  });

  it('print header includes "HEARTLAND Risk Assessment" title', () => {
    render(<PrintHeader />);
    expect(screen.getByText('HEARTLAND Risk Assessment')).toBeInTheDocument();
  });

  it('print header includes generation date', () => {
    render(<PrintHeader />);
    const today = new Date().toLocaleDateString();
    expect(screen.getByText(new RegExp(today))).toBeInTheDocument();
  });

  it('print header includes disclaimer text', () => {
    render(<PrintHeader />);
    expect(
      screen.getByText(/proposed tool under development/i)
    ).toBeInTheDocument();
  });
});
