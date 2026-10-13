import { EditorState, type TransactionSpec } from '@codemirror/state'
import type { SearchQuery } from '@codemirror/search'
import { EditorView } from '@codemirror/view'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { ySyncAnnotation, ySyncFacet } from 'y-codemirror.next'
import * as Y from 'yjs'
import { type Role, YDOC_CHANGES } from '@openleaf/shared'
import { useCurrentMe } from '@/api/auth'
import { dispatchEditorTransactions } from '@/features/review/dispatch-editor-transactions'
import { useCommentHighlightSync } from '@/features/review/review-editor-items'
import { ReviewPanel } from '@/features/review/review-panel'
import { useLocalViewing } from '@/features/review/editing-mode'
import { setEditorView, useEditorBridge } from '@/features/editor/editor-bridge'
import { useEditorStore } from '@/features/editor/editor-store'
import { indexTree } from '@/features/file-tree/util/tree-index'
import { useFileTreePathContext } from '@/features/file-tree/contexts/file-tree-path'
import { useEditorPropertiesContext } from '@/features/ide-react/context/editor-properties-context'
import {
  roleAtLeast,
  useIdeProject,
  useIdeTree,
} from '@/features/ide-react/openleaf-ide'
import { useProjectMetadata } from '@/features/metadata/use-project-metadata'
import { useCompileStore } from '@/features/pdf-preview/compile-store'
import { useConnectionStore } from '@/features/project/session'
import { useProjectSession } from '@/features/project/session-context'
import { useUserSettingsContext } from '@/shared/context/user-settings-context'
import { useActiveOverallTheme } from '@/shared/hooks/use-active-overall-theme'
import useEventListener from '@/shared/hooks/use-event-listener'
import type { Annotation } from '@ol-types/annotation'
import { createExtensions } from '../extensions'
import {
  setAnnotations,
  showCompileLogDiagnostics,
} from '../extensions/annotations'
import { setAutoComplete } from '../extensions/auto-complete'
import { setAutoPair } from '../extensions/auto-pair'
import { beforeChangeDocEffect } from '../extensions/before-change-doc'
import {
  restoreCursorPosition,
  setCursorLineAndScroll,
  setCursorPositionAndScroll,
} from '../extensions/cursor-position'
import { setDocFolder } from '../extensions/doc-folder'
import { setDocName } from '../extensions/doc-name'
import { setEditable } from '../extensions/editable'
import { setFilePreview } from '../extensions/file-preview'
import { setKeybindings } from '../extensions/keybindings'
import {
  setLanguage,
  setMetadata,
  setSyntaxValidation,
} from '../extensions/language'
import { setMathPreview } from '../extensions/math-preview'
import { setNonBlinkingCursor } from '../extensions/non-blinking-cursor'
import { setPhrases } from '../extensions/phrases'
import { restoreScrollPosition } from '../extensions/scroll-position'
import { setSpellCheckLanguage } from '../extensions/spelling'
import { setEditorTheme, setOptionsTheme } from '../extensions/theme'
import { setVisual } from '../extensions/visual/visual'
import { setReferencesSearchMode } from '../extensions/auto-complete'
import { setSelectionTooltip } from '../extensions/selection-quick-actions'
import { useHunspell } from '../hooks/use-hunspell'
import { usePhrases } from '../hooks/use-phrases'
import { useToolbarMenuBarEditorCommands } from '../hooks/use-toolbar-menu-editor-commands'
import { isCmVisualEditorAvailable } from '../utils/visual-editor'
import {
  CodeMirrorStateContext,
  CodeMirrorViewContext,
} from './codemirror-context'
import { CodemirrorOutline } from './codemirror-outline'
import { CodeMirrorCommandTooltip } from './codemirror-command-tooltip'
import CodeMirrorSearch from './codemirror-search'
import { CodeMirrorToolbar } from './codemirror-toolbar'
import EditorContextMenu from './editor-context-menu'
import { EditorFloatingMenu } from './editor-floating-menu'
import { FigureModal } from './figure-modal/figure-modal'
import MathPreviewTooltip from './math-preview-tooltip'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'
type DocCache = {
  ytext: Y.Text
  userId: string
  role: Role
  undoManager: Y.UndoManager
  state: EditorState | null
}

