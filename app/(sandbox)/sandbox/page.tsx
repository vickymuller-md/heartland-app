import type { Metadata } from 'next';
import { ProductEventTracker } from '@/components/analytics/product-event-tracker';
import { SandboxWorkspace } from './sandbox-workspace';

export const metadata: Metadata = {
  title: 'HEARTLAND Sandbox · Synthetic provider workflow',
  description: 'Explore the HEARTLAND operational workflow with synthetic data and no PHI.',
};

export default function SandboxPage() {
  return (
    <>
      <ProductEventTracker eventName="sandbox_view" area="sandbox" trackDuration />
      <SandboxWorkspace />
    </>
  );
}
