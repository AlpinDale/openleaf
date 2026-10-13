import { useEffect } from 'react'
import { useParams } from 'react-router'
import { useProject } from '@/api/projects'
import { connectCompileStore } from '@/features/pdf-preview/compile-store'
import { DetachedOrphanBanner } from '@/features/pdf-preview/components/detached-orphan-banner'
import { PdfPanel } from '@/features/pdf-preview/components/pdf-panel'
import { useStatusFavicon } from '@/features/status-favicon/use-status-favicon'

/**
 * PDF viewer opened by the "PDF in separate tab" layout. Compiles and SyncTeX
 * jumps are relayed to the editor window over a BroadcastChannel.
 */
export default function DetachedPdfPage() {
  const { id = '' } = useParams()
  const project = useProject(id)
  useStatusFavicon()

  useEffect(
    () =>
      connectCompileStore({ projectId: id, session: null, role: 'detached' }),
    [id]
  )

  useEffect(() => {
    if (!project.data) return
    const previous = document.title
    document.title = `${project.data.name} - PDF - OpenLeaf`
    return () => {
      document.title = previous
    }
  }, [project.data])

  return (
    <div className="openleaf-detached-pdf" data-testid="detached-pdf-page">
      {project.data && <h1 className="visually-hidden">{project.data.name}</h1>}
      <DetachedOrphanBanner projectId={id} />
      <PdfPanel />
    </div>
  )
}
