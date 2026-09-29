'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useReactToPrint } from 'react-to-print';
import { createClient } from '@/lib/supabase/client';

interface PrintTicket {
  epoch: number;
  token: string;
  root: HTMLElement;
  title: string;
  frame: HTMLIFrameElement | null;
  observer: MutationObserver | null;
}

/** Account lifetime and export fences, not a claim that previously read sources are still current.
 * Consumers must remount for a new server context and hide all source/print content until ready.
 */
export function useSessionBoundExport(expectedActorId: string) {
  const [supabase] = useState(() => createClient());
  const alive = useRef(false);
  const blocked = useRef(false);
  const epoch = useRef(0);
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionError, setSessionError] = useState(false);
  const [printBusy, setPrintBusy] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const activePrint = useRef<PrintTicket | null>(null);
  const isCurrent = useCallback((ticket: number) =>
    alive.current && !blocked.current && epoch.current === ticket, []);
  const ownsFrame = useCallback((ticket: PrintTicket, frame: HTMLIFrameElement) => {
    try { return Boolean(frame.contentDocument?.querySelector(`[data-heartland-print-ticket="${ticket.token}"]`)); }
    catch { return false; }
  }, []);
  const watchPrintFrame = useCallback((ticket: PrintTicket, frame: HTMLIFrameElement) => {
    const claim = () => {
      if (!ownsFrame(ticket, frame)) return;
      ticket.frame = frame;
      if (activePrint.current !== ticket || !isCurrent(ticket.epoch)) frame.remove();
    };
    claim(); frame.addEventListener('load', claim, { once: true });
  }, [ownsFrame, isCurrent]);
  const finishPrint = useCallback((ticket: PrintTicket | null, removeClone = false) => {
    if (!ticket) return;
    // Drain queued appends before disconnecting, including an iframe whose body is still empty.
    for (const record of ticket.observer?.takeRecords() ?? []) for (const node of record.addedNodes) {
      if (node instanceof HTMLIFrameElement && node.id === 'printWindow') watchPrintFrame(ticket, node);
    }
    ticket.observer?.disconnect();
    if (removeClone) {
      ticket.frame?.remove();
      const candidate = document.getElementById('printWindow');
      if (candidate instanceof HTMLIFrameElement) {
        if (ownsFrame(ticket, candidate)) candidate.remove();
        else watchPrintFrame(ticket, candidate);
      }
    }
    if (ticket.root.dataset.heartlandPrintTicket === ticket.token) delete ticket.root.dataset.heartlandPrintTicket;
    if (activePrint.current === ticket) {
      activePrint.current = null;
      if (alive.current) setPrintBusy(false);
    }
  }, [ownsFrame, watchPrintFrame]);
  const invalidateContent = useCallback(() => {
    epoch.current += 1;
    finishPrint(activePrint.current, true);
  }, [finishPrint]);
  const invalidateSession = useCallback(() => {
    blocked.current = true;
    invalidateContent();
    if (alive.current) { setSessionReady(false); setSessionError(true); }
  }, [invalidateContent]);
  const verifySession = useCallback(async (ticket: number) => {
    if (!isCurrent(ticket)) throw new Error('Export context changed');
    const { data: auth, error } = await supabase.auth.getUser();
    // An obsolete response (including StrictMode cleanup) cannot invalidate a newer lifetime.
    if (!isCurrent(ticket)) throw new Error('Export context changed');
    if (error || auth.user?.id !== expectedActorId) {
      invalidateSession(); throw new Error('Export session changed');
    }
    if (!isCurrent(ticket)) throw new Error('Export context changed');
  }, [isCurrent, supabase, expectedActorId, invalidateSession]);
  useEffect(() => {
    alive.current = true;
    const ticket = epoch.current;
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || session?.user.id !== expectedActorId) invalidateSession();
    });
    void verifySession(ticket).then(() => {
      if (isCurrent(ticket)) setSessionReady(true);
    }).catch(() => { if (isCurrent(ticket)) invalidateSession(); });
    return () => {
      alive.current = false; epoch.current += 1;
      finishPrint(activePrint.current, true); listener.subscription.unsubscribe();
    };
  }, [supabase, expectedActorId, isCurrent, verifySession, invalidateSession, finishPrint]);

  const beforePrint = async () => {
    const ticket = activePrint.current;
    try {
      if (!ticket) throw new Error('No current print request');
      await verifySession(ticket.epoch);
      if (ticket !== activePrint.current) throw new Error('Print request changed');
    } catch (error) {
      finishPrint(ticket, true);
      if (ticket && isCurrent(ticket.epoch)) setPrintError('Printing stopped because the session could not be verified.');
      throw error;
    }
  };
  const guardedPrint = async (iframe: HTMLIFrameElement) => {
    const candidate = activePrint.current;
    const ticket = candidate && ownsFrame(candidate, iframe) ? candidate : null;
    try {
      if (!ticket) throw new Error('No current print request');
      await verifySession(ticket.epoch);
      if (!isCurrent(ticket.epoch) || ticket !== activePrint.current || !iframe.contentWindow) throw new Error('Print context changed');
      // No await between the final fence and handing the document to the browser.
      iframe.contentDocument!.title = ticket.title;
      iframe.contentWindow.focus(); iframe.contentWindow.print();
    } catch (error) {
      iframe.remove();
      if (ticket && isCurrent(ticket.epoch)) setPrintError('Printing stopped because the document could not be verified.');
      throw error;
    } finally { finishPrint(ticket); }
  };
  const handlePrint = useReactToPrint({
    onBeforePrint: beforePrint, print: guardedPrint,
    // Each failing callback handles its captured ticket; an old error must not clear a newer job.
    onPrintError: () => {},
  });
  const beginPrint = (root: HTMLElement | null, title: string) => {
    if (!root || !sessionReady || !isCurrent(epoch.current) || activePrint.current) return;
    const ticket: PrintTicket = { epoch: epoch.current, token: crypto.randomUUID(), root, title, frame: null, observer: null };
    root.dataset.heartlandPrintTicket = ticket.token;
    activePrint.current = ticket; setPrintBusy(true); setPrintError(null);
    ticket.observer = new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node instanceof HTMLIFrameElement && node.id === 'printWindow') watchPrintFrame(ticket, node);
      }
    });
    ticket.observer.observe(document.body, { childList: true });
    // The library awaits onBeforePrint before obtaining/cloning content. Fence that gap too.
    handlePrint(() => isCurrent(ticket.epoch) && activePrint.current === ticket
      && root.dataset.heartlandPrintTicket === ticket.token ? root : null);
  };
  return { supabase, alive, epoch, sessionReady, sessionError, isCurrent, verifySession,
    invalidateSession, invalidateContent, beginPrint, printBusy, printError };
}
