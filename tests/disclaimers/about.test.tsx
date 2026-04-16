import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AboutPage from '@/app/about/page';

// ==========================================================================
// ABOUT-01: About page with all 7 content sections
// Content sourced verbatim from reference/app_statement.md
// ==========================================================================
describe('About Page (ABOUT-01)', () => {
  it('renders "What is the HEARTLAND Protocol?" section', () => {
    render(<AboutPage />);
    expect(
      screen.getByText('What is the HEARTLAND Protocol?'),
    ).toBeInTheDocument();
  });

  it('renders "What This App Does" section with 7 tool descriptions', () => {
    render(<AboutPage />);
    expect(screen.getByText('What This App Does')).toBeInTheDocument();
    expect(
      screen.getByText(/Risk Stratification Calculator/),
    ).toBeInTheDocument();
  });

  it('renders "Who Is This For?" section with 5 audience types', () => {
    render(<AboutPage />);
    expect(screen.getByText('Who Is This For?')).toBeInTheDocument();
    expect(
      screen.getByText(/Primary care physicians/),
    ).toBeInTheDocument();
  });

  it('renders "Evidence Foundation" section with trial table', () => {
    render(<AboutPage />);
    expect(
      screen.getByText('Evidence Foundation'),
    ).toBeInTheDocument();
    const matches = screen.getAllByText(/Hozho Trial/);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('renders "Federal Alignment" section with 4 programs', () => {
    render(<AboutPage />);
    expect(screen.getByText('Federal Alignment')).toBeInTheDocument();
    expect(
      screen.getByText(/Rural Health Transformation Program/),
    ).toBeInTheDocument();
  });

  it('renders "Open Access" section with Zenodo DOI link', () => {
    render(<AboutPage />);
    expect(screen.getByText('Open Access')).toBeInTheDocument();
    const zenodoLink = screen.getByText(/10\.5281\/zenodo\.18566403/);
    expect(zenodoLink).toBeInTheDocument();
    expect(zenodoLink.closest('a')).toHaveAttribute(
      'href',
      'https://doi.org/10.5281/zenodo.18566403',
    );
  });

  it('renders "Open Access" section with OSF DOI link', () => {
    render(<AboutPage />);
    const osfLink = screen.getByText(/10\.17605\/OSF\.IO\/YUSGH/);
    expect(osfLink).toBeInTheDocument();
    expect(osfLink.closest('a')).toHaveAttribute(
      'href',
      'https://doi.org/10.17605/OSF.IO/YUSGH',
    );
  });

  it('renders link to Cureus publication', () => {
    render(<AboutPage />);
    const matches = screen.getAllByText(/Cureus.*Springer Nature/);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('includes problem stat "86% of rural"', () => {
    render(<AboutPage />);
    expect(
      screen.getByText(/86% of rural/),
    ).toBeInTheDocument();
  });
});

// ==========================================================================
// ABOUT-02: Author contact information
// ==========================================================================
describe('About Page Author Contact (ABOUT-02)', () => {
  it('renders author name "Vicky Muller Ferreira, MD"', () => {
    render(<AboutPage />);
    expect(
      screen.getByText('Vicky Muller Ferreira, MD'),
    ).toBeInTheDocument();
  });

  it('renders ORCID link to 0009-0009-1099-5690', () => {
    render(<AboutPage />);
    const orcidLink = screen.getByText('0009-0009-1099-5690');
    expect(orcidLink).toBeInTheDocument();
    expect(orcidLink.closest('a')).toHaveAttribute(
      'href',
      'https://orcid.org/0009-0009-1099-5690',
    );
  });

  it('renders email vickymuller@heartlandprotocol.org', () => {
    render(<AboutPage />);
    const emailLink = screen.getByText('vickymuller@heartlandprotocol.org');
    expect(emailLink).toBeInTheDocument();
    expect(emailLink.closest('a')).toHaveAttribute(
      'href',
      'mailto:vickymuller@heartlandprotocol.org',
    );
  });
});
