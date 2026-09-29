import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { authorize } from '@/lib/auth/authorization';
import { getTeamDirectory } from '@/lib/team/queries';
import { ProviderPageDisclaimer } from '@/components/disclaimers/provider-page-disclaimer';
import { LabSourcePanel } from '../_components/lab-source-panel';

export default async function LabSourcesPage({ params, searchParams }: {
  params: Promise<{ patientId: string }>; searchParams: Promise<{ organization?: string | string[] }>;
}) {
  const auth = await authorize('provider');
  if (!auth.authorized) return <p role="alert">A current provider session with MFA and consent is required.</p>;
  const { patientId } = await params; const { organization } = await searchParams;
  if (!z.guid().safeParse(patientId).success || (organization !== undefined && !z.guid().safeParse(organization).success)) {
    return <p role="alert">The requested patient or organization could not be verified.</p>;
  }
  const directory = organization ? null : await getTeamDirectory(auth.supabase);
  const organizations = directory?.members.filter((member) => member.is_self) ?? [];
  const validDirectory = !directory?.error && organizations.every((org) => z.guid().safeParse(org.organization_id).success
    && typeof org.organization_name === 'string' && org.organization_name.length > 0);
  return <div className="space-y-5">
    <ProviderPageDisclaimer />
    <a className="inline-flex min-h-11 items-center text-blue-700 underline" href={`/patients/${patientId}`}>Back to patient record</a>
    {typeof organization === 'string' ? <LabSourcePanel actorId={auth.user.id} patientId={patientId}
      organizationId={organization} scopeKey={randomUUID()} />
      : <section className="space-y-3"><h1 className="text-2xl font-bold">Choose the source organization</h1>
        <p>Choose explicitly. Membership alone does not authorize this patient or source. Every read and change verifies current scope.</p>
        {!validDirectory ? <p role="alert">Organization directory unavailable. Reload before continuing.</p>
          : organizations.length === 0 ? <p>No organization is available in your directory. Verify your access with the team.</p>
            : organizations.map((org) => <a key={org.organization_id} className="block min-h-11 text-blue-700 underline"
              href={`/patients/${patientId}/lab-sources?organization=${org.organization_id}`}>{org.organization_name}</a>)}
      </section>}
  </div>;
}
