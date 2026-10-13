import {
  type ProjectDetails,
  type ProjectTree,
  roleAtLeast,
} from '@openleaf/shared'
import classNames from 'classnames'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import type * as Y from 'yjs'
import { errorMessage } from '@/api/client'
import { patchProject } from '@/api/projects'
import { createEntry } from '@/api/tree'
import { getEditorView } from '@/features/editor/editor-bridge'
import { indexTree } from '@/features/file-tree/util/tree-index'
import {
  type BibEntry,
  extractBibEntries,
} from '@/features/metadata/bib-entries'
import type { ProjectSession } from '@/features/project/session'
import { useProjectSession } from '@/features/project/session-context'
import { useTranslation } from '@/i18n'
import Notification from '@/shared/components/notification'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import { closeCitationDialog, useCitationStore } from './citation-store'

const NEW_BIB_NAME = 'references.bib'
const MAX_RESULTS = 200

type BibDoc = { id: string; path: string }
type FoundEntry = BibEntry & { path: string }

/** Inserts `\cite{keys}` at the editor selection and focuses the editor. */
function insertCite(keys: string[]) {
  const view = getEditorView()
  if (!view || keys.length === 0) return
  const text = `\\cite{${keys.join(',')}}`
  const { from, to } = view.state.selection.main
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
    scrollIntoView: true,
    userEvent: 'input',
  })
  view.focus()
}

/** Resolves with the doc's Y.Text once it has synced into the session. */
function waitForText(
  session: ProjectSession,
  docId: string,
  timeoutMs = 5000
): Promise<Y.Text> {
  const existing = session.texts.get(docId)
  if (existing) return Promise.resolve(existing)
  return new Promise((resolve, reject) => {
    const onChange = () => {
      const text = session.texts.get(docId)
      if (!text) return
      cleanup()
      resolve(text)
    }
    const timer = window.setTimeout(() => {
      cleanup()
      reject(new Error('The bibliography file did not sync in time'))
    }, timeoutMs)
    const cleanup = () => {
      window.clearTimeout(timer)
      session.texts.unobserve(onChange)
    }
    session.texts.observe(onChange)
  })
}

function useBibDocs(tree: ProjectTree): BibDoc[] {
  return useMemo(() => {
    const index = indexTree(tree)
    return tree.entries
      .filter(e => e.kind === 'doc' && e.name.toLowerCase().endsWith('.bib'))
      .map(e => ({ id: e.id, path: index.paths.get(e.id) ?? e.name }))
      .sort((a, b) => a.path.localeCompare(b.path))
  }, [tree])
}

