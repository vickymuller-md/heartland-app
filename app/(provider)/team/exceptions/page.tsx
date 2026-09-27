import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { authorize } from '@/lib/auth/authorization';
import { getTeamDirectory } from '@/lib/team/queries';
import { getOperationalExceptions } from '@/lib/team/exception-queries';
import { EXCEPTION_LOAD_ERROR, type ExceptionResult } from '@/lib/team/operational-exceptions';
import { ExceptionPanel } from './exception-panel';

export default async function OperationalExceptionsPage() {
  const auth = await authorize('provider');
  if (!auth.authorized) redirect(auth.error === 'MFA required' ? '/security/mfa' : '/login');
  const directory = await getTeamDirectory(auth.supabase);
  const organizations = directory.members.filter((member) => member.is_self)
    .map((member) => ({ id: member.organization_id, name: member.organization_name }));
  const initial: ExceptionResult = organizations.length
    ? await getOperationalExceptions(auth.supabase, { organizationId: organizations[0].id })
    : { data: null, error: EXCEPTION_LOAD_ERROR };
  return <div className="space-y-6">
    <Link href="/team" className="text-sm text-blue-700 underline">Team &amp; access</Link>
    <header><h1 className="text-3xl font-bold">Operational exceptions</h1>
      <p className="mt-2 text-slate-600">Responsibility gaps and unfinished processing, with patient access checked separately from team administration.</p></header>
    {directory.error ? <p role="alert">{EXCEPTION_LOAD_ERROR}</p>
      : <ExceptionPanel snapshotId={`${auth.user.id}:${randomUUID()}`} organizations={organizations} initial={initial} />}
  </div>;
}
