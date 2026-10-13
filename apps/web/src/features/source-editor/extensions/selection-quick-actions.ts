// Adapted from Overleaf services/web/frontend/js/features/source-editor/extensions/review-tooltip.ts (AGPL-3.0)
import {
  Compartment,
  type EditorState,
  type Extension,
  StateEffect,
  StateField,
  Transaction,
  type TransactionSpec,
} from '@codemirror/state'
import {
  EditorView,
  showTooltip,
  type Tooltip,
  type TooltipView,
} from '@codemirror/view'
import { addCommentTooltip } from '@/features/review/extensions/add-comment-tooltip'
import { isContextMenuMouseEvent } from '../utils/context-menu-mouse-event'

const mouseDownEffect = StateEffect.define()
const mouseUpEffect = StateEffect.define()
const mouseDownStateField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(mouseDownEffect)) return true
      if (effect.is(mouseUpEffect)) return false
    }
    return value
  },
})

/**
 * The (empty) tooltip over a non-empty selection that the React floating
 * menu (`EditorFloatingMenu`) renders its quick actions into. While the mouse
 * is still down the tooltip exists but stays hidden.
 */
export const quickActionsTooltipField = StateField.define<Tooltip | null>({
  create: () => null,
  update(tooltip, tr) {
    if (tr.state.selection.main.empty) return null
    const userEvent = tr.annotation(Transaction.userEvent)
    if (
      !tr.effects.some(effect => effect.is(mouseUpEffect)) &&
      userEvent !== 'select' &&
      userEvent !== 'select.pointer'
    ) {
      // another selection change hides it; other updates keep it
      return tr.selection ? null : tooltip
    }
    return buildTooltip(tr.state, tr.state.field(mouseDownStateField))
  },
  provide: field => showTooltip.from(field),
})

function buildTooltip(state: EditorState, hidden: boolean): Tooltip {
  const { main } = state.selection
  const lineAtFrom = state.doc.lineAt(main.from)
  const lineAtTo = state.doc.lineAt(main.to)
  const column = main.head - lineAtTo.from
  // a multi-line selection ending at the start of a line anchors to the line before
  const pos =
    lineAtFrom.number !== lineAtTo.number && column === 0
      ? main.head - 1
      : main.head
  return {
    pos,
    above: main.head !== main.to,
    create: (): TooltipView => {
      const dom = document.createElement('div')
      dom.className = 'review-tooltip-menu-container'
      dom.style.display = hidden ? 'none' : 'block'
      return { dom, overlap: true, offset: { x: 0, y: 8 } }
    },
  }
}

const quickActionsTheme = EditorView.baseTheme({
  '.review-tooltip-menu-container.cm-tooltip': {
    backgroundColor: 'transparent',
    border: 'none',
    zIndex: 0,
  },
})

const quickActions = (): Extension => {
  let mouseUpListener: (() => void) | null = null
  const removeMouseUpListener = () => {
    if (mouseUpListener)
      document.removeEventListener('mouseup', mouseUpListener)
  }
  return [
    quickActionsTheme,
    mouseDownStateField,
    quickActionsTooltipField,
    EditorView.domEventHandlers({
      mousedown: (event, view) => {
        // the context menu replaces the tooltip
        if (isContextMenuMouseEvent(event)) return false
        removeMouseUpListener()
        mouseUpListener = () => {
          removeMouseUpListener()
          view.dispatch({ effects: mouseUpEffect.of(null) })
        }
        view.dispatch({ effects: mouseDownEffect.of(null) })
        document.addEventListener('mouseup', mouseUpListener)
      },
    }),
  ]
}

const selectionTooltipConf = new Compartment()

/**
 * What appears over a selection: the quick actions menu (user setting
 * `selectionQuickActions`), else the single "Add comment" button for those
 * who may comment.
 */
const selectionTooltipExtension = (enabled: boolean, canComment: boolean) =>
  enabled ? quickActions() : canComment ? addCommentTooltip : []

export const selectionTooltip = (enabled: boolean, canComment: boolean) =>
  selectionTooltipConf.of(selectionTooltipExtension(enabled, canComment))

export const setSelectionTooltip = (
  enabled: boolean,
  canComment: boolean
): TransactionSpec => ({
  effects: selectionTooltipConf.reconfigure(
    selectionTooltipExtension(enabled, canComment)
  ),
})
