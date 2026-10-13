import path from 'node:path'

/** Extensions tried, in order, for `\includegraphics{name}` without one. */
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'pdf', 'eps']

/** Metadata the writers may use; everything else (css, header-includes, …) is dropped. */
const KEPT_META: Record<string, true> = {
  title: true,
  subtitle: true,
  author: true,
  date: true,
  abstract: true,
  keywords: true,
  lang: true,
  institute: true,
  thanks: true,
}

/** Raw passthrough formats that the docx/html/markdown writers ignore. */
const INERT_RAW_FORMATS: Record<string, true> = { latex: true, tex: true }

type Node = { t: string; c?: unknown }
type PandocDoc = { meta?: Record<string, unknown>; blocks: unknown[] }

const isNode = (value: unknown): value is Node =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Node).t === 'string'

/**
 * Makes a pandoc JSON AST safe to render with resources enabled: every image
 * must name a file of this project (rewritten relative to the root doc's
 * folder), otherwise it becomes its alt text; raw HTML/OpenXML passthrough and
 * unexpected metadata are removed. The non-sandboxed writer then reads no
 * file outside the export directory and fetches nothing remote.
 */
export function sanitizeAst(
  doc: PandocDoc,
  opts: { rootDir: string; projectFiles: ReadonlySet<string> }
): PandocDoc {
  const resolveImage = (src: string): string | null => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('/')) return null
    let rel: string
    try {
      rel = decodeURIComponent(src)
    } catch {
      return null
    }
    const joined = path.posix.normalize(path.posix.join(opts.rootDir, rel))
    if (joined === '..' || joined.startsWith('../')) return null
    const candidates = [joined, ...IMAGE_EXTENSIONS.map(e => `${joined}.${e}`)]
    const found = candidates.find(c => opts.projectFiles.has(c))
    return found ? path.posix.relative(opts.rootDir, found) : null
  }

  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      const out: unknown[] = []
      for (const item of value) {
        if (
          isNode(item) &&
          (item.t === 'RawBlock' || item.t === 'RawInline') &&
          !Object.hasOwn(INERT_RAW_FORMATS, String((item.c as unknown[])?.[0]))
        )
          continue
        out.push(walk(item))
      }
      return out
    }
    if (isNode(value) && value.t === 'Image') {
      const [attr, alt, target] = value.c as [
        unknown,
        unknown[],
        [string, string],
      ]
      const src = resolveImage(target[0])
      if (!src) return { t: 'Span', c: [['', [], []], walk(alt)] }
      return { t: 'Image', c: [attr, walk(alt), [src, target[1]]] }
    }
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, walk(v)])
      )
    }
    return value
  }

  const meta = Object.fromEntries(
    Object.entries(doc.meta ?? {})
      .filter(([key]) => Object.hasOwn(KEPT_META, key))
      .map(([key, value]) => [key, walk(value)])
  )
  return { ...doc, meta, blocks: walk(doc.blocks) as unknown[] }
}
