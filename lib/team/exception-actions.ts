'use server';

import { authorize } from '@/lib/auth/authorization';
import { getOperationalExceptions } from './exception-queries';
import { EXCEPTION_LOAD_ERROR, type ExceptionResult } from './operational-exceptions';

/** Read-only authenticated request; no service client, mutation, retry or external send. */
export async function loadOperationalExceptions(input: {
  organizationId: string; after: string | null;
}): Promise<ExceptionResult> {
  try {
    const auth = await authorize('provider');
    if (!auth.authorized) return { data: null, error: EXCEPTION_LOAD_ERROR };
    return await getOperationalExceptions(auth.supabase, input);
  } catch {
    return { data: null, error: EXCEPTION_LOAD_ERROR };
  }
}
