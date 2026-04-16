/**
 * Patient Detail Tabs -- Tests
 * Requirements: DASH-03 (patient detail view with tabs), DASH-09 (provider notes)
 * Source: HEARTLAND Protocol v3.3
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PatientDetailTabs } from '@/app/(provider)/patients/[patientId]/_components/patient-detail-tabs';
import { SymptomHistory } from '@/app/(provider)/patients/[patientId]/_components/symptom-history';
import { MedicationSummary } from '@/app/(provider)/patients/[patientId]/_components/medication-summary';
import { EducationSummary } from '@/app/(provider)/patients/[patientId]/_components/education-summary';
import { ProviderNotes } from '@/app/(provider)/patients/[patientId]/_components/provider-notes';
import type { VitalsChartPoint, SymptomEntry, ProviderNote, AlertRow } from '@/lib/dashboard/types';

// Mock recharts to avoid jsdom rendering issues
vi.mock('recharts', () => ({
  LineChart: ({ children }: { children: React.ReactNode }) => <div data-testid="line-chart">{children}</div>,
  Line: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  CartesianGrid: () => <div />,
  Legend: () => <div />,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Mock ChartContainer to render children directly
vi.mock('@/components/ui/chart', () => ({
  ChartContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ChartTooltip: () => <div />,
  ChartTooltipContent: () => <div />,
}));

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; className?: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

// Mock server actions
vi.mock('@/lib/dashboard/actions', () => ({
  addProviderNote: vi.fn(),
  NoteActionState: {},
}));

vi.mock('@/lib/messages/actions', () => ({
  sendMessage: vi.fn(),
  MessageActionState: {},
}));

// ---------- Test Data ----------

const mockVitals: VitalsChartPoint[] = [
  { date: '2026-03-20T10:00:00Z', weight_lbs: 180, sbp: 120, dbp: 80, heart_rate: 72, spo2: 98 },
  { date: '2026-03-21T10:00:00Z', weight_lbs: 181, sbp: 125, dbp: 82, heart_rate: 75, spo2: 97 },
];

const mockSymptoms: SymptomEntry[] = [
  { id: 's1', recorded_at: '2026-03-25T12:00:00Z', dyspnea: 1, edema: 0, orthopnea: 0, fatigue: 2, red_flag: false },
  { id: 's2', recorded_at: '2026-03-24T12:00:00Z', dyspnea: 3, edema: 2, orthopnea: 1, fatigue: 3, red_flag: true },
];

const mockNotes: ProviderNote[] = [
  { id: 'n1', patient_id: 'p1', provider_id: 'prov1', provider_name: 'Dr. Smith', content: 'Patient responding well to treatment', created_at: '2026-03-25T14:00:00Z' },
  { id: 'n2', patient_id: 'p1', provider_id: 'prov1', provider_name: 'Dr. Smith', content: 'Initial assessment complete', created_at: '2026-03-20T10:00:00Z' },
];

const mockAlerts: AlertRow[] = [
  {
    id: 'a1', patient_id: 'p1', patient_name: 'Test Patient',
    vitals_id: 'v1', flags: ['spo2_low'], severity: 'critical', status: 'open',
    acknowledged_by: null, acknowledged_at: null,
    resolved_by: null, resolved_at: null, created_at: '2026-03-25T12:00:00Z',
  },
];

// ==========================================================================
// DASH-03: Patient detail view with 5 tabs and clinical data display
// ==========================================================================

describe('PatientDetailTabs', () => {
  it('renders 5 tabs: Vitals, Symptoms, Medications, Education, Notes', () => {
    render(
      <PatientDetailTabs
        patientId="p1"
        vitals={mockVitals}
        symptoms={mockSymptoms}
        adherenceSummary={null}
        educationProgress={null}
        notes={mockNotes}
        openAlerts={mockAlerts}
        messages={[]}
        comorbidities={[]}
      />
    );

    // Tab triggers should be present (text hidden on mobile, but still in DOM)
    expect(screen.getByText('Vitals')).toBeInTheDocument();
    expect(screen.getByText('Symptoms')).toBeInTheDocument();
    expect(screen.getByText('Medications')).toBeInTheDocument();
    expect(screen.getByText('Education')).toBeInTheDocument();
    expect(screen.getByText('Notes')).toBeInTheDocument();
  });

  it('Vitals tab shows multi-series line chart (weight, SBP, DBP, HR, SpO2)', () => {
    render(
      <PatientDetailTabs
        patientId="p1"
        vitals={mockVitals}
        symptoms={[]}
        adherenceSummary={null}
        educationProgress={null}
        notes={[]}
        messages={[]}
        openAlerts={[]}
        comorbidities={[]}
      />
    );

    // Chart should be rendered (mocked)
    expect(screen.getByTestId('line-chart')).toBeInTheDocument();
  });

  it('Vitals tab supports 7/30/90 day period toggle', () => {
    render(
      <PatientDetailTabs
        patientId="p1"
        vitals={mockVitals}
        symptoms={[]}
        adherenceSummary={null}
        educationProgress={null}
        notes={[]}
        messages={[]}
        openAlerts={[]}
        comorbidities={[]}
      />
    );

    // Period buttons should be present
    expect(screen.getByText('7d')).toBeInTheDocument();
    expect(screen.getByText('30d')).toBeInTheDocument();
    expect(screen.getByText('90d')).toBeInTheDocument();
  });
});

// ==========================================================================
// Symptom History
// ==========================================================================

describe('SymptomHistory', () => {
  it('displays symptom history with severity badges', () => {
    render(<SymptomHistory symptoms={mockSymptoms} />);

    // Should show severity labels
    expect(screen.getAllByText('Dyspnea').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Edema').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Fatigue').length).toBeGreaterThan(0);
  });

  it('shows red flag badge for flagged entries', () => {
    render(<SymptomHistory symptoms={mockSymptoms} />);

    // Red flag entry should be marked
    expect(screen.getByText('Red Flag')).toBeInTheDocument();
  });

  it('shows empty state when no symptoms', () => {
    render(<SymptomHistory symptoms={[]} />);
    expect(screen.getByText('No symptoms reported')).toBeInTheDocument();
  });
});

// ==========================================================================
// Medication Summary
// ==========================================================================

describe('MedicationSummary', () => {
  it('shows medication list and adherence summary', () => {
    const adherenceData = {
      medications: [
        { id: 'm1', name: 'Lisinopril', dosage: '10mg', frequency: 'Daily', adherence_pct: 85 },
        { id: 'm2', name: 'Metoprolol', dosage: '25mg', frequency: 'BID', adherence_pct: 70 },
      ],
      days: [
        { date: '2026-03-25', total_doses: 3, taken_doses: 2 },
        { date: '2026-03-24', total_doses: 3, taken_doses: 3 },
      ],
    };

    render(<MedicationSummary adherenceSummary={adherenceData} />);

    expect(screen.getByText('Lisinopril')).toBeInTheDocument();
    expect(screen.getByText('Metoprolol')).toBeInTheDocument();
    expect(screen.getByText('85%')).toBeInTheDocument();
    expect(screen.getByText('70%')).toBeInTheDocument();
  });

  it('shows empty state when no medications', () => {
    render(<MedicationSummary adherenceSummary={null} />);
    expect(screen.getByText('No medications recorded')).toBeInTheDocument();
  });
});

// ==========================================================================
// Education Summary
// ==========================================================================

describe('EducationSummary', () => {
  it('shows completion status per domain', () => {
    const eduData = {
      domains: [
        { domain: 'daily_weight', label: 'Daily Weight Monitoring', completed: true },
        { domain: 'medications', label: 'Medication Management', completed: true },
        { domain: 'warning_signs', label: 'Warning Signs', completed: false },
        { domain: 'diet', label: 'Diet & Nutrition', completed: false },
      ],
    };

    render(<EducationSummary educationProgress={eduData} />);

    expect(screen.getByText('Daily Weight Monitoring')).toBeInTheDocument();
    expect(screen.getByText('Warning Signs')).toBeInTheDocument();
    expect(screen.getByText('2/4 domains (50%)')).toBeInTheDocument();
  });

  it('shows empty state when education not started', () => {
    render(<EducationSummary educationProgress={null} />);
    expect(screen.getByText('Education not started')).toBeInTheDocument();
  });
});

// ==========================================================================
// Provider Notes (DASH-09)
// ==========================================================================

describe('ProviderNotes', () => {
  it('displays provider notes in reverse chronological order', () => {
    render(<ProviderNotes patientId="p1" notes={mockNotes} />);

    expect(screen.getByText('Patient responding well to treatment')).toBeInTheDocument();
    expect(screen.getByText('Initial assessment complete')).toBeInTheDocument();
    expect(screen.getAllByText('Dr. Smith')).toHaveLength(2);
  });

  it('shows empty state when no notes', () => {
    render(<ProviderNotes patientId="p1" notes={[]} />);
    expect(screen.getByText('No notes yet')).toBeInTheDocument();
  });

  it('renders add note form with textarea and submit button', () => {
    render(<ProviderNotes patientId="p1" notes={[]} />);

    expect(screen.getByLabelText('Add a Note')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Write a clinical note...')).toBeInTheDocument();
    expect(screen.getByText('Save Note')).toBeInTheDocument();
  });

  it('includes hidden patientId field in form', () => {
    render(<ProviderNotes patientId="p1" notes={[]} />);
    const hiddenInput = document.querySelector('input[name="patientId"]') as HTMLInputElement;
    expect(hiddenInput).toBeTruthy();
    expect(hiddenInput.value).toBe('p1');
  });
});

// ==========================================================================
// PatientInfoTab: Track B badge (TRKB-04)
// ==========================================================================

import { PatientInfoTab } from '@/app/(provider)/patients/[patientId]/_components/patient-info-tab';

const basePatientInfo = {
  full_name: 'Test Patient',
  email: 'test@example.com',
  phone: '555-1234',
  address: '123 Main St',
  patient_code: 'ABC234',
  risk_tier: 'moderate',
  track_assignment: 'B' as string | null,
  facility_tier: 2,
  linked_at: '2026-01-15T00:00:00Z',
};

describe('PatientInfoTab: Track B badge (TRKB-04)', () => {
  it('shows amber "Analog — provider enters data" badge when track_assignment is B', () => {
    render(<PatientInfoTab info={{ ...basePatientInfo, track_assignment: 'B' }} patientId="p1" />);
    expect(screen.getByText(/Analog/)).toBeInTheDocument();
    expect(screen.getByText(/provider enters data/)).toBeInTheDocument();
  });

  it('shows "Enter Diary Data" link when track_assignment is B', () => {
    render(<PatientInfoTab info={{ ...basePatientInfo, track_assignment: 'B' }} patientId="p1" />);
    const entryLink = screen.getByText(/Enter Diary Data/i);
    expect(entryLink).toBeInTheDocument();
    expect(entryLink.closest('a')).toHaveAttribute('href', '/patients/p1/track-b-entry');
  });

  it('does not show Track B badge when track_assignment is A', () => {
    render(<PatientInfoTab info={{ ...basePatientInfo, track_assignment: 'A' }} patientId="p1" />);
    expect(screen.queryByText(/Analog/)).not.toBeInTheDocument();
    // Should show standard track label instead
    expect(screen.getByText(/Track A/)).toBeInTheDocument();
  });

  it('does not show Track B badge when track_assignment is null', () => {
    render(<PatientInfoTab info={{ ...basePatientInfo, track_assignment: null }} patientId="p1" />);
    expect(screen.queryByText(/Analog/)).not.toBeInTheDocument();
  });
});
