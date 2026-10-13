import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './client'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // 4xx answers won't change on retry; only retry network/5xx failures.
      retry: (failureCount, error) =>
        error instanceof ApiError &&
        (error.status === 0 || error.status >= 500) &&
        failureCount < 2,
    },
  },
})
