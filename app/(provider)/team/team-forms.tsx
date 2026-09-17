'use client';

import { useActionState, useState, useTransition } from 'react';
import {
  completeAccessReview,
  grantMemberCapability,
  revokeMemberCapability,
  updateOrganizationSettings,
} from '@/lib/team/actions';
import {
  EVIDENCE_REQUIRED_CAPABILITIES,
  MEMBER_CAPABILITIES,
  MEMBER_CAPABILITY_LABELS,
} from '@/lib/team/types';
import type { MemberCapability, MemberCapabilityRow, OrganizationSettings } from '@/lib/team/types';
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

/**
 * Member capabilities (migration 00040). The chips come from
 * `member_authorizations`, which carries no credential strings; the evidence a
 * manager types is written to the manager-only evidence table by the RPC.
 */
export function MemberCapabilitiesRow({ member }: { member: MemberCapabilityRow }) {
  const [capability, setCapability] = useState<MemberCapability>('educate');
  const [evidence, setEvidence] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const evidenceRequired = EVIDENCE_REQUIRED_CAPABILITIES.includes(capability);

  const run = (task: () => Promise<{ success?: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await task();
      if (!result.success) setError(result.error ?? 'This authorization could not be changed.');
      else setEvidence('');
    });
  };

  return (
    <article className="rounded-xl border bg-white p-4" data-testid={`capabilities-${member.membership_id}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold text-slate-900">{member.member_name}</p>
        <p className="text-xs uppercase tracking-wide text-slate-500">
          {member.member_role} · {member.organization_name}
        </p>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {member.authorizations.length === 0 ? (
          <span className="text-sm text-slate-600">No active authorizations.</span>
        ) : (
          member.authorizations.map((authorization) => (
            <span
              key={authorization.id}
              className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-900"
            >
              {MEMBER_CAPABILITY_LABELS[authorization.capability]}
              {authorization.grant_source === 'bootstrap_00040' && (
                <span className="text-blue-700">· role-derived, review</span>
              )}
              {member.can_manage && (
                <button
                  type="button"
                  className="rounded-full px-1 text-blue-900 underline disabled:opacity-50"
                  disabled={pending}
                  onClick={() => run(() => revokeMemberCapability({ authorizationId: authorization.id }))}
                >
                  Revoke
                </button>
              )}
            </span>
          ))
        )}
      </div>

      {member.can_manage && (
        <form
          className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            run(() =>
              grantMemberCapability({
                membershipId: member.membership_id,
                capability,
                evidenceRef: evidence.trim() || undefined,
              }),
            );
          }}
        >
          <label className="text-sm font-medium text-slate-800">
            Capability
            <select
              name="capability"
              value={capability}
              onChange={(event) => setCapability(event.target.value as MemberCapability)}
              className="mt-1 min-h-11 w-full rounded-md border bg-white px-3 sm:w-56"
            >
              {MEMBER_CAPABILITIES.map((value) => (
                <option key={value} value={value}>
                  {MEMBER_CAPABILITY_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex-1 text-sm font-medium text-slate-800">
            Credential evidence{evidenceRequired ? '' : ' (optional)'}
            <input
              name="evidenceRef"
              value={evidence}
              required={evidenceRequired}
              minLength={3}
              maxLength={500}
              onChange={(event) => setEvidence(event.target.value)}
              placeholder="Licence or credential reference on file"
              className="mt-1 min-h-11 w-full rounded-md border px-3"
            />
          </label>
          <Button type="submit" className="min-h-11" disabled={pending}>
            {pending ? 'Saving…' : 'Grant'}
          </Button>
        </form>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </article>
  );
}
