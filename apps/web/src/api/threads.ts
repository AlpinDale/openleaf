import { ThreadList } from '@openleaf/shared'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from './client'
import { threadsKey } from './projects'
import { queryClient } from './query-client'

export function useThreads(projectId: string) {
  return useQuery({
    queryKey: threadsKey(projectId),
    queryFn: async ({ signal }) =>
      (
        await apiFetch(`/projects/${projectId}/threads`, {
          schema: ThreadList,
          signal,
        })
      ).threads,
  })
}

/** Runs a thread mutation, then refetches the list (the server also broadcasts). */
async function mutate(
  projectId: string,
  path: string,
  method: string,
  body?: unknown
) {
  await apiFetch(`/projects/${projectId}/threads${path}`, { method, body })
  await queryClient.invalidateQueries({ queryKey: threadsKey(projectId) })
}

export const createThread = (
  projectId: string,
  body: { id: string; docId: string; content: string }
) => mutate(projectId, '', 'POST', body)

export const addMessage = (
  projectId: string,
  threadId: string,
  content: string
) => mutate(projectId, `/${threadId}/messages`, 'POST', { content })

export const editMessage = (
  projectId: string,
  threadId: string,
  messageId: string,
  content: string
) =>
  mutate(projectId, `/${threadId}/messages/${messageId}`, 'PATCH', { content })

export const deleteMessage = (
  projectId: string,
  threadId: string,
  messageId: string
) => mutate(projectId, `/${threadId}/messages/${messageId}`, 'DELETE')

export const resolveThread = (projectId: string, threadId: string) =>
  mutate(projectId, `/${threadId}/resolve`, 'POST')

export const reopenThread = (projectId: string, threadId: string) =>
  mutate(projectId, `/${threadId}/reopen`, 'POST')

export const deleteThread = (projectId: string, threadId: string) =>
  mutate(projectId, `/${threadId}`, 'DELETE')
