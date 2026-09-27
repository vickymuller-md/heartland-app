import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import { authorize } from '@/lib/auth/authorization';
import { loadMyReassignmentRequests } from '@/lib/daily-loop/reassignment-actions';
import { ReassignmentRequestsPanel } from './requests-panel';

export default async function ReassignmentRequestsPage() {
  const auth = await authorize('provider');
  if (!auth.authorized) redirect(auth.error === 'MFA required' ? '/security/mfa' : '/login');
  const initial = await loadMyReassignmentRequests();
  return <div className="space-y-6">
    <Link href="/team" className="text-blue-700 underline">Team &amp; access</Link>
    <header><h1 className="text-3xl font-bold">My pending reassignment requests</h1>
      <p className="mt-2 text-slate-600">Recover your saved requests even after an item leaves the Daily Loop or exceptions view. Only your currently authorized records appear.</p></header>
    <ReassignmentRequestsPanel scopeKey={`${auth.user.id}:${randomUUID()}`} initial={initial} />
  </div>;
}