/**
 * Brings a cached state up to date with its Y.Text (edits that arrived while
 * another doc was shown), marking the change as coming from Yjs so it isn't
 * sent back.
 */
function syncCachedState(state: EditorState, ytext: Y.Text): EditorState {
  const current = state.doc.toString()
  const next = ytext.toString()
  if (current === next) return state
  let start = 0
  const minLength = Math.min(current.length, next.length)
  while (start < minLength && current[start] === next[start]) start++
  let end = 0
  while (
    end < minLength - start &&
    current[current.length - 1 - end] === next[next.length - 1 - end]
  )
    end++
  return state.update({
    changes: {
      from: start,
      to: current.length - end,
      insert: next.slice(start, next.length - end),
    },
    annotations: ySyncAnnotation.of(state.facet(ySyncFacet)),
  }).state
}

/**
 * The OpenLeaf source editor: one EditorView per editor page, with a cached
 * EditorState and Y.UndoManager per doc. Replaces Overleaf's
 * `codemirror-editor.tsx` + `use-codemirror-scope.ts`.
 */
function OpenLeafEditor() {
  const [state, setState] = useState(() => EditorState.create())
  const viewRef = useRef<EditorView | null>(null)
  if (viewRef.current === null) {
    const view: EditorView = new EditorView({
      state,
      dispatchTransactions: trs => {
        dispatchEditorTransactions(view, trs)
        setState(view.state)
      },
    })
    viewRef.current = view
  }
  const view = viewRef.current
  const installed = useEditorBridge(s => s.docId !== null)

  return (
    <CodeMirrorStateContext.Provider value={state}>
      <CodeMirrorViewContext.Provider value={view}>
        <EditorScope view={view} />
        {installed && <EditorComponents />}
      </CodeMirrorViewContext.Provider>
    </CodeMirrorStateContext.Provider>
  )
}

function EditorComponents() {
  useToolbarMenuBarEditorCommands()
  useCommentHighlightSync()
  const reviewOpen = useEditorStore(s => s.reviewOpen)
  return (
    <>
      <CodemirrorOutline />
      <FigureModal />
      <CodeMirrorSearch />
      <CodeMirrorToolbar />
      <CodeMirrorCommandTooltip />
      <MathPreviewTooltip />
      <EditorContextMenu />
      <EditorFloatingMenu />
      {reviewOpen && <ReviewPanel />}
    </>
  )
}

