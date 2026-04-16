import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fs from 'fs';
import path from 'path';
import { PrintButton } from '@/components/ui/print-button';

const globalsCssPath = path.resolve(__dirname, '../../app/globals.css');
const globalsCss = fs.readFileSync(globalsCssPath, 'utf-8');

describe('Print CSS (PRNT-01)', () => {
  it('globals.css contains @media print rules', () => {
    expect(globalsCss).toContain('@media print');
  });

  it('globals.css contains @page with size: letter', () => {
    expect(globalsCss).toContain('size: letter');
  });

  it('globals.css contains print-color-adjust: exact', () => {
    expect(globalsCss).toContain('print-color-adjust: exact');
  });
});

describe('PrintButton Component (PRNT-01)', () => {
  it('renders a button with default "Print" label', () => {
    render(<PrintButton />);
    expect(screen.getByRole('button', { name: /print/i })).toBeInTheDocument();
  });

  it('has print:hidden in its className', () => {
    render(<PrintButton />);
    const button = screen.getByRole('button', { name: /print/i });
    expect(button.className).toMatch(/print:hidden/);
  });

  it('calls window.print() on click', async () => {
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {});
    const user = userEvent.setup();

    render(<PrintButton />);
    await user.click(screen.getByRole('button', { name: /print/i }));

    expect(printSpy).toHaveBeenCalledOnce();
    printSpy.mockRestore();
  });

  it('renders custom label when provided', () => {
    render(<PrintButton label="Print Report" />);
    expect(screen.getByRole('button', { name: /print report/i })).toBeInTheDocument();
  });

  it('accepts custom className', () => {
    render(<PrintButton className="mt-4" />);
    const button = screen.getByRole('button', { name: /print/i });
    expect(button.className).toContain('mt-4');
  });

  it('renders Printer icon', () => {
    render(<PrintButton />);
    const button = screen.getByRole('button', { name: /print/i });
    const svg = button.querySelector('svg');
    expect(svg).toBeTruthy();
  });
});
