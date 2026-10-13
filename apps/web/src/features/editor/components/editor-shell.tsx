import type { ProjectDetails, ProjectTree } from '@openleaf/shared'
import {
  Fragment,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
} from 'react'
import {
  Group,
  Panel,
  type PanelImperativeHandle,
  Separator,
  useDefaultLayout,
  usePanelRef,
} from 'react-resizable-panels'
import { CitationDialog } from '@/features/citations/citation-dialog'
import {
  setCommandPaletteOpen,
  useCommandPaletteStore,
} from '@/features/command-palette/command-palette-store'
import { CommandPalette } from '@/features/command-palette/components/command-palette'
import { ConnectionAlerts } from '@/features/connection/connection-alerts'
import { indexTree } from '@/features/file-tree/util/tree-index'
import {
  setFocusMode,
  toggleFocusMode,
  useFocusModeStore,
} from '@/features/focus-mode/focus-mode-store'
import { HistoryView } from '@/features/history/components/history-view'
import { useShellCommands } from '@/features/menu-bar/use-shell-commands'
import { useCompileStore } from '@/features/pdf-preview/compile-store'
import { CompileController } from '@/features/pdf-preview/components/compile-controller'
import { PdfPanel } from '@/features/pdf-preview/components/pdf-panel'
import { startCompileKeypress } from '@/features/pdf-preview/hooks/use-compile-triggers'
import { useConnectionStore } from '@/features/project/session'
import { ProjectSearchPanel } from '@/features/project-search/components/project-search-panel'
import { ADD_COMMENT_EVENT } from '@/features/review/extensions/add-comment-tooltip'
import { useReviewEvents } from '@/features/review/use-review-events'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { useStatusFavicon } from '@/features/status-favicon/use-status-favicon'
import { SymbolPalettePanel } from '@/features/symbol-palette/components/symbol-palette-panel'
import { useTranslation } from '@/i18n'
import OLSpinner from '@/shared/components/ol/ol-spinner'
import { isMac } from '@/shared/utils/os'
import {
  type EditorLayout,
  type RailTab,
  useEditorStore,
} from '../editor-store'
import { EditorPanel } from './editor-panel'
import { EditorTopBar } from './editor-top-bar'
import { selectLayout } from './layout-dropdown'
import { FilesRailPanel, RailStrip } from './rail'

/** Overleaf's layout shortcuts: ⌃⌘ + arrow on macOS, Ctrl+Alt + arrow elsewhere. */
const LAYOUT_KEYS: Record<string, EditorLayout> = {
  ArrowDown: 'sideBySide',
  ArrowLeft: 'editorOnly',
  ArrowRight: 'pdfOnly',
  ArrowUp: 'detached',
}

/**
 * Opens the main document when a project loads, and closes the open doc/file
 * once its entry disappears from the tree.
 */
function useOpenEntrySync(project: ProjectDetails, tree: ProjectTree) {
  const initializedFor = useRef<string | null>(null)
  useEffect(() => {
    const index = indexTree(tree)
    const store = useEditorStore.getState()
    const kindOf = (id: string | null) =>
      id ? index.byId.get(id)?.kind : undefined

    if (initializedFor.current !== project.id) {
      initializedFor.current = project.id
      store.reset()
      const firstTex = [...index.paths.entries()]
        .filter(([id, path]) => kindOf(id) === 'doc' && path.endsWith('.tex'))
        .sort(([, a], [, b]) => a.localeCompare(b))[0]?.[0]
      store.openDoc(
        kindOf(project.rootDocId) === 'doc'
          ? project.rootDocId
          : (firstTex ?? null)
      )
      return
    }
    if (store.openDocId && kindOf(store.openDocId) !== 'doc')
      store.openDoc(null)
    if (store.openFileId && kindOf(store.openFileId) !== 'file') {
      store.openFile(null)
    }
  }, [project.id, project.rootDocId, tree])
}

/**
 * Editor-page shortcuts that work wherever focus is: Mod-Enter / Mod-S compile
 * (also the Vim `:w` command's `pdf:recompile` event), Mod-Shift-F opens
 * project search, Mod-P the command palette, Mod-Shift-M toggles focus mode,
 * and the layout shortcuts. Capture phase, so they win over CodeMirror and
 * inputs. Esc leaves focus mode when nothing else used the key.
 */
