import { create } from 'zustand'

const STORAGE_KEY = 'openleaf:focus-mode'

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

/**
 * Focus mode hides the rail and the top-bar chrome, leaving the editor and
 * (per layout) the PDF. Persisted like Overleaf's `ui.focus-mode`.
 */
export const useFocusModeStore = create<{ focusMode: boolean }>(() => ({
  focusMode: readStored(),
}))

export function setFocusMode(focusMode: boolean) {
  useFocusModeStore.setState({ focusMode })
  try {
    localStorage.setItem(STORAGE_KEY, String(focusMode))
  } catch {
    // storage unavailable: keep the in-memory state
  }
}

export function toggleFocusMode() {
  setFocusMode(!useFocusModeStore.getState().focusMode)
}
