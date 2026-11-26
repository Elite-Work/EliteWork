"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * App-wide React Query provider (#503).
 *
 * The trades list is the first consumer, but mounting the client at the root
 * keeps future cursor-paginated screens from each creating their own cache.
 * The client lives in state so Fast Refresh does not recreate it (and drop
 * the cache) on every edit.
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // List data is refreshed on navigation/focus explicitly; refetching
            // everything on window focus would replay every loaded page.
            refetchOnWindowFocus: false,
            staleTime: 30_000,
            retry: 1,
          },
        },
      }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
