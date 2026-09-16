import type { Metadata } from 'next';
import { ProviderPageDisclaimer } from '@/components/disclaimers/provider-page-disclaimer';
import { GuideContent } from './_components/guide-content';

export const metadata: Metadata = {
  title: 'Protocol Guide | HEARTLAND Protocol',
  description:
    'Ask a bounded assistant about the published HEARTLAND Protocol content, with references. Educational implementation-support resource; not medical advice.',
};

export default function GuidePage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 print:max-w-none print:px-8">
      <GuideContent />
      <ProviderPageDisclaimer className="mt-8" />
    </div>
  );
}
