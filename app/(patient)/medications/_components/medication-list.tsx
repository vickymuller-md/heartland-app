'use client';

/**
 * HEARTLAND Medication List -- CRUD management
 *
 * Renders medication cards with edit/deactivate actions.
 * Add/Edit opens a dialog with MedicationForm.
 * Deactivate shows confirmation before soft-deleting.
 *
 * Elderly-friendly: 48px tap targets, clear typography.
 */

import { useState, useTransition } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { FREQUENCY_OPTIONS } from '@/lib/medications/constants';
import { deactivateMedication } from '@/lib/medications/actions';
import type { MedicationRow } from '@/lib/medications/types';
import { MedicationForm } from './medication-form';

function getFrequencyLabel(freq: string): string {
  return FREQUENCY_OPTIONS.find((o) => o.value === freq)?.label ?? freq;
}

export function MedicationList({
  medications,
}: {
  medications: MedicationRow[];
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [editMed, setEditMed] = useState<MedicationRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<MedicationRow | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDeactivate(med: MedicationRow) {
    startTransition(async () => {
      await deactivateMedication(med.id);
      setConfirmDelete(null);
    });
  }

  return (
    <div className="space-y-3">
      {/* Add Medication button */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogTrigger
          className="w-full min-h-[48px] bg-blue-600 text-white rounded-lg text-lg font-semibold flex items-center justify-center gap-2 hover:bg-blue-700 transition-colors"
        >
          <Plus className="h-5 w-5" />
          Add Medication
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Medication</DialogTitle>
          </DialogHeader>
          <MedicationForm mode="add" onSuccess={() => setAddOpen(false)} />
        </DialogContent>
      </Dialog>

      {/* Medication cards */}
      {medications.map((med) => (
        <div
          key={med.id}
          className="p-4 bg-white border border-gray-200 rounded-lg space-y-2"
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-lg font-semibold text-gray-900">{med.name}</p>
              <p className="text-base text-gray-600">{med.dosage}</p>
              <p className="text-sm text-gray-500">
                {getFrequencyLabel(med.frequency)}
              </p>
            </div>
            <div className="flex gap-2">
              {/* Edit button */}
              <button
                type="button"
                onClick={() => setEditMed(med)}
                className="min-h-[48px] min-w-[48px] flex items-center justify-center rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50"
                aria-label={`Edit ${med.name}`}
              >
                <Pencil className="h-5 w-5" />
              </button>
              {/* Delete button */}
              <button
                type="button"
                onClick={() => setConfirmDelete(med)}
                className="min-h-[48px] min-w-[48px] flex items-center justify-center rounded-lg border border-red-200 text-red-600 hover:bg-red-50"
                aria-label={`Remove ${med.name}`}
              >
                <Trash2 className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Timing tags */}
          {med.timing && med.timing.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {med.timing.map((t) => (
                <span
                  key={t}
                  className="px-2 py-0.5 text-xs bg-blue-50 text-blue-700 rounded-full"
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}

      {/* Edit dialog */}
      <Dialog open={!!editMed} onOpenChange={(open) => !open && setEditMed(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Medication</DialogTitle>
          </DialogHeader>
          {editMed && (
            <MedicationForm
              mode="edit"
              medication={editMed}
              onSuccess={() => setEditMed(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog
        open={!!confirmDelete}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Medication</DialogTitle>
          </DialogHeader>
          <p className="text-base text-gray-700">
            Remove <strong>{confirmDelete?.name}</strong> from your list? You
            can add it back later if needed.
          </p>
          <div className="flex gap-3 mt-4">
            <button
              type="button"
              onClick={() => setConfirmDelete(null)}
              className="flex-1 min-h-[48px] border border-gray-300 rounded-lg text-base font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => confirmDelete && handleDeactivate(confirmDelete)}
              disabled={isPending}
              className="flex-1 min-h-[48px] bg-red-600 text-white rounded-lg text-base font-semibold hover:bg-red-700 disabled:opacity-50"
            >
              {isPending ? 'Removing...' : 'Remove'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
