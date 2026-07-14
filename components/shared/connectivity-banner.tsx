'use client';

import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import Link from 'next/link';

export function ConnectivityBanner({ workspace = 'provider' }: { workspace?: 'provider' | 'patient' }) {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  if (online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-start gap-2 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>
        Offline degraded mode. Information may be stale.{' '}
        {workspace === 'provider'
          ? 'Do not acknowledge, close, or document work until connectivity returns.'
          : 'Your entries are not stored on this device; reconnect before submitting.'}
        {workspace === 'provider' && (
          <> <Link href="/downtime" className="font-semibold underline">Open downtime playbook.</Link></>
        )}
      </span>
    </div>
  );
}
