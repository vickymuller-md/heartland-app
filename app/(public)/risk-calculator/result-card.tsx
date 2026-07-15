import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TIER_COLORS } from '@/lib/risk-score/constants';
import type { RiskResult } from '@/lib/risk-score/types';

interface ResultCardProps {
  result: RiskResult;
}

/**
 * Displays the tier badge, score, and care pathway recommendations.
 * Visible on both screen and print. Colors preserved in print via print-color-adjust.
 */
export function ResultCard({ result }: ResultCardProps) {
  const colors = TIER_COLORS[result.tier];

  return (
    <div data-testid="result-card" className="print:break-inside-avoid">
      <Card className={`border-l-4 ${colors.border}`} style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' } as React.CSSProperties}>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="text-lg">Risk Assessment</span>
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${colors.badge}`}
              data-testid="tier-badge"
            >
              {result.tierLabel}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Score display */}
          <div className="mb-4 flex items-baseline gap-1">
            <span className={`text-4xl font-bold ${colors.text}`}>
              {result.totalScore}
            </span>
            <span className="text-lg text-muted-foreground">/ {result.maxScore}</span>
          </div>

          {/* Care pathway */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold">Care Pathway</h4>
            <div className="grid gap-2 text-sm">
              <div className="flex justify-between">
                <span className="font-medium text-muted-foreground">Follow-up</span>
                <span className="text-right">{result.carePathway.followUp}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-medium text-muted-foreground">Monitoring</span>
                <span className="text-right">{result.carePathway.monitoring}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-medium text-muted-foreground">Support</span>
                <span className="text-right">{result.carePathway.support}</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {result.carePathway.description}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Risk score disclaimer */}
      <p className="mt-3 text-xs italic text-muted-foreground" data-testid="disclaimer">
        The HEARTLAND Risk Stratification Framework is a proposed tool under
        development. It has not been validated against clinical outcomes data.
        Formal validation through registry data is a defined research objective.
      </p>
    </div>
  );
}
