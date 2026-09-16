import Link from 'next/link';
import { FlaskConical } from 'lucide-react';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { createClient } from '@/lib/supabase/server';

export default async function SandboxLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <div className="min-h-screen bg-slate-50">
      <a href="#main-content" className="sr-only z-50 max-w-[calc(100%-1.5rem)] rounded bg-white px-4 py-3 font-semibold text-slate-950 shadow focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Skip to main content
      </a>
      <header className="border-b bg-white">
        <div className="mx-auto flex min-h-16 max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 sm:px-6">
          <Link href="/sandbox" className="flex min-h-11 min-w-0 max-w-full flex-wrap items-center gap-2 rounded font-bold text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-700">
            HEARTLAND
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-1 text-xs font-semibold text-violet-800">
              <FlaskConical className="size-3.5" aria-hidden="true" /> Sandbox
            </span>
            <span className="hidden text-xs font-medium text-slate-500 lg:inline">Full synthetic product tour</span>
          </Link>
          {user ? <SignOutButton className="h-auto min-h-11 max-w-full whitespace-normal py-2" /> : (
            <nav className="flex min-w-0 flex-wrap items-center gap-3" aria-label="Sandbox account options">
              <Link href="/login" className="hidden min-h-11 items-center text-sm font-semibold text-slate-600 hover:text-slate-950 sm:inline-flex">Sign in</Link>
              <Link href="/register?mode=tester" className="inline-flex min-h-11 max-w-full items-center rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-700">Create account</Link>
            </nav>
          )}
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-7xl px-4 py-4 focus-visible:outline-2 focus-visible:outline-violet-700 sm:px-6 sm:py-6">{children}</main>
    </div>
  );
}
