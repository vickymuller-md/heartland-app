/**
 * Combined Vitals + Symptoms Entry Form Tests
 * Requirements: VITL-01 (weight), VITL-02 (BP/HR), VITL-03 (SpO2), VITL-04 (symptoms), VITL-08 (elderly UX)
 * SAFE-01: Offline red flag evaluation
 */

import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSubmitVitals, mockUseIsOnline } = vi.hoisted(() => ({
  mockSubmitVitals: vi.fn(),
  mockUseIsOnline: vi.fn<() => boolean>(),
}));

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Mock the server action
vi.mock('@/lib/vitals/actions', () => ({
  submitVitals: mockSubmitVitals,
}));

// Mock useIsOnline
vi.mock('@/lib/offline/hooks', () => ({
  useIsOnline: () => mockUseIsOnline(),
}));

beforeEach(() => {
  localStorageMock.clear();
  mockUseIsOnline.mockReturnValue(true);
  mockSubmitVitals.mockReset().mockResolvedValue({ success: true, redFlags: [] });
});

import { VitalsEntryForm } from '@/app/(patient)/today/_components/vitals-form';

describe('VitalsEntryForm', () => {
  describe('vitals fields', () => {
    it('renders weight input with unit toggle (lbs/kg)', () => {
      render(<VitalsEntryForm />);

      const weightInput = screen.getByLabelText(/weight/i);
      expect(weightInput).toBeInTheDocument();
      expect(weightInput.getAttribute('type')).toBe('number');

      // Unit toggle buttons
      expect(screen.getByText('lbs')).toBeInTheDocument();
      expect(screen.getByText('kg')).toBeInTheDocument();
    });

    it('renders systolic BP, diastolic BP, and heart rate number inputs', () => {
      render(<VitalsEntryForm />);

      const sbpInput = screen.getByLabelText(/systolic/i);
      expect(sbpInput).toBeInTheDocument();
      expect(sbpInput.getAttribute('type')).toBe('number');

      const dbpInput = screen.getByLabelText(/diastolic/i);
      expect(dbpInput).toBeInTheDocument();
      expect(dbpInput.getAttribute('type')).toBe('number');

      const hrInput = screen.getByLabelText(/heart rate/i);
      expect(hrInput).toBeInTheDocument();
      expect(hrInput.getAttribute('type')).toBe('number');
    });

    it('renders SpO2 input marked as optional', () => {
      render(<VitalsEntryForm />);

      const spo2Label = screen.getByText(/spo2/i).closest('label');
      expect(spo2Label).toBeInTheDocument();
      expect(spo2Label?.textContent).toMatch(/optional/i);
    });

    it('all number inputs have min-h-[48px] and text-lg (VITL-08)', () => {
      render(<VitalsEntryForm />);

      const numberInputs = screen.getAllByRole('spinbutton');
      numberInputs.forEach((input) => {
        expect(input.className).toContain('min-h-[48px]');
        expect(input.className).toContain('text-lg');
      });
    });

    it('all labels are visible (not placeholder-only) with text-lg font', () => {
      render(<VitalsEntryForm />);

      // Check that visible labels exist for all vitals fields
      const labels = [
        /weight/i,
        /systolic/i,
        /diastolic/i,
        /heart rate/i,
        /spo2/i,
      ];

      labels.forEach((labelPattern) => {
        const label = screen.getByText((_content, element) => {
          return (
            element?.tagName === 'LABEL' &&
            labelPattern.test(element.textContent ?? '')
          );
        });
        expect(label).toBeInTheDocument();
        expect(label.className).toContain('text-lg');
        expect(label.className).toContain('font-semibold');
      });
    });
  });

  describe('symptom checklist', () => {
    it('renders 4 symptom items: dyspnea, edema, orthopnea, fatigue', () => {
      render(<VitalsEntryForm />);

      expect(screen.getByText(/shortness of breath/i)).toBeInTheDocument();
      expect(screen.getByText(/swelling/i)).toBeInTheDocument();
      expect(screen.getByText(/trouble breathing lying down/i)).toBeInTheDocument();
      expect(screen.getByText(/tiredness/i)).toBeInTheDocument();
    });

    it('dyspnea, edema, fatigue each have 4 severity options: none/mild/moderate/severe', () => {
      render(<VitalsEntryForm />);

      // Each severity symptom should have 4 radio options
      const radioGroups = screen.getAllByRole('radiogroup');
      // 3 severity groups + 1 boolean group = at least 4
      expect(radioGroups.length).toBeGreaterThanOrEqual(4);

      // Check severity labels appear (3 symptoms x 4 levels = 12 occurrences of None/Mild/Moderate/Severe)
      const noneRadios = screen.getAllByText('None');
      expect(noneRadios.length).toBeGreaterThanOrEqual(3);
    });

    it('orthopnea is a yes/no toggle (boolean)', () => {
      render(<VitalsEntryForm />);

      // Find the orthopnea section
      const orthopneaLabel = screen.getByText(/trouble breathing lying down/i);
      const section = orthopneaLabel.closest('div');
      expect(section).toBeTruthy();

      // Should have Yes and No radio options
      const yesOption = within(section!).getByText('Yes');
      const noOption = within(section!).getByText('No');
      expect(yesOption).toBeInTheDocument();
      expect(noOption).toBeInTheDocument();
    });

    it('severity options show descriptive labels', () => {
      render(<VitalsEntryForm />);

      // Descriptions from SYMPTOM_SEVERITY constant
      expect(screen.getAllByText(/noticeable but not limiting/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/limits some daily activities/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/significantly limits daily activities/i).length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('submission', () => {
    it('submit button is full-width with min-h-[48px] and text-lg', () => {
      render(<VitalsEntryForm />);

      const submitButton = screen.getByRole('button', {
        name: /submit daily check-in/i,
      });
      expect(submitButton).toBeInTheDocument();
      expect(submitButton.className).toContain('w-full');
      expect(submitButton.className).toContain('min-h-[48px]');
      expect(submitButton.className).toContain('text-lg');
    });
  });

  describe('elderly UX (VITL-08)', () => {
    it('form uses single-column layout (no side-by-side fields on mobile)', () => {
      render(<VitalsEntryForm />);

      // The form should use space-y layout (single-column stacking)
      const form = screen.getByRole('button', { name: /submit/i }).closest(
        'form'
      );
      expect(form?.className).toContain('space-y');
    });

    it("sections are visually grouped with clear headers: 'Vitals' and 'How Are You Feeling?'", () => {
      render(<VitalsEntryForm />);

      expect(screen.getByText('Vitals')).toBeInTheDocument();
      expect(screen.getByText('How Are You Feeling?')).toBeInTheDocument();
    });
  });

  describe('secure server submission', () => {
    async function fillAndSubmitForm(user: ReturnType<typeof userEvent.setup>, overrides?: { sbp?: string; spo2?: string }) {
      // Fill required fields
      await user.type(screen.getByLabelText(/weight/i), '165');
      await user.type(screen.getByLabelText(/systolic/i), overrides?.sbp ?? '120');
      await user.type(screen.getByLabelText(/diastolic/i), '80');
      await user.type(screen.getByLabelText(/heart rate/i), '72');
      if (overrides?.spo2) {
        await user.type(screen.getByLabelText(/spo2/i), overrides.spo2);
      }

      // Click submit
      await user.click(screen.getByRole('button', { name: /submit daily check-in/i }));
    }

    it('submits through the authenticated Server Action', async () => {
      const user = userEvent.setup();
      render(<VitalsEntryForm />);

      await fillAndSubmitForm(user);

      await waitFor(() => {
        expect(mockSubmitVitals).toHaveBeenCalledWith(null, expect.any(FormData));
      });
    });

    it('renders RedFlagAlert when the server returns critical flags', async () => {
      mockSubmitVitals.mockResolvedValue({
        success: true,
        redFlags: [
          { id: 'sbp_low_symptomatic', severity: 'critical', message: 'Low blood pressure with symptoms', action: 'Hold medications' },
        ],
      });

      const user = userEvent.setup();
      render(<VitalsEntryForm />);

      await fillAndSubmitForm(user, { sbp: '70' });

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByText(/low blood pressure/i)).toBeInTheDocument();
      });
    });

    it('shows success only after the server confirms persistence', async () => {
      const user = userEvent.setup();
      render(<VitalsEntryForm />);

      await fillAndSubmitForm(user);

      await waitFor(() => {
        expect(screen.getByText(/check-in complete/i)).toBeInTheDocument();
      });
      // No alert should render
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('refuses offline submission and does not claim the data was saved', async () => {
      mockUseIsOnline.mockReturnValue(false);
      const user = userEvent.setup();
      render(<VitalsEntryForm />);

      await fillAndSubmitForm(user);

      expect(await screen.findByText(/clinical data has not been saved/i)).toBeInTheDocument();
      expect(mockSubmitVitals).not.toHaveBeenCalled();
      expect(screen.queryByText(/check-in complete/i)).toBeNull();
    });
  });
});
