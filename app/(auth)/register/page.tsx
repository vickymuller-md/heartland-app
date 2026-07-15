import { createClient } from "@/lib/supabase/server";
import { RegisterForm } from "@/components/auth/register-form";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ invite_provider?: string; mode?: string }>;
}) {
  const params = await searchParams;
  const inviteProviderId = params.invite_provider;

  let inviterName: string | null = null;

  if (inviteProviderId) {
    const supabase = await createClient();
    const { data: provider } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", inviteProviderId)
      .eq("role", "provider")
      .single();

    inviterName = provider?.full_name ?? null;
  }

  return (
    <RegisterForm
      inviteProviderId={inviteProviderId}
      inviterName={inviterName}
      initialRole={params.mode === "patient" ? "patient" : "tester"}
    />
  );
}
