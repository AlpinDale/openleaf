import { HistoryList, HistoryTreeEntry, LabelList } from '@openleaf/shared'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { ApiError, apiFetch, apiUrl, errorMessage, toApiError } from './client'
import { historyKey, labelsKey } from './projects'
import { queryClient } from './query-client'
import { treeKey } from './tree'

export const HISTORY_PAGE_SIZE = 50

const HistoryTreeResponse = z.object({ files: z.array(HistoryTreeEntry) })

/** Versions newest first, paged with the `before` cursor. */
export function useHistoryVersions(projectId: string) {
  return useInfiniteQuery({
    queryKey: historyKey(projectId),
    // Opening the history view must show current edits (the route flushes them).
    staleTime: 0,
    refetchOnMount: 'always',
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: String(HISTORY_PAGE_SIZE) })
      if (pageParam) params.set('before', pageParam)
      return (
        await apiFetch(`/projects/${projectId}/history?${params}`, {
          schema: HistoryList,
          signal,
        })
      ).versions
    },
    getNextPageParam: lastPage =>
      lastPage.length < HISTORY_PAGE_SIZE ? null : lastPage.at(-1)!.oid,
  })
}

export function useHistoryLabels(projectId: string) {
  return useQuery({
    queryKey: labelsKey(projectId),
    queryFn: async ({ signal }) =>
      (
        await apiFetch(`/projects/${projectId}/history/labels`, {
          schema: LabelList,
          signal,
        })
      ).labels,
  })
}

/** Files of the version `oid`; `null` oid (before the first version) is empty. */
export function useHistoryTree(projectId: string, oid: string | null) {
  return useQuery({
    queryKey: ['historyTree', projectId, oid],
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async ({ signal }) =>
      oid
        ? (
            await apiFetch(`/projects/${projectId}/history/${oid}/tree`, {
              schema: HistoryTreeResponse,
              signal,
            })
          ).files
        : [],
  })
}

export const historyFileUrl = (projectId: string, oid: string, path: string) =>
  apiUrl(
    `/projects/${projectId}/history/${oid}/file?path=${encodeURIComponent(path)}`
  )

export const historyZipUrl = (projectId: string, oid: string) =>
  apiUrl(`/projects/${projectId}/history/${oid}/download.zip`)

/** Text of `path` at `oid`; `''` when the version has no such file. */
export function useHistoryFileText(
  projectId: string,
  oid: string | null,
  path: string | null,
  enabled: boolean
) {
  return useQuery({
    queryKey: ['historyFile', projectId, oid, path],
    enabled: enabled && path !== null,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async ({ signal }) => {
      if (!oid || !path) return ''
      let response: Response
      try {
        response = await fetch(historyFileUrl(projectId, oid, path), {
          credentials: 'same-origin',
          signal,
        })
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') throw err
        throw new ApiError(0, 'network', errorMessage(err))
      }
      if (response.status === 404) return ''
      if (!response.ok) {
        throw await toApiError(response)
      }
      try {
        return await response.text()
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') throw err
        throw new ApiError(0, 'network', errorMessage(err))
      }
    },
  })
}

async function invalidateHistory(projectId: string) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: historyKey(projectId) }),
    queryClient.invalidateQueries({ queryKey: labelsKey(projectId) }),
  ])
}

/** Restores the whole project (no `path`) or one file to version `oid`. */
export async function restoreHistoryVersion(
  projectId: string,
  oid: string,
  path?: string
) {
  await apiFetch(`/projects/${projectId}/history/${oid}/restore`, {
    method: 'POST',
    body: path ? { path } : {},
  })
  await Promise.all([
    invalidateHistory(projectId),
    queryClient.invalidateQueries({ queryKey: treeKey(projectId) }),
  ])
}

export async function addHistoryLabel(
  projectId: string,
  oid: string,
  name: string
) {
  await apiFetch(`/projects/${projectId}/history/labels`, {
    method: 'POST',
    body: { oid, name },
  })
  await invalidateHistory(projectId)
}

export async function deleteHistoryLabel(projectId: string, labelId: string) {
  await apiFetch(`/projects/${projectId}/history/labels/${labelId}`, {
    method: 'DELETE',
  })
  await invalidateHistory(projectId)
}
