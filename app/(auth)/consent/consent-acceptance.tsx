"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConsentDialog } from "@/components/auth/consent-dialog";
import { recordConsent } from "@/app/actions/auth";
import { createClient } from "@/lib/supabase/client";
import { clearClientSecurityState } from "@/lib/offline/db";

interface ConsentAcceptanceProps {
  nextPath: "/dashboard" | "/today" | "/sandbox" | "/update-password";
}

export function ConsentAcceptance({ nextPath }: ConsentAcceptanceProps) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function handleAccept() {
    setError(null);
    const result = await recordConsent("v1.0", "registration");
    if (!result.success) {
      setError(result.error ?? "Unable to record consent");
      return;
    }

    router.replace(nextPath);
    router.refresh();
  }

  async function handleCancel() {
    setOpen(false);
    const supabase = createClient();
    await supabase.auth.signOut();
    await clearClientSecurityState();
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="rounded-lg border bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold">Consent required</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Review and accept the current privacy and clinical-use notice before
        accessing account data.
      </p>
      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
      <ConsentDialog
        open={open}
        onAccept={handleAccept}
        onCancel={handleCancel}
      />
    </div>
  );
}
