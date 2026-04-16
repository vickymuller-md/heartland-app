"use server";

import { createClient } from "@/lib/supabase/server";

interface RecordConsentResult {
  success: boolean;
  error?: string;
}

export async function recordConsent(
  userId: string,
  consentVersion: string = "v1.0",
  consentType: string = "registration",
): Promise<RecordConsentResult> {
  try {
    const supabase = await createClient();

    const { error } = await supabase.from("consents").insert({
      user_id: userId,
      consent_version: consentVersion,
      consent_type: consentType,
      accepted: true,
      accepted_at: new Date().toISOString(),
    });

    if (error) {
      console.error("Failed to record consent:", error.message);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Consent recording exception:", message);
    return { success: false, error: message };
  }
}
