'use client';

import { useState } from 'react';
import { OwnershipSelector } from '@/components/ownership-selector';

type Props = { patientId: string; scopeKey: string; organizations: { id: string; name: string }[] };
export function AccountabilityPanel(props: Props) {
  return <PanelState key={`${props.scopeKey}:${props.patientId}`} {...props} />;
}
function PanelState({ patientId, organizations, scopeKey }: Props) {
  const [organization, setOrganization] = useState(organizations[0]?.id ?? '');
  if (!organizations.length) return null;
  return <section className="rounded-2xl border bg-white p-5" aria-labelledby="accountability-heading" data-testid="accountability-panel">
    <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Team management</p>
    <h2 id="accountability-heading" className="text-lg font-bold text-slate-950">Accountable provider for this patient</h2>
    <p className="mt-1 text-sm text-slate-600">Designation applies to future work in the selected organization. Existing work stays with its current owner until a separately reviewed transfer is accepted or an authorized reassignment is recorded.</p>
    <label className="mt-3 block text-sm font-medium">Designation organization
      <select value={organization} onChange={(event) => setOrganization(event.target.value)} className="mt-1 min-h-11 w-full rounded-md border bg-white px-3">
        {organizations.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}
      </select>
    </label>
    <OwnershipSelector scopeKey={scopeKey} kind="designation" organizationId={organization} patientId={patientId} />
  </section>;
}
