import { useEditorBridge } from '@/features/editor/editor-bridge'
import {
  docPath,
  syncCursorToPdf,
  syncToCode,
  useCompileStore,
} from '../compile-store'

/** Overleaf's `useSynctex`, backed by the compile store. */
export default function useSynctex() {
  const syncInFlight = useCompileStore(s => s.syncInFlight)
  const pdfUrl = useCompileStore(s => s.pdfUrl)
  const docId = useEditorBridge(s => s.docId)
  const path = docId ? docPath(docId) : null
  const canSyncToPdf = Boolean(
    pdfUrl && path && /\.(tex|ltx|rtex|rnw)$/i.test(path)
  )

  return {
    syncToPdf: syncCursorToPdf,
    syncToCode,
    syncToPdfInFlight: syncInFlight,
    syncToCodeInFlight: syncInFlight,
    canSyncToPdf,
  }
}
