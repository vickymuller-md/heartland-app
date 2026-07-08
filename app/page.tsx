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
    <div className="bg-terminal font-editorial text-cool antialiased selection:bg-alert/40 selection:text-cool">
      <Masthead
        currentSite="app"
        navItems={[
          { label: "The Protocol", href: "/about" },
          { label: "Try the tools", href: "/tools" },
          {
            label: "Research",
            href: "https://doi.org/10.5281/zenodo.18566403",
            external: true,
          },
          { label: "Sign in", href: "/login" },
        ]}
        cta={{ label: "Request access", href: "/request-access" }}
      />
      <Hero />
      <Abstract />
      <Modules />
      <EvidenceFoundation />
      <AccessCta />
      <Colophon
        currentSite="app"
        version="v1.0.2"
        extraBlocks={[
          {
            title: "Platform",
            links: [
              { label: "Request access", href: "/request-access" },
              { label: "Sign in", href: "/login" },
              { label: "About the protocol", href: "/about" },
            ],
          },
        ]}
      />
    </div>
  );
}
