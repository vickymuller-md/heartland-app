import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Masthead, Colophon } from "@heartland/ui";
import { Hero } from "@/components/landing/hero";
import { Abstract } from "@/components/landing/abstract";
import { Modules } from "@/components/landing/modules";
import { EvidenceFoundation } from "@/components/landing/evidence";
import { AccessCta } from "@/components/landing/access-cta";

export const metadata: Metadata = {
  title: "HEARTLAND Protocol · Clinical Implementation Companion for Rural Heart Failure",
  description:
    "A peer-reviewed implementation framework and interactive companion toolkit — educational implementation support for licensed professionals managing heart failure in rural and resource-limited settings across the United States.",
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
    <main id="main-content" className="bg-terminal font-editorial text-cool antialiased selection:bg-alert/40 selection:text-cool">
      <Masthead
        currentSite="app"
        navItems={[
          { label: "The Protocol", href: "/about" },
          { label: "Try sandbox", href: "/sandbox" },
          {
            label: "Research",
            href: "https://doi.org/10.5281/zenodo.19101219",
            external: true,
          },
          { label: "Sign in", href: "/login" },
        ]}
        cta={{ label: "Try sandbox", href: "/sandbox" }}
      />
      <aside className="border-b border-amber-900/40 bg-amber-950 px-6 py-3 text-center font-editorial text-sm leading-relaxed text-amber-100">
        Public routes: educational sandbox. Authenticated workspace: controlled evaluation only. Real PHI and unsupervised clinical use are not authorized until organizational security, privacy, validation, staffing, and governance gates are approved.
      </aside>
      <Hero />
      <Abstract />
      <Modules />
      <EvidenceFoundation />
      <AccessCta />
      <Colophon
        currentSite="app"
        version="v1.2.0"
        legal={
          <>
            Built by Vicky Muller Ferreira, MD. For licensed clinicians only.
            This release does not establish FDA clearance or authorization and
            does not resolve medical-device classification. It does not replace
            clinical judgment or institutional policy. Public routes use
            synthetic data; authenticated workspaces remain controlled
            evaluation only. Real PHI and unsupervised clinical use are not
            authorized until release gates are approved.
          </>
        }
        extraBlocks={[
          {
            title: "Platform",
            links: [
              { label: "Try sandbox", href: "/sandbox" },
              { label: "Create tester account", href: "/register?mode=tester" },
              { label: "Request clinical access", href: "/request-access" },
              { label: "Sign in", href: "/login" },
              { label: "About the protocol", href: "/about" },
              {
                label: "Software Heritage",
                href: "https://archive.softwareheritage.org/swh:1:snp:3e39be4952047172a2c1a131c2965bd580a6dc69/",
                external: true,
              },
            ],
          },
        ]}
      />
    </main>
  );
}
