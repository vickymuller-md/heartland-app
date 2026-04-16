'use client';

/**
 * Mute Toggle -- Client Component
 *
 * Button to mute a specific alert type for a patient.
 * Uses useTransition for pending state and router.refresh() for revalidation.
 *
 * Requirements: ALRT-07 (per-patient alert type muting)
 */

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { muteAlertType } from '@/lib/dashboard/actions';
import { BellOff, Loader2 } from 'lucide-react';

interface MuteToggleProps {
  patientId: string;
  alertType: string; // first flag from alert.flags[]
}

export function MuteToggle({ patientId, alertType }: MuteToggleProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleMute = () => {
    startTransition(async () => {
      await muteAlertType(patientId, alertType);
      router.refresh();
    });
  };

  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={handleMute}
      disabled={isPending}
      title={`Mute ${alertType} alerts for this patient`}
      data-testid="mute-btn"
    >
      {isPending
        ? <Loader2 className="size-3 animate-spin" />
        : <BellOff className="size-3" />}
      <span className="ml-1 hidden sm:inline">Mute</span>
    </Button>
  );
}
