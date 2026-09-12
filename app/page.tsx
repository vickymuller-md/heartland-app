import type { Metadata } from "next";
import { APP_VERSION } from "@/lib/app-version";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Masthead } from "@heartland/ui";
import { Colophon } from "@/components/landing/colophon";
import { Hero } from "@/components/landing/hero";
import { Abstract } from "@/components/landing/abstract";
import { ScaleDemo } from "@/components/landing/scale-demo";
import { AutomationEvidence } from "@/components/landing/automation-evidence";
import { Modules } from "@/components/landing/modules";
import { EvidenceFoundation } from "@/components/landing/evidence";
import { AccessCta } from "@/components/landing/access-cta";

export const metadata: Metadata = {
  title: `HEARTLAND App ${APP_VERSION} · Educational Implementation Companion`,
  description:
    "An educational implementation companion for rural heart failure teams. Explore eight protocol modules, synthetic workflows and AI responsibilities; distinguish published software from local improvements under evaluation.",
};

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    // Authenticated users bypass the landing page and go straight to their workspace.
    redirect("/dashboard");
  }

  return (
    <main id="main-content" className="bg-terminal font-editorial text-cool antialiased [overflow-wrap:anywhere] selection:bg-alert/40 selection:text-cool [&>header]:static [&>header>div]:flex-wrap [&>header>div]:gap-4 [&>header_a]:min-h-11 [&>header_a]:items-center [&>header_a]:inline-flex [&>header_a]:text-sm [&>header_a>span]:text-base [&>header_nav]:flex-wrap [&>header_nav]:gap-4 [&>header>div>div>a:hover]:text-terminal">
      <Masthead
        currentSite="app"
        navItems={[
          { label: "The Protocol", href: "/about" },
          { label: "Evidence Lab", href: "/sandbox" },
          {
            label: "Toolkit",
            href: "https://doi.org/10.5281/zenodo.19101219",
            external: true,
          },
          { label: "Sign in", href: "/login" },
        ]}
        cta={{ label: "Open Evidence Lab", href: "/sandbox" }}
      />
      <aside className="border-b border-amber-900/40 bg-amber-950 px-6 py-3 text-center font-editorial text-sm leading-relaxed text-amber-100">
        Public routes: educational sandbox. Authenticated workspace: controlled evaluation only. Real PHI and unsupervised clinical use are not authorized until organizational security, privacy, validation, staffing, and governance gates are approved.
      </aside>
      <Hero />
      <Abstract />
      <ScaleDemo />
      <AutomationEvidence />
      <Modules />
      <EvidenceFoundation />
      <AccessCta />
      <Colophon />
    </main>
  );
}
