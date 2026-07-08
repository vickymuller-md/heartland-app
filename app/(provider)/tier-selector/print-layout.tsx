"use client";

import {
  CATEGORY_DEFINITIONS,
  QUALITY_METRICS,
  ASM_READINESS_ITEMS,
  TIER_LABELS,
} from "@/lib/tier-selector/constants";
import type { TierResult } from "@/lib/tier-selector/types";

interface PrintLayoutProps {
  result: TierResult;
}

export function PrintLayout({ result }: PrintLayoutProps) {
  return (
    <div className="hidden print:block space-y-6 text-sm">
      {/* Header */}
      <div className="border-b pb-4">
        <h1 className="text-xl font-bold">HEARTLAND Protocol</h1>
        <h2 className="text-lg font-semibold">
          Implementation Tier Assessment
        </h2>
      </div>

      {/* Tier Result Summary */}
      <section>
        <h3 className="text-base font-bold mb-2">Assessment Result</h3>
        <p className="text-lg font-bold">{result.tierLabel}</p>
        <p className="mt-1">{result.rationale}</p>

        <div className="mt-3">
          <h4 className="font-semibold mb-1">Category Breakdown</h4>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b">
                <th className="text-left py-1 pr-4">Category</th>
                <th className="text-left py-1">Level</th>
              </tr>
            </thead>
            <tbody>
              {result.categoryBreakdown.map((cat) => (
                <tr key={cat.categoryId} className="border-b">
                  <td className="py-1 pr-4">{cat.categoryLabel}</td>
                  <td className="py-1">
                    {TIER_LABELS[cat.selectedLevel]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Implementation Checklist */}
      <section>
        <h3 className="text-base font-bold mb-2">
          Implementation Checklist
        </h3>
        {CATEGORY_DEFINITIONS.map((cat) => {
          const catResult = result.categoryBreakdown.find(
            (c) => c.categoryId === cat.id,
          );
          const catTier = catResult
            ? catResult.selectedLevel
            : result.overallTier;
          const levelDef = cat.levels[catTier];
          return (
            <div key={cat.id} className="mb-2">
              <p className="font-semibold">
                {cat.label} ({TIER_LABELS[catTier]})
              </p>
              <p className="ml-4">{levelDef.description}</p>
            </div>
          );
        })}
      </section>

      {/* Quality Metrics */}
      <section>
        <h3 className="text-base font-bold mb-2">Quality Metrics Targets</h3>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b">
              <th className="text-left py-1 pr-4">Metric</th>
              <th className="text-left py-1 pr-4">Tier 1 Target</th>
              <th className="text-left py-1">Tier 2/3 Target</th>
            </tr>
          </thead>
          <tbody>
            {QUALITY_METRICS.map((metric) => (
              <tr key={metric.name} className="border-b">
                <td className="py-1 pr-4">{metric.name}</td>
                <td className="py-1 pr-4">{metric.tier1Target}</td>
                <td className="py-1">{metric.tier23Target}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ASM Readiness */}
      <section>
        <h3 className="text-base font-bold mb-2">
          Value-Based Payment Preparation (ASM 2027)
        </h3>
        <ul className="list-disc ml-6 space-y-1">
          {ASM_READINESS_ITEMS.map((item) => (
            <li key={item.id}>
              <span className="font-semibold">{item.label}</span>:{" "}
              {item.description}
            </li>
          ))}
        </ul>
      </section>

      {/* Footer */}
      <div className="border-t pt-4 text-xs text-gray-500 space-y-2">
        <p>
          Generated: {new Date().toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </p>
        <p>
          This tool is designed for healthcare professionals as a educational
          implementation-support resource. It does not provide medical diagnoses,
          treatment recommendations for individual patients, or replace
          clinical judgment. Not intended for direct patient care. For
          professional use only.
        </p>
      </div>
    </div>
  );
}
