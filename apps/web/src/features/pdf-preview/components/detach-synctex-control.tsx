import { useEditorStore } from '@/features/editor/editor-store'
import { GoToPdfButton } from './synctex-controls'

/** "Show in PDF" in the editor toolbar while the PDF is in a separate tab. */
export function DetacherSynctexControl() {
  const detached = useEditorStore(s => s.layout === 'detached')
  return detached ? <GoToPdfButton detached /> : null
}
