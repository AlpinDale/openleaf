import {
  type CompileResponse,
  CompileResponse as CompileResponseSchema,
  type CompileStatus,
  SynctexCodePosition,
  SynctexPdfPosition,
  type UserSettings,
} from '@openleaf/shared'
import { z } from 'zod'
import { create } from 'zustand'
import { type Me, meKey, patchMe } from '@/api/auth'
import { apiFetch, errorMessage, isApiError } from '@/api/client'
import { queryClient } from '@/api/query-client'
import {
  getCursorPosition,
  goToPosition,
} from '@/features/editor/editor-bridge'
import { useEditorStore } from '@/features/editor/editor-store'
import type { ProjectSession } from '@/features/project/session'
import { showToast } from '@/features/toasts'
import { t } from '@/i18n'
import type { Annotation } from '@/types/annotation'
import { debugConsole } from '@/utils/debugging'
import {
  emptyLogEntries,
  handleLogFiles,
  type LogEntries,
} from './util/output-files'
import type { HighlightData } from './util/types'

export type CompileUiStatus = 'idle' | 'compiling' | CompileStatus

export type CompileAnnotation = {
  /** 1-based line. */
  line: number
  column?: number
  severity: 'error' | 'warning' | 'info'
  message: string
  source?: string
}

export type CompileOptionName =
  | 'autoCompile'
  | 'draft'
  | 'syntaxCheck'
  | 'stopOnFirstError'

/** Compile option ↔ the `UserSettings` field it persists to. */
const OPTION_SETTINGS = {
  autoCompile: 'autoCompile',
  draft: 'compileDraft',
  syntaxCheck: 'compileSyntaxCheck',
  stopOnFirstError: 'compileStopOnFirstError',
} as const satisfies Record<CompileOptionName, keyof UserSettings>

type CompileState = {
  status: CompileUiStatus
  result: CompileResponse | null
  logEntries: LogEntries
  rawLog: string
  pdfUrl: string | null
  autoCompile: boolean
  draft: boolean
  syntaxCheck: boolean
  stopOnFirstError: boolean
  /** Epoch ms when the last compile finished. */
  lastCompileAt: number | null
  /** Epoch ms when the running (or last) compile started. */
  compileStartedAt: number | null
  /** Epoch ms of the last local edit to any doc. */
  changedAt: number
  error: string | null
  /** Log entries with a file and line, by project-relative path. */
  annotationsByPath: Record<string, CompileAnnotation[]>
  /** Same entries in Overleaf's annotation shape, by doc entry id. */
  logEntryAnnotations: Record<string, Annotation[]>
  /** SyncTeX highlight boxes to draw; `seq` changes on every request. */
  highlights: { boxes: HighlightData[]; seq: number }
  syncInFlight: boolean
  logsOpen: boolean
  wordCountOpen: boolean
  /** This window is the detached PDF viewer. */
  detached: boolean
  /** Detached window only: an editor window is connected over the channel. */
  editorLinked: boolean
}

type CompileActions = {
  compile(): Promise<void>
  stop(): Promise<void>
  clearCache(): Promise<void>
  /** Clears the cached files, then compiles. */
  recompileFromScratch(): Promise<void>
  setOption(name: CompileOptionName, value: boolean): void
  setLogsOpen(open: boolean): void
}

const initialState: CompileState = {
  status: 'idle',
  result: null,
  logEntries: emptyLogEntries(),
  rawLog: '',
  pdfUrl: null,
  autoCompile: true,
  draft: false,
  syntaxCheck: false,
  stopOnFirstError: false,
  lastCompileAt: null,
  compileStartedAt: null,
  changedAt: 0,
  error: null,
  annotationsByPath: {},
  logEntryAnnotations: {},
  highlights: { boxes: [], seq: 0 },
  syncInFlight: false,
  logsOpen: false,
  wordCountOpen: false,
  detached: false,
  editorLinked: false,
}

/** Messages between the editor window and the detached PDF window. */
export type ChannelMessage =
  | {
      type: 'compiled'
      result: CompileResponse | null
      logEntries?: LogEntries
      rawLog?: string
    }
  | { type: 'status'; status: CompileUiStatus }
  | { type: 'sync-to-code'; path: string; line: number; column: number }
  | { type: 'sync-to-pdf'; boxes: HighlightData[] }
  | { type: 'compile' }
  | { type: 'hello'; role: 'editor' | 'detached' }
  | { type: 'bye'; role: 'editor' | 'detached' }

