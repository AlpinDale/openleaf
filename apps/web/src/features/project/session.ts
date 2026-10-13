import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
} from '@hocuspocus/provider'
import {
  ProjectEvent,
  type ProjectTree,
  projectDocumentName,
  type TreeEntry,
  YDOC_TEXTS,
} from '@openleaf/shared'
import type { QueryClient } from '@tanstack/react-query'
import type { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { create } from 'zustand'
import { historyKey, projectKey, threadsKey } from '@/api/projects'
import { treeKey } from '@/api/tree'
import { indexTree } from '@/features/file-tree/util/tree-index'
import { debugConsole } from '@/utils/debugging'

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

export const useConnectionStore = create<{
  status: ConnectionStatus
  /** The document finished its first sync since the session started. */
  syncedOnce: boolean
}>(() => ({ status: 'connecting', syncedOnce: false }))

export type ProjectSession = {
  projectId: string
  ydoc: Y.Doc
  provider: HocuspocusProvider
  websocketProvider: HocuspocusProviderWebsocket
  awareness: Awareness | null
  texts: Y.Map<Y.Text>
  getPath(entryId: string): string | null
  getEntryByPath(path: string): TreeEntry | null
  /** Resolves once every local change reached the server; rejects after `timeoutMs`. */
  waitForSync(timeoutMs?: number): Promise<void>
  destroy(): void
}

/** Name of the window event every server push is re-dispatched as. */
export const PROJECT_EVENT = 'openleaf:project-event'

function collabUrl() {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${protocol}://${location.host}/collab`
}

function handleProjectEvent(
  projectId: string,
  queryClient: QueryClient,
  event: ProjectEvent
) {
  switch (event.type) {
    case 'tree.changed':
      queryClient.invalidateQueries({ queryKey: treeKey(projectId) })
      break
    case 'project.updated':
      queryClient.invalidateQueries({ queryKey: projectKey(projectId) })
      break
    case 'comments.changed':
      queryClient.invalidateQueries({ queryKey: threadsKey(projectId) })
      break
    case 'history.committed':
      queryClient.invalidateQueries({ queryKey: historyKey(projectId) })
      break
  }
  window.dispatchEvent(new CustomEvent(PROJECT_EVENT, { detail: event }))
}

export function createProjectSession(
  projectId: string,
  queryClient: QueryClient
): ProjectSession {
  useConnectionStore.setState({ status: 'connecting', syncedOnce: false })

  let destroyed = false
  const pendingSyncs = new Set<() => void>()
  const ydoc = new Y.Doc()
  const websocketProvider = new HocuspocusProviderWebsocket({
    url: collabUrl(),
  })
  const provider = new HocuspocusProvider({
    websocketProvider,
    name: projectDocumentName(projectId),
    document: ydoc,
    token: 'cookie',
    onStatus: ({ status }) => {
      if (destroyed) return
      useConnectionStore.setState({ status: status as ConnectionStatus })
    },
    onSynced: ({ state }) => {
      if (destroyed) return
      if (state) useConnectionStore.setState({ syncedOnce: true })
    },
    onStateless: ({ payload }) => {
      if (destroyed) return
      let event: ProjectEvent
      try {
        event = ProjectEvent.parse(JSON.parse(payload))
      } catch {
        debugConsole.warn('Ignoring malformed project event', payload)
        return
      }
      handleProjectEvent(projectId, queryClient, event)
    },
    onAuthenticationFailed: ({ reason }) => {
      debugConsole.error('Realtime authentication failed:', reason)
    },
  })
  // A shared websocket provider doesn't attach its document providers itself.
  provider.attach()

  const tree = () => queryClient.getQueryData<ProjectTree>(treeKey(projectId))

  return {
    projectId,
    ydoc,
    provider,
    websocketProvider,
    awareness: provider.awareness,
    texts: ydoc.getMap<Y.Text>(YDOC_TEXTS),
    getPath(entryId) {
      const current = tree()
      return current ? (indexTree(current).paths.get(entryId) ?? null) : null
    },
    getEntryByPath(path) {
      const current = tree()
      return current ? (indexTree(current).byPath.get(path) ?? null) : null
    },
    waitForSync(timeoutMs = 5000) {
      if (destroyed) return Promise.reject(new Error('Project session closed'))
      if (!provider.hasUnsyncedChanges) return Promise.resolve()
      const { promise, resolve, reject } = Promise.withResolvers<void>()
      const onDestroy = () => {
        cleanup()
        reject(new Error('Project session closed'))
      }
      const onChange = () => {
        if (provider.hasUnsyncedChanges) return
        cleanup()
        resolve()
      }
      const timer = window.setTimeout(() => {
        cleanup()
        reject(new Error('Timed out waiting for changes to reach the server'))
      }, timeoutMs)
      const cleanup = () => {
        window.clearTimeout(timer)
        provider.off('unsyncedChanges', onChange)
        pendingSyncs.delete(onDestroy)
      }
      provider.on('unsyncedChanges', onChange)
      pendingSyncs.add(onDestroy)
      onChange()
      return promise
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      for (const cancel of pendingSyncs) cancel()
      provider.destroy()
      websocketProvider.destroy()
      ydoc.destroy()
    },
  }
}
