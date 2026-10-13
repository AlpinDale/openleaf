import { create } from 'zustand'

export type EditorLayout = 'sideBySide' | 'editorOnly' | 'pdfOnly' | 'detached'
export type RailTab = 'files' | 'search' | 'symbols'
export type EditorMode = 'source' | 'visual'

type EditorStoreState = {
  openDocId: string | null
  /** Binary file shown in the editor panel instead of `openDocId`. */
  openFileId: string | null
  layout: EditorLayout
  railTab: RailTab | null
  reviewOpen: boolean
  historyOpen: boolean
  editorMode: EditorMode
}

type EditorStoreActions = {
  openDoc(id: string | null): void
  openFile(id: string | null): void
  setLayout(layout: EditorLayout): void
  /** Selecting the active tab collapses the rail. */
  setRailTab(tab: RailTab | null): void
  toggleReview(): void
  setHistoryOpen(open: boolean): void
  setEditorMode(mode: EditorMode): void
  /** Back to the initial state, for a newly opened project. */
  reset(): void
}

const initialState: EditorStoreState = {
  openDocId: null,
  openFileId: null,
  layout: 'sideBySide',
  railTab: 'files',
  reviewOpen: false,
  historyOpen: false,
  editorMode: 'source',
}

export const useEditorStore = create<EditorStoreState & EditorStoreActions>(
  set => ({
    ...initialState,
    openDoc: id => set({ openDocId: id, openFileId: null }),
    openFile: id => set({ openFileId: id }),
    setLayout: layout => set({ layout }),
    setRailTab: tab =>
      set(state => ({ railTab: state.railTab === tab ? null : tab })),
    toggleReview: () => set(state => ({ reviewOpen: !state.reviewOpen })),
    setHistoryOpen: open => set({ historyOpen: open }),
    setEditorMode: mode => set({ editorMode: mode }),
    reset: () => set(initialState),
  })
)