type Connection = {
  projectId: string
  /** Absent in the detached PDF window. */
  session: ProjectSession | null
  role: 'editor' | 'detached'
  channel: BroadcastChannel | null
  /** Mounted users of this connection. */
  refs: number
  resultVersion: number
  onPageHide: () => void
}

let connection: Connection | null = null
let detachedWindow: Window | null = null
let detachedWindowTimer: number | null = null

const channelName = (projectId: string) => `openleaf-project-${projectId}`

function post(message: ChannelMessage) {
  connection?.channel?.postMessage(message)
}

export const useCompileStore = create<CompileState & CompileActions>(
  (set, get) => ({
    ...initialState,

    async compile() {
      const conn = connection
      if (!conn) return
      if (conn.role === 'detached') {
        post({ type: 'compile' })
        return
      }
      const { session, projectId } = conn
      if (get().status === 'compiling' || !session) return
      const previousStatus = get().status
      set({ status: 'compiling', compileStartedAt: Date.now(), error: null })
      post({ type: 'status', status: 'compiling' })

      try {
        await session.waitForSync()
      } catch {
        if (connection !== conn) return
        showToast({
          type: 'warning',
          content: t('compile_unsynced_changes'),
        })
      }
      if (connection !== conn) return

      const { draft, syntaxCheck, stopOnFirstError } = get()
      let result: CompileResponse
      try {
        result = await apiFetch(`/projects/${projectId}/compile`, {
          method: 'POST',
          body: { draft, syntaxCheck, stopOnFirstError },
          schema: CompileResponseSchema,
        })
      } catch (err) {
        if (connection !== conn) return
        if (isApiError(err, 'compile_in_progress')) {
          showToast({ type: 'info', content: t('already_compiling') })
          set({ status: previousStatus })
        } else {
          set({ status: 'idle', error: errorMessage(err) })
        }
        post({ type: 'status', status: get().status })
        return
      }
      if (connection !== conn) return
      await applyResult(result)
      if (connection !== conn) return
      const state = get()
      if (state.result !== result) return
      post({
        type: 'compiled',
        result,
        logEntries: state.logEntries,
        rawLog: state.rawLog,
      })
    },

    async stop() {
      const conn = connection
      if (!conn) return
      try {
        await apiFetch(`/projects/${conn.projectId}/compile/stop`, {
          method: 'POST',
        })
      } catch (err) {
        if (connection !== conn) return
        showToast({ type: 'error', content: errorMessage(err) })
      }
    },

    async clearCache() {
      const conn = connection
      if (!conn) return
      try {
        await apiFetch(`/projects/${conn.projectId}/compile/cache`, {
          method: 'DELETE',
        })
      } catch (err) {
        if (connection !== conn) return
        showToast({ type: 'error', content: errorMessage(err) })
        return
      }
      if (connection !== conn) return
      conn.resultVersion++
      set({
        status: 'idle',
        result: null,
        pdfUrl: null,
        logEntries: emptyLogEntries(),
        rawLog: '',
        annotationsByPath: {},
        logEntryAnnotations: {},
      })
      post({ type: 'compiled', result: null })
    },

    async recompileFromScratch() {
      if (get().status === 'compiling') return
      const conn = connection
      if (!conn) return
      const version = conn.resultVersion
      await get().clearCache()
      if (connection !== conn || conn.resultVersion === version) return
      await get().compile()
    },

    setOption(name, value) {
      set({ [name]: value } as Pick<CompileState, CompileOptionName>)
      patchMe({ settings: { [OPTION_SETTINGS[name]]: value } }).catch(err =>
        showToast({ type: 'error', content: errorMessage(err) })
      )
    },

    setLogsOpen(open) {
      set({ logsOpen: open })
    },
  })
)

/** Copies the compile options from the user's settings. */
export function syncCompileOptions(settings: UserSettings) {
  useCompileStore.setState({
    autoCompile: settings.autoCompile,
    draft: settings.compileDraft,
    syntaxCheck: settings.compileSyntaxCheck,
    stopOnFirstError: settings.compileStopOnFirstError,
  })
}

