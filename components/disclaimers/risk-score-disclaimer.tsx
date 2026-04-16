import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

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
