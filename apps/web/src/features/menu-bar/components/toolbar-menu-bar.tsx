// Adapted from Overleaf services/web/frontend/js/features/ide-react/components/toolbar/{menu-bar,change-layout-options,download-project}.tsx (AGPL-3.0).
import { selectAll } from '@codemirror/commands'
import { openSearchPanel } from '@codemirror/search'
import type { EditorView } from '@codemirror/view'
import {
  EXPORT_FORMATS,
  type ExportFormat,
  type ProjectDetails,
  type ProjectTree,
  roleAtLeast,
} from '@openleaf/shared'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { yUndoManagerKeymap } from 'y-codemirror.next'
import { patchMe, useMe } from '@/api/auth'
import { errorMessage } from '@/api/client'
import { useAppConfig } from '@/api/config'
import { copyProject, projectZipUrl } from '@/api/projects'
import { setCommandPaletteOpen } from '@/features/command-palette/command-palette-store'
import { NamePromptModal } from '@/features/common/name-prompt-modal'
import {
  FOCUS_MODE_COMMAND_ID,
  LAYOUT_OPTIONS,
  selectLayout,
  useShortcutLabel,
} from '@/features/editor/components/layout-dropdown'
import { useEditorBridge } from '@/features/editor/editor-bridge'
import { useEditorStore } from '@/features/editor/editor-store'
import { exportProject } from '@/features/export/export-project'
import { requestFileTreeAction } from '@/features/file-tree/file-tree-actions'
import {
  setFocusMode,
  useFocusModeStore,
} from '@/features/focus-mode/focus-mode-store'
import HotkeysModal from '@/features/hotkeys-modal/components/hotkeys-modal'
import { setVisualMode } from '@/features/ide-react/context/editor-properties-context'
import { useCommandProvider } from '@/features/ide-react/hooks/use-command-provider'
import {
  openWordCount,
  useCompileStore,
} from '@/features/pdf-preview/compile-store'
import {
  requestPresentationMode,
  setZoom,
  usePdfViewerStore,
} from '@/features/pdf-preview/pdf-viewer-store'
import {
  type EditingMode,
  setEditingMode,
  useEditingMode,
} from '@/features/review/editing-mode'
import { applySnippet } from '@/features/source-editor/languages/latex/completions/apply'
import { isVisualEditorAvailable } from '@/features/source-editor/utils/visual-editor'
import { showToast } from '@/features/toasts'
import { useTranslation } from '@/i18n'
import { MenuBar } from '@/shared/components/menu-bar/menu-bar'
import {
  MenuBarDropdown,
  NestedMenuBarDropdown,
} from '@/shared/components/menu-bar/menu-bar-dropdown'
import { MenuBarOption } from '@/shared/components/menu-bar/menu-bar-option'
import {
  OLDropdownDivider,
  OLDropdownHeader,
  OLDropdownItem,
} from '@/shared/components/ol/ol-dropdown-menu'
import { isMac } from '@/shared/utils/os'
import CommandDropdown, { type MenuStructure } from './command-dropdown'

/** Registry ids of the export commands, as in Overleaf. */
const EXPORT_COMMANDS: Record<ExportFormat, { id: string; labelKey: string }> =
  {
    docx: { id: 'export-as-docx', labelKey: 'export_as_docx' },
    md: { id: 'export-as-markdown', labelKey: 'export_as_markdown' },
    html: { id: 'export-as-html', labelKey: 'export_as_html' },
  }

/** Insert menu snippets (`$1` is where the cursor lands). */
const INSERT_SNIPPETS = [
  {
    id: 'insert-title',
    labelKey: 'title',
    template: '\\title{$1}',
  },
  {
    id: 'insert-abstract',
    labelKey: 'abstract',
    template: '\\begin{abstract}\n\t$1\n\\end{abstract}',
  },
  {
    id: 'insert-keywords',
    labelKey: 'keywords',
    template: '\\noindent\\textbf{Keywords:} $1',
  },
]