function buildAnnotations(logEntries: LogEntries) {
  const annotationsByPath: Record<string, CompileAnnotation[]> = {}
  const logEntryAnnotations: Record<string, Annotation[]> = {}
  const seenLine: Record<string, true> = {}
  const session = connection?.session
  for (const entry of logEntries.all) {
    if (!entry.file) continue
    const line = Number(entry.line) || 1
    const severity = entry.level === 'error' ? 'error' : 'warning'
    const message = entry.message ?? ''
    const byPath = annotationsByPath[entry.file] ?? []
    annotationsByPath[entry.file] = byPath
    byPath.push({
      line,
      column: entry.column,
      severity,
      message,
      source: entry.type ?? 'compile',
    })

    const docId = session?.getEntryByPath(entry.file)?.id
    if (!docId) continue
    const forDoc = logEntryAnnotations[docId] ?? []
    logEntryAnnotations[docId] = forDoc
    const annotation: Annotation = {
      id: entry.key,
      entryIndex: forDoc.length,
      row: line - 1,
      type: severity,
      text: message,
      source: 'compile',
      ruleId: entry.ruleId,
      command: entry.command,
    }
    const lineKey = `${docId}:${line}`
    if (entry.level !== 'typesetting' && !seenLine[lineKey]) {
      annotation.firstOnLine = true
      seenLine[lineKey] = true
    }
    forDoc.push(annotation)
  }
  return { annotationsByPath, logEntryAnnotations }
}

function pdfUrlOf(result: CompileResponse | null) {
  const pdf = result?.outputFiles.find(file => file.path === 'output.pdf')
  return pdf && result?.buildId ? `${pdf.url}?build=${result.buildId}` : null
}

/** Parses a compile result's logs and installs it as the current result. */
async function applyResult(
  result: CompileResponse | null,
  parsed?: { logEntries: LogEntries; rawLog: string }
) {
  const conn = connection
  if (!conn) return
  const version = ++conn.resultVersion
  let logEntries = parsed?.logEntries ?? emptyLogEntries()
  let rawLog = parsed?.rawLog ?? ''
  if (result && !parsed) {
    try {
      const logs = await handleLogFiles(result)
      logEntries = logs.logEntries
      rawLog = logs.log ?? ''
    } catch (err) {
      debugConsole.warn('Failed to process the compile logs', err)
    }
  }
  if (connection !== conn || conn.resultVersion !== version) return
  useCompileStore.setState({
    status: result?.status ?? 'idle',
    result,
    logEntries,
    rawLog,
    pdfUrl: pdfUrlOf(result),
    lastCompileAt: Date.now(),
    error: null,
    ...buildAnnotations(logEntries),
  })
}

/** Opens the source location in the editor; in the detached window, asks the editor to. */
function goToCodeLocation(path: string, line: number, column: number) {
  if (connection?.role === 'detached') {
    post({ type: 'sync-to-code', path, line, column })
    return
  }
  const entry = connection?.session?.getEntryByPath(path)
  if (entry?.kind !== 'doc') {
    showToast({ type: 'warning', content: t('file_not_found_in_project') })
    return
  }
  void goToPosition({ docId: entry.id, line, column })
}

/** Jumps to a log entry's file and line. */
export function goToLogEntry(file: string, line?: number, column?: number) {
  goToCodeLocation(file, line ?? 1, column ?? 0)
}

function showHighlights(boxes: HighlightData[]) {
  useCompileStore.setState(state => ({
    highlights: { boxes, seq: state.highlights.seq + 1 },
  }))
}

