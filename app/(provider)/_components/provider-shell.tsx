'use client';

/**
 * Provider Shell -- Client Component
 *
 * The sidebar navigation and layout wrapper, extracted from the layout
 * so that the layout can be a Server Component that fetches data.
 *
 * EFFI-02: Sidebar refactored into 3 labeled NAV_GROUPS with urgentCount badge.
 */

import { useEffect, useState } from 'react';
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  LayoutDashboard,
  Users,
  Bell,
  CreditCard,
  Info,
  Menu,
  X,
  Calculator,
  Pill,
  Radio,
  ClipboardCheck,
  ListChecks,
  ClipboardList,
  Stethoscope,
  FileBarChart2,
  BarChart2,
  BookOpen,
  ShieldCheck,
} from 'lucide-react';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { ConnectivityBanner } from '@/components/shared/connectivity-banner';

// ---------- NAV_GROUPS: Grouped sidebar navigation ----------

export const NAV_GROUPS = [
  {
    label: 'Daily',
    items: [
      { href: '/dashboard', label: 'Daily Loop', icon: LayoutDashboard, showBadge: false },
      { href: '/patients', label: 'Patients', icon: Users, showBadge: false },
      { href: '/alerts', label: 'Inbox', icon: Bell, showBadge: true },
      { href: '/team', label: 'Team & Access', icon: Users, showBadge: false },
      { href: '/titration-worklist', label: 'Titration Worklist', icon: ClipboardCheck, showBadge: false },
    ],
  },
  {
    label: 'Clinical Tools',
    items: [
      { href: '/risk-calculator', label: 'Risk Calculator', icon: Calculator, showBadge: false },
      { href: '/gdmt-pathway', label: 'GDMT Pathway', icon: Pill, showBadge: false },
      { href: '/titration-checklist', label: 'Titration', icon: ClipboardCheck, showBadge: false },
      { href: '/discharge', label: 'Discharge', icon: ClipboardList, showBadge: false },
      { href: '/remote-monitoring', label: 'Remote Monitoring', icon: Radio, showBadge: false },
      { href: '/tier-selector', label: 'Tier Selector', icon: ListChecks, showBadge: false },
      { href: '/comorbidity-manager', label: 'Comorbidity Manager', icon: Stethoscope, showBadge: false },
      { href: '/quality-metrics', label: 'Quality Metrics', icon: BarChart2, showBadge: false },
    ],
  },
  {
    label: 'Reference',
    items: [
      { href: '/pocket-cards', label: 'Pocket Cards', icon: CreditCard, showBadge: false },
      { href: '/reports', label: 'Reports', icon: FileBarChart2, showBadge: false },
      { href: '/invite', label: 'Invite Patient', icon: Users, showBadge: false },
      { href: '/guide', label: 'User Guide', icon: BookOpen, showBadge: false },
      { href: '/security/mfa', label: 'Session Security', icon: ShieldCheck, showBadge: false },
      { href: '/about', label: 'About', icon: Info, showBadge: false },
    ],
  },
] as const;

function ProviderNavigation({ urgentCount, onNavigate }: { urgentCount: number | null; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <>
      {/* Navigation -- grouped (EFFI-02) */}
      <nav aria-label="Workspace destinations" className="flex-1 overflow-y-auto px-3 py-4">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-4">
            <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-slate-300">
              {group.label}
            </p>
            {group.items.map((item) => {
              const Icon = item.icon;
              const showCount = item.showBadge && urgentCount !== null && urgentCount > 0;
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${active ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon className="size-5 shrink-0" />
                  <span className="flex-1">{item.label}</span>
                  {item.showBadge && urgentCount === null && <span className="text-xs text-amber-200">Count unavailable</span>}
                  {showCount && (
                    <span className="ml-auto rounded-full bg-red-700 px-1.5 py-0.5 text-xs font-bold text-white">
                      {urgentCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Sign Out */}
      <div className="border-t border-slate-700 p-4">
        <SignOutButton className="w-full justify-start text-slate-300 hover:bg-slate-800 hover:text-white" />
      </div>
    </>
  );
}

export function ProviderShell({ children, urgentCount }: { children: React.ReactNode; urgentCount: number | null }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  useEffect(() => {
    const desktop = window.matchMedia?.('(min-width: 64rem)');
    const closeOnDesktop = () => { if (desktop?.matches) setSidebarOpen(false); };
    desktop?.addEventListener('change', closeOnDesktop);
    return () => desktop?.removeEventListener('change', closeOnDesktop);
  }, []);

  return (
    <div className="flex min-h-screen">
      <a href="#main-content" className="sr-only z-50 rounded bg-white px-4 py-3 font-semibold text-slate-950 focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Skip to main content</a>
      <aside className="hidden w-64 shrink-0 flex-col bg-slate-900 text-white lg:flex print:hidden">
        <div className="flex h-16 items-center px-6 text-lg font-bold">HEARTLAND</div>
        <ProviderNavigation urgentCount={urgentCount} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center border-b border-gray-200 bg-white px-4 print:hidden lg:hidden">
          <Dialog open={sidebarOpen} onOpenChange={setSidebarOpen}>
            <DialogTrigger aria-label="Open sidebar" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded hover:bg-gray-100">
              <Menu className="size-5 text-gray-700" />
            </DialogTrigger>
            <DialogContent showCloseButton={false} className="inset-y-0 left-0 flex h-dvh w-72 max-w-[90vw] translate-x-0 translate-y-0 flex-col gap-0 rounded-none bg-slate-900 p-0 text-white">
              <div className="flex min-h-16 items-center justify-between px-4">
                <DialogTitle>Workspace navigation</DialogTitle>
                <DialogClose aria-label="Close sidebar" className="inline-flex min-h-11 min-w-11 items-center justify-center rounded hover:bg-slate-700"><X className="size-5" /></DialogClose>
              </div>
              <ProviderNavigation urgentCount={urgentCount} onNavigate={() => setSidebarOpen(false)} />
            </DialogContent>
          </Dialog>
          <span className="ml-3 text-lg font-bold tracking-wide text-slate-900">HEARTLAND</span>
        </header>
        <ConnectivityBanner workspace="provider" />
        <main id="main-content" tabIndex={-1} className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
