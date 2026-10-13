import { create } from 'zustand'

/** Whether the command palette is open (⌘P / Ctrl+P, View menu). */
export const useCommandPaletteStore = create<{ open: boolean }>(() => ({
  open: false,
}))

export function setCommandPaletteOpen(open: boolean) {
  useCommandPaletteStore.setState({ open })
}
