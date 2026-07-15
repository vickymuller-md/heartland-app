import type { Metadata } from 'next';
import { ChecklistWizard } from './checklist-wizard';
import { ProviderPageDisclaimer } from '@/components/disclaimers/provider-page-disclaimer';
import { authorize } from '@/lib/auth/authorization';

export const metadata: Metadata = {
  title: 'Telephone Titration Checklist | HEARTLAND Protocol',
  description:
    'Step-by-step guided checklist for phone-based GDMT titration with safety gate assessment, based on the Hozho Trial methodology.',
};

/**
 * Server component shell for the Telephone Titration Checklist page.
 * Renders the client-side ChecklistWizard which handles all step logic.
 */
export default async function TitrationChecklistPage() {
  const clinicalIntegrationEnabled = (await authorize('provider')).authorized;
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 print:hidden">
        <h1 className="text-2xl font-bold tracking-tight">
          Telephone Titration Checklist
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Walk through phone-based medication titration with automated safety gate assessment.
          Based on the Hozho Trial methodology for rural HF management.
        </p>
      </div>

      <ProviderPageDisclaimer className="mb-6" />

      <ChecklistWizard clinicalIntegrationEnabled={clinicalIntegrationEnabled} />
    </div>
  );
}
