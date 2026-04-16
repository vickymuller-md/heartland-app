import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LinkageManagement } from "./linkage-management";
import Link from "next/link";
import { UserPlus } from "lucide-react";

export type LinkageRow = {
  id: string;
  status: string;
  invite_email: string | null;
  created_at: string;
  linked_at: string | null;
  patient: { id: string; full_name: string; email: string } | null;
};

export default async function PatientManagePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Verify the user is a provider
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, provider_code")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "provider") {
    redirect("/today");
  }

  // Fetch all links for this provider
  const { data: links } = await supabase
    .from("provider_patient_links")
    .select(
      "id, status, invite_email, created_at, linked_at, patient:profiles!patient_id(id, full_name, email)"
    )
    .eq("provider_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">
          Patient Management
        </h1>
        <Link
          href="/invite"
          className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
        >
          <UserPlus className="size-4" />
          Invite Patient
        </Link>
      </div>

      {/* Provider Code Card */}
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-6">
        <p className="text-sm font-medium text-blue-700">
          Your Provider Code
        </p>
        <p className="mt-2 font-mono text-3xl font-bold tracking-wider text-blue-900">
          {profile.provider_code ?? "---"}
        </p>
        <p className="mt-2 text-sm text-blue-600">
          Share this code with patients so they can request linkage
        </p>
      </div>

      {/* Linkage Management (Client Component with Realtime) */}
      <LinkageManagement
        initialLinks={(links as unknown as LinkageRow[]) ?? []}
        providerId={user.id}
      />
    </div>
  );
}
