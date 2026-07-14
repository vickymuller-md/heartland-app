import "server-only";

import { createClient } from "@/lib/supabase/server";

export type AppRole = "provider" | "patient";

type AuthorizationFailure = {
  authorized: false;
  error: "Not authenticated" | "Unauthorized" | "Consent required" | "MFA required";
};

type AuthorizationSuccess = {
  authorized: true;
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: { id: string; email?: string };
  role: AppRole;
};

export type AuthorizationResult = AuthorizationFailure | AuthorizationSuccess;

interface AuthorizationOptions {
  requireConsent?: boolean;
  requireMfa?: boolean;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Authoritative Server Action guard.
 *
 * Identity comes from Auth getUser(), role comes from the database profile,
 * and clinical access requires the current registration consent. User-editable
 * metadata is never used for authorization.
 */
export async function authorize(
  requiredRole?: AppRole,
  options: AuthorizationOptions = {},
): Promise<AuthorizationResult> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { authorized: false, error: "Not authenticated" };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (
    profileError ||
    !profile ||
    (profile.role !== "provider" && profile.role !== "patient") ||
    (requiredRole && profile.role !== requiredRole)
  ) {
    return { authorized: false, error: "Unauthorized" };
  }

  if (options.requireConsent !== false) {
    const { data: consent, error: consentError } = await supabase
      .from("consents")
      .select("id")
      .eq("user_id", user.id)
      .eq("consent_type", "registration")
      .eq("consent_version", "v1.0")
      .eq("accepted", true)
      .limit(1)
      .maybeSingle();

    if (consentError || !consent) {
      return { authorized: false, error: "Consent required" };
    }
  }

  const requireMfa = options.requireMfa ?? requiredRole === "provider";
  if (requireMfa && profile.role === "provider") {
    const { data: assurance, error: assuranceError } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assuranceError || assurance?.currentLevel !== "aal2") {
      return { authorized: false, error: "MFA required" };
    }
  }

  return {
    authorized: true,
    supabase,
    user: { id: user.id, email: user.email },
    role: profile.role,
  };
}

export async function authorizeProviderForPatient(
  patientId: string,
): Promise<AuthorizationResult> {
  if (!UUID_PATTERN.test(patientId)) {
    return { authorized: false, error: "Unauthorized" };
  }

  const auth = await authorize("provider");
  if (!auth.authorized) return auth;

  const { data: link, error } = await auth.supabase
    .from("provider_patient_links")
    .select("id")
    .eq("provider_id", auth.user.id)
    .eq("patient_id", patientId)
    .eq("status", "active")
    .maybeSingle();

  if (error || !link) {
    return { authorized: false, error: "Unauthorized" };
  }

  return auth;
}
