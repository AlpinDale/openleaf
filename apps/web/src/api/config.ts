import { AppConfig } from '@openleaf/shared'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './client'
import { queryClient } from './query-client'

export const configKey = ['config'] as const

export type { AppConfig }

export function fetchAppConfig(): Promise<AppConfig> {
  return queryClient.fetchQuery({
    queryKey: configKey,
    queryFn: ({ signal }) => apiFetch('/config', { schema: AppConfig, signal }),
    staleTime: Number.POSITIVE_INFINITY,
  })
}

/** Instance capabilities (`exports`, `supportUrl`); fetched once per page load. */
export function useAppConfig() {
  return useQuery({
    queryKey: configKey,
    queryFn: ({ signal }) => apiFetch('/config', { schema: AppConfig, signal }),
    staleTime: Number.POSITIVE_INFINITY,
  })
}
