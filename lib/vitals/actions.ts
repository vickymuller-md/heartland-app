'use server';

import type { VitalsActionState, BatchVitalsActionState } from './types';
import { submitCapturedVitals, submitCapturedProviderVitals } from './submission-actions';
import { submitCapturedVitalsBatch } from './batch-actions';

export async function submitVitals(previous: VitalsActionState | null, formData: FormData): Promise<VitalsActionState> {
  return submitCapturedVitals(previous, formData);
}

export async function submitVitalsAsProvider(previous: VitalsActionState | null, formData: FormData): Promise<VitalsActionState> {
  return submitCapturedProviderVitals(previous, formData);
}

export async function submitBatchVitalsAsProvider(previous: BatchVitalsActionState | null, formData: FormData): Promise<BatchVitalsActionState> {
  return submitCapturedVitalsBatch(previous, formData);
}