function useGlobalShortcuts(projectId: string) {
  useEffect(() => {
    const compile = () => {
      useCompileStore.getState().compile()
    }
    // whether an open dialog or menu will consume this Escape (checked before
    // they handle it and possibly close)
    let escapeForPopup = false
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        escapeForPopup = Boolean(
          document.querySelector('.modal.show, .dropdown-menu.show')
        )
        return
      }
      if (startCompileKeypress(event)) {
        event.preventDefault()
        event.stopPropagation()
        compile()
        return
      }
      const layoutModifiers = isMac
        ? event.ctrlKey && event.metaKey && !event.altKey
        : event.ctrlKey && event.altKey && !event.metaKey
      const layout = LAYOUT_KEYS[event.key]
      if (layoutModifiers && !event.shiftKey && layout) {
        event.preventDefault()
        event.stopPropagation()
        if (!useEditorStore.getState().historyOpen) {
          selectLayout(projectId, layout)
        }
        return
      }
      if (!(isMac ? event.metaKey : event.ctrlKey) || event.altKey) return
      const key = event.key.toLowerCase()
      // review shortcuts re-dispatch the events of the in-editor keymap
      const reviewEvent = event.shiftKey
        ? { a: 'toggle-track-changes', c: ADD_COMMENT_EVENT }[key]
        : key === 'j'
          ? 'ui.toggle-review-panel'
          : undefined
      if (reviewEvent) {
        event.preventDefault()
        event.stopPropagation()
        window.dispatchEvent(new Event(reviewEvent))
      } else if (event.shiftKey && key === 'f') {
        event.preventDefault()
        useEditorStore.setState({ railTab: 'search' })
      } else if (event.shiftKey && key === 'm') {
        event.preventDefault()
        event.stopPropagation()
        toggleFocusMode()
      } else if (!event.shiftKey && key === 'p') {
        event.preventDefault()
        event.stopPropagation()
        if (!useEditorStore.getState().historyOpen) {
          setCommandPaletteOpen(!useCommandPaletteStore.getState().open)
        }
      }
    }
    // bubble phase: CodeMirror (autocomplete, search panel, Vim) gets Escape
    // first and marks it handled
    const onEscape = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        !event.defaultPrevented &&
        !escapeForPopup &&
        useFocusModeStore.getState().focusMode
      ) {
        setFocusMode(false)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keydown', onEscape)
    window.addEventListener('pdf:recompile', compile)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keydown', onEscape)
      window.removeEventListener('pdf:recompile', compile)
    }
  }, [projectId])
}

function railPanel(
  tab: RailTab,
  project: ProjectDetails,
  tree: ProjectTree,
  railFilesLower: ReactNode
) {
  switch (tab) {
    case 'files':
      return (
        <FilesRailPanel project={project} tree={tree} lower={railFilesLower} />
      )
    case 'search':
      return <ProjectSearchPanel tree={tree} />
    case 'symbols':
      return <SymbolPalettePanel project={project} />
  }
}

const PANEL_IDS = ['rail', 'editor', 'pdf'] as const
type PanelId = (typeof PANEL_IDS)[number]
const DEFAULT_SIZES: Record<PanelId, number> = { rail: 20, editor: 40, pdf: 40 }

/**
 * Rail | editor | PDF. All three panels stay mounted (hidden ones are
 * collapsed to 0) so the single EditorView and its per-doc states survive
 * rail and layout changes.
 */
