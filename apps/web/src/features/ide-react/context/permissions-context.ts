import { roleAtLeast, useIdeProject } from '@/features/ide-react/openleaf-ide'

export type Permissions = {
  read: boolean
  write: boolean
  comment: boolean
  trackedWrite: boolean
  admin: boolean
}

export function usePermissionsContext(): Permissions {
  const { role } = useIdeProject()
  return {
    read: true,
    write: roleAtLeast(role, 'editor'),
    comment: roleAtLeast(role, 'reviewer'),
    trackedWrite: roleAtLeast(role, 'reviewer'),
    admin: role === 'owner',
  }
}
