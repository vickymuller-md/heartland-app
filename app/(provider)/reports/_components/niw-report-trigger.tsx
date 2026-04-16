/**
 * NiwReportTrigger -- Client Component
 *
 * Button that opens browser print dialog targeting the NiwTractionPrint layout.
 * Uses useReactToPrint with contentRef pattern (react-to-print v3).
 *
 * Requirement: REPT-06 (NIW traction print page)
 */

'use client';

import React, { useRef } from 'react';
import { useReactToPrint } from 'react-to-print';
import { NiwTractionPrint } from './niw-traction-print';
import type { NiwTractionData } from '@/lib/reports/types';

export function NiwReportTrigger({ data }: { data: NiwTractionData }) {
  const printRef = useRef<HTMLDivElement>(null);
  const handlePrint = useReactToPrint({ contentRef: printRef });

  return (
    <>
      <button
        onClick={() => handlePrint()}
        className="inline-flex items-center gap-2 rounded-md bg-blue-800 px-4 py-2 text-sm font-medium text-white hover:bg-blue-900"
      >
        Generate NIW Report
      </button>
      <NiwTractionPrint ref={printRef} data={data} />
    </>
  );
}
