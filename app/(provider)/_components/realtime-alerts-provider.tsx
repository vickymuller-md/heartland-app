'use client';

/**
 * Realtime Alerts Provider -- Client Component
 *
 * Subscribes to Supabase Realtime postgres_changes on the alerts table
 * for linked patient IDs. On INSERT: invalidates React Query caches and
 * shows a toast notification. On UPDATE: invalidates caches only.
 *
 * CRITICAL: Single channel per provider session (anti-pattern: per-component).
 * CRITICAL: Cleanup via removeChannel in useEffect return.
 *
 * Requirements: DASH-08 (real-time update without page refresh)
 */

import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { showAlertToast } from './alert-toast';
import type { RealtimeChannel } from '@supabase/supabase-js';

interface RealtimeAlertsProviderProps {
  children: React.ReactNode;
  providerId: string;
  linkedPatientIds: string[];
}

export function RealtimeAlertsProvider({
  children,
  providerId,
  linkedPatientIds,
}: RealtimeAlertsProviderProps) {
  const queryClient = useQueryClient();
  const supabase = createClient();

  useEffect(() => {
    // Skip subscription if no linked patients
    if (linkedPatientIds.length === 0) return;

    // Subscribe to alerts table for linked patients only
    const channel: RealtimeChannel = supabase
      .channel(`provider-alerts-${providerId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'alerts',
          filter: `patient_id=in.(${linkedPatientIds.join(',')})`,
        },
        (payload) => {
          const newAlert = payload.new as {
            flags: string[];
            severity: string;
            patient_id: string;
          };

          // Invalidate React Query caches
          queryClient.invalidateQueries({ queryKey: ['alerts'] });
          queryClient.invalidateQueries({ queryKey: ['patients'] });
          queryClient.invalidateQueries({
            queryKey: ['patient', newAlert.patient_id],
          });

          // Show toast notification
          showAlertToast(newAlert);
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'alerts',
          filter: `patient_id=in.(${linkedPatientIds.join(',')})`,
        },
        () => {
          // Invalidate caches on status change (acknowledge/resolve)
          // No toast for status changes -- only for new alerts
          queryClient.invalidateQueries({ queryKey: ['alerts'] });
          queryClient.invalidateQueries({ queryKey: ['patients'] });
        }
      )
      .subscribe();

    // CRITICAL: Clean up subscription on unmount
    return () => {
      supabase.removeChannel(channel);
    };
    // Join IDs to avoid reference change issues with array dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerId, linkedPatientIds.join(','), queryClient, supabase]);

  return <>{children}</>;
}
