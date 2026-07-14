'use client';

import { useState, useTransition } from 'react';
import { ShieldX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { revokeProviderAccess } from './actions';

export function RevokeAccessButton({ linkId, providerName }: { linkId: string; providerName: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <Button
        type="button"
        size="sm"
        variant="destructive"
        disabled={pending}
        onClick={() => {
          if (!window.confirm(`Revoke ${providerName}'s access to your HEARTLAND workspace?`)) return;
          startTransition(async () => {
            const result = await revokeProviderAccess(linkId);
            if (!result.success) setError(result.error ?? 'Unable to revoke access');
          });
        }}
      >
        <ShieldX className="mr-1 size-4" /> {pending ? 'Revoking…' : 'Revoke access'}
      </Button>
      {error && <p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}
