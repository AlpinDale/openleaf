import { useQueryClient } from '@tanstack/react-query'
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from 'react'
import { createProjectSession, type ProjectSession } from './session'

const ProjectSessionContext = createContext<ProjectSession | null>(null)

/** Opens one realtime session for the project; children render once it exists. */
export function ProjectSessionProvider({
  projectId,
  children,
}: {
  projectId: string
  children: ReactNode
}) {
  const queryClient = useQueryClient()
  const [session, setSession] = useState<ProjectSession | null>(null)

  useEffect(() => {
    const created = createProjectSession(projectId, queryClient)
    setSession(created)
    return () => {
      setSession(null)
      created.destroy()
    }
  }, [projectId, queryClient])

  if (!session || session.projectId !== projectId) return null
  return (
    <ProjectSessionContext.Provider value={session}>
      {children}
    </ProjectSessionContext.Provider>
  )
}

export function useProjectSession(): ProjectSession {
  const session = useContext(ProjectSessionContext)
  if (!session) {
    throw new Error(
      'useProjectSession must be used inside ProjectSessionProvider'
    )
  }
  return session
}
