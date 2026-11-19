'use client';

import { createContext, useContext, useEffect, useEffectEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { showAlertToast } from './alert-toast';

type StreamStatus = 'connecting' | 'connected' | 'unavailable';
const StreamContext = createContext<StreamStatus>('connecting');

export function AlertRefreshStatus({ checkedAt }: { checkedAt: string }) {
  const status = useContext(StreamContext);
  const label = { connecting: 'Connecting to updates', connected: 'Listening for updates', unavailable: 'Live updates interrupted. Refreshing periodically while online' }[status];
  return <p role="status" className="mt-1 text-xs text-slate-600">{label} · View loaded <time dateTime={checkedAt}>{checkedAt.slice(11, 19)} UTC</time></p>;
}

export function RealtimeAlertsProvider({ children, providerId, linkedPatientIds, linksAvailable = true }: {
  children: React.ReactNode; providerId: string; linkedPatientIds: string[]; linksAvailable?: boolean;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const supabase = createClient();
  const links = [...new Set(linkedPatientIds)].sort().join(',');
  const [status, setStatus] = useState<StreamStatus>('connecting');
  const refreshView = useEffectEvent(() => router.refresh());
  const notify = useEffectEvent((alert: Parameters<typeof showAlertToast>[0]) => showAlertToast(alert, () => router.push('/alerts')));

  useEffect(() => {
    let active = true;
    let connected = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const seen = new Set<string>();
    const ids = links ? links.split(',') : [];
    const allowed = new Set(ids);
    function scheduleRead() {
      if (!active || timer || document.visibilityState === 'hidden' || !navigator.onLine) return;
      timer = setTimeout(() => { timer = undefined; if (active) refreshView(); }, 150);
    }
    function catchUp() {
      if (!active) return;
      setStatus(navigator.onLine && connected && linksAvailable ? 'connected' : 'unavailable');
      scheduleRead();
    }
    const channel = supabase.channel(`provider-alerts-${providerId}`);
    for (let start = 0; start < ids.length; start += 100) {
      const filter = `patient_id=in.(${ids.slice(start, start + 100).join(',')})`;
      channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'alerts', filter }, payload => {
        if (!active) return;
        const alert = payload.new as { id?: string; flags: string[]; severity: string; patient_id: string };
        if (!allowed.has(alert.patient_id)) return;
        if (alert.id && seen.has(alert.id)) return;
        if (alert.id) {
          seen.add(alert.id);
          if (seen.size > 256) seen.delete(seen.values().next().value!);
        }
        void queryClient.invalidateQueries({ queryKey: ['alerts'] });
        void queryClient.invalidateQueries({ queryKey: ['patients'] });
        void queryClient.invalidateQueries({ queryKey: ['patient', alert.patient_id] });
        notify(alert);
        scheduleRead();
      });
      channel.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'alerts', filter }, () => {
        if (!active) return;
        void queryClient.invalidateQueries({ queryKey: ['alerts'] });
        void queryClient.invalidateQueries({ queryKey: ['patients'] });
        scheduleRead();
      });
    }
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'provider_patient_links', filter: `provider_id=eq.${providerId}` }, scheduleRead);
    channel.subscribe(state => {
      if (!active) return;
      connected = state === 'SUBSCRIBED';
      setStatus(connected && navigator.onLine && linksAvailable ? 'connected' : 'unavailable');
      if (connected) scheduleRead();
    });
    // An open socket can miss a database change. Reconcile the operational views
    // while visible, including when the transport still reports a subscription.
    const recovery = setInterval(() => {
      const operational = ['/alerts', '/dashboard'].includes(window.location.pathname);
      if (operational || !connected || !linksAvailable) scheduleRead();
    }, 30_000);
    window.addEventListener('online', catchUp);
    window.addEventListener('offline', catchUp);
    window.addEventListener('focus', catchUp);
    document.addEventListener('visibilitychange', catchUp);
    return () => {
      active = false;
      clearTimeout(timer);
      clearInterval(recovery);
      window.removeEventListener('online', catchUp);
      window.removeEventListener('offline', catchUp);
      window.removeEventListener('focus', catchUp);
      document.removeEventListener('visibilitychange', catchUp);
      void supabase.removeChannel(channel);
    };
  }, [providerId, links, linksAvailable, queryClient, supabase]);

  return <StreamContext.Provider value={status}>{children}</StreamContext.Provider>;
}
