import Link from 'next/link';
import { WorkspaceBrand } from '@/components/shared/workspace-brand';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { createClient } from '@/lib/supabase/server';

export default async function SandboxLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  return (
    <div className="min-h-screen bg-background">
      <a href="#main-content" className="sr-only z-50 max-w-[calc(100%-1.5rem)] rounded bg-white px-4 py-3 font-semibold text-slate-950 shadow focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Skip to main content
      </a>
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex min-h-16 max-w-[1200px] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 sm:px-6">
          <Link href="/sandbox" aria-label="Heartland Sandbox" className="flex min-h-11 min-w-0 max-w-full flex-wrap items-center gap-2 rounded font-bold text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            <WorkspaceBrand />
            <span className="border-l border-border pl-2 text-sm font-medium text-muted-foreground">Sandbox</span>
          </Link>
          {user ? <SignOutButton className="h-auto min-h-11 max-w-full whitespace-normal py-2" /> : (
            <nav className="flex min-w-0 flex-wrap items-center gap-3" aria-label="Sandbox account options">
              <Link href="/login" className="hidden min-h-11 items-center text-sm font-semibold text-slate-600 hover:text-slate-950 sm:inline-flex">Sign in</Link>
              <Link href="/register?mode=tester" className="inline-flex min-h-11 max-w-full items-center rounded-lg border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground hover:border-input hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">Create account</Link>
            </nav>
          )}
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-[1200px] px-4 pb-6 focus-visible:outline-2 focus-visible:outline-ring sm:px-6 sm:pb-8">{children}</main>
    </div>
  );
}
