"use server";

import { authorize } from "@/lib/auth/authorization";

interface RecordConsentResult {
  success: boolean;
  error?: string;
}

export async function recordConsent(
  consentVersion: string = "v1.0",
  consentType: string = "registration",
): Promise<RecordConsentResult> {
  try {
    if (consentVersion !== "v1.0" || consentType !== "registration") {
      return { success: false, error: "Unsupported consent" };
    }

    const auth = await authorize(undefined, { requireConsent: false });
    if (!auth.authorized) {
      return { success: false, error: auth.error };
    }

    const { error } = await auth.supabase
      .from("consents")
      .upsert(
        {
          user_id: auth.user.id,
          consent_version: "v1.0",
          consent_type: "registration",
          accepted: true,
        },
        {
          onConflict: "user_id,consent_version,consent_type",
          ignoreDuplicates: true,
        },
      );

    if (error) {
      console.error("Failed to record consent");
      return { success: false, error: "Unable to record consent" };
    }

    return { success: true };
  } catch {
    console.error("Consent recording exception");
    return { success: false, error: "Unable to record consent" };
  }
}