const EDITING_MODES: { mode: EditingMode; labelKey: string }[] = [
  { mode: 'editing', labelKey: 'editing' },
  { mode: 'reviewing', labelKey: 'reviewing' },
  { mode: 'viewing', labelKey: 'viewing' },
]

/** Runs the Yjs undo manager's binding for `key` (`Mod-z` undo, `Mod-y` redo). */
function runUndoBinding(view: EditorView, key: 'Mod-z' | 'Mod-y') {
  yUndoManagerKeymap.find(binding => binding.key === key)?.run?.(view)
  view.focus()
}

/** Inserts a snippet at the cursor, on a line of its own when the line has text. */
function insertSnippet(view: EditorView, template: string) {
  const { from, to } = view.state.selection.main
  const line = view.state.doc.lineAt(from)
  const prefix = line.text.slice(0, from - line.from).trim() ? '\n' : ''
  applySnippet(`${prefix}${template}`)(view, { label: '' }, from, to)
  view.focus()
}

/** Starts a download without leaving the editor page. */
function download(url: string, filename: string) {
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
}

const checkIcon = (checked: boolean) =>
  checked ? 'check' : <OLDropdownItem.EmptyLeadingIcon />

function shortcutHint(label: string | undefined) {
  return label ? <span className="dropdown-shortcut">{label}</span> : undefined
}

function LayoutOption({
  projectId,
  option,
  active,
}: {
  projectId: string
  option: (typeof LAYOUT_OPTIONS)[number]
  active: boolean
}) {
  const { t } = useTranslation()
  const shortcut = useShortcutLabel(option.commandId)
  return (
    <MenuBarOption
      eventKey={option.layout}
      title={t(option.labelKey)}
      leadingIcon={checkIcon(active)}
      trailingIcon={shortcutHint(shortcut)}
      onClick={() => selectLayout(projectId, option.layout)}
    />
  )
}

function EditingModeMenu() {
  const { t } = useTranslation()
  const { mode, availableModes, disabledModes } = useEditingMode()
  return (
    <NestedMenuBarDropdown id="view-editing-mode" title={t('editing_mode')}>
      {EDITING_MODES.filter(option => availableModes.includes(option.mode)).map(
        option => (
          <MenuBarOption
            key={option.mode}
            eventKey={`editing-mode-${option.mode}`}
            title={t(option.labelKey)}
            leadingIcon={checkIcon(mode === option.mode)}
            disabled={disabledModes.includes(option.mode)}
            onClick={() => setEditingMode(option.mode)}
          />
        )
      )}
    </NestedMenuBarDropdown>
  )
}

