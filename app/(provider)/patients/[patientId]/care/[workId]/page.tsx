import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { authorize } from '@/lib/auth/authorization';
import { loadCareWorkflow } from '@/lib/care-workflow/step-actions';
import { careWorkflowReadSchema } from '@/lib/care-workflow/step-types';
import { CareWorkflowPanel } from '../../_components/care-workflow-panel';
import { ProviderPageDisclaimer } from '@/components/disclaimers/provider-page-disclaimer';
import { getTeamDirectory } from '@/lib/team/queries';

export default async function CareWorkflowPage({ params, searchParams }: { params: Promise<{ patientId: string; workId: string }>;
  searchParams: Promise<{ organization?: string | string[] }> }) {
  const auth = await authorize('provider');
  if (!auth.authorized) return <p role="alert">A currently authorized provider session with MFA and consent is required. Sign in again before continuing.</p>;
  const { patientId, workId } = await params;
  const input = { actor_id: auth.user.id, patient_id: patientId, work_item_id: workId };
  if (!careWorkflowReadSchema.safeParse(input).success) return <p role="alert">This follow-up could not be verified.</p>;
  const requestedOrg = (await searchParams).organization;
  if (requestedOrg !== undefined && !z.guid().safeParse(requestedOrg).success) return <p role="alert">This organization could not be verified.</p>;
  const result = await loadCareWorkflow(input);
  if (requestedOrg && result.data && requestedOrg !== result.data.organization_id) return <p role="alert">The requested organization does not match this follow-up. Return to Daily Loop to select the correct organization.</p>;
  const organizationId = result.data?.organization_id ?? (z.guid().safeParse(requestedOrg).success ? requestedOrg as string : null);
  // Directory entries offer explicit recovery destinations only; every pending read rechecks scope.
  const organizations = !organizationId ? (await getTeamDirectory(auth.supabase)).members.filter((member) => member.is_self) : [];
  return <div className="space-y-5">
    <ProviderPageDisclaimer />
    <a className="inline-flex min-h-11 items-center text-blue-700 underline" href="/dashboard">Back to Daily Loop</a>
    {organizationId ? <CareWorkflowPanel actorId={auth.user.id} patientId={patientId} workId={workId} organizationId={organizationId}
      initial={result.data} scopeKey={randomUUID()} />
      : <div className="space-y-3"><p role="alert">{result.error} Choose the original organization to check your own pending receipts. This does not grant access to the workflow.</p>
        {organizations.map((org) => <a key={org.organization_id} className="block min-h-11 text-blue-700 underline"
          href={`/patients/${patientId}/care/${workId}?organization=${org.organization_id}`}>{org.organization_name}</a>)}</div>}
  </div>;
}
