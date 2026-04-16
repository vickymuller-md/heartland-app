'use client';

/**
 * React Query Provider -- Client Component
 *
 * Wraps children with QueryClientProvider for @tanstack/react-query.
 * Used by the provider layout to enable cache invalidation from
 * the RealtimeAlertsProvider.
 */

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // 1 minute
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