function ViewMenu({
  project,
  visualAvailable,
}: {
  project: ProjectDetails
  visualAvailable: boolean
}) {
  const { t } = useTranslation()
  const layout = useEditorStore(s => s.layout)
  const railTab = useEditorStore(s => s.railTab)
  const editorMode = useEditorStore(s => s.editorMode)
  const focusMode = useFocusModeStore(s => s.focusMode)
  const settings = useMe().data?.settings
  const pdfjsReady = usePdfViewerStore(s => s.wrapper !== null)
  const pdfVisible =
    (layout === 'sideBySide' || layout === 'pdfOnly') &&
    settings?.pdfViewer !== 'native'
  const focusShortcut = useShortcutLabel(FOCUS_MODE_COMMAND_ID)
  const paletteShortcut = useShortcutLabel('command-palette')

  const toggleSetting = (
    name: 'breadcrumbs' | 'editorTabs' | 'mathPreview',
    value: boolean
  ) => {
    patchMe({ settings: { [name]: value } }).catch(err =>
      showToast({ type: 'error', content: errorMessage(err) })
    )
  }

  const subdued =
    'ide-redesign-toolbar-dropdown-toggle-subdued ide-redesign-toolbar-button-subdued'

  return (
    <MenuBarDropdown title={t('view')} id="view" className={subdued}>
      <OLDropdownHeader>{t('layout_options')}</OLDropdownHeader>
      {LAYOUT_OPTIONS.map(option => (
        <LayoutOption
          key={option.layout}
          projectId={project.id}
          option={option}
          active={layout === option.layout}
        />
      ))}
      <MenuBarOption
        eventKey="focus_mode"
        title={t('focus_mode')}
        leadingIcon={checkIcon(focusMode)}
        trailingIcon={shortcutHint(focusShortcut)}
        onClick={() => setFocusMode(!focusMode)}
      />
      <MenuBarOption
        eventKey="show_sidebar"
        title={t('show_sidebar')}
        leadingIcon={checkIcon(railTab !== null)}
        disabled={focusMode}
        onClick={() =>
          useEditorStore.setState({
            railTab: railTab === null ? 'files' : null,
          })
        }
      />
      <OLDropdownDivider />
      <OLDropdownHeader>{t('editor')}</OLDropdownHeader>
      <EditingModeMenu />
      <MenuBarOption
        eventKey="editor_mode_source"
        title={t('source')}
        leadingIcon={checkIcon(editorMode === 'source')}
        onClick={() => setVisualMode(false)}
      />
      <MenuBarOption
        eventKey="editor_mode_visual"
        title={t('visual')}
        leadingIcon={checkIcon(editorMode === 'visual')}
        disabled={!visualAvailable}
        onClick={() => setVisualMode(true)}
      />
      <OLDropdownDivider />
      <OLDropdownHeader>{t('editor_settings')}</OLDropdownHeader>
      <MenuBarOption
        eventKey="show_breadcrumbs"
        title={t('show_breadcrumbs')}
        leadingIcon={checkIcon(settings?.breadcrumbs ?? true)}
        onClick={() =>
          toggleSetting('breadcrumbs', !(settings?.breadcrumbs ?? true))
        }
      />
      <MenuBarOption
        eventKey="show_editor_tabs"
        title={t('show_editor_tabs')}
        leadingIcon={checkIcon(settings?.editorTabs ?? true)}
        onClick={() =>
          toggleSetting('editorTabs', !(settings?.editorTabs ?? true))
        }
      />
      <MenuBarOption
        eventKey="show_equation_preview"
        title={t('show_equation_preview')}
        leadingIcon={checkIcon(settings?.mathPreview ?? true)}
        onClick={() =>
          toggleSetting('mathPreview', !(settings?.mathPreview ?? true))
        }
      />
      <OLDropdownDivider />
      <OLDropdownHeader>{t('pdf_preview')}</OLDropdownHeader>
      <MenuBarOption
        eventKey="presentation_mode"
        title={t('presentation_mode')}
        disabled={!pdfjsReady || !pdfVisible}
        onClick={requestPresentationMode}
      />
      <NestedMenuBarDropdown id="view-pdf-zoom" title={t('pdf_zoom')}>
        <MenuBarOption
          eventKey="pdf_zoom_in"
          title={t('zoom_in')}
          disabled={!pdfjsReady || !pdfVisible}
          onClick={() => setZoom('zoom-in')}
        />
        <MenuBarOption
          eventKey="pdf_zoom_out"
          title={t('zoom_out')}
          disabled={!pdfjsReady || !pdfVisible}
          onClick={() => setZoom('zoom-out')}
        />
        <MenuBarOption
          eventKey="pdf_fit_width"
          title={t('fit_to_width')}
          disabled={!pdfjsReady || !pdfVisible}
          onClick={() => setZoom('page-width')}
        />
        <MenuBarOption
          eventKey="pdf_fit_height"
          title={t('fit_to_height')}
          disabled={!pdfjsReady || !pdfVisible}
          onClick={() => setZoom('page-height')}
        />
      </NestedMenuBarDropdown>
      <OLDropdownDivider />
      <MenuBarOption
        eventKey="command_palette"
        title={t('command_palette')}
        trailingIcon={shortcutHint(paletteShortcut)}
        onClick={() => setCommandPaletteOpen(true)}
      />
    </MenuBarDropdown>
  )
}

