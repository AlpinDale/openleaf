import { create } from 'zustand'

export const SETTINGS_TABS = [
  'editor',
  'spelling_and_language',
  'compiler',
  'references',
  'appearance',
] as const

export type SettingsTab = (typeof SETTINGS_TABS)[number]

type SettingsModalState = {
  show: boolean
  activeTab: SettingsTab
  /** The custom dictionary editor, opened from Spelling → Dictionary. */
  dictionaryShown: boolean
}

export const useSettingsModalStore = create<SettingsModalState>(() => ({
  show: false,
  activeTab: 'editor',
  dictionaryShown: false,
}))

/** Opens the settings modal, on `tab` when given, else on the last tab shown. */
export function openSettingsModal(tab?: SettingsTab) {
  useSettingsModalStore.setState(state => ({
    show: true,
    activeTab: tab ?? state.activeTab,
  }))
}

export function closeSettingsModal() {
  useSettingsModalStore.setState({ show: false })
}

export function setSettingsTab(tab: SettingsTab) {
  useSettingsModalStore.setState({ activeTab: tab })
}

/** Swaps the settings window for the dictionary editor. */
export function openDictionaryModal() {
  useSettingsModalStore.setState({ show: false, dictionaryShown: true })
}

/** Closes the dictionary editor and returns to Settings → Spelling. */
export function closeDictionaryModal() {
  useSettingsModalStore.setState({
    dictionaryShown: false,
    show: true,
    activeTab: 'spelling_and_language',
  })
}