function EditorBody({
  project,
  tree,
  railFilesLower,
}: {
  project: ProjectDetails
  tree: ProjectTree
  railFilesLower?: ReactNode
}) {
  const layout = useEditorStore(s => s.layout)
  const railTab = useEditorStore(s => s.railTab)
  const historyOpen = useEditorStore(s => s.historyOpen)
  const focusMode = useFocusModeStore(s => s.focusMode)
  const visible: Record<PanelId, boolean> = {
    rail: railTab !== null && !focusMode,
    editor: layout !== 'pdfOnly',
    pdf: layout === 'sideBySide' || layout === 'pdfOnly',
  }
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: 'openleaf-editor',
    panelIds: [...PANEL_IDS],
  })
  const refs: Record<PanelId, RefObject<PanelImperativeHandle | null>> = {
    rail: usePanelRef(),
    editor: usePanelRef(),
    pdf: usePanelRef(),
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: refs are stable; re-run when visibility changes
  useEffect(() => {
    for (const id of PANEL_IDS) {
      const panel = refs[id].current
      if (!panel) continue
      if (visible[id] && panel.isCollapsed()) panel.expand()
      else if (!visible[id] && !panel.isCollapsed()) panel.collapse()
    }
  }, [visible.rail, visible.editor, visible.pdf])

  const content: Record<PanelId, ReactNode> = {
    rail: railTab ? railPanel(railTab, project, tree, railFilesLower) : null,
    editor: <EditorPanel project={project} tree={tree} />,
    pdf: <PdfPanel />,
  }

  return (
    <div className="ide-redesign-body">
      {!focusMode && <RailStrip />}
      <div className="openleaf-editor-workspace">
        <Group
          orientation="horizontal"
          id="openleaf-editor"
          className="openleaf-editor-panels"
          defaultLayout={defaultLayout}
          onLayoutChanged={onLayoutChanged}
        >
          {PANEL_IDS.map((id, i) => {
            // A separator is usable only between two visible panels.
            const separatorUsable =
              visible[id] && PANEL_IDS.slice(0, i).some(prev => visible[prev])
            return (
              <Fragment key={id}>
                {i > 0 && (
                  <Separator
                    disabled={!separatorUsable}
                    className={
                      separatorUsable
                        ? 'horizontal-resize-handle horizontal-resize-handle-enabled'
                        : 'd-none'
                    }
                  />
                )}
                <Panel
                  id={id}
                  panelRef={refs[id]}
                  defaultSize={`${DEFAULT_SIZES[id]}`}
                  minSize={id === 'rail' ? '10' : '15'}
                  collapsible
                  collapsedSize="0"
                  className="openleaf-editor-panel"
                  style={visible[id] ? undefined : { overflow: 'hidden' }}
                >
                  {content[id]}
                </Panel>
              </Fragment>
            )
          })}
        </Group>
        {historyOpen && (
          <div className="openleaf-history-overlay">
            <HistoryView project={project} />
          </div>
        )}
      </div>
    </div>
  )
}

export function EditorShell({
  project,
  tree,
  railFilesLower,
}: {
  project: ProjectDetails
  tree: ProjectTree
  /** Content under the file tree in the Files rail tab. */
  railFilesLower?: ReactNode
}) {
  const { t } = useTranslation()
  const status = useConnectionStore(s => s.status)
  const syncedOnce = useConnectionStore(s => s.syncedOnce)
  const historyOpen = useEditorStore(s => s.historyOpen)
  useOpenEntrySync(project, tree)
  useGlobalShortcuts(project.id)
  useReviewEvents()
  useShellCommands(project.id)
  useStatusFavicon()

  // first in both branches, so it stays mounted when the first sync lands
  const connectionAlerts = <ConnectionAlerts />

  if (!syncedOnce) {
    return (
      <>
        {connectionAlerts}
        <div className="loading-screen" data-testid="editor-connecting">
          <OLSpinner size="lg" />
          <p className="loading-screen-label">{t('connecting')}…</p>
        </div>
      </>
    )
  }

  return (
    <>
      {connectionAlerts}
      <div className="ide-redesign-main openleaf-editor">
        <EditorTopBar project={project} tree={tree} />
        <CompileController project={project} />
        {status !== 'connected' && (
          <div
            className="editing-paused-banner"
            role="status"
            data-testid="editor-reconnecting"
          >
            <OLSpinner size="sm" />
            {t('reconnecting')}…
          </div>
        )}
        <EditorBody
          project={project}
          tree={tree}
          railFilesLower={railFilesLower}
        />
        <CommandPalette tree={tree} disabled={historyOpen} />
        <SettingsModal project={project} tree={tree} />
        <CitationDialog project={project} tree={tree} />
      </div>
    </>
  )
}
