import type { Metadata } from 'next';
import { TierQuestionnaire } from './questionnaire';
import { ProviderPageDisclaimer } from '@/components/disclaimers/provider-page-disclaimer';
import { authorize } from '@/lib/auth/authorization';

export const metadata: Metadata = {
  title: 'Implementation Tier Selector | HEARTLAND Protocol',
  description:
    'Assess your facility resources to determine the appropriate HEARTLAND Protocol implementation tier.',
};

/**
 * Server component shell for the Tier Selector page.
 * Renders the client-side TierQuestionnaire which handles all assessment logic.
 */
export default async function TierSelectorPage() {
  const clinicalIntegrationEnabled = (await authorize('provider')).authorized;
  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 print:hidden">
        <h1 className="text-2xl font-bold tracking-tight">
          Implementation Tier Selector
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Assess your facility&apos;s resources to determine the appropriate
          HEARTLAND Protocol implementation tier.
        </p>
      </div>

      <ProviderPageDisclaimer className="mb-6" />

      <TierQuestionnaire clinicalIntegrationEnabled={clinicalIntegrationEnabled} />
    </div>
  );
}
