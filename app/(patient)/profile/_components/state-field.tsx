'use client';

/**
 * StateField -- US State Dropdown for Patient Profile
 * Requirements: REPT-07 (geographic state capture for NIW traction map)
 * Source: HEARTLAND Protocol v3.3 -- Phase 28 Reporting & NIW Evidence
 *
 * Full state names match us-atlas TopoJSON properties.name for choropleth mapping.
 */

import { useTransition } from 'react';
import { toast } from 'sonner';
import { updateProfileState } from '../actions';

const US_STATES = [
  'Alabama',
  'Alaska',
  'Arizona',
  'Arkansas',
  'California',
  'Colorado',
  'Connecticut',
  'Delaware',
  'District of Columbia',
  'Florida',
  'Georgia',
  'Hawaii',
  'Idaho',
  'Illinois',
  'Indiana',
  'Iowa',
  'Kansas',
  'Kentucky',
  'Louisiana',
  'Maine',
  'Maryland',
  'Massachusetts',
  'Michigan',
  'Minnesota',
  'Mississippi',
  'Missouri',
  'Montana',
  'Nebraska',
  'Nevada',
  'New Hampshire',
  'New Jersey',
  'New Mexico',
  'New York',
  'North Carolina',
  'North Dakota',
  'Ohio',
  'Oklahoma',
  'Oregon',
  'Pennsylvania',
  'Rhode Island',
  'South Carolina',
  'South Dakota',
  'Tennessee',
  'Texas',
  'Utah',
  'Vermont',
  'Virginia',
  'Washington',
  'West Virginia',
  'Wisconsin',
  'Wyoming',
] as const;

interface StateFieldProps {
  defaultValue?: string;
}

export function StateField({ defaultValue }: StateFieldProps) {
  const [isPending, startTransition] = useTransition();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const state = e.target.value;
    startTransition(async () => {
      const result = await updateProfileState(state);
      if (result?.error) {
        toast.error(result.error);
      } else {
        toast.success('Saved');
      }
    });
  }

  return (
    <select
      name="state"
      defaultValue={defaultValue ?? ''}
      onChange={handleChange}
      disabled={isPending}
      className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
    >
      <option value="">Select your state</option>
      {US_STATES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}