/** Code → PDF: highlights the PDF boxes for a source position (1-based line). */
export async function syncToPdf(position: {
  path: string
  line: number
  column?: number
}) {
  const conn = connection
  if (!conn) return
  if (queryClient.getQueryData<Me>(meKey)?.settings.pdfViewer === 'native') {
    showToast({
      type: 'info',
      content: t('synctex_unavailable_native_viewer'),
    })
    return
  }
  useCompileStore.setState({ syncInFlight: true })
  try {
    const params = new URLSearchParams({
      path: position.path,
      line: String(position.line),
      column: String(position.column ?? 0),
    })
    const { pdf } = await apiFetch(
      `/projects/${conn.projectId}/synctex/code?${params}`,
      { schema: z.object({ pdf: z.array(SynctexPdfPosition) }) }
    )
    if (connection !== conn) return
    if (pdf.length === 0) {
      showToast({ type: 'info', content: t('synctex_no_position') })
      return
    }
    if (useEditorStore.getState().layout === 'detached' && conn.channel) {
      post({ type: 'sync-to-pdf', boxes: pdf })
    } else {
      showHighlights(pdf)
    }
  } catch (err) {
    if (connection !== conn) return
    showToast({
      type: 'warning',
      content: isApiError(err, 'not_found')
        ? t('synctex_needs_compile')
        : errorMessage(err),
    })
  } finally {
    if (connection === conn) {
      useCompileStore.setState({ syncInFlight: false })
    }
  }
}

/** Path of a doc entry in the editor window's project, or null. */
export function docPath(docId: string): string | null {
  return connection?.session?.getPath(docId) ?? null
}

/** Code → PDF for the editor's cursor. Returns false when there is no open doc. */
export function syncCursorToPdf(): boolean {
  const cursor = getCursorPosition()
  const path = cursor && docPath(cursor.docId)
  if (!cursor || !path) {
    showToast({ type: 'info', content: t('synctex_no_open_doc') })
    return false
  }
  void syncToPdf({ path, line: cursor.line, column: cursor.column })
  return true
}

/** PDF → code: opens the source location for a PDF point (1-based page, PDF points from top-left). */
export async function syncToCode(position: {
  page: number
  h: number
  v: number
}) {
  const conn = connection
  if (!conn) return
  useCompileStore.setState({ syncInFlight: true })
  try {
    const params = new URLSearchParams({
      page: String(position.page),
      h: position.h.toFixed(2),
      v: position.v.toFixed(2),
    })
    const { code } = await apiFetch(
      `/projects/${conn.projectId}/synctex/pdf?${params}`,
      { schema: z.object({ code: z.array(SynctexCodePosition) }) }
    )
    if (connection !== conn) return
    const first = code[0]
    if (!first) {
      showToast({ type: 'info', content: t('synctex_no_position') })
      return
    }
    goToCodeLocation(first.path, first.line, first.column)
  } catch (err) {
    if (connection !== conn) return
    showToast({
      type: 'warning',
      content: isApiError(err, 'not_found')
        ? t('synctex_needs_compile')
        : errorMessage(err),
    })
  } finally {
    if (connection === conn) {
      useCompileStore.setState({ syncInFlight: false })
    }
  }
}

/** Opens the word count modal (rendered by `CompileController`). */
export function openWordCount() {
  useCompileStore.setState({ wordCountOpen: true })
}

/** URL of the current PDF, for downloads. */
export function downloadPdfUrl(): string | null {
  return useCompileStore.getState().pdfUrl
}

/** Records a local edit (drives auto compile and stale-annotation hiding). */
export function markChanged() {
  useCompileStore.setState({ changedAt: Date.now() })
}

/** Layout → "PDF in a separate tab". Call from a click handler (popup blockers). */
export function openDetachedPdf(projectId: string) {
  useEditorStore.getState().setLayout('detached')
  if (detachedWindow && !detachedWindow.closed) {
    detachedWindow.focus()
    return
  }
  detachedWindow = window.open(
    `/project/${projectId}/pdf`,
    `openleaf-pdf-${projectId}`
  )
  if (!detachedWindow) {
    showToast({ type: 'warning', content: t('popup_blocked') })
    useEditorStore.getState().setLayout('sideBySide')
    return
  }
  const opened = detachedWindow
  if (detachedWindowTimer !== null) window.clearInterval(detachedWindowTimer)
  detachedWindowTimer = window.setInterval(() => {
    if (!opened.closed) return
    if (detachedWindowTimer !== null) window.clearInterval(detachedWindowTimer)
    detachedWindowTimer = null
    if (detachedWindow === opened) detachedWindow = null
    if (useEditorStore.getState().layout === 'detached') {
      useEditorStore.getState().setLayout('sideBySide')
    }
  }, 1000)
}

