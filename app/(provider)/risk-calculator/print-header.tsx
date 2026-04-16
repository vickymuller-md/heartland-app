'use client';

/**
 * Print-only header for the HEARTLAND Risk Assessment printout.
 * Hidden on screen (hidden), visible when printing (print:block).
 */
export function PrintHeader() {
  return (
    <div className="hidden print:block print:mb-4" data-testid="print-header">
      <h1 className="text-2xl font-bold">HEARTLAND Risk Assessment</h1>
      <p className="text-sm text-gray-600">
        Generated: {new Date().toLocaleDateString()}
      </p>
      <p className="mt-2 text-xs italic text-gray-500">
        The HEARTLAND Risk Stratification Framework is a proposed tool under
        development. It has not been validated against clinical outcomes data.
        Formal validation through registry data is a defined research objective.
      </p>
      <hr className="mt-3 border-gray-300" />
    </div>
  );
}
