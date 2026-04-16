'use client';

import { useState, useMemo } from 'react';
import { evaluateDeviceCriteria } from '@/lib/comorbidity/engine';
import type { DeviceResult } from '@/lib/comorbidity/types';

function parseNumeric(value: string): number | null {
  if (value.trim() === '') return null;
  const n = parseFloat(value);
  return Number.isNaN(n) ? null : n;
}

const RESULT_STYLES: Record<
  DeviceResult,
  { bg: string; border: string; text: string; label: string }
> = {
  crt_candidate: {
    bg: 'bg-green-50',
    border: 'border-green-200',
    text: 'text-green-800',
    label: 'CRT Candidate',
  },
  possible_crt: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-800',
    label: 'Possible CRT (QRS 130-149 ms)',
  },
  icd_only: {
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    text: 'text-blue-800',
    label: 'Primary Prevention ICD Consideration',
  },
  monitor: {
    bg: 'bg-gray-50',
    border: 'border-gray-200',
    text: 'text-gray-600',
    label: 'Criteria Not Met -- Continue GDMT',
  },
  insufficient_data: {
    bg: 'bg-gray-50',
    border: 'border-gray-200',
    text: 'text-gray-500',
    label: 'Enter data to evaluate',
  },
};

export function DeviceCriteriaForm() {
  const [lvef, setLvef] = useState('');
  const [lbbb, setLbbb] = useState(false);
  const [qrsMs, setQrsMs] = useState('');
  const [gdmtDuration, setGdmtDuration] = useState('');

  const evaluation = useMemo(
    () =>
      evaluateDeviceCriteria({
        lvef: parseNumeric(lvef),
        lbbb,
        qrsMs: parseNumeric(qrsMs),
        gdmtDurationMonths: parseNumeric(gdmtDuration),
      }),
    [lvef, lbbb, qrsMs, gdmtDuration],
  );

  const style = RESULT_STYLES[evaluation.result];

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="text-base font-semibold text-gray-900">
        Device Evaluation Criteria
      </h3>
      <p className="mt-1 text-xs text-gray-500">
        CRT / ICD assessment per Protocol Module 6
      </p>

      <div className="mt-4 space-y-3">
        <div>
          <label
            htmlFor="device-lvef"
            className="block text-sm font-medium text-gray-700"
          >
            LVEF (%)
          </label>
          <input
            id="device-lvef"
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

        <div className="flex items-center gap-2">
          <button
            type="button"
            role="checkbox"
            aria-checked={lbbb}
            onClick={() => setLbbb((prev) => !prev)}
            className={`flex h-5 w-5 items-center justify-center rounded border text-xs transition-colors ${
              lbbb
                ? 'border-blue-500 bg-blue-500 text-white'
                : 'border-gray-300 bg-white text-transparent'
            }`}
          >
            {lbbb ? '\u2713' : ''}
          </button>
          <label
            className="text-sm font-medium text-gray-700 cursor-pointer"
            onClick={() => setLbbb((prev) => !prev)}
          >
            LBBB morphology present
          </label>
        </div>

        <div>
          <label
            htmlFor="device-qrs"
            className="block text-sm font-medium text-gray-700"
          >
            QRS Duration (ms)
          </label>
          <input
            id="device-qrs"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={qrsMs}
            onChange={(e) => setQrsMs(e.target.value)}
            placeholder="e.g. 155"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label
            htmlFor="device-gdmt"
            className="block text-sm font-medium text-gray-700"
          >
            GDMT Duration (months)
          </label>
          <input
            id="device-gdmt"
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
      </div>

      {/* Result display */}
      <div
        className={`mt-4 rounded-lg border p-3 ${style.bg} ${style.border}`}
      >
        <p className={`text-sm font-semibold ${style.text}`}>{style.label}</p>
        <p className={`mt-0.5 text-sm ${style.text}`}>
          {evaluation.recommendation}
        </p>
      </div>
    </div>
  );
}
