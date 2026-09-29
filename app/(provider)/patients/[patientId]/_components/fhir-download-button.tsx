'use client';

import { useEffect, useRef, useState } from 'react';
import { useSessionBoundExport } from '@/lib/exports/use-session-bound-export';

interface Props { providerId: string; patientId: string; contextId: string }

export function FhirDownloadButton(props: Props) {
  return <SessionDownload key={JSON.stringify([props.providerId, props.patientId, props.contextId])} {...props} />;
}

function SessionDownload({ providerId, patientId }: Props) {
  const { supabase, epoch, sessionReady, sessionError, isCurrent, verifySession } = useSessionBoundExport(providerId);
  const active = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || session?.user.id !== providerId) active.current?.abort();
    });
    return () => { active.current?.abort(); listener.subscription.unsubscribe(); };
  }, [supabase, providerId]);

  async function download() {
    const ticket = epoch.current;
    if (!sessionReady || !isCurrent(ticket) || active.current) return;
    const controller = new AbortController();
    active.current = controller; setBusy(true); setError(null);
    let objectUrl: string | null = null;
    let anchor: HTMLAnchorElement | null = null;
    try {
      await verifySession(ticket);
      const response = await fetch(`/api/patients/${encodeURIComponent(patientId)}/fhir`, {
        credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal,
        headers: { 'X-Heartland-Expected-Actor': providerId },
      });
      if (!isCurrent(ticket) || controller.signal.aborted) return;
      if (!response.ok) throw new Error(response.status === 413
        ? 'Export exceeds the 10,000-resource limit. No partial file was created.'
        : 'Export could not be verified. Reload the patient page and try again.');
      if (response.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/fhir+json'
        || response.headers.get('X-Heartland-Export-Actor')?.toLowerCase() !== providerId.toLowerCase()
        || response.headers.get('X-Heartland-Export-Patient')?.toLowerCase() !== patientId.toLowerCase()) {
        throw new Error('Export identity could not be verified. No file was created.');
      }
      // Keep the original bytes; JSON.parse would silently round FHIR decimals.
      const blob = await response.blob();
      await verifySession(ticket);
      if (!isCurrent(ticket) || controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      anchor = document.createElement('a'); anchor.href = objectUrl;
      anchor.download = `heartland-fhir-r4-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      // No await between the final fence and browser handoff. Already handed-off files cannot be revoked.
      anchor.click();
    } catch (failure) {
      if (isCurrent(ticket) && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Export could not be verified.');
    } finally {
      anchor?.remove();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (active.current === controller) active.current = null;
      if (isCurrent(ticket)) setBusy(false);
    }
  }
  if (sessionError) return <p role="alert" className="text-sm text-red-700 print:hidden">Export session changed. Reload the patient page.</p>;
  return <div className="print:hidden">
    <button type="button" onClick={() => void download()} disabled={!sessionReady || busy}
      className="inline-flex min-h-11 items-center rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50">
      {busy ? 'Preparing FHIR export…' : 'Export FHIR R4'}
    </button>
    {error && <p role="alert" className="mt-1 max-w-sm text-sm text-red-700">{error}</p>}
  </div>;
}
