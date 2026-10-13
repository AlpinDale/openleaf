import {
  fileExtension,
  type ProjectDetails,
  type ProjectTree,
  roleAtLeast,
  type TreeEntry,
} from '@openleaf/shared'
import {
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { type NodeApi, Tree, type TreeApi } from 'react-arborist'
import { errorMessage } from '@/api/client'
import { patchProject } from '@/api/projects'
import {
  createEntry,
  deleteEntry,
  fileUrl,
  moveEntry,
  renameEntry,
} from '@/api/tree'
import { ConfirmModal } from '@/features/common/confirm-modal'
import { useEditorStore } from '@/features/editor/editor-store'
import { showToast } from '@/features/toasts'
import { useTranslation } from '@/i18n'
import {
  OLDropdownDivider,
  OLDropdownItem,
} from '@/shared/components/ol/ol-dropdown-menu'
import { useFileTreeActions } from '../file-tree-actions'
import { indexTree, isWithin } from '../util/tree-index'
import {
  buildTreeNodes,
  DRAFT_ID,
  type DraftEntry,
  type FileTreeNode,
} from '../util/tree-nodes'
import { FileTreeContextMenu, type MenuCoords } from './file-tree-context-menu'
import {
  FileTreeNodeView,
  FileTreeRow,
  FileTreeRowContext,
  type FileTreeRowContextValue,
} from './file-tree-node'
import { FileTreeToolbar } from './file-tree-toolbar'
import { ImportProjectModal } from './modals/import-project-modal'
import { ImportUrlModal } from './modals/import-url-modal'
import { UploadModal } from './modals/upload-modal'

type Dialog =
  | { kind: 'upload'; parentId: string; files?: File[] }
  | { kind: 'import-url'; parentId: string }
  | { kind: 'import-project'; parentId: string }
  | { kind: 'delete'; ids: string[] }

const ROW_HEIGHT = 28

function useElementSize() {
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      setSize({
        width: Math.floor(entry.contentRect.width),
        height: Math.floor(entry.contentRect.height),
      })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])
  return { ref: setElement, ...size }
}

