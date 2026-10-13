import { useIdeProject } from '@/features/ide-react/openleaf-ide'
import { useProjectSession } from '@/features/project/session-context'
import type { ProjectSnapshot } from '@/infrastructure/project-snapshot'
import { getProjectSnapshot } from '@/infrastructure/project-snapshot'

/** Overleaf project features. */
const features = {
  trackChanges: true,
  trackChangesVisible: true,
  references: true,
  symbolPalette: true,
}

export function useProjectContext(): {
  projectId: string
  project: {
    _id: string
    name: string
    rootDocId: string | null
    spellCheckLanguage: string
  }
  features: typeof features
  projectSnapshot: ProjectSnapshot
} {
  const session = useProjectSession()
  const project = useIdeProject()
  return {
    projectId: session.projectId,
    project: {
      _id: project.id,
      name: project.name,
      rootDocId: project.rootDocId,
      spellCheckLanguage: project.spellLanguage,
    },
    features,
    projectSnapshot: getProjectSnapshot(session),
  }
}
