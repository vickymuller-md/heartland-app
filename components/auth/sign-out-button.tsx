"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { clearClientSecurityState } from "@/lib/offline/db";

interface SignOutButtonProps {
  className?: string;
}

export function SignOutButton({ className }: SignOutButtonProps) {
  const router = useRouter();
  const supabase = createClient();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignOut() {
    setSigningOut(true);
    setError(null);
    const { error: signOutError } = await supabase.auth.signOut();
    await clearClientSecurityState();

    if (signOutError) {
      setError("Unable to end the session. Close this browser and try again.");
      setSigningOut(false);
      return;
    }

    router.replace("/login");
    router.refresh();
  }

  return (
    <div>
      <Button
        variant="ghost"
        onClick={handleSignOut}
        className={className}
        disabled={signingOut}
      >
        <LogOut data-icon="inline-start" className="size-4" />
        {signingOut ? "Signing Out..." : "Sign Out"}
      </Button>
      {error && <p role="alert" className="max-w-56 text-xs text-red-700">{error}</p>}
    </div>
  );
}
