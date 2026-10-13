// From Overleaf services/web/frontend/js/features/ide-react/hooks/use-command-provider.ts (AGPL-3.0)
import { type DependencyList, useEffect } from 'react'
import {
  type Command,
  useCommandRegistryStore,
} from '../context/command-registry-context'

export const useCommandProvider = (
  generateElements: () => Command[] | undefined,
  dependencies: DependencyList
) => {
  useEffect(() => {
    const elements = generateElements()
    if (!elements) return
    const { register, unregister } = useCommandRegistryStore.getState()
    register(...elements)
    return () => {
      unregister(...elements.map(element => element.id))
    }
    // biome-ignore lint/correctness/useExhaustiveDependencies: caller-supplied deps, as in Overleaf
  }, dependencies)
}
