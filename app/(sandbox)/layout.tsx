import Link from 'next/link';
import { FlaskConical } from 'lucide-react';
import { redirect } from 'next/navigation';
import { authorize } from '@/lib/auth/authorization';
import { SignOutButton } from '@/components/auth/sign-out-button';

export default async function SandboxLayout({ children }: { children: React.ReactNode }) {
  const auth = await authorize('tester', { requireMfa: false });
  if (!auth.authorized) redirect(auth.error === 'Consent required' ? '/consent' : '/login');

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b bg-white">
        <div className="mx-auto flex min-h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/sandbox" className="flex min-h-11 items-center gap-2 font-bold text-slate-950">
            HEARTLAND
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-1 text-xs font-semibold text-violet-800">
              <FlaskConical className="size-3.5" aria-hidden="true" /> Sandbox
            </span>
          </Link>
          <SignOutButton className="min-h-11" />
        </div>
      </header>
      <main id="main-content" className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
