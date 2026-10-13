import { useContext } from 'react'
import { NestableDropdownContext } from '@/shared/context/nestable-dropdown-context'

export const useNestableDropdown = () => {
  const context = useContext(NestableDropdownContext)
  if (context === undefined) {
    throw new Error(
      'useNestableDropdown must be used within a NestableDropdownContextProvider'
    )
  }
  return context
}
