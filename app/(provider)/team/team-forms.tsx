'use client';

import { useActionState } from 'react';
import { completeAccessReview, updateOrganizationSettings } from '@/lib/team/actions';
import type { OrganizationSettings } from '@/lib/team/types';
import { Button } from '@/components/ui/button';

const initialState: { success?: boolean; error?: string } = {};

export function OrganizationSettingsForm({ organization }: { organization: OrganizationSettings }) {
  const [state, action, pending] = useActionState(updateOrganizationSettings, initialState);
  return (
    <form action={action} className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-2">
      <input type="hidden" name="organizationId" value={organization.id} />
      <label className="text-sm font-medium text-slate-800">
        Organization name
        <input name="name" defaultValue={organization.name} required minLength={3} maxLength={160} className="mt-1 min-h-10 w-full rounded-md border px-3" />
      </label>
      <label className="text-sm font-medium text-slate-800">
        Timezone
        <input name="timezone" defaultValue={organization.timezone} required minLength={3} maxLength={80} className="mt-1 min-h-10 w-full rounded-md border px-3" />
      </label>
      <label className="text-sm font-medium text-slate-800">
        Alert-response target · minutes
        <input name="alertSlaMinutes" type="number" min={5} max={1440} defaultValue={organization.alert_sla_minutes} required className="mt-1 min-h-10 w-full rounded-md border px-3" />
      </label>
      <label className="text-sm font-medium text-slate-800">
        Downtime contact or instruction
        <input name="downtimeContact" defaultValue={organization.downtime_contact ?? ''} maxLength={160} className="mt-1 min-h-10 w-full rounded-md border px-3" />
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save operating settings'}</Button>
        {state.success && <span className="text-sm text-emerald-700">Saved.</span>}
        {state.error && <span role="alert" className="text-sm text-red-700">{state.error}</span>}
      </div>
    </form>
  );
}

export function AccessReviewForm({ organizationId }: { organizationId: string }) {
  const [state, action, pending] = useActionState(completeAccessReview, initialState);
  return (
    <form action={action} className="space-y-3 rounded-xl border bg-white p-4">
      <input type="hidden" name="organizationId" value={organizationId} />
      <label className="block text-sm font-medium text-slate-800">
        Review findings and disposition
        <textarea
          name="findings"
          required
          minLength={3}
          maxLength={1000}
          rows={3}
          placeholder="Confirm active members and patient assignments; record removals or state no exceptions found."
          className="mt-1 w-full rounded-md border px-3 py-2"
        />
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>{pending ? 'Recording…' : 'Attest monthly access review'}</Button>
        {state.success && <span className="text-sm text-emerald-700">Review recorded.</span>}
        {state.error && <span role="alert" className="text-sm text-red-700">{state.error}</span>}
      </div>
    </form>
  );
}