function EditorScope({ view }: { view: EditorView }) {
  const session = useProjectSession()
  const project = useIdeProject()
  const me = useCurrentMe()
  const tree = useIdeTree()
  const openDocId = useEditorStore(s => s.openDocId)
  const syncedOnce = useConnectionStore(s => s.syncedOnce)
  const { userSettings } = useUserSettingsContext()
  const {
    fontFamily,
    fontSize,
    lineHeight,
    autoComplete,
    autoPairDelimiters,
    mode,
    syntaxValidation,
    mathPreview,
    editorTheme,
    editorMode,
    nonBlinkingCursor,
    selectionQuickActions,
    referencesSearchMode,
  } = userSettings
  const activeOverallTheme = useActiveOverallTheme()
  const metadata = useProjectMetadata()
  const phrases = usePhrases()
  const { previewByPath, dirname } = useFileTreePathContext()
  const { showVisual: visual } = useEditorPropertiesContext()

  const index = indexTree(tree)
  const openDocName = openDocId
    ? (index.byId.get(openDocId)?.name ?? null)
    : null
  const openDocPath = openDocId ? (index.paths.get(openDocId) ?? null) : null

  const canEdit = roleAtLeast(project.role, 'reviewer')
  // "Viewing" in the editing mode switch makes the editor read-only locally
  const viewing = useLocalViewing()
  const editable = canEdit && syncedOnce && !viewing
  const spellCheckLanguage = canEdit ? project.spellLanguage : ''
  const hunspellManager = useHunspell(spellCheckLanguage)
  const showVisual =
    visual && !!openDocName && isCmVisualEditorAvailable(openDocName)

  // visual mode starts from the persisted user setting
  useEffect(() => {
    useEditorStore.getState().setEditorMode(editorMode)
    // only on load: later changes go through the store
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Latest config, read when a doc's state is (re)installed.
  const theme = { fontFamily, fontSize, lineHeight, activeOverallTheme }
  const config = {
    theme,
    editorTheme,
    mode,
    settings: {
      autoComplete,
      autoPairDelimiters,
      syntaxValidation,
      mathPreview,
      mode,
      selectionQuickActions,
      referencesSearchMode,
    },
    nonBlinkingCursor,
    metadata,
    phrases,
    spelling: { spellCheckLanguage, hunspellManager },
    showVisual,
    previewByPath,
    dirname,
    editable,
    docName: openDocName,
    userId: me.user.id,
    role: project.role,
  }
  const configRef = useRef(config)
  configRef.current = config

  const caches = useRef(new Map<string, DocCache>())
  const installedDocId = useRef<string | null>(null)
  const searchQueryRef = useRef<SearchQuery | null>(null)
  useEventListener(
    'search-panel-before-doc-change',
    useCallback((event: CustomEvent) => {
      searchQueryRef.current = event.detail
    }, [])
  )

  // re-run installation when the open doc's Y.Text appears (e.g. a new doc)
  const [textsVersion, setTextsVersion] = useState(0)
  useEffect(() => {
    const observer = () => setTextsVersion(v => v + 1)
    session.texts.observe(observer)
    return () => session.texts.unobserve(observer)
  }, [session])

  // install the open doc's state in the view
  // biome-ignore lint/correctness/useExhaustiveDependencies: textsVersion re-runs on Y map changes
  useEffect(() => {
    const previousId = installedDocId.current
    if (!openDocId || !syncedOnce) return
    const ytext = session.texts.get(openDocId)
    if (!ytext) return
    if (
      previousId === openDocId &&
      caches.current.get(openDocId)?.ytext === ytext &&
      caches.current.get(openDocId)?.role === project.role &&
      caches.current.get(openDocId)?.userId === me.user.id
    )
      return

    if (previousId) {
      view.dispatch({ effects: beforeChangeDocEffect.of(null) })
      const previous = caches.current.get(previousId)
      if (previous) previous.state = view.state
    }

    let cache = caches.current.get(openDocId)
    if (
      cache &&
      (cache.ytext !== ytext ||
        cache.role !== project.role ||
        cache.userId !== me.user.id)
    ) {
      cache.undoManager.destroy()
      cache = undefined
    }
    if (!cache) {
      const undoManager = new Y.UndoManager([
        ytext,
        session.ydoc.getMap(YDOC_CHANGES),
      ])
      cache = {
        ytext,
        userId: me.user.id,
        role: project.role,
        undoManager,
        state: null,
      }
      caches.current.set(openDocId, cache)
    }

    const current = configRef.current
    const fresh = cache.state === null
    const nextState = cache.state
      ? syncCachedState(cache.state, ytext)
      : EditorState.create({
          doc: ytext.toString(),
          extensions: createExtensions({
            docId: openDocId,
            ytext,
            awareness: session.awareness,
            undoManager: cache.undoManager,
            ydoc: session.ydoc,
            userId: current.userId,
            role: current.role,
            docName: current.docName ?? '',
            theme: current.theme,
            metadata: current.metadata,
            settings: current.settings,
            phrases: current.phrases,
            spelling: current.spelling,
            showVisual: current.showVisual,
            previewByPath: current.previewByPath,
            currentDocFolder: current.dirname(openDocId),
            projectFeatures: {},
            initialSearchQuery: searchQueryRef.current,
          }),
        })
    view.setState(nextState)
    installedDocId.current = openDocId

    // a cached state may hold config from before the doc was hidden
    const specs: TransactionSpec[] = [
      setEditable(current.editable),
      setOptionsTheme(current.theme),
      setNonBlinkingCursor(
        current.nonBlinkingCursor ||
          window.matchMedia(REDUCED_MOTION_QUERY).matches
      ),
    ]
    if (fresh) specs.unshift(restoreCursorPosition(nextState.doc, openDocId))
    else
      specs.push(
        setAutoPair(current.settings.autoPairDelimiters),
        setAutoComplete({ enabled: current.settings.autoComplete }),
        setSyntaxValidation(current.settings.syntaxValidation),
        setMathPreview(current.settings.mathPreview),
        setMetadata(current.metadata),
        setSpellCheckLanguage(current.spelling),
        setPhrases(current.phrases),
        setVisual(current.showVisual),
        setFilePreview(current.previewByPath),
        setDocFolder(current.dirname(openDocId)),
        setReferencesSearchMode(current.settings.referencesSearchMode),
        setSelectionTooltip(
          current.settings.selectionQuickActions,
          current.role !== 'viewer'
        )
      )
    view.dispatch(...specs)
    setEditorView(view, openDocId)

    let scrollTimer: number | undefined
    if (!current.showVisual) {
      scrollTimer = window.setTimeout(() => {
        view.dispatch(restoreScrollPosition())
        view.focus()
      })
    }
    return () => {
      window.clearTimeout(scrollTimer)
    }
  }, [
    view,
    session,
    openDocId,
    syncedOnce,
    textsVersion,
    project.role,
    me.user.id,
  ])

  // nothing installed when no doc is open
  useEffect(() => {
    if (openDocId === null) setEditorView(null, null)
  }, [openDocId])
  // Tear down on unmount. Deferred, so the simulated unmount/remount of
  // React StrictMode doesn't destroy the live view and its plugins.
  const pendingTeardown = useRef<number | undefined>(undefined)
  useEffect(() => {
    window.clearTimeout(pendingTeardown.current)
    const cached = caches.current
    return () => {
      pendingTeardown.current = window.setTimeout(() => {
        setEditorView(null, null)
        view.destroy()
        for (const cache of cached.values()) cache.undoManager.destroy()
        cached.clear()
      })
    }
  }, [view])

  // drop cached states of docs that left the tree
  useEffect(() => {
    const { byId } = indexTree(tree)
    for (const [docId, cache] of caches.current) {
      if (byId.get(docId)?.kind === 'doc' || docId === installedDocId.current)
        continue
      cache.undoManager.destroy()
      caches.current.delete(docId)
    }
  }, [tree])

  // theme
  useEffect(() => {
    view.dispatch(
      setOptionsTheme({ fontFamily, fontSize, lineHeight, activeOverallTheme })
    )
    let stale = false
    setEditorTheme(editorTheme).then(spec => {
      if (!stale) view.dispatch(spec)
    })
    return () => {
      stale = true
    }
  }, [
    view,
    fontFamily,
    fontSize,
    lineHeight,
    activeOverallTheme,
    editorTheme,
    openDocId,
    syncedOnce,
    textsVersion,
    project.role,
    me.user.id,
  ])

  useEffect(() => {
    let stale = false
    let timer: number | undefined
    setKeybindings(mode).then(spec => {
      if (!stale)
        timer = window.setTimeout(() => {
          if (!stale) view.dispatch(spec)
        })
    })
    return () => {
      stale = true
      window.clearTimeout(timer)
    }
  }, [
    view,
    mode,
    openDocId,
    syncedOnce,
    textsVersion,
    project.role,
    me.user.id,
  ])

  // Every per-setting effect from Overleaf's use-codemirror-scope, each
  // dispatching its setter asynchronously like the original.
  const useDispatchEffect = (spec: () => TransactionSpec, deps: unknown[]) =>
    // biome-ignore lint/correctness/useExhaustiveDependencies: deps are passed by the caller
    useEffect(() => {
      const timer = window.setTimeout(() => view.dispatch(spec()))
      return () => window.clearTimeout(timer)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [view, ...deps])

  useDispatchEffect(() => setAutoPair(autoPairDelimiters), [autoPairDelimiters])
  useDispatchEffect(
    () => setAutoComplete({ enabled: autoComplete }),
    [autoComplete]
  )
  useDispatchEffect(
    () => setSyntaxValidation(syntaxValidation),
    [syntaxValidation]
  )
  useDispatchEffect(() => setMathPreview(mathPreview), [mathPreview])
  useDispatchEffect(() => setMetadata(metadata), [metadata])
  useDispatchEffect(
    () => setSpellCheckLanguage({ spellCheckLanguage, hunspellManager }),
    [spellCheckLanguage, hunspellManager]
  )
  useDispatchEffect(() => setPhrases(phrases), [phrases])
  useDispatchEffect(() => setEditable(editable), [editable])
  useDispatchEffect(
    () => setReferencesSearchMode(referencesSearchMode),
    [referencesSearchMode]
  )
  useDispatchEffect(
    () => setSelectionTooltip(selectionQuickActions, project.role !== 'viewer'),
    [selectionQuickActions, project.role]
  )
  // Separate dispatches: both specs carry `effects`, so spreading them into
  // one object would drop the first.
  useDispatchEffect(() => setFilePreview(previewByPath), [previewByPath])
  useDispatchEffect(
    () => setDocFolder(openDocId ? dirname(openDocId) : null),
    [dirname, openDocId]
  )

  // The non-blinking cursor setting, or the OS reduced-motion preference.
  useEffect(() => {
    const query = window.matchMedia(REDUCED_MOTION_QUERY)
    const apply = () =>
      view.dispatch(setNonBlinkingCursor(nonBlinkingCursor || query.matches))
    const timer = window.setTimeout(apply)
    query.addEventListener('change', apply)
    return () => {
      window.clearTimeout(timer)
      query.removeEventListener('change', apply)
    }
  }, [view, nonBlinkingCursor])

  useEffect(() => {
    if (!openDocName) return
    const timer = window.setTimeout(() => {
      view.dispatch(
        setDocName(openDocName),
        setLanguage(
          openDocName,
          configRef.current.metadata,
          configRef.current.settings.syntaxValidation
        )
      )
    })
    return () => window.clearTimeout(timer)
  }, [view, openDocName])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      view.dispatch(setVisual(showVisual))
      view.dispatch({
        effects: EditorView.scrollIntoView(view.state.selection.main.head),
      })
      window.dispatchEvent(new Event('editor:visual-switch'))
    })
    return () => window.clearTimeout(timer)
  }, [view, showVisual])

  // compile log annotations for the open doc
  const annotations = useCompileStore(s =>
    openDocPath ? s.annotationsByPath[openDocPath] : undefined
  )
  const compiling = useCompileStore(s => s.status === 'compiling')
  const editedSinceCompileStarted = useCompileStore(
    s =>
      s.changedAt != null &&
      s.compileStartedAt != null &&
      s.changedAt > s.compileStartedAt
  )
  const enableCompileLogLinter =
    !syntaxValidation || (!editedSinceCompileStarted && !compiling)
  const enableCompileLogLinterRef = useRef(enableCompileLogLinter)
  enableCompileLogLinterRef.current = enableCompileLogLinter

  useDispatchEffect(
    () => showCompileLogDiagnostics(enableCompileLogLinter),
    [enableCompileLogLinter]
  )

  useEffect(() => {
    if (!openDocId) return
    const converted: Annotation[] = (annotations ?? []).map((item, i) => ({
      row: item.line - 1,
      type: item.severity,
      text: item.message,
      source: item.source,
      id: `${openDocId}-${i}`,
      entryIndex: i,
      firstOnLine: true,
    }))
    const timer = window.setTimeout(() => {
      view.dispatch(
        setAnnotations(view.state, converted),
        showCompileLogDiagnostics(enableCompileLogLinterRef.current)
      )
    })
    return () => window.clearTimeout(timer)
  }, [view, openDocId, annotations])

  // events from the rest of the IDE (outline, SyncTeX, review)
  useEventListener(
    'editor:gotoLine',
    useCallback(
      (
        event: CustomEvent<{
          gotoLine: number
          gotoColumn?: number
          selectText?: string
        }>
      ) => {
        const { gotoLine, gotoColumn, selectText } = event.detail
        setCursorLineAndScroll(view, gotoLine, gotoColumn, selectText)
      },
      [view]
    )
  )
  useEventListener(
    'editor:gotoOffset',
    useCallback(
      (event: CustomEvent<{ gotoOffset: number }>) =>
        setCursorPositionAndScroll(view, event.detail.gotoOffset),
      [view]
    )
  )
  useEventListener(
    'editor:focus',
    useCallback(() => view.focus(), [view])
  )

  const containerRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (node) node.appendChild(view.dom)
    },
    [view]
  )

  return <div ref={containerRef} style={{ height: '100%' }} />
}

export default memo(OpenLeafEditor)
