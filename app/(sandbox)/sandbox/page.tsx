import type { Metadata } from 'next';
import { ProductEventTracker } from '@/components/analytics/product-event-tracker';
import { SandboxWorkspace } from './sandbox-workspace';

export const metadata: Metadata = {
  title: 'Full Synthetic Sandbox | HEARTLAND Protocol',
  description: 'Explore HEARTLAND end to end with synthetic patients, operational workflows, pathways, coordination, patient experience, and impact reporting.',
};

export default function SandboxPage() {
  return (
    <>
      <ProductEventTracker eventName="sandbox_view" area="sandbox" trackDuration />
      <SandboxWorkspace />
    </>
  );
}
