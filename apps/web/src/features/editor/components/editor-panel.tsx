import type { ProjectDetails, ProjectTree } from '@openleaf/shared'
import { lazy, Suspense } from 'react'
import { TabsContainer } from '@/features/editor-tabs/components/tabs-container'
import { indexTree } from '@/features/file-tree/util/tree-index'
import { FileView } from '@/features/file-view/file-view'
import { useIdeUserSettings } from '@/features/ide-react/openleaf-ide'
import { useTranslation } from '@/i18n'
import { FullSizeLoadingSpinner } from '@/shared/components/loading-spinner'
import { useEditorStore } from '../editor-store'

const SourceEditor = lazy(
  () => import('@/features/source-editor/components/source-editor')
)

export function EditorPanel({
  project,
  tree,
}: {
  project: ProjectDetails
  tree: ProjectTree
}) {
  const { t } = useTranslation()
  const { editorTabs, previewEditorTabs } = useIdeUserSettings()
  const openDocId = useEditorStore(s => s.openDocId)
  const openFileId = useEditorStore(s => s.openFileId)
  const index = indexTree(tree)
  const file = openFileId ? index.byId.get(openFileId) : undefined

  return (
    <div className="ide-redesign-editor-container" data-testid="editor-panel">
      {editorTabs && (
        <TabsContainer
          projectId={project.id}
          tree={tree}
          preview={previewEditorTabs}
        />
      )}
      <div className="ol-editor-panel-body">
        {file && <FileView project={project} entry={file} />}
        {openDocId ? (
          // stays mounted while a binary file is shown, keeping per-doc state
          <div className="ide-redesign-full-height" hidden={!!file}>
            <Suspense fallback={<FullSizeLoadingSpinner delay={500} />}>
              <SourceEditor />
            </Suspense>
          </div>
        ) : (
          !file && (
            <div className="no-file-selection-message">
              <h3>{t('no_file_selected')}</h3>
            </div>
          )
        )}
      </div>
    </div>
  )
}
