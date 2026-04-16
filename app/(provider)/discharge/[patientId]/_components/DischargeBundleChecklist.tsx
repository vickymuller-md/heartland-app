'use client';

/**
 * DischargeBundleChecklist -- Client Component
 * Requirement: DSCH-01 (tier-aware discharge bundle checklist)
 *
 * Renders 4 bundle items with tier-specific descriptions.
 * Checked state is optimistic UI (persistence via saveDischarge bundle_completed jsonb).
 *
 * Source: HEARTLAND Protocol v3.3 Module 4, Section 4.1
 */

import { useState } from 'react';
import { CheckCircle, Circle } from 'lucide-react';
import { BUNDLE_COMPONENTS } from '@/lib/discharge/constants';

interface DischargeBundleChecklistProps {
  tier: 1 | 2 | 3;
  initialChecked?: Record<string, boolean>;
}

export function DischargeBundleChecklist({
  tier,
  initialChecked,
}: DischargeBundleChecklistProps) {
  const [checked, setChecked] = useState<Record<string, boolean>>(
    initialChecked ?? {}
  );

  const toggleItem = (id: string) => {
    setChecked((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const completedCount = BUNDLE_COMPONENTS.filter((c) => checked[c.id]).length;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 print:hidden">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">
          Discharge Bundle Checklist
        </h2>
        <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
          Tier {tier}
        </span>
      </div>

      <p className="text-sm text-gray-500 mb-4">
        {completedCount} of {BUNDLE_COMPONENTS.length} items completed
      </p>

      <ul className="space-y-2" data-testid="bundle-list">
        {BUNDLE_COMPONENTS.map((item) => {
          const isChecked = !!checked[item.id];
          const description = tier === 1 ? item.tier1 : item.tier23;

          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => toggleItem(item.id)}
                className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                  isChecked
                    ? 'border-emerald-200 bg-emerald-50'
                    : 'border-gray-200 bg-white hover:bg-gray-50'
                }`}
                data-testid={`bundle-item-${item.id}`}
              >
                {isChecked ? (
                  <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                ) : (
                  <Circle className="mt-0.5 h-5 w-5 shrink-0 text-gray-400" />
                )}
                <div>
                  <span className="text-sm font-medium text-gray-900">
                    {item.label}
                  </span>
                  <span className="ml-2 text-xs text-gray-500">
                    {item.timing}
                  </span>
                  <p className="mt-1 text-sm text-gray-600">{description}</p>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
