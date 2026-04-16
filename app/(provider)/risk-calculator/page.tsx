import type { Metadata } from 'next';
import { CalculatorForm } from './calculator-form';
import { ComparisonTable } from './comparison-table';
import { ProviderPageDisclaimer } from '@/components/disclaimers/provider-page-disclaimer';

export const metadata: Metadata = {
  title: 'HEARTLAND Risk Calculator',
  description:
    'HEARTLAND Risk Stratification Calculator — 10 clinical variables for rural heart failure risk assessment',
};

/**
 * Server component shell for the Risk Stratification Calculator page.
 * Renders the client-side CalculatorForm which handles all scoring logic.
 */
export default function RiskCalculatorPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 print:hidden">
        <h1 className="text-2xl font-bold tracking-tight">
          Risk Stratification Calculator
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Assess patient risk using the HEARTLAND scoring framework. Toggle
          clinical variables to compute the risk tier and care pathway.
        </p>
      </div>

      <ProviderPageDisclaimer variant="framework" className="mb-6" />

      <CalculatorForm />

      {/* Comparison table (reference material — hidden in print) */}
      <div className="mt-10">
        <ComparisonTable />
      </div>
    </div>
  );
}
