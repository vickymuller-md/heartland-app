"use client";

import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { TIER_COLORS, TIER_LABELS } from "@/lib/tier-selector/constants";
import type { TierResult } from "@/lib/tier-selector/types";

interface TierResultCardProps {
  result: TierResult;
}

export function TierResultCard({ result }: TierResultCardProps) {
  const colors = TIER_COLORS[result.overallTier];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Assessment Result</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Overall tier badge */}
        <div
          className={`inline-flex items-center rounded-lg border px-4 py-2 text-lg font-bold ${colors.badge}`}
        >
          {result.tierLabel}
        </div>

        {/* Rationale */}
        <p className="text-sm text-muted-foreground">{result.rationale}</p>

        {/* Category breakdown */}
        <div>
          <h4 className="text-sm font-medium mb-2">Category Breakdown</h4>
          <div className="flex flex-wrap gap-1.5">
            {result.categoryBreakdown.map((cat) => (
              <span
                key={cat.categoryId}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${TIER_COLORS[cat.selectedLevel].badge}`}
              >
                {cat.categoryLabel}
                <span className="font-semibold">
                  T{cat.selectedLevel}
                </span>
              </span>
            ))}
          </div>
        </div>

        {/* Upgrade recommendations */}
        {result.upgradeRecommendations.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-2">
              Upgrade Recommendations
            </h4>
            <ol className="space-y-2 text-sm">
              {result.upgradeRecommendations.map((rec) => (
                <li
                  key={rec.category}
                  className="rounded border border-gray-100 bg-gray-50 p-2"
                >
                  <span className="font-medium">{rec.category}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    (Tier {rec.currentLevel} \u2192 Tier {rec.targetLevel})
                  </span>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {rec.action}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
