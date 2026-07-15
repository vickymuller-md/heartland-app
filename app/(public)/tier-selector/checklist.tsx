"use client";

import { useState } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { CATEGORY_DEFINITIONS, TIER_COLORS } from "@/lib/tier-selector/constants";
import type { TierLevel, TierResult } from "@/lib/tier-selector/types";

interface ImplementationChecklistProps {
  result: TierResult;
  tierLevel: TierLevel;
}

export function ImplementationChecklist({
  result,
  tierLevel,
}: ImplementationChecklistProps) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const colors = TIER_COLORS[tierLevel];

  const toggleItem = (id: string) => {
    setChecked((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const checkedCount = Object.values(checked).filter(Boolean).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Implementation Checklist</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          {checkedCount} of {CATEGORY_DEFINITIONS.length} items checked
        </p>
        {CATEGORY_DEFINITIONS.map((cat) => {
          // Get the tier for this specific category from the result
          const catResult = result.categoryBreakdown.find(
            (c) => c.categoryId === cat.id,
          );
          const catTier = catResult ? catResult.selectedLevel : tierLevel;
          const levelDef = cat.levels[catTier];
          const itemId = `checklist-${cat.id}`;

          return (
            <div
              key={cat.id}
              className={`rounded-lg border p-3 ${colors.border}`}
            >
              <div className="flex items-start gap-3">
                <Checkbox
                  checked={checked[itemId] || false}
                  onCheckedChange={() => toggleItem(itemId)}
                  className="mt-0.5"
                />
                <div className="flex-1">
                  <p className="text-sm font-medium">{cat.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {levelDef.description}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