export function ToolbarMenuBar({
  project,
  tree,
}: {
  project: ProjectDetails
  tree: ProjectTree
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const view = useEditorBridge(s => s.view)
  const openDocId = useEditorStore(s => s.openDocId)
  const pdfUrl = useCompileStore(s => s.pdfUrl)
  const config = useAppConfig().data
  const [showHotkeys, setShowHotkeys] = useState(false)
  const [showCopy, setShowCopy] = useState(false)

  const canWrite = roleAtLeast(project.role, 'editor')
  const canTrackedWrite = roleAtLeast(project.role, 'reviewer')
  const openDocName = openDocId
    ? tree.entries.find(entry => entry.id === openDocId)?.name
    : undefined
  const visualAvailable = openDocName
    ? isVisualEditorAvailable(openDocName)
    : false
  const exportsAvailable = config?.exports ?? false
  const supportUrl = config?.supportUrl ?? null

  useCommandProvider(
    () => [
      {
        id: 'new_file',
        label: t('new_file'),
        disabled: !canWrite,
        handler: () => requestFileTreeAction('new-file'),
      },
      {
        id: 'new_folder',
        label: t('new_folder'),
        disabled: !canWrite,
        handler: () => requestFileTreeAction('new-folder'),
      },
      {
        id: 'upload_file',
        label: t('upload_file'),
        disabled: !canWrite,
        handler: () => requestFileTreeAction('upload'),
      },
      {
        id: 'copy_project',
        label: t('make_a_copy'),
        handler: () => setShowCopy(true),
      },
      {
        id: 'word_count',
        label: t('word_count_lower'),
        handler: openWordCount,
      },
      {
        id: 'download-as-source-zip',
        label: t('download_as_source_zip'),
        handler: () =>
          download(projectZipUrl(project.id), `${project.name}.zip`),
      },
      {
        id: 'download-pdf',
        label: t('download_as_pdf'),
        disabled: !pdfUrl,
        handler: () => {
          if (pdfUrl) download(pdfUrl, `${project.name}.pdf`)
        },
      },
      ...EXPORT_FORMATS.map(format => ({
        id: EXPORT_COMMANDS[format].id,
        label: t(EXPORT_COMMANDS[format].labelKey),
        disabled: !exportsAvailable,
        handler: () => void exportProject(project.id, format),
      })),
      {
        id: 'keyboard-shortcuts',
        label: t('keyboard_shortcuts'),
        handler: () => setShowHotkeys(true),
      },
      ...(supportUrl
        ? [
            {
              id: 'contact-us',
              label: t('contact_us'),
              handler: () =>
                window.open(supportUrl, '_blank', 'noopener,noreferrer'),
            },
          ]
        : []),
      {
        id: 'undo',
        label: t('undo'),
        disabled: !view || !canTrackedWrite,
        handler: () => {
          if (view) runUndoBinding(view, 'Mod-z')
        },
      },
      {
        id: 'redo',
        label: t('redo'),
        disabled: !view || !canTrackedWrite,
        handler: () => {
          if (view) runUndoBinding(view, 'Mod-y')
        },
      },
      {
        id: 'find',
        label: t('find'),
        disabled: !view,
        handler: () => {
          if (view) openSearchPanel(view)
        },
      },
      {
        id: 'select-all',
        label: t('select_all'),
        disabled: !view,
        handler: () => {
          if (!view) return
          selectAll(view)
          view.focus()
        },
      },
      ...INSERT_SNIPPETS.map(snippet => ({
        id: snippet.id,
        label: t(snippet.labelKey),
        disabled: !view || !canTrackedWrite || !visualAvailable,
        handler: () => {
          if (view) insertSnippet(view, snippet.template)
        },
      })),
    ],
    [
      t,
      project.id,
      project.name,
      canWrite,
      canTrackedWrite,
      pdfUrl,
      view,
      visualAvailable,
      exportsAvailable,
      supportUrl,
    ]
  )

  const fileMenu: MenuStructure = useMemo(
    () => [
      {
        id: 'file-file-tree',
        children: ['new_file', 'new_folder', 'upload_file', 'copy_project'],
      },
      { id: 'file-tools', children: ['show_version_history', 'word_count'] },
      {
        id: 'file-download',
        children: [
          {
            id: 'file-download-group',
            title: t('download'),
            children: [
              'download-as-source-zip',
              'download-pdf',
              ...EXPORT_FORMATS.map(format => EXPORT_COMMANDS[format].id),
            ],
          },
        ],
      },
      { id: 'file-settings', children: ['open-settings'] },
    ],
    [t]
  )

  const editMenu: MenuStructure = useMemo(
    () => [
      { id: 'edit-undo-redo', children: ['undo', 'redo'] },
      { id: 'edit-search', children: ['find', 'select-all'] },
    ],
    []
  )

  const insertMenu: MenuStructure = useMemo(
    () => [
      {
        id: 'insert-latex',
        children: [
          {
            id: 'insert-math-group',
            title: t('math'),
            children: ['insert-inline-math', 'insert-display-math'],
          },
          'insert-symbol',
          {
            id: 'insert-figure-group',
            title: t('figure'),
            children: [
              'insert-figure-from-computer',
              'insert-figure-from-project-files',
              'insert-figure-from-another-project',
              'insert-figure-from-url',
            ],
          },
          'insert-table',
          'insert-citation',
          'insert-link',
          'insert-cross-reference',
        ],
      },
      {
        id: 'insert-document-parts',
        children: ['insert-title', 'insert-abstract', 'insert-keywords'],
      },
      { id: 'insert-comment', children: ['comment'] },
    ],
    [t]
  )

  const formatMenu: MenuStructure = useMemo(
    () => [
      { id: 'format-text', children: ['format-bold', 'format-italics'] },
      {
        id: 'format-list',
        children: [
          'format-bullet-list',
          'format-numbered-list',
          'format-increase-indentation',
          'format-decrease-indentation',
        ],
      },
      {
        id: 'format-paragraph',
        title: t('paragraph_styles'),
        children: [
          'format-style-normal',
          'format-style-section',
          'format-style-subsection',
          'format-style-subsubsection',
          'format-style-paragraph',
          'format-style-subparagraph',
        ],
      },
    ],
    [t]
  )

  const helpMenu: MenuStructure = useMemo(
    () => [{ id: 'help-main', children: ['keyboard-shortcuts', 'contact-us'] }],
    []
  )

  return (
    <>
      <MenuBar
        className="ide-redesign-toolbar-menu-bar"
        id="toolbar-menu-bar-item"
        data-testid="menu-bar"
      >
        <CommandDropdown menu={fileMenu} title={t('file')} id="file" />
        <CommandDropdown menu={editMenu} title={t('edit')} id="edit" />
        <CommandDropdown menu={insertMenu} title={t('insert')} id="insert" />
        <ViewMenu project={project} visualAvailable={visualAvailable} />
        <CommandDropdown menu={formatMenu} title={t('format')} id="format" />
        <CommandDropdown menu={helpMenu} title={t('help')} id="help" />
      </MenuBar>
      <HotkeysModal
        show={showHotkeys}
        handleHide={() => setShowHotkeys(false)}
        isMac={isMac}
        trackChangesVisible
      />
      <NamePromptModal
        show={showCopy}
        title={t('copy_project')}
        label={t('project_name')}
        initialValue={t('copy_of_x', { name: project.name })}
        submitLabel={t('copy')}
        testId="copy-project-modal"
        onHide={() => setShowCopy(false)}
        onSubmit={async name => {
          const id = await copyProject(project.id, name)
          showToast({ type: 'success', content: t('project_copied') })
          navigate(`/project/${id}`)
        }}
      />
    </>
  )
}
