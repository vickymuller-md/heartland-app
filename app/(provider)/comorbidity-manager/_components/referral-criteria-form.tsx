'use client';

import { useState, useMemo } from 'react';
import { AlertTriangle, Info, Shield } from 'lucide-react';
import {
  evaluateReferralCriteria,
} from '@/lib/comorbidity/engine';
import type { ReferralResult } from '@/lib/comorbidity/types';

function parseNumeric(value: string): number | null {
  if (value.trim() === '') return null;
  const n = parseFloat(value);
  return Number.isNaN(n) ? null : n;
}

function parseInteger(value: string): number | null {
  if (value.trim() === '') return null;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? null : n;
}

const RESULT_STYLES: Record<
  ReferralResult,
  { bg: string; border: string; text: string; icon: typeof AlertTriangle }
> = {
  refer: {
    bg: 'bg-red-50',
    border: 'border-red-200',
    text: 'text-red-800',
    icon: AlertTriangle,
  },
  monitor: {
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    text: 'text-blue-800',
    icon: Shield,
  },
  insufficient_data: {
    bg: 'bg-gray-50',
    border: 'border-gray-200',
    text: 'text-gray-600',
    icon: Info,
  },
};

const RESULT_LABELS: Record<ReferralResult, string> = {
  refer: 'Referral Recommended',
  monitor: 'Continue GDMT Optimization',
  insufficient_data: 'Incomplete Data',
};

export function ReferralCriteriaForm() {
  const [lvef, setLvef] = useState('');
  const [gdmtDuration, setGdmtDuration] = useState('');
  const [hospitalizations, setHospitalizations] = useState('');

  const evaluation = useMemo(
    () =>
      evaluateReferralCriteria({
        lvef: parseNumeric(lvef),
        gdmtDurationMonths: parseNumeric(gdmtDuration),
        hfHospitalizationsLast12m: parseInteger(hospitalizations),
      }),
    [lvef, gdmtDuration, hospitalizations],
  );

  const style = RESULT_STYLES[evaluation.result];
  const Icon = style.icon;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="text-base font-semibold text-gray-900">
        Advanced HF Referral Criteria
      </h3>
      <p className="mt-1 text-xs text-gray-500">
        Protocol Module 6, Section 6.2
      </p>

      <div className="mt-4 space-y-3">
        <div>
          <label
            htmlFor="referral-lvef"
            className="block text-sm font-medium text-gray-700"
          >
            LVEF (%)
          </label>
          <input
            id="referral-lvef"
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            step={1}
            value={lvef}
            onChange={(e) => setLvef(e.target.value)}
            placeholder="e.g. 30"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label
            htmlFor="referral-gdmt"
            className="block text-sm font-medium text-gray-700"
          >
            GDMT Duration (months)
          </label>
          <input
            id="referral-gdmt"
            type="number"
            inputMode="decimal"
            min={0}
            step={1}
            value={gdmtDuration}
            onChange={(e) => setGdmtDuration(e.target.value)}
            placeholder="e.g. 4"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label
            htmlFor="referral-hosp"
            className="block text-sm font-medium text-gray-700"
          >
            HF Hospitalizations (last 12 months)
          </label>
          <input
            id="referral-hosp"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={hospitalizations}
            onChange={(e) => setHospitalizations(e.target.value)}
            placeholder="e.g. 2"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Result display */}
      <div
        className={`mt-4 flex items-start gap-2 rounded-lg border p-3 ${style.bg} ${style.border}`}
      >
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${style.text}`} />
        <div className={`text-sm ${style.text}`}>
          <p className="font-semibold">{RESULT_LABELS[evaluation.result]}</p>
          <p className="mt-0.5">{evaluation.recommendation}</p>
        </div>
      </div>

      {/* Additional criteria (always shown when data is present) */}
      {evaluation.additionalCriteria.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-gray-500">
            Additional Referral Considerations
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-gray-600">
            {evaluation.additionalCriteria.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
