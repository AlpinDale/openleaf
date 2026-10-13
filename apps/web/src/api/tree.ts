import { ProjectTree, TreeEntry, UploadResult } from '@openleaf/shared'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { ApiError, apiFetch, apiUrl } from './client'
import { queryClient } from './query-client'

export const treeKey = (projectId: string) => ['tree', projectId] as const

const EntryResponse = z.object({ entry: TreeEntry })

export function useTree(projectId: string) {
  return useQuery({
    queryKey: treeKey(projectId),
    queryFn: ({ signal }) =>
      apiFetch(`/projects/${projectId}/tree`, { schema: ProjectTree, signal }),
  })
}

export const fileUrl = (projectId: string, entryId: string) =>
  apiUrl(`/projects/${projectId}/files/${entryId}`)

async function entryMutation(
  projectId: string,
  path: string,
  method: string,
  body?: unknown
): Promise<TreeEntry> {
  const { entry } = await apiFetch(`/projects/${projectId}${path}`, {
    method,
    body,
    schema: EntryResponse,
  })
  await queryClient.invalidateQueries({ queryKey: treeKey(projectId) })
  return entry
}

export function createEntry(
  projectId: string,
  parentId: string,
  name: string,
  kind: 'folder' | 'doc'
) {
  return entryMutation(projectId, '/entries', 'POST', { parentId, name, kind })
}

export function renameEntry(projectId: string, entryId: string, name: string) {
  return entryMutation(projectId, `/entries/${entryId}/rename`, 'POST', {
    name,
  })
}

export function moveEntry(
  projectId: string,
  entryId: string,
  parentId: string
) {
  return entryMutation(projectId, `/entries/${entryId}/move`, 'POST', {
    parentId,
  })
}

export function refreshEntry(projectId: string, entryId: string) {
  return entryMutation(projectId, `/entries/${entryId}/refresh`, 'POST')
}

export function importUrl(
  projectId: string,
  parentId: string,
  name: string,
  url: string,
  { overwrite = false }: { overwrite?: boolean } = {}
) {
  return entryMutation(projectId, '/entries/import-url', 'POST', {
    parentId,
    name,
    url,
    overwrite,
  })
}

export function importFromProject(
  projectId: string,
  parentId: string,
  name: string,
  sourceProjectId: string,
  sourceEntryId: string,
  { overwrite = false }: { overwrite?: boolean } = {}
) {
  return entryMutation(projectId, '/entries/import-project', 'POST', {
    parentId,
    name,
    sourceProjectId,
    sourceEntryId,
    overwrite,
  })
}

export async function deleteEntry(projectId: string, entryId: string) {
  await apiFetch(`/projects/${projectId}/entries/${entryId}`, {
    method: 'DELETE',
  })
  await queryClient.invalidateQueries({ queryKey: treeKey(projectId) })
}

/**
 * Uploads files into a folder. Throws `ApiError` with code `conflict` (and
 * `details.conflicts: UploadConflict[]`) when a name exists and `overwrite` is off;
 * nothing is written in that case.
 */
export async function uploadFiles(
  projectId: string,
  parentId: string,
  files: File[],
  { overwrite }: { overwrite: boolean }
): Promise<TreeEntry[]> {
  const body = new FormData()
  // Fields first: the server reads them before streaming the file parts.
  body.append('parentId', parentId)
  body.append('overwrite', String(overwrite))
  for (const file of files) body.append('file', file, file.name)
  const { entries } = await apiFetch(`/projects/${projectId}/upload`, {
    method: 'POST',
    body,
    schema: UploadResult,
  })
  await queryClient.invalidateQueries({ queryKey: treeKey(projectId) })
  return entries
}

export type UploadConflict = { name: string; existingEntryId?: string }
const UploadConflicts = z.array(
  z.object({ name: z.string(), existingEntryId: z.string().optional() })
)

/** Names that clashed in a 409 upload/import answer. */
export function uploadConflicts(err: unknown): UploadConflict[] {
  if (!(err instanceof ApiError) || err.code !== 'conflict') return []
  const parsed = UploadConflicts.safeParse(err.details.conflicts)
  return parsed.success ? parsed.data : []
}
