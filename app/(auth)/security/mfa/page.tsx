import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { authorize } from '@/lib/auth/authorization';
import { MfaSetup } from './mfa-setup';

export const metadata: Metadata = {
  title: 'Provider security · HEARTLAND',
};

export default async function ProviderMfaPage() {
  const auth = await authorize('provider', { requireMfa: false });
  if (!auth.authorized) {
    redirect(auth.error === 'Consent required' ? '/consent' : '/login');
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-4 py-10">
      <MfaSetup />
    </main>
  );
}
