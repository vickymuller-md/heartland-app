"use client";

import { useState } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ASM_READINESS_ITEMS } from "@/lib/tier-selector/constants";

export function ASMReadiness() {
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const toggleItem = (id: string) => {
    setChecked((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const checkedCount = Object.values(checked).filter(Boolean).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Value-Based Payment Preparation (ASM 2027)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          The Accountable Care Model for heart failure (ASM 2027) will require
          participating facilities to meet quality benchmarks. Prepare your
          facility by addressing these readiness items.
        </p>

        <p className="text-xs text-muted-foreground">
          {checkedCount} of {ASM_READINESS_ITEMS.length} items completed
        </p>

        <div className="space-y-3">
          {ASM_READINESS_ITEMS.map((item) => (
            <div
              key={item.id}
              className="flex items-start gap-3 rounded-lg border border-gray-200 p-3"
            >
              <Checkbox
                checked={checked[item.id] || false}
                onCheckedChange={() => toggleItem(item.id)}
                className="mt-0.5"
              />
              <div className="flex-1">
                <p className="text-sm font-medium">{item.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {item.description}
                </p>
              </div>
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          For more information, visit the{" "}
          <a
            href="https://innovation.cms.gov"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 underline hover:text-blue-800"
          >
            CMS Innovation Center
          </a>
          .
        </p>
      </CardContent>
    </Card>
  );
}
