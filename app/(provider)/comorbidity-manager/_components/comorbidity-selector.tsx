'use client';

import { useState, useCallback } from 'react';
import { COMORBIDITY_DATA } from '@/lib/comorbidity/constants';
import type { ComorbidityKey } from '@/lib/comorbidity/types';

interface ComorbiditySelectorProps {
  initialSelected: ComorbidityKey[];
  onSelectionChange: (keys: ComorbidityKey[]) => void;
}

export function ComorbiditySelector({
  initialSelected,
  onSelectionChange,
}: ComorbiditySelectorProps) {
  const [selected, setSelected] = useState<Set<ComorbidityKey>>(
    () => new Set(initialSelected),
  );

  const toggle = useCallback(
    (key: ComorbidityKey) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
        onSelectionChange(Array.from(next));
        return next;
      });
    },
    [onSelectionChange],
  );

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {COMORBIDITY_DATA.map((c) => {
        const isSelected = selected.has(c.key);
        return (
          <button
            key={c.key}
            type="button"
            aria-pressed={isSelected}
            onClick={() => toggle(c.key)}
            className={`min-h-[48px] rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
              isSelected
                ? 'border-blue-500 bg-blue-50 text-blue-800'
                : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50'
            }`}
          >
            {c.label}
          </button>
        );
      })}
    </div>
  );
}
