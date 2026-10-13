import type { ProjectTree } from '@openleaf/shared'
import { useEffect, useMemo, useState } from 'react'
import { queryClient } from '@/api/query-client'
import { treeKey } from '@/api/tree'
import { indexTree } from '@/features/file-tree/util/tree-index'
import { useFileTreeFolder } from '@/features/ide-react/openleaf-ide'
import type { AdvancedReferenceSearchResult } from '@/features/ide-react/references/types'
import { useProjectSession } from '@/features/project/session-context'
import type { Metadata } from '@/features/source-editor/extensions/language'
import type { BibEntry } from './bib-entries'
import type { MetadataRequest, MetadataResponse } from './metadata.worker'

const DEBOUNCE_MS = 1000
const TEX_RE = /\.(tex|sty|cls|ltx)$/i

/**
 * Project-wide autocomplete metadata (labels, packages, package commands,
 * bibliography keys), recomputed in a worker 1 s after any doc text changes.
 */
export function useProjectMetadata(): Metadata {
  const session = useProjectSession()
  const fileTreeData = useFileTreeFolder()
  const [result, setResult] = useState<MetadataResponse>({
    docs: {},
    bibEntries: [],
  })

  useEffect(() => {
    const worker = new Worker(
      new URL('./metadata.worker.ts', import.meta.url),
      {
        type: 'module',
      }
    )
    worker.addEventListener(
      'message',
      (event: MessageEvent<MetadataResponse>) => setResult(event.data)
    )

    const post = () => {
      const tree = queryClient.getQueryData<ProjectTree>(
        treeKey(session.projectId)
      )
      if (!tree) return
      const index = indexTree(tree)
      const request: MetadataRequest = { docs: [], bibs: [] }
      session.texts.forEach((ytext, id) => {
        const path = index.paths.get(id)
        if (!path || index.byId.get(id)?.kind !== 'doc') return
        if (TEX_RE.test(path)) {
          request.docs.push({ id, path, text: ytext.toString() })
        } else if (path.toLowerCase().endsWith('.bib')) {
          request.bibs.push({ path, text: ytext.toString() })
        }
      })
      worker.postMessage(request)
    }

    let timer: number | undefined
    const schedule = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(post, DEBOUNCE_MS)
    }
    post()
    session.texts.observeDeep(schedule)
    const unsubscribe = queryClient.getQueryCache().subscribe(event => {
      if (event.query.queryKey[0] === 'tree') schedule()
    })
    return () => {
      window.clearTimeout(timer)
      session.texts.unobserveDeep(schedule)
      unsubscribe()
      worker.terminate()
    }
  }, [session])

  return useMemo(() => {
    const docs = Object.values(result.docs)
    const entries = result.bibEntries
    return {
      labels: new Set(docs.flatMap(doc => doc.labels)),
      packageNames: new Set(docs.flatMap(doc => doc.packageNames)),
      commands: docs.flatMap(doc => Object.values(doc.packages).flat()),
      referenceKeys: new Set(entries.map(entry => entry.key)),
      searchLocalReferences: async (query: string) =>
        searchReferences(entries, query),
      fileTreeData,
    }
  }, [result, fileTreeData])
}

function searchReferences(
  entries: BibEntry[],
  query: string
): AdvancedReferenceSearchResult {
  const needle = query.toLowerCase()
  return {
    hits: entries
      .filter(
        entry =>
          entry.key.toLowerCase().includes(needle) ||
          entry.title.toLowerCase().includes(needle)
      )
      .map(entry => ({
        _source: {
          EntryKey: entry.key,
          Fields: {
            author: entry.author,
            date: entry.year,
            journal: '',
            title: entry.title,
            year: entry.year,
          },
        },
      })),
  }
}
