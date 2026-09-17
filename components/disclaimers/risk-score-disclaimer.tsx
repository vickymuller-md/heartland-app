import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

/**
 * One-line caveat for any surface that shows a stored risk tier without room
 * for the full disclaimer below. It prints, because the surfaces that carry it
 * include the shareable patient summary.
 */
export const RISK_TIER_CAVEAT =
  "Risk tier comes from the HEARTLAND Risk Stratification Framework, a proposed, non-validated heuristic; it is not a prediction of events.";

export function RiskTierDisclaimer({ className = "" }: { className?: string }) {
  return (
    <p
      role="note"
      aria-label="Risk tier disclaimer"
      className={"text-xs text-gray-600 " + className}
    >
      {RISK_TIER_CAVEAT}
    </p>
  );
}

export function RiskScoreDisclaimer() {
  return (
    <div className="mb-4">
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          The HEARTLAND Risk Stratification Framework is a proposed pragmatic
          heuristic designed to supplement — not replace — validated prognostic
          instruments such as the MAGGIC score. It has not been statistically
          validated through derivation/validation cohort testing with ROC
          analysis or calibration assessment. The variable weights reflect
          clinical reasoning informed by published evidence, not regression
          coefficients from a derivation dataset. Formal validation using
          registry data linked with geographic and social determinant variables
          represents a planned next step in this research program.
        </AlertDescription>
      </Alert>
    </div>
  );
}
