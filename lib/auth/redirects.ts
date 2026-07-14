const ALLOWED_CONFIRM_REDIRECTS = new Set([
  "/today",
  "/dashboard",
  "/update-password",
  "/consent?invited=1",
]);

/**
 * Accept only exact, application-owned destinations after an auth callback.
 * Rejecting query strings and path prefixes keeps callback data from becoming
 * an open redirect primitive.
 */
export function getSafeConfirmRedirect(value: string | null): string {
  return value && ALLOWED_CONFIRM_REDIRECTS.has(value) ? value : "/today";
}
