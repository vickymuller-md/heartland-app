/**
 * SbarPrintLayout -- Print-only layout for SBAR handoff
 * Requirement: SBAR-04 (export PDF with HEARTLAND branding and disclaimer)
 *
 * Always in DOM (hidden on screen via "hidden print:block").
 * Visible only when browser print dialog is triggered via react-to-print.
 */

import { format } from 'date-fns';

interface SbarPrintLayoutProps {
  situation: string;
  background: string;
  assessment: string;
  recommendation: string;
  patientName: string;
  generatedAt: Date;
}

const SECTIONS = [
  { label: 'Situation', key: 'situation' },
  { label: 'Background', key: 'background' },
  { label: 'Assessment', key: 'assessment' },
  { label: 'Recommendation', key: 'recommendation' },
] as const;

export function SbarPrintLayout({
  situation,
  background,
  assessment,
  recommendation,
  patientName,
  generatedAt,
}: SbarPrintLayoutProps) {
  const content: Record<string, string> = {
    situation,
    background,
    assessment,
    recommendation,
  };

  return (
    <div className="hidden print:block" data-testid="sbar-print-layout">
      <div className="p-8 text-sm font-sans">
        {/* Header */}
        <h1 className="text-xl font-bold mb-1">
          HEARTLAND Protocol — Clinical Handoff (SBAR)
        </h1>
        <p className="text-sm text-gray-600 mb-1">
          Patient: {patientName}
        </p>
        <p className="text-xs text-gray-500 mb-4">
          Generated: {format(generatedAt, 'PPP p')}
        </p>

        {/* Disclaimer */}
        <p className="text-xs italic border border-gray-300 rounded p-2 mb-6">
          This tool is designed for healthcare professionals as a clinical
          decision support resource. It does not provide medical diagnoses,
          treatment recommendations for individual patients, or replace clinical
          judgment. Not intended for direct patient care. For professional use
          only.
        </p>

        {/* 4 SBAR sections */}
        {SECTIONS.map(({ label, key }) => (
          <section key={key} className="mb-6">
            <h2 className="font-bold text-base mb-2 border-b pb-1">{label}</h2>
            <p className="whitespace-pre-wrap leading-relaxed">
              {content[key]}
            </p>
          </section>
        ))}
      </div>
    </div>
  );
}
