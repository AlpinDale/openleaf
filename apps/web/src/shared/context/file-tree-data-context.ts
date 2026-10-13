import { useFileTreeFolder } from '@/features/ide-react/openleaf-ide'

export function useFileTreeData() {
  return { fileTreeData: useFileTreeFolder() }
}
