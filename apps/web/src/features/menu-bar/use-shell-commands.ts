import { useMe } from '@/api/auth'
import {
  FOCUS_MODE_COMMAND_ID,
  LAYOUT_OPTIONS,
  selectLayout,
} from '@/features/editor/components/layout-dropdown'
import { useEditorStore } from '@/features/editor/editor-store'
import {
  toggleFocusMode,
  useFocusModeStore,
} from '@/features/focus-mode/focus-mode-store'
import { useCommandProvider } from '@/features/ide-react/hooks/use-command-provider'
import {
  syncCursorToPdf,
  useCompileStore,
} from '@/features/pdf-preview/compile-store'
import { syncViewportToCode } from '@/features/pdf-preview/components/synctex-controls'
import {
  requestPresentationMode,
  setZoom,
  usePdfViewerStore,
} from '@/features/pdf-preview/pdf-viewer-store'
import { openSettingsModal } from '@/features/settings/settings-modal-store'
import { useTranslation } from '@/i18n'

/**
 * Registers the editor shell's commands (layout, focus mode, compile,
 * SyncTeX, PDF viewer, panels) so the menus and the command palette share
 * them. Mount once per editor page.
 */
export function useShellCommands(projectId: string) {
  const { t } = useTranslation()
  const layout = useEditorStore(s => s.layout)
  const focusMode = useFocusModeStore(s => s.focusMode)
  const compiling = useCompileStore(s => s.status === 'compiling')
  const hasPdf = useCompileStore(s => s.pdfUrl !== null)
  const viewerReady = usePdfViewerStore(s => s.wrapper !== null)
  const nativeViewer = useMe().data?.settings.pdfViewer === 'native'
  const pdfVisible = layout === 'sideBySide' || layout === 'pdfOnly'
  const pdfjsReady = viewerReady && pdfVisible && !nativeViewer
  const synctexReady = hasPdf && !nativeViewer

  useCommandProvider(
    () => [
      ...LAYOUT_OPTIONS.map(option => ({
        id: option.commandId,
        label: t(option.labelKey),
        handler: () => selectLayout(projectId, option.layout),
      })),
      {
        id: FOCUS_MODE_COMMAND_ID,
        label: focusMode ? t('exit_focus_mode') : t('focus_mode'),
        handler: toggleFocusMode,
      },
      {
        id: 'compile',
        label: t('recompile'),
        disabled: compiling,
        handler: () => void useCompileStore.getState().compile(),
      },
      {
        id: 'stop-compile',
        label: t('stop_compile'),
        disabled: !compiling,
        handler: () => void useCompileStore.getState().stop(),
      },
      {
        id: 'recompile-from-scratch',
        label: t('recompile_from_scratch'),
        disabled: compiling,
        handler: () => void useCompileStore.getState().recompileFromScratch(),
      },
      {
        id: 'synctex-sync-to-pdf',
        label: t('show_in_pdf'),
        disabled: !synctexReady,
        handler: () => syncCursorToPdf(),
      },
      {
        id: 'synctex-sync-to-code',
        label: t('show_in_code'),
        disabled: !synctexReady || !pdfVisible,
        handler: syncViewportToCode,
      },
      {
        id: 'show_version_history',
        label: t('show_version_history'),
        handler: () => useEditorStore.getState().setHistoryOpen(true),
      },
      {
        id: 'toggle-review-panel',
        label: t('review_panel'),
        handler: () =>
          window.dispatchEvent(new Event('ui.toggle-review-panel')),
      },
      {
        id: 'project-search',
        label: t('project_search'),
        handler: () => useEditorStore.setState({ railTab: 'search' }),
      },
      {
        id: 'open-settings',
        label: t('settings'),
        handler: () => openSettingsModal(),
      },
      {
        id: 'view-pdf-presentation-mode',
        label: t('presentation_mode'),
        disabled: !pdfjsReady,
        handler: requestPresentationMode,
      },
      {
        id: 'view-pdf-zoom-in',
        label: t('zoom_in'),
        disabled: !pdfjsReady,
        handler: () => setZoom('zoom-in'),
      },
      {
        id: 'view-pdf-zoom-out',
        label: t('zoom_out'),
        disabled: !pdfjsReady,
        handler: () => setZoom('zoom-out'),
      },
      {
        id: 'view-pdf-fit-width',
        label: t('fit_to_width'),
        disabled: !pdfjsReady,
        handler: () => setZoom('page-width'),
      },
      {
        id: 'view-pdf-fit-height',
        label: t('fit_to_height'),
        disabled: !pdfjsReady,
        handler: () => setZoom('page-height'),
      },
    ],
    [t, projectId, focusMode, compiling, synctexReady, pdfVisible, pdfjsReady]
  )
}
