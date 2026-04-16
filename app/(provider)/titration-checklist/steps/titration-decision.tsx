'use client';

import { useMemo } from 'react';
import { TitrationDecisionTable } from '@/components/titration/titration-decision-table';
import { getTitrationAction } from '@/lib/titration/engine';
import type { VitalSigns, DrugClassRecommendation } from '@/lib/titration/types';
import { ArrowUp, Pause, ArrowDown, AlertTriangle } from 'lucide-react';

interface TitrationDecisionProps {
  vitals: VitalSigns;
  providerNotes: string;
  onNotesChange: (notes: string) => void;
  perDrugRecommendations?: DrugClassRecommendation[];
  showAceiWarning?: boolean;
}

const ACTION_CONFIG = {
  uptitrate: {
    icon: ArrowUp,
    label: 'UPTITRATE',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-200',
  },
  hold: {
    icon: Pause,
    label: 'HOLD',
    className: 'border-yellow-200 bg-yellow-50 text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950/20 dark:text-yellow-200',
  },
  reduce: {
    icon: ArrowDown,
    label: 'REDUCE',
    className: 'border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/20 dark:text-red-200',
  },
} as const;

const PER_DRUG_ACTION_COLORS: Record<string, string> = {
  uptitrate: 'bg-emerald-100 text-emerald-800',
  hold: 'bg-yellow-100 text-yellow-800',
  reduce: 'bg-red-100 text-red-800',
  'not-applicable': 'bg-gray-100 text-gray-600',
};

export function TitrationDecision({
  vitals,
  providerNotes,
  onNotesChange,
  perDrugRecommendations = [],
  showAceiWarning = false,
}: TitrationDecisionProps) {
  const action = useMemo(() => getTitrationAction(vitals), [vitals]);
  const config = ACTION_CONFIG[action.action];
  const Icon = config.icon;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Titration Decision</h2>
      <p className="text-sm text-muted-foreground">
        Algorithm-guided recommendation based on entered vitals. The provider makes the final clinical decision.
      </p>

      {/* ACEi + ARNI washout warning */}
      {showAceiWarning && (
        <div
          role="alert"
          data-testid="acei-washout-warning"
          className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div>
            <p className="font-semibold">ACEi + ARNI Washout Required</p>
            <p className="mt-0.5 text-amber-700">
              ACEi detected in medication list. Allow 36-hour washout before initiating ARNI.
              Stopping ACEi and starting ARNI same-day risks life-threatening angioedema.
            </p>
          </div>
        </div>
      )}

      {/* Per-drug recommendation table */}
      {perDrugRecommendations.length > 0 && (
        <div data-testid="per-drug-recommendations">
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
            Per-Drug Recommendations
          </h3>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Drug Class</th>
                  <th className="px-3 py-2 text-left font-medium">Action</th>
                  <th className="px-3 py-2 text-left font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {perDrugRecommendations.map((rec) => (
                  <tr key={rec.drugClass} className="border-t">
                    <td className="px-3 py-2 font-medium">{rec.drugClass}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${PER_DRUG_ACTION_COLORS[rec.action] ?? 'bg-gray-100 text-gray-600'}`}>
                        {rec.action.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{rec.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Global calculated recommendation */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
          {perDrugRecommendations.length > 0 ? 'Global Summary' : 'Recommendation'}
        </h3>
        <div
          className={`flex items-center gap-3 rounded-lg border p-4 ${config.className}`}
          data-testid="titration-recommendation"
        >
          <Icon className="size-6 shrink-0" />
          <div>
            <p className="text-lg font-bold">{config.label}</p>
            <p className="text-sm">{action.details}</p>
          </div>
        </div>
      </div>

      {/* Decision algorithm reference table */}
      <div className="mt-6">
        <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
          Decision Algorithm Reference
        </h3>
        <TitrationDecisionTable highlightVitals={vitals} />
      </div>

      {/* Provider notes / override */}
      <div className="mt-4 space-y-1.5">
        <label htmlFor="provider-notes" className="text-sm font-medium">
          Provider Notes / Override
        </label>
        <textarea
          id="provider-notes"
          className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          rows={3}
          placeholder="Optional: Add clinical notes or document if overriding the algorithm recommendation..."
          value={providerNotes}
          onChange={(e) => onNotesChange(e.target.value)}
        />
      </div>
    </div>
  );
}
