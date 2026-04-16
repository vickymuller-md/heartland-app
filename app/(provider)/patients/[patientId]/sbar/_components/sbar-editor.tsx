'use client';

/**
 * SbarEditor -- Editable SBAR form with PDF export
 * Requirements: SBAR-01 (4-section form), SBAR-03 (editable), SBAR-04 (PDF export)
 *
 * Client Component with 4 controlled textareas and react-to-print integration.
 * Print layout always in DOM (hidden on screen) for reliable print ref.
 */

import { useRef, useState } from 'react';
import { useReactToPrint } from 'react-to-print';
import Link from 'next/link';
import { ArrowLeft, Printer } from 'lucide-react';
import { SbarPrintLayout } from './sbar-print-layout';
import type { SbarData } from '@/lib/sbar/types';

interface SbarEditorProps {
  initialData: SbarData;
  patientName: string;
  patientId: string;
}

const SECTIONS = [
  { key: 'situation', label: 'S \u2014 Situation', id: 'sbar-situation' },
  { key: 'background', label: 'B \u2014 Background', id: 'sbar-background' },
  { key: 'assessment', label: 'A \u2014 Assessment', id: 'sbar-assessment' },
  { key: 'recommendation', label: 'R \u2014 Recommendation', id: 'sbar-recommendation' },
] as const;

export function SbarEditor({ initialData, patientName, patientId }: SbarEditorProps) {
  const [situation, setSituation] = useState(initialData.situation);
  const [background, setBackground] = useState(initialData.background);
  const [assessment, setAssessment] = useState(initialData.assessment);
  const [recommendation, setRecommendation] = useState(initialData.recommendation);

  const printRef = useRef<HTMLDivElement>(null);
  const handlePrint = useReactToPrint({ contentRef: printRef });

  const state: Record<string, string> = { situation, background, assessment, recommendation };
  const setters: Record<string, (v: string) => void> = {
    situation: setSituation,
    background: setBackground,
    assessment: setAssessment,
    recommendation: setRecommendation,
  };

  return (
    <div>
      {/* Editable form -- screen only */}
      <div className="print:hidden space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <Link
              href={`/patients/${patientId}`}
              className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors mb-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Patient
            </Link>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">
              SBAR Handoff — {patientName}
            </h1>
          </div>
          <button
            type="button"
            onClick={() => handlePrint()}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
          >
            <Printer className="h-4 w-4" />
            Export PDF
          </button>
        </div>

        {/* 4 SBAR sections */}
        {SECTIONS.map(({ key, label, id }) => (
          <div key={key}>
            <label htmlFor={id} className="block text-sm font-semibold text-gray-800 mb-1.5">
              {label}
            </label>
            <textarea
              id={id}
              rows={6}
              value={state[key]}
              onChange={(e) => setters[key](e.target.value)}
              className="w-full rounded-md border border-gray-300 p-3 text-sm font-mono leading-relaxed resize-y min-h-[120px] focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        ))}
      </div>

      {/* Print layout -- always in DOM, hidden on screen */}
      <div ref={printRef}>
        <SbarPrintLayout
          situation={situation}
          background={background}
          assessment={assessment}
          recommendation={recommendation}
          patientName={patientName}
          generatedAt={new Date()}
        />
      </div>
    </div>
  );
}
