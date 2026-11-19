import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { addMedicationSchema } from '@/lib/medications/schema';
import { MedicationForm } from '@/app/(patient)/medications/_components/medication-form';
import { MedicationList } from '@/app/(patient)/medications/_components/medication-list';
import { addMedication, deactivateMedication, updateMedication } from '@/lib/medications/actions';
import type { MedicationRow } from '@/lib/medications/types';

vi.mock('@/lib/medications/actions', () => ({ addMedication: vi.fn(), updateMedication: vi.fn(), deactivateMedication: vi.fn() }));

describe('Medication CRUD (MEDS-01)', () => {
  describe('Zod Schema Validation', () => {
    it('accepts valid medication: name, dosage, frequency, timing', () => {
      const result = addMedicationSchema.safeParse({
        name: 'Carvedilol',
        dosage: '25 mg',
        frequency: 'twice_daily',
        timing: ['morning', 'evening'],
      });
      expect(result.success).toBe(true);
    });

    it('rejects empty medication name', () => {
      const result = addMedicationSchema.safeParse({
        name: '',
        dosage: '25 mg',
        frequency: 'twice_daily',
        timing: ['morning'],
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty dosage', () => {
      const result = addMedicationSchema.safeParse({
        name: 'Carvedilol',
        dosage: '',
        frequency: 'twice_daily',
        timing: ['morning'],
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid frequency value', () => {
      const result = addMedicationSchema.safeParse({
        name: 'Carvedilol',
        dosage: '25 mg',
        frequency: 'every_other_day',
        timing: ['morning'],
      });
      expect(result.success).toBe(false);
    });

    it('accepts an unconfirmed time without inventing one', () => {
      const result = addMedicationSchema.safeParse({
        name: 'Carvedilol',
        dosage: '25 mg',
        frequency: 'twice_daily',
        timing: [],
      });
      expect(result.success).toBe(true);
    });

    it('accepts all valid frequency values: once_daily, twice_daily, three_times_daily, four_times_daily, as_needed, weekly', () => {
      const frequencies = [
        'once_daily',
        'twice_daily',
        'three_times_daily',
        'four_times_daily',
        'as_needed',
        'weekly',
      ] as const;
      for (const frequency of frequencies) {
        const result = addMedicationSchema.safeParse({
          name: 'Test Med',
          dosage: '10 mg',
          frequency,
          weekly_day: frequency === 'weekly' ? 1 : null,
          timing: ['morning'],
        });
        expect(result.success, `frequency "${frequency}" should be valid`).toBe(true);
      }
    });
  });

  describe('Medication List', () => {
    const actor = '80000000-0000-4000-8000-000000000001';
    const item: MedicationRow = { id: '80000000-0000-4000-8000-000000000002', patient_id: actor, name: 'Synthetic item',
      dosage: 'Recorded strength', frequency: 'weekly', weekly_day: 1, timing: ['At the time on the plan, including weekends'],
      active: true, created_at: '2026-11-15T00:00:00Z', schedule_revision: '80000000-0000-4000-8000-000000000003' };
    beforeEach(() => vi.clearAllMocks());

    it('edits the recorded weekday while preserving written timing and the source revision', async () => {
      const user = userEvent.setup();
      vi.mocked(updateMedication).mockResolvedValue({ success: true });
      render(<MedicationList medications={[item]} actorId={actor} />);
      expect(screen.getByText(/Weekly · Monday/)).toBeVisible();
      await user.click(screen.getByRole('button', { name: 'Edit Synthetic item' }));
      const dialog = within(await screen.findByRole('dialog'));
      expect(dialog.getByLabelText('Confirmed weekday')).toHaveValue('1');
      expect(dialog.getByLabelText('Other timing instructions as recorded')).toHaveValue(item.timing[0]);
      await user.selectOptions(dialog.getByLabelText('Confirmed weekday'), '2');
      await user.click(dialog.getByRole('button', { name: 'Save Changes' }));
      await waitFor(() => expect(updateMedication).toHaveBeenCalledOnce());
      const data = vi.mocked(updateMedication).mock.calls[0][1];
      expect([data.get('id'), data.get('actor_id'), data.get('revision'), data.get('weekly_day')]).toEqual([item.id, actor, item.schedule_revision, '2']);
    });

    it('requires a chosen weekday and keeps the operation identity through a lost acknowledgement', async () => {
      const user = userEvent.setup();
      vi.mocked(addMedication).mockRejectedValueOnce(new Error('interrupted')).mockResolvedValueOnce({ success: true });
      render(<MedicationForm mode="add" actorId={actor} />);
      await user.type(screen.getByLabelText('Medication Name'), 'Synthetic weekly item');
      await user.type(screen.getByLabelText('Dosage'), 'Recorded dose');
      await user.selectOptions(screen.getByLabelText('Frequency', { exact: true }), 'weekly');
      await user.click(screen.getByRole('button', { name: 'Add Medication' }));
      expect(addMedication).not.toHaveBeenCalled();
      await user.selectOptions(screen.getByLabelText('Confirmed weekday'), '0');
      await user.click(screen.getByRole('button', { name: 'Add Medication' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Saving was not confirmed');
      await user.click(screen.getByRole('button', { name: 'Add Medication' }));
      await waitFor(() => expect(addMedication).toHaveBeenCalledTimes(2));
      const submissions = vi.mocked(addMedication).mock.calls.map(([, form]) => form);
      expect(submissions[1].get('request_id')).toBe(submissions[0].get('request_id'));
      expect(submissions[1].get('weekly_day')).toBe('0');
    });

    it('retains a failed removal for retry with the same medication and revision', async () => {
      const user = userEvent.setup();
      vi.mocked(deactivateMedication).mockResolvedValueOnce({ error: 'Removal was not confirmed.' }).mockResolvedValueOnce({ success: true });
      render(<MedicationList medications={[item]} actorId={actor} />);
      await user.click(screen.getByRole('button', { name: 'Remove Synthetic item' }));
      const dialog = within(await screen.findByRole('dialog'));
      await user.click(dialog.getByRole('button', { name: 'Remove', exact: true }));
      expect(await dialog.findByRole('alert')).toHaveTextContent('Removal was not confirmed.');
      await user.click(await dialog.findByRole('button', { name: 'Remove', exact: true }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(vi.mocked(deactivateMedication).mock.calls).toEqual([[item.id, actor, item.schedule_revision], [item.id, actor, item.schedule_revision]]);
    });
  });
});
