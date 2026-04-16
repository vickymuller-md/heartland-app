import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { InviteForm } from "@/components/provider/invite-form";

export default async function InvitePage() {
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
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "provider") {
    redirect("/today");
  }

  return (
    <div className="flex min-h-[60vh] items-start justify-center pt-8">
      <InviteForm />
    </div>
  );
}
