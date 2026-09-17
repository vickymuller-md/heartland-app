'use client';

import { useState, useTransition } from 'react';
import { UserRoundCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { designatePatientAccountable } from '@/lib/daily-loop/actions';
import type { TeamMember } from '@/lib/team/types';

/**
 * Team-manager control: names the single provider accountable for this patient.
 * Only members of organizations this user manages are offered.
 */
export function AccountabilityPanel({
  patientId,
  members,
}: {
  patientId: string;
  members: TeamMember[];
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (members.length === 0) return null;

  const showOrganization = new Set(members.map((member) => member.organization_id)).size > 1;

  const save = (value: string) => {
    const [organizationId, accountableId] = value.split(':');
    if (!organizationId || !accountableId) {
      setError('Choose a provider.');
      return;
    }
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await designatePatientAccountable({
        organizationId,
        patientId,
        accountableId,
      });
      if (!result.success) setError(result.error ?? 'The accountable provider could not be designated.');
      else setMessage('Accountable provider saved.');
    });
  };

  return (
    <section
      className="rounded-2xl border bg-white p-5"
      aria-labelledby="accountability-heading"
      data-testid="accountability-panel"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Team management</p>
      <h2 id="accountability-heading" className="text-lg font-bold text-slate-950">
        Accountable provider for this patient
      </h2>
      <p className="mt-1 text-sm text-slate-600">
        New work for this patient is assigned to this provider. Work already open stays with its
        current provider until a transfer is accepted.
      </p>
      <form
        className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          save(String(new FormData(event.currentTarget).get('accountable') ?? ''));
        }}
      >
        <label className="flex-1 text-sm font-medium text-slate-800">
          Accountable provider
          <select
            name="accountable"
            required
            defaultValue=""
            className="mt-1 min-h-11 w-full rounded-md border bg-white px-3"
          >
            <option value="" disabled>Choose a provider</option>
            {members.map((member) => (
              <option
                key={`${member.organization_id}:${member.member_id}`}
                value={`${member.organization_id}:${member.member_id}`}
              >
                {showOrganization ? `${member.member_name} — ${member.organization_name}` : member.member_name}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" className="min-h-11" disabled={pending}>
          <UserRoundCheck className="mr-2 size-4" /> {pending ? 'Saving…' : 'Save'}
        </Button>
      </form>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
      {message && <p role="status" className="mt-2 text-sm text-emerald-700">{message}</p>}
    </section>
  );
}
