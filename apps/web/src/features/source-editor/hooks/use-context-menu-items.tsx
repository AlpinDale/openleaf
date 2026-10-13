import {
  useCodeMirrorStateContext,
  useCodeMirrorViewContext,
} from '@/features/source-editor/components/codemirror-context'
import { usePermissionsContext } from '@/features/ide-react/context/permissions-context'
import { useProjectContext } from '@/shared/context/project-context'
import useSynctex from '@/features/pdf-preview/hooks/use-synctex'
import { useLayoutContext } from '@/shared/context/layout-context'
import { useTranslation } from '@/i18n'
import { useCallback } from 'react'
import {
  formatShortcut,
  useCommandRegistry,
} from '@/features/ide-react/context/command-registry-context'
import { closeContextMenuEffect } from '../extensions/context-menu'
import { useEditorManagerContext } from '@/features/ide-react/context/editor-manager-context'
import { useFileTreePathContext } from '@/features/file-tree/contexts/file-tree-path'
import { useContextMenuCommandDefinition } from './use-command-definitions'
import * as commands from '../extensions/toolbar/commands'
import {
  cutSelection,
  copySelection,
  pasteWithoutFormatting,
  pasteWithFormatting,
} from '../commands/clipboard'
import { showClipboardPasteErrorToast } from '../components/clipboard-toasts'
import { isVisual } from '../extensions/visual/visual'
import { isCursorOnEmptyLine } from '../utils/is-cursor-on-empty-line'
import { selectAll } from '@codemirror/commands'

export const useContextMenuItems = () => {
  const view = useCodeMirrorViewContext()
  const state = useCodeMirrorStateContext()
  const permissions = usePermissionsContext()
  const { syncToPdf, syncToPdfInFlight, canSyncToPdf } = useSynctex()
  const {
    changeLayout,
    pdfLayout,
    view: ideView,
    detachRole,
  } = useLayoutContext()
  const { t } = useTranslation()
  const { shortcuts } = useCommandRegistry()
  // "Add comment" is enabled with comments (M7) through this feature flag
  const { features } = useProjectContext()
  const { openDocWithId } = useEditorManagerContext()
  const { findEntityByPath } = useFileTreePathContext()
  const { commandName, commandDefinition } = useContextMenuCommandDefinition()

  const closeMenu = useCallback(() => {
    view.dispatch({ effects: closeContextMenuEffect.of(null) })
    view.focus()
  }, [view])

  // Handle closing the menu when it loses focus, e.g. click outside the editor
  const onToggle = (show: boolean) => {
    if (!show) {
      closeMenu()
    }
  }

  const hasSelection = !state.selection.main.empty
  const canEdit = permissions.write || permissions.trackedWrite

  const isEditorOnly =
    pdfLayout === 'flat' && ideView === 'editor' && detachRole !== 'detacher'

  const wrapForContextMenu = useCallback(
    (command: () => Promise<boolean> | boolean) => async () => {
      const result = await command()
      if (result !== false) {
        view.focus()
        closeMenu()
      }
    },
    [view, closeMenu]
  )

  const getShortcut = useCallback(
    (id: string) => {
      const shortcut = shortcuts[id]?.[0]
      return shortcut ? formatShortcut(shortcut) : undefined
    },
    [shortcuts]
  )

  const inVisualMode = isVisual(view)

  const handleCut = wrapForContextMenu(() => cutSelection(view))
  const handleCopy = wrapForContextMenu(() => copySelection(view))
  const handlePaste = wrapForContextMenu(async () => {
    const result = await (inVisualMode
      ? pasteWithFormatting(view)
      : pasteWithoutFormatting(view))
    if (result === false) {
      showClipboardPasteErrorToast(getShortcut('paste'))
    }
    return result
  })
  const handlePasteSpecial = wrapForContextMenu(async () => {
    const result = await (inVisualMode
      ? pasteWithoutFormatting(view)
      : pasteWithFormatting(view))
    if (result === false) {
      showClipboardPasteErrorToast(getShortcut('paste'))
    }
    return result
  })
  const handleSelectAll = wrapForContextMenu(() => selectAll(view))
  const handleDelete = wrapForContextMenu(() => commands.deleteSelection(view))

  const handleComment = wrapForContextMenu(() => {
    commands.addComment('editor-context-menu')
    return true
  })

  const handleJumpToDefinition = wrapForContextMenu(() => {
    if (!commandDefinition) {
      return true
    }
    const result = findEntityByPath(commandDefinition.path)
    if (result?.type === 'doc') {
      openDocWithId(result.entity._id, { gotoOffset: commandDefinition.pos })
    }
    return true
  })

  const handleSyncToPdf = useCallback(() => {
    // the PDF must be visible to show the highlight
    if (isEditorOnly) {
      changeLayout('sideBySide')
    }
    void syncToPdf()
    closeMenu()
  }, [syncToPdf, changeLayout, isEditorOnly, closeMenu])

  return {
    closeMenu,
    onToggle,
    menuItems: [
      {
        label: t('cut'),
        handler: handleCut,
        disabled: false,
        show: canEdit,
        shortcut: getShortcut('cut'),
      },
      {
        label: t('copy'),
        handler: handleCopy,
        disabled: false,
        show: true,
        shortcut: getShortcut('copy'),
      },
      {
        label: t('paste'),
        handler: handlePaste,
        disabled: false,
        show: canEdit,
        shortcut: getShortcut('paste'),
      },
      {
        label: inVisualMode
          ? t('paste_without_formatting')
          : t('paste_with_formatting'),
        handler: handlePasteSpecial,
        disabled: false,
        show: canEdit,
        shortcut: inVisualMode ? getShortcut('paste-special') : undefined,
      },
      {
        label: t('select_all'),
        handler: handleSelectAll,
        disabled: false,
        show: true,
        shortcut: getShortcut('select-all'),
      },
      {
        label: t('delete'),
        handler: handleDelete,
        disabled: !hasSelection,
        show: canEdit,
        shortcut: undefined,
      },
      {
        label: t('jump_to_location_in_pdf'),
        handler: handleSyncToPdf,
        disabled: syncToPdfInFlight,
        separatorAbove: true,
        show: canSyncToPdf,
        shortcut: undefined,
      },
      {
        label: t('jump_to_command_definition'),
        handler: handleJumpToDefinition,
        disabled: !commandDefinition,
        separatorAbove: !canSyncToPdf,
        show: Boolean(commandName),
        shortcut: undefined,
      },
      {
        label: t('comment'),
        handler: handleComment,
        disabled: isCursorOnEmptyLine(state),
        separatorAbove: true,
        show: features.trackChangesVisible && permissions.comment,
        shortcut: getShortcut('insert-comment'),
      },
    ].filter(item => item.show),
  }
}
