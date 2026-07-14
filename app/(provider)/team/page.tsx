import Link from 'next/link';
import { formatDistanceToNow } from 'date-fns';
import { redirect } from 'next/navigation';
import { authorize } from '@/lib/auth/authorization';
import { CLINICAL_RULE_REGISTRY, unapprovedClinicalRuleSets } from '@/lib/clinical-governance/rule-registry';
import { getTeamOperations } from '@/lib/team/queries';
import { AccessReviewForm, OrganizationSettingsForm } from './team-forms';

export default async function TeamOperationsPage() {
  const auth = await authorize('provider');
  if (!auth.authorized) redirect(auth.error === 'MFA required' ? '/security/mfa' : '/login');
  const operations = await getTeamOperations(auth.supabase);

  return (
    <div className="space-y-7">
      <div>
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-700">Governed operations</p>
        <h1 className="text-3xl font-bold tracking-tight text-slate-950">Team &amp; access</h1>
        <p className="mt-1 text-sm text-slate-600">Membership, workload, delivery evidence, operating targets, and monthly access review.</p>
      </div>

      {operations.error ? (
        <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-medium text-red-900">{operations.error}</div>
      ) : (
        <>
          <section className="space-y-3" aria-labelledby="workload-title">
            <div>
              <h2 id="workload-title" className="text-xl font-bold text-slate-950">Team workload</h2>
              <p className="text-sm text-slate-600">Counts contain no patient identifiers. Managers can delegate work from Daily Loop.</p>
            </div>
            <div className="overflow-x-auto rounded-xl border bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                  <tr><th className="px-4 py-3">Member</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Open</th><th className="px-4 py-3">Overdue</th><th className="px-4 py-3">Today</th><th className="px-4 py-3">Critical</th><th className="px-4 py-3">Oldest due</th></tr>
                </thead>
                <tbody className="divide-y">
                  {operations.workloads.map((row) => (
                    <tr key={`${row.organization_id}-${row.member_id}`}>
                      <td className="px-4 py-3 font-medium text-slate-900">{row.member_name}</td>
                      <td className="px-4 py-3 text-slate-600">{row.member_role}</td>
                      <td className="px-4 py-3">{row.open_count}</td>
                      <td className="px-4 py-3 font-medium text-red-700">{row.overdue_count}</td>
                      <td className="px-4 py-3">{row.due_today_count}</td>
                      <td className="px-4 py-3 font-medium text-red-700">{row.critical_count}</td>
                      <td className="px-4 py-3 text-slate-600">{row.oldest_due_at ? formatDistanceToNow(new Date(row.oldest_due_at), { addSuffix: true }) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2" aria-labelledby="delivery-title">
            <div className="rounded-xl border bg-white p-4">
              <h2 id="delivery-title" className="text-lg font-bold text-slate-950">In-app delivery evidence</h2>
              <p className="mt-1 text-sm text-slate-600">“Available” proves server persistence only; it does not claim device delivery or patient review.</p>
              <div className="mt-4 space-y-3">
                {operations.deliveryHealth.map((row) => (
                  <dl key={row.organization_id} className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                    <div><dt className="text-slate-500">Available</dt><dd className="text-xl font-bold">{row.available_count}</dd></div>
                    <div><dt className="text-slate-500">Read</dt><dd className="text-xl font-bold text-emerald-700">{row.read_count}</dd></div>
                    <div><dt className="text-slate-500">Failed</dt><dd className="text-xl font-bold text-red-700">{row.failed_count}</dd></div>
                    <div><dt className="text-slate-500">Superseded</dt><dd className="text-xl font-bold text-slate-600">{row.superseded_count}</dd></div>
                  </dl>
                ))}
              </div>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <h2 className="text-lg font-bold text-amber-950">Downtime workflow</h2>
              <p className="mt-1 text-sm text-amber-900">Use the non-PHI checklist when the workspace or network is unavailable. Facility ownership and escalation targets must be approved locally.</p>
              <Link href="/downtime" className="mt-4 inline-flex min-h-10 items-center rounded-lg bg-amber-900 px-4 text-sm font-medium text-white">Open printable downtime playbook</Link>
            </div>
          </section>

          <section className="space-y-4" aria-labelledby="settings-title">
            <div>
              <h2 id="settings-title" className="text-xl font-bold text-slate-950">Operating settings</h2>
              <p className="text-sm text-slate-600">These targets guide workflow; they do not create a guaranteed clinical response service.</p>
            </div>
            {operations.organizations.map((organization) => operations.manageableOrganizationIds.includes(organization.id) ? (
              <OrganizationSettingsForm key={organization.id} organization={organization} />
            ) : (
              <div key={organization.id} className="rounded-xl border bg-white p-4 text-sm text-slate-700">{organization.name} · {organization.timezone} · {organization.alert_sla_minutes}-minute target</div>
            ))}
          </section>

          <section className="space-y-4" aria-labelledby="access-title">
            <div>
              <h2 id="access-title" className="text-xl font-bold text-slate-950">Access review</h2>
              <p className="text-sm text-slate-600">Membership provisioning remains administrator-controlled. Self-service membership grants are intentionally unavailable.</p>
            </div>
            {operations.organizations
              .filter((organization) => operations.manageableOrganizationIds.includes(organization.id))
              .map((organization) => (
                <AccessReviewForm key={organization.id} organizationId={organization.id} />
              ))}
            <div className="space-y-2">
              {operations.accessReviews.length === 0 ? (
                <p className="rounded-xl border border-dashed p-4 text-sm text-slate-600">No access review attestation recorded yet.</p>
              ) : operations.accessReviews.map((review) => (
                <article key={review.id} className="rounded-xl border bg-white p-4 text-sm">
                  <p className="font-semibold text-slate-900">{review.review_period} · completed {formatDistanceToNow(new Date(review.completed_at), { addSuffix: true })}</p>
                  <p className="mt-1 text-slate-600">{review.active_members_count} members · {review.active_patient_count} patient assignments · {review.open_work_items_count} open work items</p>
                  <p className="mt-2 text-slate-700">{review.findings}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="space-y-4" aria-labelledby="clinical-gate-title">
            <div>
              <h2 id="clinical-gate-title" className="text-xl font-bold text-slate-950">Clinical release gate</h2>
              <p className="text-sm text-slate-600">Versioned rule inventory. Deployment does not count as independent clinical approval.</p>
            </div>
            {unapprovedClinicalRuleSets.length > 0 && (
              <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-medium text-amber-950">
                {unapprovedClinicalRuleSets.length} of {CLINICAL_RULE_REGISTRY.length} high-risk rule sets await independent review. PHI pilot remains blocked.
              </div>
            )}
            <div className="grid gap-3 lg:grid-cols-2">
              {CLINICAL_RULE_REGISTRY.map((ruleSet) => (
                <article key={ruleSet.id} className="rounded-xl border bg-white p-4 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-semibold text-slate-950">{ruleSet.name}</h3>
                    <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900">Review pending</span>
                  </div>
                  <p className="mt-2 text-slate-600">Version {ruleSet.version}</p>
                  <p className="mt-2 text-slate-700">{ruleSet.source}</p>
                  <p className="mt-2 text-xs text-slate-500">Owner: {ruleSet.ownerRole}</p>
                </article>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
