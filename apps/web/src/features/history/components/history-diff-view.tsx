import {
  defaultHighlightStyle,
  LanguageSupport,
  syntaxHighlighting,
} from '@codemirror/language'
import { unifiedMergeView } from '@codemirror/merge'
import { EditorState } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { useEffect, useRef } from 'react'
import { LaTeXLanguage } from '@/features/source-editor/languages/latex/latex-language'

const LATEX_EXTENSION = /\.(tex|latex|ltx|sty|cls|clo|dtx|ins|bbx|cbx)$/i

/** Read-only unified diff of `original` → `modified`. */
export function HistoryDiffView({
  path,
  original,
  modified,
}: {
  path: string
  original: string
  modified: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const view = new EditorView({
      parent: containerRef.current!,
      state: EditorState.create({
        doc: modified,
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.lineWrapping,
          lineNumbers(),
          LATEX_EXTENSION.test(path) ? new LanguageSupport(LaTeXLanguage) : [],
          syntaxHighlighting(defaultHighlightStyle),
          unifiedMergeView({
            original,
            mergeControls: false,
            highlightChanges: true,
          }),
        ],
      }),
    })
    return () => view.destroy()
  }, [path, original, modified])

  return (
    <div
      className="cm-viewer-container openleaf-history-diff"
      ref={containerRef}
      data-testid="history-diff"
    />
  )
}
