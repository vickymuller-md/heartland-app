"use client";

import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { QUALITY_METRICS, TIER_COLORS } from "@/lib/tier-selector/constants";
import type { TierLevel } from "@/lib/tier-selector/types";

interface QualityMetricsTableProps {
  tierLevel: TierLevel;
}

export function QualityMetricsTable({ tierLevel }: QualityMetricsTableProps) {
  const isTier1 = tierLevel === 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Quality Metrics Targets</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="pb-2 pr-4 font-medium">Metric</th>
                <th
                  className={`pb-2 pr-4 font-medium ${isTier1 ? TIER_COLORS[1].text + " font-bold" : ""}`}
                >
                  Tier 1 Target
                </th>
                <th
                  className={`pb-2 font-medium ${!isTier1 ? TIER_COLORS[tierLevel].text + " font-bold" : ""}`}
                >
                  Tier 2/3 Target
                </th>
              </tr>
            </thead>
            <tbody>
              {QUALITY_METRICS.map((metric) => (
                <tr key={metric.name} className="border-b last:border-0">
                  <td className="py-2 pr-4">{metric.name}</td>
                  <td
                    className={`py-2 pr-4 ${isTier1 ? TIER_COLORS[1].bg + " font-medium rounded px-1" : ""}`}
                  >
                    {metric.tier1Target}
                  </td>
                  <td
                    className={`py-2 ${!isTier1 ? TIER_COLORS[tierLevel].bg + " font-medium rounded px-1" : ""}`}
                  >
                    {metric.tier23Target}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
