import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LinkProviderForm } from "./link-provider-form";

type ExistingLink = {
  id: string;
  status: string;
  provider: { full_name: string } | null;
};

export default async function LinkProviderPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Verify the user is a patient
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role === "provider") {
    redirect("/dashboard");
  }

  // Fetch existing links for display
  const { data: existingLinks } = await supabase
    .from("provider_patient_links")
    .select("id, status, provider:profiles!provider_id(full_name)")
    .eq("patient_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Link to Your Provider</h2>
        <p className="mt-1 text-sm text-gray-600">
          Enter the 6-character code your provider gave you to connect your
          accounts.
        </p>
      </div>

      <LinkProviderForm existingLinks={(existingLinks as unknown as ExistingLink[]) ?? []} />
    </div>
  );
}
