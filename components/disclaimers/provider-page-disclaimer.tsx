import type { ReactNode } from "react";

/**
 * Shared page-level disclaimer for provider routes.
 *
 * Consolidates the two literal disclaimer texts required by `NIW_INTEGRATION.md`
 * lines 72-74 (scope-of-use + framework-status). Choose the appropriate variant
 * per page; both variants are print-hidden since the DisclaimerFooter in the
 * root layout handles the print footer.
 *
 * Variants:
 *   default   — scope of use only (all clinical tool pages)
 *   framework — scope of use + framework status (risk calculator only,
 *               because only that page exposes the HEARTLAND Risk
 *               Stratification Framework itself)
 */
export type ProviderPageDisclaimerVariant = "default" | "framework";

export function ProviderPageDisclaimer({
  variant = "default",
  className = "",
  children,
}: {
  variant?: ProviderPageDisclaimerVariant;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <aside
      role="note"
      aria-label="Clinical decision support disclaimer"
      className={
        "rounded-lg border border-gray-200 bg-gray-50 p-4 text-xs text-gray-600 print:hidden " +
        className
      }
    >
      <p className="font-medium mb-1">Clinical Decision Support Disclaimer</p>
      <p>
        This tool is designed for healthcare professionals as a clinical
        decision support resource. It does not provide medical diagnoses,
        treatment recommendations for individual patients, or replace clinical
        judgment. Not intended for direct patient care. For professional use
        only.
      </p>
      {variant === "framework" && (
        <p className="mt-2">
          The HEARTLAND Risk Stratification Framework is a proposed tool under
          development. It has not been validated against clinical outcomes
          data. Formal validation through registry data is a defined research
          objective.
        </p>
      )}
      {children}
    </aside>
  );
}
