'use client';

/**
 * PrintableInstructions -- Client Component
 * Requirement: DSCH-06 (tier-appropriate printable discharge instructions)
 *
 * Uses react-to-print for browser print dialog. Print target is hidden on screen,
 * visible on print. Tier 1 gets 3 core domains; Tier 2/3 gets all 8 domains.
 *
 * Source: HEARTLAND Protocol v3.3 Module 4, Section 4.3
 */

import { useRef } from 'react';
import { useReactToPrint } from 'react-to-print';
import { Printer } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { TEACH_BACK_DOMAINS } from '@/lib/discharge/constants';

interface PrintableInstructionsProps {
  patientName: string;
  dischargedAt: string;
  facilityTier: 1 | 2 | 3;
  providerName: string;
}

export function PrintableInstructions({
  patientName,
  dischargedAt,
  facilityTier,
  providerName,
}: PrintableInstructionsProps) {
  const printRef = useRef<HTMLDivElement>(null);

  const handlePrint = useReactToPrint({
    contentRef: printRef,
  });

  // Tier 1: domains with tier === 'all' (3 domains)
  // Tier 2/3: all 8 domains
  const domains =
    facilityTier === 1
      ? TEACH_BACK_DOMAINS.filter((d) => d.tier === 'all')
      : TEACH_BACK_DOMAINS;

  return (
    <>
      {/* Print button -- visible on screen only */}
      <div className="print:hidden">
        <button
          type="button"
          onClick={() => handlePrint()}
          className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
          data-testid="print-button"
        >
          <Printer className="h-4 w-4" />
          Print Discharge Instructions
        </button>
      </div>

      {/* Print target -- hidden on screen, visible on print */}
      <div ref={printRef} className="hidden print:block" data-testid="print-content">
        <div className="p-8 text-sm font-sans print:text-black print:bg-white">
          {/* Header */}
          <h1 className="text-xl font-bold mb-1">
            HEARTLAND Protocol — Discharge Instructions
          </h1>
          <p className="text-sm text-gray-600 mb-1">
            Patient: {patientName}
          </p>
          <p className="text-sm text-gray-600 mb-1">
            Discharge Date: {format(parseISO(dischargedAt), 'MMMM d, yyyy')}
          </p>
          <p className="text-sm text-gray-600 mb-1">
            Provider: {providerName}
          </p>
          <p className="text-xs text-gray-500 mb-4">
            Tier {facilityTier} — {domains.length} teach-back domains
          </p>

          {/* Teach-back domains */}
          <h2 className="text-base font-bold mb-3 border-b pb-1">
            Teach-Back Education Domains
          </h2>

          {domains.map((domain) => (
            <section key={domain.id} className="mb-5" data-testid={`print-domain-${domain.id}`}>
              <h3 className="font-semibold text-sm mb-1">{domain.title}</h3>
              <p className="text-sm leading-relaxed mb-2">{domain.description}</p>
              <div className="border border-gray-300 rounded p-3 min-h-[3rem]">
                <p className="text-xs text-gray-400 italic">
                  Teach-back verification notes:
                </p>
              </div>
            </section>
          ))}

          {/* Disclaimer */}
          <div className="mt-8 border-t pt-4">
            <p className="text-xs italic text-gray-500">
              This tool is designed for healthcare professionals as a clinical
              decision support resource. It does not provide medical diagnoses,
              treatment recommendations for individual patients, or replace
              clinical judgment. Not intended for direct patient care. For
              professional use only.
            </p>
            <p className="text-xs italic text-gray-500 mt-2">
              The HEARTLAND Risk Stratification Framework is a proposed tool
              under development. It has not been validated against clinical
              outcomes data. Formal validation through registry data is a
              defined research objective.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
