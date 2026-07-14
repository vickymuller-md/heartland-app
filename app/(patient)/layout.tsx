"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Heart, TrendingUp, Pill, BookOpen, CalendarDays, Shield, UserRound } from "lucide-react";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { clearOfflineData } from "@/lib/offline/db";
import { ConnectivityBanner } from "@/components/shared/connectivity-banner";

const tabs = [
  { href: "/today", label: "Today", icon: Heart },
  { href: "/history", label: "History", icon: TrendingUp },
  { href: "/medications", label: "Meds", icon: Pill },
  { href: "/plan", label: "Plan", icon: CalendarDays },
  { href: "/education", label: "Learn", icon: BookOpen },
  { href: "/privacy", label: "Privacy", icon: Shield },
];

export default function PatientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  // Purge plaintext clinical records left by versions that supported offline writes.
  useEffect(() => {
    void clearOfflineData();
  }, []);

  return (
    <div className="min-h-screen pb-20">
      {/* Top bar */}
      <header className="flex h-14 items-center justify-between border-b border-gray-200 bg-white px-4">
        <h1 className="text-lg font-bold tracking-wide text-slate-900">
          HEARTLAND
        </h1>
        <div className="flex items-center gap-3">
          <Link
            href="/profile"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Profile"
          >
            <UserRound className="size-5" />
          </Link>
          <SignOutButton className="text-gray-500 hover:text-gray-700" />
        </div>
      </header>

      {/* PWA install prompt -- self-managing visibility */}
      <InstallPrompt />

      <ConnectivityBanner workspace="patient" />

      {/* Main content -- pb-20 clears the fixed bottom nav */}
      <main className="px-4 pt-4 pb-20 max-w-lg mx-auto">{children}</main>

      {/* Bottom tab navigation -- min 48px tap targets for elderly users (VITL-08) */}
      <nav
        className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="grid grid-cols-6 max-w-lg mx-auto">
          {tabs.map(({ href, label, icon: Icon }) => {
            const active = pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex flex-col items-center justify-center min-h-[48px] min-w-[48px] px-2 py-2 ${
                  active
                    ? "text-blue-600 font-semibold"
                    : "text-gray-500"
                }`}
              >
                <Icon className="h-6 w-6 mb-0.5" />
                <span className="text-xs">{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
