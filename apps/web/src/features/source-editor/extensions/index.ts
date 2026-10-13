import {
  EditorView,
  rectangularSelection,
  tooltips,
  crosshairCursor,
  dropCursor,
  highlightActiveLineGutter,
} from '@codemirror/view'
import { EditorState, Extension, Prec } from '@codemirror/state'
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next'
import type * as Y from 'yjs'
import type { Awareness } from 'y-protocols/awareness'
import { keymap } from '@codemirror/view'
import { captureException } from '@/infrastructure/error-reporter'
import { foldGutter, indentOnInput, indentUnit } from '@codemirror/language'
import { language } from './language'
import { lineWrappingIndentation } from './line-wrapping-indentation'
import { theme } from './theme'
import { cursorPosition } from './cursor-position'
import { scrollPosition } from './scroll-position'
import { annotations } from './annotations'
import { autoComplete } from './auto-complete'
import { editable } from './editable'
import { autoPair } from './auto-pair'
import { phrases } from './phrases'
import { spelling } from './spelling'
import { symbolPalette } from './symbol-palette'
import { search } from './search'
import { filterCharacters } from './filter-characters'
import { keybindings } from './keybindings'
import { bracketMatching, bracketSelection } from './bracket-matching'
import { verticalOverflow } from './vertical-overflow'
import { lineNumbers } from './line-numbers'
import { highlightActiveLine } from './highlight-active-line'
import { emptyLineFiller } from './empty-line-filler'
import { goToLinePanel } from './go-to-line'
import { drawSelection } from './draw-selection'
import { nonBlinkingCursor } from './non-blinking-cursor'
import { sourceOnly, visual } from './visual/visual'
import { inlineBackground } from './inline-background'
import { indentationMarkers } from './indentation-markers'
import { keymaps } from './keymaps'
import { shortcuts } from './shortcuts'
import { effectListeners } from './effect-listeners'
import { highlightSpecialChars } from './highlight-special-chars'
import { toolbarPanel } from './toolbar/toolbar-panel'
import { breadcrumbPanel } from './breadcrumbs-panel'
import { geometryChangeEvent } from './geometry-change-event'
import { docName } from './doc-name'
import { filePreview } from './file-preview'
import { docFolder } from './doc-folder'
import { fileTreeItemDrop } from './file-tree-item-drop'
import { mathPreview } from './math-preview'
import { tooltipsReposition } from './tooltips-reposition'
import { contextMenu } from './context-menu'
import type { Role } from '@openleaf/shared'
import { selectionTooltip } from './selection-quick-actions'
import { tabsListener } from './tabs-listener'
import { commentHighlights } from '@/features/review/extensions/comment-highlights'
import {
  trackChangesCapture,
  trackedChangesDecorations,
} from '@/features/review/extensions/track-changes'

/**
 * A zero-height element in <body> for tooltips: CodeMirror gives the tooltip
 * container the editor theme classes, whose `height: 100%` would otherwise
 * make the page itself scrollable.
 */
let tooltipParentElement: HTMLElement | null = null
const tooltipParent = () => {
  if (!tooltipParentElement?.isConnected) {
    tooltipParentElement = document.createElement('div')
    tooltipParentElement.className = 'ol-cm-tooltip-parent'
    tooltipParentElement.style.height = '0'
    tooltipParentElement.style.overflow = 'visible'
    document.body.append(tooltipParentElement)
  }
  return tooltipParentElement
}

export type CreateExtensionsOptions = Record<string, any> & {
  docId: string
  ytext: Y.Text
  awareness: Awareness | null
  undoManager: Y.UndoManager
  ydoc: Y.Doc
  userId: string
  role: Role
}