function CitationSearch({
  entries,
  canInsert,
}: {
  entries: FoundEntry[]
  canInsert: boolean
}) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>([])

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const matching = needle
      ? entries.filter(entry =>
          [entry.key, entry.title, entry.author, entry.year].some(value =>
            value.toLowerCase().includes(needle)
          )
        )
      : entries
    return matching.slice(0, MAX_RESULTS)
  }, [entries, query])

  const toggle = (key: string) =>
    setSelected(keys =>
      keys.includes(key) ? keys.filter(k => k !== key) : [...keys, key]
    )

  const submit = (keys: string[]) => {
    insertCite(keys)
    closeCitationDialog()
  }

  return (
    <>
      <OLModalBody>
        <OLFormControl
          autoFocus
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && canInsert) {
              event.preventDefault()
              const keys = selected.length > 0 ? selected : [results[0]?.key]
              if (keys[0]) submit(keys)
            }
          }}
          placeholder={t('search_by_citekey_author_year_title')}
          aria-label={t('search_references')}
          data-testid="citation-search"
        />
        {entries.length === 0 ? (
          <p className="text-center text-muted my-4">
            {t('no_references_found')}
          </p>
        ) : (
          <ul
            className="list-unstyled openleaf-citation-results"
            aria-label={t('references')}
          >
            {results.map(entry => (
              <li key={`${entry.path}:${entry.key}`}>
                <button
                  type="button"
                  className={classNames('openleaf-citation-result', {
                    selected: selected.includes(entry.key),
                  })}
                  aria-pressed={selected.includes(entry.key)}
                  onClick={() => toggle(entry.key)}
                  onDoubleClick={() => canInsert && submit([entry.key])}
                  data-testid="citation-result"
                >
                  <span className="openleaf-citation-key" translate="no">
                    {entry.key}
                  </span>
                  <span className="openleaf-citation-meta">
                    {[entry.author, entry.year].filter(Boolean).join(', ')}
                  </span>
                  {entry.title && (
                    <span className="openleaf-citation-title">
                      {entry.title}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </OLModalBody>
      <OLModalFooter>
        <OLButton variant="secondary" onClick={closeCitationDialog}>
          {t('cancel')}
        </OLButton>
        <OLButton
          variant="primary"
          disabled={!canInsert || selected.length === 0}
          onClick={() => submit(selected)}
        >
          {t('insert')}
        </OLButton>
      </OLModalFooter>
    </>
  )
}

function AddReference({
  project,
  tree,
  bibDocs,
  existingKeys,
  canInsert,
  onDone,
}: {
  project: ProjectDetails
  tree: ProjectTree
  bibDocs: BibDoc[]
  existingKeys: Map<string, Set<string>>
  canInsert: boolean
  onDone: () => void
}) {
  const { t } = useTranslation()
  const session = useProjectSession()
  const defaultTarget =
    bibDocs.find(doc => doc.id === project.mainBibDocId)?.id ??
    bibDocs[0]?.id ??
    ''
  const [targetId, setTargetId] = useState(defaultTarget)
  const [bibtex, setBibtex] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const parsed = useMemo(() => extractBibEntries(bibtex), [bibtex])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (parsed.length === 0) {
      setError(t('citation_no_entry_found'))
      return
    }
    const duplicate = parsed.find(entry =>
      existingKeys.get(targetId)?.has(entry.key)
    )
    if (duplicate) {
      setError(t('bibtex_duplicates_keys'))
      return
    }
    setError(null)
    setBusy(true)
    try {
      let docId = targetId
      if (!docId) {
        const created = await createEntry(
          project.id,
          tree.rootFolderId,
          NEW_BIB_NAME,
          'doc'
        )
        docId = created.id
        await patchProject(project.id, { mainBibDocId: docId })
      }
      const ytext = await waitForText(session, docId)
      session.ydoc.transact(() => {
        const current = ytext.toString()
        const separator =
          current.length === 0 ? '' : current.endsWith('\n') ? '\n' : '\n\n'
        ytext.insert(ytext.length, `${separator}${bibtex.trim()}\n`)
      })
      if (canInsert) insertCite(parsed.map(entry => entry.key))
      closeCitationDialog()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <OLModalBody>
        {error && (
          <div className="notification-list">
            <Notification type="error" content={error} />
          </div>
        )}
        <OLFormGroup controlId="citation-target">
          <OLFormLabel>
            {t('main_bibliography_file_for_this_project')}
          </OLFormLabel>
          <select
            id="citation-target"
            className="form-select form-select-sm"
            value={targetId}
            onChange={event => setTargetId(event.target.value)}
            data-testid="citation-target"
          >
            {bibDocs.length === 0 && (
              <option value="">
                {t('citation_create_bib_file', { name: NEW_BIB_NAME })}
              </option>
            )}
            {bibDocs.map(doc => (
              <option key={doc.id} value={doc.id} translate="no">
                {doc.path}
              </option>
            ))}
          </select>
        </OLFormGroup>
        <OLFormGroup controlId="citation-bibtex">
          <OLFormLabel>{t('bibtex')}</OLFormLabel>
          <OLFormControl
            as="textarea"
            rows={8}
            className="openleaf-citation-bibtex"
            value={bibtex}
            onChange={event => setBibtex(event.target.value)}
            placeholder="@article{key,&#10;  title = {…},&#10;}"
            spellCheck={false}
            autoFocus
            data-testid="citation-bibtex"
          />
        </OLFormGroup>
      </OLModalBody>
      <OLModalFooter>
        <OLButton variant="secondary" onClick={onDone}>
          {t('back')}
        </OLButton>
        <OLButton
          type="submit"
          variant="primary"
          disabled={busy || bibtex.trim() === ''}
          isLoading={busy}
        >
          {canInsert ? t('citation_add_and_cite') : t('add_reference')}
        </OLButton>
      </OLModalFooter>
    </form>
  )
}

/** Insert → Citation: search the project's .bib entries or paste a new one. */
export function CitationDialog({
  project,
  tree,
}: {
  project: ProjectDetails
  tree: ProjectTree
}) {
  const { t } = useTranslation()
  const show = useCitationStore(s => s.show)
  const session = useProjectSession()
  const bibDocs = useBibDocs(tree)
  const [adding, setAdding] = useState(false)
  const [entries, setEntries] = useState<FoundEntry[]>([])
  const canEditBib = roleAtLeast(project.role, 'editor')
  const canInsert = roleAtLeast(project.role, 'reviewer')

  // Read the .bib docs fresh each time the dialog opens or they change.
  useEffect(() => {
    if (!show) return
    const read = () =>
      setEntries(
        bibDocs.flatMap(doc =>
          extractBibEntries(session.texts.get(doc.id)?.toString() ?? '').map(
            entry => ({ ...entry, path: doc.path })
          )
        )
      )
    read()
    session.texts.observeDeep(read)
    return () => session.texts.unobserveDeep(read)
  }, [show, bibDocs, session])

  useEffect(() => {
    if (!show) setAdding(false)
  }, [show])

  const existingKeys = useMemo(() => {
    const byDoc = new Map<string, Set<string>>()
    for (const doc of bibDocs) byDoc.set(doc.id, new Set())
    const idByPath = new Map(bibDocs.map(doc => [doc.path, doc.id]))
    for (const entry of entries)
      byDoc.get(idByPath.get(entry.path) ?? '')?.add(entry.key)
    return byDoc
  }, [bibDocs, entries])

  return (
    <OLModal
      show={show}
      onHide={closeCitationDialog}
      size="lg"
      themed
      data-testid="citation-dialog"
    >
      <OLModalHeader>
        <OLModalTitle>
          {adding ? t('add_reference') : t('insert_citation')}
        </OLModalTitle>
      </OLModalHeader>
      {!adding && canEditBib && (
        <div className="openleaf-citation-actions">
          <OLButton
            variant="link"
            size="sm"
            onClick={() => setAdding(true)}
            data-testid="citation-add-new"
          >
            {t('citation_add_new_reference')}
          </OLButton>
        </div>
      )}
      {adding ? (
        <AddReference
          project={project}
          tree={tree}
          bibDocs={bibDocs}
          existingKeys={existingKeys}
          canInsert={canInsert}
          onDone={() => setAdding(false)}
        />
      ) : (
        <CitationSearch entries={entries} canInsert={canInsert} />
      )}
    </OLModal>
  )
}
