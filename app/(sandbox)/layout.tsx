import Link from 'next/link';
import { FlaskConical } from 'lucide-react';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { createClient } from '@/lib/supabase/server';

export default async function SandboxLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b bg-white">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/sandbox" className="flex min-h-11 items-center gap-2 font-bold text-slate-950">
            HEARTLAND
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-1 text-xs font-semibold text-violet-800">
              <FlaskConical className="size-3.5" aria-hidden="true" /> Sandbox
            </span>
            <span className="hidden text-xs font-medium text-slate-500 lg:inline">Full synthetic product tour</span>
          </Link>
          {user ? <SignOutButton className="min-h-11" /> : (
            <nav className="flex items-center gap-3" aria-label="Sandbox account options">
              <Link href="/login" className="hidden min-h-11 items-center text-sm font-semibold text-slate-600 hover:text-slate-950 sm:inline-flex">Sign in</Link>
              <Link href="/register?mode=tester" className="inline-flex min-h-11 items-center rounded-lg bg-slate-950 px-3 text-sm font-semibold text-white hover:bg-slate-800">Create account</Link>
            </nav>
          )}
        </div>
      </header>
      <main id="main-content" className="mx-auto max-w-7xl px-4 py-4 sm:px-6 sm:py-6">{children}</main>
    </div>
  );
}
