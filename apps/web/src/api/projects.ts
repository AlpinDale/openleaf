import {
  type ExportFormat,
  ProjectDetails,
  ProjectSummary,
} from '@openleaf/shared'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { ApiError, apiFetch, apiUrl, errorMessage, toApiError } from './client'
import { queryClient } from './query-client'

export const projectsKey = ['projects'] as const
export const projectKey = (id: string) => ['project', id] as const
// Reserved for later milestones.
export const threadsKey = (id: string) => ['threads', id] as const
export const historyKey = (id: string) => ['history', id] as const
export const labelsKey = (id: string) => ['labels', id] as const

const ProjectsResponse = z.object({ projects: z.array(ProjectSummary) })
const CreatedProject = z.object({ id: z.string() })

export function useProjects() {
  return useQuery({
    queryKey: projectsKey,
    queryFn: async ({ signal }) =>
      (await apiFetch('/projects', { schema: ProjectsResponse, signal }))
        .projects,
  })
}

export function useProject(id: string) {
  return useQuery({
    queryKey: projectKey(id),
    queryFn: ({ signal }) =>
      apiFetch(`/projects/${id}`, { schema: ProjectDetails, signal }),
  })
}

export async function createProject(
  name: string,
  template: 'blank' | 'example'
): Promise<string> {
  const { id } = await apiFetch('/projects', {
    method: 'POST',
    body: { name, template },
    schema: CreatedProject,
  })
  await queryClient.invalidateQueries({ queryKey: projectsKey })
  return id
}

export async function importProjectZip(file: File): Promise<string> {
  const body = new FormData()
  body.append('file', file, file.name)
  const { id } = await apiFetch('/projects/import', {
    method: 'POST',
    body,
    schema: CreatedProject,
  })
  await queryClient.invalidateQueries({ queryKey: projectsKey })
  return id
}

export async function copyProject(id: string, name: string): Promise<string> {
  const result = await apiFetch(`/projects/${id}/copy`, {
    method: 'POST',
    body: { name },
    schema: CreatedProject,
  })
  await queryClient.invalidateQueries({ queryKey: projectsKey })
  return result.id
}

export type ProjectPatch = {
  name?: string
  rootDocId?: string | null
  compiler?: ProjectDetails['compiler']
  image?: string
  spellLanguage?: string
  mainBibDocId?: string | null
}
type ProjectPatchQueue = {
  pending: Promise<unknown>
  confirmed: ProjectDetails | undefined
  patches: ProjectPatch[]
}
const projectPatchQueues = new Map<string, ProjectPatchQueue>()

function renderProjectPatches(id: string, queue: ProjectPatchQueue) {
  if (!queue.confirmed) return
  const updated = { ...queue.confirmed }
  for (const patch of queue.patches) Object.assign(updated, patch)
  queryClient.setQueryData(projectKey(id), updated)
}

/** Updates project settings, applying the change to `['project', id]` before the server answers. */
export function patchProject(
  id: string,
  patch: ProjectPatch
): Promise<ProjectDetails> {
  void queryClient.cancelQueries({ queryKey: projectKey(id) })
  let queue = projectPatchQueues.get(id)
  if (!queue) {
    queue = {
      pending: Promise.resolve(),
      confirmed: queryClient.getQueryData<ProjectDetails>(projectKey(id)),
      patches: [],
    }
    projectPatchQueues.set(id, queue)
  }
  queue.patches.push(patch)
  renderProjectPatches(id, queue)
  const currentQueue = queue
  const result = queue.pending
    .catch(() => {})
    .then(() => applyProjectPatch(id, patch, currentQueue))
  queue.pending = result
  return result
}

async function applyProjectPatch(
  id: string,
  patch: ProjectPatch,
  queue: ProjectPatchQueue
): Promise<ProjectDetails> {
  try {
    const updated = await apiFetch(`/projects/${id}`, {
      method: 'PATCH',
      body: patch,
      schema: ProjectDetails,
    })
    queue.confirmed = updated
    if (patch.name !== undefined) {
      queryClient.invalidateQueries({ queryKey: projectsKey })
    }
    return updated
  } finally {
    queue.patches.shift()
    renderProjectPatches(id, queue)
    if (queue.patches.length === 0) projectPatchQueues.delete(id)
  }
}

export type ProjectStateAction = 'archive' | 'unarchive' | 'trash' | 'restore'

export async function setProjectState(id: string, action: ProjectStateAction) {
  await apiFetch(`/projects/${id}/${action}`, { method: 'POST' })
  await queryClient.invalidateQueries({ queryKey: projectsKey })
}

export async function deleteProject(id: string) {
  await apiFetch(`/projects/${id}`, { method: 'DELETE' })
  queryClient.removeQueries({ queryKey: projectKey(id) })
  await queryClient.invalidateQueries({ queryKey: projectsKey })
}

export const projectZipUrl = (id: string) =>
  apiUrl(`/projects/${id}/download.zip`)

export const exportUrl = (id: string, format: ExportFormat) =>
  apiUrl(`/projects/${id}/export.${format}`)

/**
 * Converts the project with pandoc and saves the result as a download.
 * Throws `ApiError` (e.g. code `converter_unavailable`) when the server can't.
 */
export async function downloadProjectExport(
  id: string,
  format: ExportFormat
): Promise<void> {
  let response: Response
  try {
    response = await fetch(exportUrl(id, format), {
      credentials: 'same-origin',
    })
  } catch (err) {
    throw new ApiError(0, 'network', errorMessage(err))
  }
  if (!response.ok) throw await toApiError(response)
  const disposition = response.headers.get('content-disposition') ?? ''
  const encodedFilename = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1]
  let filename = /filename="([^"]+)"/i.exec(disposition)?.[1]
  if (encodedFilename) {
    try {
      filename = decodeURIComponent(encodedFilename)
    } catch {
      // Malformed optional metadata must not prevent downloading the body.
    }
  }
  let blob: Blob
  try {
    blob = await response.blob()
  } catch (err) {
    throw new ApiError(0, 'network', errorMessage(err))
  }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename ?? `export.${format}`
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
