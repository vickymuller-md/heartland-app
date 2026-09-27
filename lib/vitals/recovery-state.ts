import type { VitalsActionState } from './types';

/** Keep proven receipts through a transient read failure, never through access
 * revocation or across identities. A fresh authorized receipt always wins. */
export function mergeRecoveredVitals(previous: VitalsActionState, result: VitalsActionState,
  requestedId?: string): VitalsActionState {
  if (result.errorKind === 'access') return result;
  const sameReceipt = Boolean(previous.saved && previous.requestId && previous.requestId === requestedId);
  if (sameReceipt && result.error && !result.saved) {
    return { ...previous, error: result.error, errorKind: result.errorKind };
  }
  if (sameReceipt && result.saved && result.requestId === previous.requestId && !result.success && !result.redFlags) {
    return { ...result, redFlags: previous.redFlags };
  }
  return result;
}
