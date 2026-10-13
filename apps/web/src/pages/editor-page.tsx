import { useEffect } from 'react'
import { Link, useParams } from 'react-router'
import { useMe } from '@/api/auth'
import { isApiError } from '@/api/client'
import { useProject } from '@/api/projects'
import { useTree } from '@/api/tree'
import { DeepLinkHandler } from '@/features/deep-links/deep-link-handler'
import { EditorShell } from '@/features/editor/components/editor-shell'
import { setEditorMeta } from '@/features/editor/editor-meta'
import { OutlineContainer } from '@/features/outline/components/outline-container'
import { ProjectSessionProvider } from '@/features/project/session-context'
import { EditingModeBinding } from '@/features/review/editing-mode'
import { useTranslation } from '@/i18n'
import { FullSizeLoadingSpinner } from '@/shared/components/loading-spinner'
import Notification from '@/shared/components/notification'

export default function EditorPage() {
  const { t } = useTranslation()
  const { id = '' } = useParams()
  const project = useProject(id)
  const tree = useTree(id)
  const me = useMe()

  useEffect(() => {
    if (!project.data) return
    const previous = document.title
    document.title = `${project.data.name} - OpenLeaf`
    return () => {
      document.title = previous
    }
  }, [project.data])

  const error = project.error ?? tree.error
  if (error) {
    return (
      <div className="container py-5">
        <Notification
          type="error"
          title={
            isApiError(error, 'not_found')
              ? t('project_not_found')
              : t('generic_something_went_wrong')
          }
          content={
            <>
              <p>{error.message}</p>
              <Link to="/">{t('back_to_your_projects')}</Link>
            </>
          }
        />
      </div>
    )
  }
  if (!project.data || !tree.data || !me.data)
    return <FullSizeLoadingSpinner delay={500} />

  setEditorMeta(project.data, me.data)

  return (
    <ProjectSessionProvider projectId={id}>
      <EditorShell
        project={project.data}
        tree={tree.data}
        railFilesLower={<OutlineContainer />}
      />
      <DeepLinkHandler />
      <EditingModeBinding />
    </ProjectSessionProvider>
  )
}