export const createExtensions = (
  options: CreateExtensionsOptions
): Extension[] => [
  // Yjs owns the document content and the undo stack.
  yCollab(options.ytext, options.awareness, {
    undoManager: options.undoManager,
  }),
  Prec.high(keymap.of(yUndoManagerKeymap)),
  trackChangesCapture({
    ydoc: options.ydoc,
    ytext: options.ytext,
    docId: options.docId,
    userId: options.userId,
    role: options.role,
  }),
  lineNumbers(),
  highlightSpecialChars(options.showVisual),
  // The built-in extension that displays buttons for folding code in a gutter element,
  // configured with custom openText and closeText symbols.
  foldGutter({
    openText: '▾',
    closedText: '▸',
  }),
  drawSelection(),
  nonBlinkingCursor(),
  // A built-in facet that is set to true to allow multiple selections.
  // This makes the editor more like a code editor than Google Docs or Microsoft Word,
  // which only have single selections.
  EditorState.allowMultipleSelections.of(true),
  // A built-in extension that enables soft line wrapping.
  EditorView.lineWrapping,
  sourceOnly(
    options.showVisual,
    EditorView.contentAttributes.of({ 'aria-label': 'Source Editor editing' })
  ),
  // A built-in extension that re-indents input if the language defines an indentOnInput field in its language data.
  indentOnInput(),
  lineWrappingIndentation(options.showVisual),
  indentationMarkers(options.showVisual),
  bracketMatching(),
  bracketSelection(),
  // A built-in extension that enables rectangular selections, created by dragging a new selection while holding down Alt.
  rectangularSelection(),
  // A built-in extension that turns the pointer into a crosshair while Alt is pressed.
  crosshairCursor(),
  // A built-in extension that shows where dragged content will be dropped.
  dropCursor(),
  // A built-in extension that is used for configuring tooltip behaviour,
  // configured so that the tooltip parent is the document body,
  // to avoid cutting off tooltips which overflow the editor.
  tooltips({
    parent: tooltipParent(),
    tooltipSpace(view) {
      const { top, bottom } = view.scrollDOM.getBoundingClientRect()

      return {
        top,
        left: 0,
        bottom,
        right: window.innerWidth,
      }
    },
  }),
  keymaps,
  goToLinePanel(),
  filterCharacters(),

  // NOTE: `autoComplete` needs to be before `keybindings` so that arrow key handling
  // in the autocomplete pop-up takes precedence over Vim/Emacs key bindings
  autoComplete({
    enabled: options.settings.autoComplete,
    projectFeatures: options.projectFeatures,
    referencesSearchMode: options.settings.referencesSearchMode,
  }),

  // NOTE: `keybindings` needs to be before `language` so that Vim/Emacs bindings take
  // precedence over language-specific keyboard shortcuts
  keybindings(),

  docName(options.docName),
  filePreview(options.previewByPath),
  docFolder(options.currentDocFolder),

  // NOTE: `annotations` needs to be before `language`
  annotations(),
  language(options.docName, options.metadata, options.settings),
  indentUnit.of('    '), // 4 spaces
  theme(options.theme),
  cursorPosition(options.docId),
  scrollPosition(options.docId, options.showVisual),
  autoPair(options.settings),
  editable(),
  search(options.initialSearchQuery),
  phrases(options.phrases),
  spelling(options.spelling),
  shortcuts,
  symbolPalette(),
  // NOTE: `emptyLineFiller` needs to be before `trackChanges`,
  // so the decorations are added in the correct order.
  emptyLineFiller(),
  trackedChangesDecorations,
  commentHighlights(options.ydoc, options.docId),
  selectionTooltip(
    options.settings.selectionQuickActions,
    options.role !== 'viewer'
  ),
  visual(options.docName, options.showVisual),
  mathPreview(options.settings.mathPreview),
  contextMenu(),
  toolbarPanel(),
  breadcrumbPanel(),
  verticalOverflow(),
  highlightActiveLine(options.showVisual),
  // The built-in extension that highlights the active line in the gutter.
  highlightActiveLineGutter(),
  inlineBackground(options.showVisual),
  EditorView.exceptionSink.of(exception => captureException(exception)),
  effectListeners(),
  geometryChangeEvent(),
  fileTreeItemDrop(),
  tooltipsReposition(),
  tabsListener(),
]
