import Link from 'next/link';
import { WorkspaceBrand } from '@/components/shared/workspace-brand';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 py-10">
      <Link href="/" aria-label="Heartland home" className="inline-flex min-h-11 items-center rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><WorkspaceBrand /></Link>
      <main id="main-content" className="w-full max-w-md">{children}</main>
    </div>
  );
}
