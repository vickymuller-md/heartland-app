'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { findUsRegion, US_REGIONS } from '@/lib/us-regions';
import { updateProfileState } from '../actions';

const choices = [...US_REGIONS].sort((a, b) => a.name.localeCompare(b.name));

export function StateField({ defaultValue }: { defaultValue?: string }) {
  const [selected, setSelected] = useState(findUsRegion(defaultValue)?.code ?? '');
  const [isPending, startTransition] = useTransition();

  function handleChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const code = event.target.value;
    const previous = selected;
    setSelected(code);
    startTransition(async () => {
      try {
        const result = await updateProfileState(code);
        if (!result.success) throw new Error('Unable to save state or territory');
        toast.success('Saved');
      } catch {
        setSelected(previous);
        toast.error('State or territory could not be saved. Try again.');
      }
    });
  }

  return (
    <select
      id="state"
      name="state"
      value={selected}
      onChange={handleChange}
      disabled={isPending}
      aria-busy={isPending}
      className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
    >
      <option value="">Select your state or territory</option>
      {choices.map(({ code, name }) => <option key={code} value={code}>{name}</option>)}
    </select>
  );
}
