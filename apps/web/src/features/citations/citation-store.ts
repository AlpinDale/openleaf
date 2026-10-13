import { create } from 'zustand'

export const useCitationStore = create<{ show: boolean }>(() => ({
  show: false,
}))

/** Opens Insert → Citation; the chosen key is inserted at the editor cursor. */
export function openCitationDialog(): void {
  useCitationStore.setState({ show: true })
}

export function closeCitationDialog(): void {
  useCitationStore.setState({ show: false })
}
