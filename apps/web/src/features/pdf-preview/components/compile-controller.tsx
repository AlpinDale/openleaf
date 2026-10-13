import { forEachDiagnostic } from '@codemirror/lint'
import type { ProjectDetails } from '@openleaf/shared'
import { useEffect, useRef } from 'react'
import type * as Y from 'yjs'
import { useMe } from '@/api/auth'
import { useTree } from '@/api/tree'
import { getEditorView } from '@/features/editor/editor-bridge'
import { useEditorStore } from '@/features/editor/editor-store'
import { useProjectSession } from '@/features/project/session-context'
import { WordCountModal } from '@/features/word-count-modal/components/word-count-modal'
import {
  closeDetachedPdf,
  connectCompileStore,
  markChanged,
  syncCompileOptions,
  useCompileStore,
} from '../compile-store'

const AUTO_COMPILE_DELAY = 3000

/** Error diagnostics from code check in the open doc (compile-log annotations excluded). */
function openDocHasLintErrors() {
  const view = getEditorView()
  if (!view) return false
  let found = false
  forEachDiagnostic(view.state, diagnostic => {
    // compile-log annotations carry `compile: true` (see extensions/annotations.ts)
    const fromCompileLog = 'compile' in diagnostic && diagnostic.compile
    if (diagnostic.severity === 'error' && !fromCompileLog) {
      found = true
    }
  })
  return found
}

/**
 * Editor-window compile wiring: binds the compile store to the session, runs
 * the initial and auto compiles, relays to the detached PDF window, and hosts
 * the word count modal. Mount once per editor page.
 */
export function CompileController({ project }: { project: ProjectDetails }) {
  const session = useProjectSession()
  const settings = useMe().data?.settings
  const tree = useTree(project.id).data
  const wordCountOpen = useCompileStore(s => s.wordCountOpen)
  const initialCompileFor = useRef<unknown>(null)

  useEffect(
    () =>
      connectCompileStore({
        projectId: project.id,
        session,
        role: 'editor',
      }),
    [project.id, session]
  )

  useEffect(() => {
    if (settings) syncCompileOptions(settings)
  }, [settings])

  // one compile when the session first syncs, if there is something to compile
  useEffect(() => {
    if (!tree || initialCompileFor.current === session) return
    initialCompileFor.current = session
    const hasRootDoc =
      project.rootDocId !== null ||
      tree.entries.some(
        entry => entry.kind === 'doc' && entry.name.endsWith('.tex')
      )
    if (hasRootDoc) void useCompileStore.getState().compile()
  }, [session, tree, project.rootDocId])

  // auto compile 3 s after the last local edit
  useEffect(() => {
    let timer: number | undefined
    const run = () => {
      const state = useCompileStore.getState()
      if (!state.autoCompile) return
      if (state.status === 'compiling') {
        timer = window.setTimeout(run, 1000)
        return
      }
      if (openDocHasLintErrors()) return
      void state.compile()
    }
    const observer = (_events: Y.YEvent<any>[], transaction: Y.Transaction) => {
      if (!transaction.local || transaction.origin === session.provider) return
      markChanged()
      window.clearTimeout(timer)
      timer = window.setTimeout(run, AUTO_COMPILE_DELAY)
    }
    session.texts.observeDeep(observer)
    return () => {
      window.clearTimeout(timer)
      session.texts.unobserveDeep(observer)
    }
  }, [session])

  // leaving the "PDF in separate tab" layout closes that tab
  useEffect(
    () =>
      useEditorStore.subscribe((state, previous) => {
        if (previous.layout === 'detached' && state.layout !== 'detached') {
          closeDetachedPdf()
        }
      }),
    []
  )

  return (
    <WordCountModal
      show={wordCountOpen}
      onHide={() => useCompileStore.setState({ wordCountOpen: false })}
      projectId={project.id}
      docId={project.rootDocId}
    />
  )
}
