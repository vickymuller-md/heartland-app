'use client';

import { useState, useTransition } from 'react';
import { Pencil } from 'lucide-react';
import { CKM_STAGE_LABELS } from '@/lib/ckm/constants';
import { updateCkmStage } from '@/lib/actions/ckm-actions';

interface CkmBadgeProps {
  stage: number | null;
  patientId: string;
  onUpdate?: () => void;
}

/**
 * CKM Syndrome Stage badge with inline edit capability.
 *
 * Displays the current CKM stage (0-4) with color-coded label.
 * Pencil icon opens inline select for stage change via Server Action.
 */
export function CkmBadge({ stage, patientId, onUpdate }: CkmBadgeProps) {
  const [editing, setEditing] = useState(false);
  const [isPending, startTransition] = useTransition();

  if (stage === null || stage === undefined) {
    return <p className="text-sm text-gray-900 mt-0.5">—</p>;
  }

  const stageInfo = CKM_STAGE_LABELS[stage];
  if (!stageInfo) {
    return <p className="text-sm text-gray-900 mt-0.5">—</p>;
  }

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newStage = Number(e.target.value);
    startTransition(async () => {
      await updateCkmStage(patientId, newStage);
      setEditing(false);
      onUpdate?.();
    });
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2 mt-1">
        <select
          className="rounded-md border border-gray-300 px-2 py-1 text-xs"
          defaultValue={stage}
          onChange={handleChange}
          disabled={isPending}
          aria-label="Select CKM Stage"
        >
          {Object.entries(CKM_STAGE_LABELS).map(([key, val]) => (
            <option key={key} value={key}>
              {val.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="text-xs text-gray-500 hover:text-gray-700"
          onClick={() => setEditing(false)}
          disabled={isPending}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 mt-1">
      <span
        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${stageInfo.color}`}
      >
        {stageInfo.label}
      </span>
      <button
        type="button"
        className="text-gray-400 hover:text-gray-600"
        onClick={() => setEditing(true)}
        aria-label="Edit CKM Stage"
      >
        <Pencil className="h-3 w-3" />
      </button>
    </span>
  );
}
