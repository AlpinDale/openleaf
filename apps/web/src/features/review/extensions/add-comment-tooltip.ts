import { type EditorState, StateField } from '@codemirror/state'
import { EditorView, showTooltip, type Tooltip } from '@codemirror/view'
import { t } from '@/i18n'

/** Event the panel listens to: opens a composer for the current selection. */
export const ADD_COMMENT_EVENT = 'add-new-review-comment'

function selectionTooltip(state: EditorState): Tooltip | null {
  const { main } = state.selection
  if (main.empty) return null
  return {
    pos: main.head,
    above: main.head < main.anchor,
    arrow: false,
    create() {
      const dom = document.createElement('div')
      dom.className = 'ol-add-comment-tooltip'
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'btn btn-sm btn-secondary ol-add-comment-button'
      const icon = document.createElement('span')
      icon.className = 'material-symbols'
      icon.setAttribute('aria-hidden', 'true')
      icon.textContent = 'add_comment'
      button.append(icon, ` ${t('add_comment')}`)
      button.addEventListener('mousedown', event => event.preventDefault())
      button.addEventListener('click', () =>
        window.dispatchEvent(new Event(ADD_COMMENT_EVENT))
      )
      dom.append(button)
      return { dom }
    },
  }
}

/** An "Add comment" button over any non-empty selection (plan M7 step 3). */
export const addCommentTooltip = [
  StateField.define<Tooltip | null>({
    create: selectionTooltip,
    update(value, tr) {
      if (!tr.docChanged && !tr.selection) return value
      return selectionTooltip(tr.state)
    },
    provide: field => showTooltip.from(field),
  }),
  EditorView.baseTheme({
    '.ol-add-comment-tooltip': { padding: '2px' },
  }),
]
