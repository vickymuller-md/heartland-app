'use client';

/**
 * Provider Shell -- Client Component
 *
 * The sidebar navigation and layout wrapper, extracted from the layout
 * so that the layout can be a Server Component that fetches data.
 *
 * EFFI-02: Sidebar refactored into 3 labeled NAV_GROUPS with urgentCount badge.
 */

import { useState } from 'react';
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

// ---------- ProviderShell Component ----------

interface ProviderShellProps {
  children: React.ReactNode;
  urgentCount: number;
}

export function ProviderShell({ children, urgentCount }: ProviderShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen">
      <a href="#main-content" className="sr-only z-50 rounded bg-white px-4 py-3 font-semibold text-slate-950 focus:not-sr-only focus:fixed focus:left-3 focus:top-3">Skip to main content</a>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-slate-900 text-white transition-transform duration-200 print:hidden lg:static lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Logo / Title */}
        <div className="flex h-16 items-center justify-between px-6">
          <span className="text-lg font-bold tracking-wide">HEARTLAND</span>
          <button
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded hover:bg-slate-700 lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Navigation -- grouped (EFFI-02) */}
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="mb-4">
              <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                {group.label}
              </p>
              {group.items.map((item) => {
                const Icon = item.icon;
                const showCount = item.showBadge && urgentCount > 0;
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${active ? 'bg-slate-700 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}
                    onClick={() => setSidebarOpen(false)}
                    aria-current={active ? 'page' : undefined}
                  >
                    <Icon className="size-5 shrink-0" />
                    <span className="flex-1">{item.label}</span>
                    {showCount && (
                      <span className="ml-auto rounded-full bg-red-500 px-1.5 py-0.5 text-xs font-bold text-white">
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
      </aside>

      {/* Main content area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <header className="flex h-16 items-center border-b border-gray-200 bg-white px-4 print:hidden lg:hidden">
          <button
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded hover:bg-gray-100"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open sidebar"
          >
            <Menu className="size-5 text-gray-700" />
          </button>
          <span className="ml-3 text-lg font-bold tracking-wide text-slate-900">
            HEARTLAND
          </span>
        </header>

        <ConnectivityBanner workspace="provider" />

        {/* Page content */}
        <main id="main-content" className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