export function FileTreePanel({
  project,
  tree,
}: {
  project: ProjectDetails
  tree: ProjectTree
}) {
  const { t } = useTranslation()
  const projectId = project.id
  const readOnly = !roleAtLeast(project.role, 'editor')
  const index = indexTree(tree)
  const openDocId = useEditorStore(s => s.openDocId)
  const openFileId = useEditorStore(s => s.openFileId)
  const openDoc = useEditorStore(s => s.openDoc)
  const openFile = useEditorStore(s => s.openFile)

  const treeApi = useRef<TreeApi<FileTreeNode> | null>(null)
  const [draft, setDraft] = useState<DraftEntry | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [menu, setMenu] = useState<MenuCoords | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [nativeDropFolderId, setNativeDropFolderId] = useState<string | null>(
    null
  )
  const size = useElementSize()

  const nodes = useMemo(() => buildTreeNodes(index, draft), [index, draft])

  // Reveal and select the open doc/file. A just-created entry may not have a
  // row yet, so keep trying until the tree data contains it.
  const activeId = openFileId ?? openDocId
  const pendingSelection = useRef<string | null>(null)
  useEffect(() => {
    pendingSelection.current = activeId
  }, [activeId])
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-check whenever the rows or tree size change
  useEffect(() => {
    const api = treeApi.current
    const id = pendingSelection.current
    if (!api || !id || !index.byId.has(id)) return
    api.openParents(id)
    // Rows inside just-opened folders exist after the next render.
    const frame = requestAnimationFrame(() => {
      pendingSelection.current = null
      api.select(id, { focus: false })
    })
    return () => cancelAnimationFrame(frame)
  }, [activeId, nodes, size.height])

  const selectedEntries = selectedIds.flatMap(id => {
    const entry = index.byId.get(id)
    return entry ? [entry] : []
  })

  /** Folder that new entries go into: the selected folder, or the selected file's folder. */
  const targetFolderId = () => {
    if (selectedEntries.length !== 1) return index.rootFolderId
    const [entry] = selectedEntries
    return entry.kind === 'folder'
      ? entry.id
      : (entry.parentId ?? index.rootFolderId)
  }

  const startCreate = (kind: 'doc' | 'folder') => {
    setMenu(null)
    setDraft({
      parentId: targetFolderId(),
      kind,
      name: kind === 'doc' ? 'name.tex' : '',
    })
  }

  // Put the draft row into rename mode once it's rendered.
  const draftKey = draft ? `${draft.parentId}:${draft.kind}` : null
  // biome-ignore lint/correctness/useExhaustiveDependencies: retain the draft's original name while editing; cancel if its project or permissions change
  useEffect(() => {
    if (!draftKey || !draft || readOnly) return
    const api = treeApi.current
    if (!api) return
    if (draft.parentId !== index.rootFolderId) api.open(draft.parentId)
    let cancelled = false
    const timer = window.setTimeout(() => {
      api
        .edit(DRAFT_ID)
        .then(async result => {
          if (cancelled) return
          if (result.cancelled) {
            setDraft(null)
            return
          }
          setDraft(current => current && { ...current, name: result.value })
          try {
            const entry = await createEntry(
              projectId,
              draft.parentId,
              result.value,
              draft.kind
            )
            if (!cancelled && entry.kind === 'doc') openDoc(entry.id)
          } catch (err) {
            showToast({ type: 'error', content: errorMessage(err) })
          } finally {
            if (!cancelled) setDraft(null)
          }
        })
        .catch(err => {
          if (!cancelled) {
            setDraft(null)
            showToast({ type: 'error', content: errorMessage(err) })
          }
        })
    })
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [draftKey, projectId, readOnly])

  // Run New file / New folder / Upload requested from the top-bar File menu,
  // once the tree has been laid out (its rows must exist for inline create).
  const actionRequest = useFileTreeActions(s => s.request)
  const treeReady = size.height > 0
  // biome-ignore lint/correctness/useExhaustiveDependencies: run once per request, with the current selection
  useEffect(() => {
    if (!actionRequest || !treeReady) return
    useFileTreeActions.setState({ request: null })
    if (readOnly) return
    if (actionRequest === 'upload') {
      setDialog({ kind: 'upload', parentId: targetFolderId() })
    } else {
      startCreate(actionRequest === 'new-file' ? 'doc' : 'folder')
    }
  }, [actionRequest, treeReady])

  const onRename = async ({ id, name }: { id: string; name: string }) => {
    if (id === DRAFT_ID) return // created by the draft's edit promise
    try {
      await renameEntry(projectId, id, name)
    } catch (err) {
      showToast({ type: 'error', content: errorMessage(err) })
    }
  }

  const onMove = async ({
    dragIds,
    parentId,
  }: {
    dragIds: string[]
    parentId: string | null
  }) => {
    const target = parentId ?? index.rootFolderId
    const moving = dragIds.filter(
      id => id !== DRAFT_ID && index.byId.get(id)?.parentId !== target
    )
    const results = await Promise.allSettled(
      moving.map(id => moveEntry(projectId, id, target))
    )
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        const name = index.byId.get(moving[i])?.name ?? ''
        showToast({
          type: 'error',
          content: `${name}: ${errorMessage(result.reason)}`,
        })
      }
    })
  }

  const openEntry = (entry: TreeEntry) => {
    if (entry.kind === 'doc') openDoc(entry.id)
    else if (entry.kind === 'file') openFile(entry.id)
  }

  const onActivate = (node: NodeApi<FileTreeNode>) => {
    const { entry } = node.data
    if (!entry) return
    if (entry.kind === 'folder') node.toggle()
    else openEntry(entry)
  }

  const deleteSelected = () => {
    setMenu(null)
    if (readOnly || selectedEntries.length === 0) return
    setDialog({ kind: 'delete', ids: selectedEntries.map(e => e.id) })
  }

  const confirmDelete = async (ids: string[]) => {
    // Deleting a folder removes its contents; skip selected descendants.
    const roots = ids.filter(
      id => !ids.some(other => other !== id && isWithin(index, id, other))
    )
    const results = await Promise.allSettled(
      roots.map(id => deleteEntry(projectId, id))
    )
    const failures = results.flatMap((result, i) =>
      result.status === 'rejected'
        ? [`${index.byId.get(roots[i])?.name}: ${errorMessage(result.reason)}`]
        : []
    )
    if (failures.length) throw new Error(failures.join('\n'))
  }

  const renameSelected = () => {
    setMenu(null)
    if (readOnly || selectedEntries.length !== 1) return
    treeApi.current?.edit(selectedEntries[0].id)
  }

  const setMainDocument = async (docId: string) => {
    setMenu(null)
    try {
      await patchProject(projectId, { rootDocId: docId })
    } catch (err) {
      showToast({ type: 'error', content: errorMessage(err) })
    }
  }

  const onContextMenu = useCallback(
    (event: MouseEvent, node: NodeApi<FileTreeNode>) => {
      if (event.shiftKey || node.id === DRAFT_ID) return
      event.preventDefault()
      event.stopPropagation()
      if (!node.isSelected) node.select()
      setMenu({ top: event.clientY, left: event.clientX })
    },
    []
  )

  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.target as Element).closest('input, textarea')) return
    if (event.key === 'F2') {
      event.preventDefault()
      renameSelected()
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      deleteSelected()
    }
  }

  // OS files dragged over the tree upload into the folder under the pointer.
  const nativeTargetFolder = (event: DragEvent) => {
    const row = (event.target as Element).closest<HTMLElement>(
      '[data-entry-id]'
    )
    const entry = row?.dataset.entryId
      ? index.byId.get(row.dataset.entryId)
      : undefined
    if (!entry) return index.rootFolderId
    return entry.kind === 'folder'
      ? entry.id
      : (entry.parentId ?? index.rootFolderId)
  }
  const isFileDrag = (event: DragEvent) =>
    !readOnly && event.dataTransfer.types.includes('Files')

  const rowContext = useMemo<FileTreeRowContextValue>(
    () => ({
      rootDocId: project.rootDocId,
      readOnly,
      nativeDropFolderId,
      onContextMenu,
    }),
    [project.rootDocId, readOnly, nativeDropFolderId, onContextMenu]
  )

  const single = selectedEntries.length === 1 ? selectedEntries[0] : null
  const deleteIds = dialog?.kind === 'delete' ? dialog.ids : []

  return (
    <div className="openleaf-file-tree-panel">
      <FileTreeToolbar
        readOnly={readOnly}
        onNewFile={() => startCreate('doc')}
        onNewFolder={() => startCreate('folder')}
        onUpload={() =>
          setDialog({ kind: 'upload', parentId: targetFolderId() })
        }
        onImportUrl={() =>
          setDialog({ kind: 'import-url', parentId: targetFolderId() })
        }
        onImportProject={() =>
          setDialog({ kind: 'import-project', parentId: targetFolderId() })
        }
      />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the tree inside is the interactive widget; this wrapper adds shortcuts and OS file drops */}
      <div
        ref={size.ref}
        className="openleaf-file-tree"
        data-testid="file-tree"
        onKeyDown={onKeyDown}
        onContextMenu={event => {
          if (readOnly || event.shiftKey) return
          event.preventDefault()
          treeApi.current?.deselectAll()
          setMenu({ top: event.clientY, left: event.clientX })
        }}
        onDragOver={event => {
          if (!isFileDrag(event)) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
          setNativeDropFolderId(nativeTargetFolder(event))
        }}
        onDragLeave={event => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) {
            setNativeDropFolderId(null)
          }
        }}
        onDrop={event => {
          if (!isFileDrag(event)) return
          event.preventDefault()
          setNativeDropFolderId(null)
          const files = [...event.dataTransfer.files]
          if (files.length) {
            setDialog({
              kind: 'upload',
              parentId: nativeTargetFolder(event),
              files,
            })
          }
        }}
      >
        <FileTreeRowContext.Provider value={rowContext}>
          {size.height > 0 && (
            <Tree<FileTreeNode>
              ref={treeApi}
              data={nodes}
              width={size.width}
              height={size.height}
              rowHeight={ROW_HEIGHT}
              indent={16}
              openByDefault={false}
              aria-label={t('file_tree')}
              disableEdit={readOnly}
              disableDrag={node => readOnly || node.id === DRAFT_ID}
              disableDrop={readOnly}
              onRename={onRename}
              onMove={onMove}
              onActivate={onActivate}
              onSelect={nodes => setSelectedIds(nodes.map(n => n.id))}
              renderRow={FileTreeRow}
            >
              {FileTreeNodeView}
            </Tree>
          )}
        </FileTreeRowContext.Provider>
      </div>

      {menu && (
        <FileTreeContextMenu coords={menu} onClose={() => setMenu(null)}>
          {!readOnly && single && (
            <OLDropdownItem as="button" onClick={renameSelected}>
              {t('rename')}
            </OLDropdownItem>
          )}
          {single && single.kind !== 'folder' && (
            <OLDropdownItem
              href={fileUrl(projectId, single.id)}
              download={single.name}
              onClick={() => setMenu(null)}
            >
              {t('download')}
            </OLDropdownItem>
          )}
          {!readOnly &&
            single?.kind === 'doc' &&
            fileExtension(single.name) === 'tex' &&
            single.id !== project.rootDocId && (
              <OLDropdownItem
                as="button"
                onClick={() => setMainDocument(single.id)}
              >
                {t('set_as_main_document')}
              </OLDropdownItem>
            )}
          {!readOnly && selectedEntries.length > 0 && (
            <>
              <OLDropdownDivider />
              <OLDropdownItem as="button" onClick={deleteSelected}>
                {t('delete')}
              </OLDropdownItem>
            </>
          )}
          {!readOnly &&
            (single?.kind === 'folder' || selectedEntries.length === 0) && (
              <>
                {selectedEntries.length > 0 && <OLDropdownDivider />}
                <OLDropdownItem as="button" onClick={() => startCreate('doc')}>
                  {t('new_file')}
                </OLDropdownItem>
                <OLDropdownItem
                  as="button"
                  onClick={() => startCreate('folder')}
                >
                  {t('new_folder')}
                </OLDropdownItem>
                <OLDropdownItem
                  as="button"
                  onClick={() => {
                    setMenu(null)
                    setDialog({ kind: 'upload', parentId: targetFolderId() })
                  }}
                >
                  {t('upload')}
                </OLDropdownItem>
                <OLDropdownItem
                  as="button"
                  onClick={() => {
                    setMenu(null)
                    setDialog({
                      kind: 'import-url',
                      parentId: targetFolderId(),
                    })
                  }}
                >
                  {t('from_external_url')}
                </OLDropdownItem>
                <OLDropdownItem
                  as="button"
                  onClick={() => {
                    setMenu(null)
                    setDialog({
                      kind: 'import-project',
                      parentId: targetFolderId(),
                    })
                  }}
                >
                  {t('from_another_project')}
                </OLDropdownItem>
              </>
            )}
        </FileTreeContextMenu>
      )}

      <UploadModal
        show={dialog?.kind === 'upload'}
        projectId={projectId}
        parentId={
          dialog?.kind === 'upload' ? dialog.parentId : index.rootFolderId
        }
        folderPath={
          dialog?.kind === 'upload'
            ? (index.paths.get(dialog.parentId) ?? '')
            : ''
        }
        maxUploadBytes={project.limits.maxUploadBytes}
        initialFiles={dialog?.kind === 'upload' ? dialog.files : undefined}
        onHide={() => setDialog(null)}
      />
      <ImportUrlModal
        show={dialog?.kind === 'import-url'}
        projectId={projectId}
        parentId={
          dialog?.kind === 'import-url' ? dialog.parentId : index.rootFolderId
        }
        onHide={() => setDialog(null)}
        onImported={openEntry}
      />
      <ImportProjectModal
        show={dialog?.kind === 'import-project'}
        projectId={projectId}
        parentId={
          dialog?.kind === 'import-project'
            ? dialog.parentId
            : index.rootFolderId
        }
        onHide={() => setDialog(null)}
        onImported={openEntry}
      />
      <ConfirmModal
        show={dialog?.kind === 'delete'}
        title={t('delete')}
        confirmLabel={t('delete')}
        danger
        testId="delete-entries-modal"
        onHide={() => setDialog(null)}
        onConfirm={() => confirmDelete(deleteIds)}
      >
        <p>{t('sure_you_want_to_delete')}</p>
        <ul>
          {deleteIds.map(id => (
            <li key={id} translate="no">
              {index.paths.get(id) ?? index.byId.get(id)?.name}
            </li>
          ))}
        </ul>
      </ConfirmModal>
    </div>
  )
}
