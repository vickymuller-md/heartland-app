/**
 * Client fetch wrapper for the assist endpoint. Type-only imports keep the
 * clinical-content module and zod out of the client bundle. Any failure —
 * network, 4xx/5xx, rate limit, or server fallback — resolves to null and the
 * calling surface keeps (or reveals) its deterministic content.
 */

import type { AssistRequest, AssistResponse } from './assist';

export async function requestAssist(body: AssistRequest): Promise<AssistResponse | null> {
  try {
    const response = await fetch('/api/sandbox-ai/assist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as (AssistResponse & { fallback?: boolean }) | { fallback: true };
    if ('fallback' in data && data.fallback) return null;
    return data as AssistResponse;
  } catch {
    return null;
  }
}