/** Closes the detached PDF window, if one is open. */
export function closeDetachedPdf() {
  if (detachedWindowTimer !== null) window.clearInterval(detachedWindowTimer)
  detachedWindowTimer = null
  detachedWindow?.close()
  detachedWindow = null
}

function handleMessage(message: ChannelMessage) {
  const conn = connection
  if (!conn) return
  if (conn.role === 'editor') {
    switch (message.type) {
      case 'compile':
        void useCompileStore.getState().compile()
        break
      case 'sync-to-code':
        goToCodeLocation(message.path, message.line, message.column)
        break
      case 'hello': {
        if (message.role !== 'detached') break
        const state = useCompileStore.getState()
        post({ type: 'status', status: state.status })
        post({
          type: 'compiled',
          result: state.result,
          logEntries: state.logEntries,
          rawLog: state.rawLog,
        })
        if (useEditorStore.getState().layout !== 'detached') {
          useEditorStore.getState().setLayout('detached')
        }
        break
      }
      case 'bye':
        if (
          message.role === 'detached' &&
          useEditorStore.getState().layout === 'detached'
        ) {
          useEditorStore.getState().setLayout('sideBySide')
        }
        break
    }
    return
  }
  // Detached window: linked once an editor window speaks, until it says bye.
  switch (message.type) {
    case 'compiled':
    case 'status':
    case 'sync-to-pdf':
      useCompileStore.setState({ editorLinked: true })
      break
    case 'hello':
    case 'bye':
      if (message.role === 'editor') {
        useCompileStore.setState({ editorLinked: message.type === 'hello' })
      }
      break
  }
  switch (message.type) {
    case 'compiled':
      if (message.result && message.logEntries) {
        void applyResult(message.result, {
          logEntries: message.logEntries,
          rawLog: message.rawLog ?? '',
        })
      } else {
        void applyResult(message.result)
      }
      break
    case 'status':
      useCompileStore.setState({ status: message.status })
      break
    case 'sync-to-pdf':
      showHighlights(message.boxes)
      break
    case 'hello':
      // the editor window (re)connected: announce this detached window
      if (message.role === 'editor') post({ type: 'hello', role: 'detached' })
      break
  }
}

/**
 * Binds the store to a project. The editor window passes its session; the
 * detached PDF window passes none and relays compiles over the channel.
 * Returns the disconnect function. Reconnecting the same session right after
 * disconnecting (React StrictMode, remounts) keeps the existing state.
 */
export function connectCompileStore(options: {
  projectId: string
  session: ProjectSession | null
  role: 'editor' | 'detached'
}): () => void {
  let conn = connection
  if (
    !conn ||
    conn.projectId !== options.projectId ||
    conn.session !== options.session ||
    conn.role !== options.role
  ) {
    if (conn) teardown(conn)
    useCompileStore.setState({
      ...initialState,
      logEntries: emptyLogEntries(),
      detached: options.role === 'detached',
    })
    const channel =
      typeof BroadcastChannel === 'undefined'
        ? null
        : new BroadcastChannel(channelName(options.projectId))
    const created: Connection = {
      ...options,
      channel,
      refs: 0,
      resultVersion: 0,
      onPageHide: () => {
        if (connection === created) teardown(created)
      },
    }
    if (channel) {
      channel.onmessage = event => {
        if (connection === created) handleMessage(event.data as ChannelMessage)
      }
    }
    // React cleanups don't run when the tab closes; tell the other side
    // directly (the editor falls back to its own PDF panel, and a detached
    // window shows that it lost its editor).
    window.addEventListener('pagehide', created.onPageHide)
    connection = conn = created
    // Both sides announce themselves; the editor answers a detached window's
    // hello with its state, and a detached window answers the editor's hello.
    post({ type: 'hello', role: options.role })
  }
  const current = conn
  current.refs++
  return () => {
    current.refs--
    window.setTimeout(() => {
      if (current.refs === 0 && connection === current) teardown(current)
    })
  }
}

function teardown(conn: Connection) {
  window.removeEventListener('pagehide', conn.onPageHide)
  if (connection === conn && conn.role === 'editor') closeDetachedPdf()
  conn.channel?.postMessage({ type: 'bye', role: conn.role })
  conn.channel?.close()
  if (connection === conn) connection = null
}
