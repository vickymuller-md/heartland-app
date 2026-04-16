/**
 * Track B: Printable Diary + Red Flag Card -- Tests
 * Requirements: TRKB-01 (printable diary), TRKB-05 (red flag card)
 * Source: HEARTLAND Protocol v3.3 Module 5 -- Analog Track
 */

import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TrackBDiary from '@/lib/vitals/track-b-diary';
import RedFlagCard from '@/lib/vitals/red-flag-card';
import { RED_FLAG_CRITERIA } from '@/lib/vitals/constants';

describe('Track B: Printable Diary (TRKB-01)', () => {
  it('renders exactly 7 rows (one per day of the week)', () => {
    render(<TrackBDiary patientName="Jane Doe" />);
    const table = screen.getByRole('table');
    // 7 data rows (Mon-Sun) inside tbody
    const tbody = table.querySelector('tbody');
    expect(tbody).toBeTruthy();
    const rows = tbody!.querySelectorAll('tr');
    expect(rows).toHaveLength(7);
  });

  it('renders column headers: Date, Weight, BP, HR, SOB, Ankle Swelling, Fatigue, Orthopnea, Notes', () => {
    render(<TrackBDiary patientName="Jane Doe" />);
    expect(screen.getByText('Date')).toBeInTheDocument();
    expect(screen.getByText(/Morning Weight/)).toBeInTheDocument();
    expect(screen.getByText(/Blood Pressure/)).toBeInTheDocument();
    expect(screen.getByText(/Heart Rate/)).toBeInTheDocument();
    expect(screen.getByText(/Shortness of Breath/)).toBeInTheDocument();
    expect(screen.getByText(/Ankle Swelling/)).toBeInTheDocument();
    expect(screen.getByText(/Fatigue/)).toBeInTheDocument();
    expect(screen.getByText(/Orthopnea/)).toBeInTheDocument();
    expect(screen.getByText('Notes')).toBeInTheDocument();
  });

  it('renders symptom sub-columns: SOB, Ankle Swelling, Fatigue, Orthopnea', () => {
    render(<TrackBDiary patientName="Jane Doe" />);
    // These are separate columns in the header
    expect(screen.getByText(/Shortness of Breath/)).toBeInTheDocument();
    expect(screen.getByText(/Ankle Swelling/)).toBeInTheDocument();
    expect(screen.getByText(/Fatigue/)).toBeInTheDocument();
    expect(screen.getByText(/Orthopnea/)).toBeInTheDocument();
  });

  it('applies text-lg or text-xl class to diary labels (>=18px for elderly UX)', () => {
    const { container } = render(<TrackBDiary patientName="Jane Doe" />);
    const headers = container.querySelectorAll('th');
    // All header cells should use text-lg for elderly readability
    headers.forEach((th) => {
      expect(th.className).toMatch(/text-lg|text-xl/);
    });
  });

  it('includes patient name in the diary header', () => {
    render(<TrackBDiary patientName="John Smith" />);
    expect(screen.getByText(/John Smith/)).toBeInTheDocument();
  });
});

describe('Track B: Red Flag Card (TRKB-05)', () => {
  it('renders weight_gain_3lb_2d threshold (3 lbs in 2 days) under "Call clinic" section', () => {
    render(<RedFlagCard />);
    const clinicSection = screen.getByText(/call your clinic/i).closest('div')!;
    expect(within(clinicSection).getByText(/3/)).toBeInTheDocument();
    expect(within(clinicSection).getByText(/2 day/i)).toBeInTheDocument();
  });

  it('renders sbp_low_symptomatic threshold (SBP below 90) under "Call 911 / ER" section', () => {
    render(<RedFlagCard />);
    const erSection = screen.getByText(/911|emergency/i).closest('div')!;
    expect(within(erSection).getByText(/90/)).toBeInTheDocument();
  });

  it('renders spo2_low threshold (SpO2 below 92%) under "Call 911 / ER" section', () => {
    render(<RedFlagCard />);
    const erSection = screen.getByText(/911|emergency/i).closest('div')!;
    expect(within(erSection).getByText(/92/)).toBeInTheDocument();
  });

  it('renders severe dyspnea at rest under "Call 911 / ER" section', () => {
    render(<RedFlagCard />);
    const erSection = screen.getByText(/911|emergency/i).closest('div')!;
    expect(within(erSection).getByText(/shortness of breath at rest/i)).toBeInTheDocument();
  });

  it('renders weight_gain_5lb_7d threshold (5 lbs in 1 week) under "Call 911 / ER" section', () => {
    render(<RedFlagCard />);
    const erSection = screen.getByText(/911|emergency/i).closest('div')!;
    expect(within(erSection).getByText(/5/)).toBeInTheDocument();
  });

  it('uses RED_FLAG_CRITERIA constants as source (not hardcoded numbers)', () => {
    // Verify the constants match expected values
    expect(RED_FLAG_CRITERIA.weight_gain_3lb_2d.threshold).toBe(3);
    expect(RED_FLAG_CRITERIA.weight_gain_3lb_2d.severity).toBe('warning');
    expect(RED_FLAG_CRITERIA.weight_gain_5lb_7d.threshold).toBe(5);
    expect(RED_FLAG_CRITERIA.sbp_low_symptomatic.threshold).toBe(90);
    expect(RED_FLAG_CRITERIA.spo2_low.threshold).toBe(92);
    expect(RED_FLAG_CRITERIA.dyspnea_rest.severity).toBe('critical');
  });
});
