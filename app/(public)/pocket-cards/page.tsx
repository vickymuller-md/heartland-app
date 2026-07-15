import type { Metadata } from 'next';
import { CardGallery } from './card-gallery';
import { ProviderPageDisclaimer } from '@/components/disclaimers/provider-page-disclaimer';

export const metadata: Metadata = {
  title: 'Pocket Card Library | HEARTLAND Protocol',
  description:
    'Digital reference library for all 10 HEARTLAND Protocol pocket cards, checklists, and reference materials. View, zoom, and download clinical reference figures.',
};

export default function PocketCardsPage() {
  return (
    <div className="space-y-8 print:space-y-4">
      {/* Screen header */}
      <div className="print:hidden">
        <h1 className="text-2xl font-bold tracking-tight">
          Protocol Pocket Cards
        </h1>
        <p className="text-muted-foreground mt-1">
          Digital reference library for all HEARTLAND Protocol pocket cards,
          checklists, and reference materials. Click any card to view full size
          with zoom.
        </p>
      </div>

      {/* Card gallery */}
      <CardGallery />

      <ProviderPageDisclaimer />
    </div>
  );
}
