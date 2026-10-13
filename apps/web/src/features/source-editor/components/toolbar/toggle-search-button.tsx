import { FC } from 'react'
import * as commands from '@/features/source-editor/extensions/toolbar/commands'
import { searchPanelOpen } from '@codemirror/search'
import { ToolbarButton } from '@/features/source-editor/components/toolbar/toolbar-button'
import { EditorState } from '@codemirror/state'
import { useTranslation } from '@/i18n'
import { isMac } from '@/shared/utils/os'

export const ToggleSearchButton: FC<{ state: EditorState }> = ({ state }) => {
  const { t } = useTranslation()

  return (
    <ToolbarButton
      id="toolbar-toggle-search"
      label={t('toolbar_search_file')}
      command={commands.toggleSearch}
      active={searchPanelOpen(state)}
      icon="search"
      shortcut={isMac ? '⌘F' : 'Ctrl+F'}
    />
  )
}
