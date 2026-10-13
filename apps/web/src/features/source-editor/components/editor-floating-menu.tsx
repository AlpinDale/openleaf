// Adapted from Overleaf services/web/frontend/js/features/editor-floating-menu/editor-floating-menu.tsx (AGPL-3.0)
import { language } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import { type Command, getTooltip } from '@codemirror/view'
import classNames from 'classnames'
import { memo, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useEditorBridge } from '@/features/editor/editor-bridge'
import { indexTree } from '@/features/file-tree/util/tree-index'
import { usePermissionsContext } from '@/features/ide-react/context/permissions-context'
import { useIdeTree } from '@/features/ide-react/openleaf-ide'
import { ADD_COMMENT_EVENT } from '@/features/review/extensions/add-comment-tooltip'
import { useTranslation } from '@/i18n'
import MaterialIcon from '@/shared/components/material-icon'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import { useLayoutContext } from '@/shared/context/layout-context'
import { quickActionsTooltipField } from '../extensions/selection-quick-actions'
import {
  toggleBold,
  toggleItalic,
  wrapInHref,
  wrapInInlineMath,
} from '../extensions/toolbar/commands'
import {
  useCodeMirrorStateContext,
  useCodeMirrorViewContext,
} from './codemirror-context'

const TOOLTIP_SHOW_DELAY = 120

/**
 * The position on the visual bottom line of the selection, whatever the drag
 * direction; a multi-line selection ending at column 0 ends on the line before.
 */
function selectionBottomLinePos(state: EditorState) {
  const { from, to } = state.selection.main
  const lineAtTo = state.doc.lineAt(to)
  return lineAtTo.from === to && to > from ? to - 1 : to
}

/** Quick actions over a text selection (user setting `selectionQuickActions`). */
export function EditorFloatingMenu() {
  const state = useCodeMirrorStateContext()
  const view = useCodeMirrorViewContext()
  const { focusMode } = useLayoutContext()
  const [show, setShow] = useState(true)
  const tooltipState = state.field(quickActionsTooltipField, false) ?? null

  // a new selection shows the menu again
  const hasTooltip = tooltipState !== null
  useEffect(() => {
    if (hasTooltip) setShow(true)
  }, [hasTooltip])

  // a click outside the editor and the menu hides it
  useEffect(() => {
    if (!show || !hasTooltip) return
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Element | null
      if (
        !view.contentDOM.contains(target) &&
        !target?.closest?.('.review-tooltip-menu-container, .modal')
      )
        setShow(false)
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [show, hasTooltip, view])

  if (focusMode || !show || !tooltipState) return null
  const tooltipView = getTooltip(view, tooltipState)
  if (!tooltipView) return null
  return createPortal(<EditorFloatingMenuContent />, tooltipView.dom)
}

const EditorFloatingMenuContent = memo(function EditorFloatingMenuContent() {
  const { t } = useTranslation()
  const view = useCodeMirrorViewContext()
  const state = useCodeMirrorStateContext()
  const permissions = usePermissionsContext()
  const tree = useIdeTree()
  const docId = useEditorBridge(s => s.docId)
  const [visible, setVisible] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // pinned beside the selection's bottom line, left of the text, and kept
  // inside the editor viewport while scrolling
  useEffect(() => {
    const measure = () => {
      view.requestMeasure({
        key: 'editor-floating-menu-position',
        read(view) {
          const block = view.lineBlockAt(selectionBottomLinePos(view.state))
          const lineBottomY = view.documentTop + block.bottom
          const lineCenterY = lineBottomY - view.defaultLineHeight / 2
          const menuHeight =
            menuRef.current?.getBoundingClientRect().height ?? 0
          const scrollRect = view.scrollDOM.getBoundingClientRect()
          const contentRect = view.contentDOM.getBoundingClientRect()
          return {
            top: Math.min(
              Math.max(lineCenterY - menuHeight / 2, scrollRect.top),
              scrollRect.bottom - menuHeight
            ),
            right: window.innerWidth - contentRect.left,
          }
        },
        write(position) {
          const element = menuRef.current
          if (!element) return
          element.style.position = 'fixed'
          element.style.top = `${position.top}px`
          element.style.right = `${position.right}px`
        },
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    if (menuRef.current) observer.observe(menuRef.current)
    observer.observe(view.scrollDOM)
    view.scrollDOM.addEventListener('scroll', measure)
    return () => {
      observer.disconnect()
      view.scrollDOM.removeEventListener('scroll', measure)
    }
  }, [view])

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setVisible(true),
      TOOLTIP_SHOW_DELAY
    )
    return () => window.clearTimeout(timeout)
  }, [])

  const canFormat = !state.readOnly && state.facet(language)?.name === 'latex'
  const docName = docId ? indexTree(tree).byId.get(docId)?.name : undefined
  const isTex = !!docName && /\.tex$/i.test(docName)

  const run = (command: Command) => () => {
    command(view)
    view.focus()
  }

  return (
    <div
      ref={menuRef}
      className={classNames('editor-floating-menu', {
        'editor-floating-menu-visible': visible,
      })}
      data-testid="editor-floating-menu"
    >
      {canFormat && (
        <>
          <QuickAction
            id="bold"
            icon="format_bold"
            label={t('toolbar_bold')}
            onClick={run(toggleBold)}
          />
          <QuickAction
            id="italic"
            icon="format_italic"
            label={t('toolbar_italic')}
            onClick={run(toggleItalic)}
          />
          <QuickAction
            id="link"
            icon="add_link"
            label={t('toolbar_insert_link')}
            onClick={run(wrapInHref)}
          />
          {isTex && (
            <QuickAction
              id="math"
              icon="function"
              label={t('toolbar_insert_inline_math')}
              onClick={run(wrapInInlineMath)}
            />
          )}
          <div className="editor-floating-menu-divider" />
        </>
      )}
      {permissions.comment && (
        <QuickAction
          id="comment"
          icon="chat"
          label={t('add_comment')}
          className="ol-add-comment-button"
          onClick={() => window.dispatchEvent(new Event(ADD_COMMENT_EVENT))}
        />
      )}
    </div>
  )
})

function QuickAction({
  id,
  icon,
  label,
  className,
  onClick,
}: {
  id: string
  icon: string
  label: string
  className?: string
  onClick: () => void
}) {
  return (
    <OLTooltip
      id={`editor-floating-menu-${id}`}
      description={label}
      overlayProps={{ placement: 'right' }}
    >
      <button
        type="button"
        className={classNames('editor-floating-menu-button', className)}
        // keep the selection
        onMouseDown={event => event.preventDefault()}
        onClick={onClick}
        aria-label={label}
      >
        <MaterialIcon type={icon} />
      </button>
    </OLTooltip>
  )
}
