import { validateEntryName } from '@openleaf/shared'
import classNames from 'classnames'
import {
  createContext,
  type MouseEvent,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import type {
  NodeApi,
  NodeRendererProps,
  RowRendererProps,
} from 'react-arborist'
import { showToast } from '@/features/toasts'
import { useTranslation } from '@/i18n'
import MaterialIcon from '@/shared/components/material-icon'
import type { FileTreeNode } from '../util/tree-nodes'
import FileTreeIcon from './file-tree-icon'

export type FileTreeRowContextValue = {
  rootDocId: string | null
  readOnly: boolean
  /** Folder currently targeted by an OS file drag. */
  nativeDropFolderId: string | null
  onContextMenu: (event: MouseEvent, node: NodeApi<FileTreeNode>) => void
}

export const FileTreeRowContext = createContext<FileTreeRowContextValue>({
  rootDocId: null,
  readOnly: true,
  nativeDropFolderId: null,
  onContextMenu: () => {},
})

export function FileTreeRow({
  node,
  attrs,
  innerRef,
  children,
}: RowRendererProps<FileTreeNode>) {
  const { onContextMenu, nativeDropFolderId } = useContext(FileTreeRowContext)
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: react-arborist's tree container handles keyboard navigation and selection
    <div
      {...attrs}
      role="treeitem"
      tabIndex={-1}
      ref={innerRef}
      aria-label={node.data.name}
      data-entry-id={node.id}
      data-entry-kind={node.data.kind}
      className={classNames('openleaf-file-tree-row', {
        selected: node.isSelected,
        'drop-target': node.willReceiveDrop || nativeDropFolderId === node.id,
        dragging: node.isDragging,
      })}
      onFocus={e => e.stopPropagation()}
      onClick={node.handleClick}
      onContextMenu={e => onContextMenu(e, node)}
    >
      {children}
    </div>
  )
}

export function FileTreeNodeView({
  node,
  style,
  dragHandle,
}: NodeRendererProps<FileTreeNode>) {
  const { t } = useTranslation()
  const { rootDocId, readOnly } = useContext(FileTreeRowContext)
  const { kind, entry, name } = node.data
  const isFolder = kind === 'folder'

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: double-click rename is a mouse shortcut for F2/Enter
    <div
      ref={dragHandle}
      style={style}
      className="openleaf-file-tree-node"
      onDoubleClick={() => {
        if (!readOnly && entry && !isFolder) node.edit()
      }}
    >
      {isFolder ? (
        <button
          type="button"
          className="openleaf-file-tree-toggle"
          tabIndex={-1}
          aria-label={node.isOpen ? t('collapse') : t('expand')}
          onClick={e => {
            e.stopPropagation()
            node.toggle()
          }}
        >
          <MaterialIcon
            type={node.isOpen ? 'expand_more' : 'chevron_right'}
            className="file-tree-expand-icon"
          />
        </button>
      ) : (
        <span className="openleaf-file-tree-toggle" aria-hidden="true" />
      )}
      <span className="openleaf-file-tree-icon">
        {isFolder ? (
          <MaterialIcon type={node.isOpen ? 'folder_open' : 'folder'} />
        ) : (
          <FileTreeIcon name={name} isLinkedFile={!!entry?.sourceUrl} />
        )}
      </span>
      {node.isEditing ? (
        <EntryNameInput node={node} />
      ) : (
        <span
          className={classNames('openleaf-file-tree-name', {
            'openleaf-file-tree-main-doc':
              entry !== null && entry.id === rootDocId,
          })}
          translate="no"
        >
          {name}
        </span>
      )}
    </div>
  )
}

function EntryNameInput({ node }: { node: NodeApi<FileTreeNode> }) {
  const { t } = useTranslation()
  const [value, setValue] = useState(node.data.name)
  const input = useRef<HTMLInputElement>(null)
  const done = useRef(false)

  useEffect(() => {
    const el = input.current
    if (!el) return
    el.focus()
    // Select the base name so typing keeps the extension.
    const dot = el.value.lastIndexOf('.')
    el.setSelectionRange(
      0,
      node.data.kind !== 'folder' && dot > 0 ? dot : el.value.length
    )
  }, [node.data.kind])

  const finish = (commit: boolean) => {
    if (done.current) return
    done.current = true
    const name = value.trim()
    if (!commit || !name || (node.data.entry && name === node.data.name)) {
      node.reset()
      return
    }
    const problem = validateEntryName(name)
    if (problem) {
      showToast({ type: 'error', content: problem })
      node.reset()
      return
    }
    node.submit(name)
  }

  return (
    <input
      ref={input}
      className="form-control form-control-sm openleaf-file-tree-input"
      aria-label={t('name')}
      data-testid="file-tree-name-input"
      value={value}
      onChange={e => setValue(e.target.value)}
      onClick={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.preventDefault()
          finish(true)
        } else if (e.key === 'Escape') {
          e.preventDefault()
          finish(false)
        }
      }}
      onBlur={() => finish(true)}
    />
  )
}
