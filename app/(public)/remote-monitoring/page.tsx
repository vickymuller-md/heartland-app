import type { Metadata } from 'next';
import { TrackAssignment } from './track-assignment';
import { ReferenceCards } from './reference-cards';
import { ProviderPageDisclaimer } from '@/components/disclaimers/provider-page-disclaimer';
import { authorize } from '@/lib/auth/authorization';

export const metadata: Metadata = {
  title: 'Remote Monitoring & Track Assignment | HEARTLAND Protocol',
  description:
    'Remote Patient Monitoring Track Assignment tool with Red Flag Alert criteria and RPM billing codes -- Module 5 of the HEARTLAND Protocol.',
};

export default async function RemoteMonitoringPage() {
  const clinicalIntegrationEnabled = (await authorize('provider')).authorized;
  return (
    <div className="space-y-8 print:space-y-4">
      {/* Screen header */}
      <div className="print:hidden">
        <h1 className="text-2xl font-bold tracking-tight">
          Remote Monitoring & Track Assignment
        </h1>
        <p className="text-muted-foreground mt-1">
          Remote Patient Monitoring -- Module 5 of the HEARTLAND Protocol
        </p>
      </div>

      {/* Track Assignment section */}
      <section aria-labelledby="track-assignment-heading">
        <h2
          id="track-assignment-heading"
          className="mb-4 text-xl font-semibold print:hidden"
        >
          Track Assignment
        </h2>
        <TrackAssignment clinicalIntegrationEnabled={clinicalIntegrationEnabled} />
      </section>

      {/* Reference Cards section */}
      <section aria-labelledby="reference-cards-heading">
        <h2
          id="reference-cards-heading"
          className="mb-4 text-xl font-semibold print:hidden"
        >
          Reference Cards
        </h2>
        <ReferenceCards />
      </section>

      <ProviderPageDisclaimer />
    </div>
  );
}
