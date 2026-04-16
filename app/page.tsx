import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Masthead } from "@/components/landing/masthead";
import { Hero } from "@/components/landing/hero";
import { Abstract } from "@/components/landing/abstract";
import { Modules } from "@/components/landing/modules";
import { EvidenceFoundation } from "@/components/landing/evidence";
import { AccessCta } from "@/components/landing/access-cta";
import { Colophon } from "@/components/landing/colophon";

export const metadata: Metadata = {
  title: "HEARTLAND Protocol · Clinical Decision Support for Rural Heart Failure",
  description:
    "A peer-reviewed implementation framework and interactive decision support toolkit for primary care-led heart failure management in rural and resource-limited settings across the United States.",
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
      <Masthead />
      <Hero />
      <Abstract />
      <Modules />
      <EvidenceFoundation />
      <AccessCta />
      <Colophon />
    </div>
  );
}
