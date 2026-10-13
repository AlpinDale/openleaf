import path from 'node:path'
import { HttpError } from '../errors.js'

const MAX_DEPTH = 16

/** `\input{x}`, `\include{x}`, `\subfile{x}`, `\import{dir}{x}`, `\subimport{dir}{x}`. */
const INCLUDE_RE =
  /\\(input|include|subfile)\s*\{([^{}]+)\}|\\(import|subimport|inputfrom|includefrom|subinputfrom|subincludefrom)\*?\s*\{([^{}]*)\}\s*\{([^{}]+)\}/g

/** Index of the first unescaped `%` in `line`, or the line length. */
function commentStart(line: string): number {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\') i++
    else if (line[i] === '%') return i
  }
  return line.length
}

/** A subfile's body: the text between `\begin{document}` and `\end{document}`. */
function documentBody(text: string): string {
  if (!/^\s*\\documentclass/m.test(text)) return text
  const begin = text.indexOf('\\begin{document}')
  const end = text.lastIndexOf('\\end{document}')
  if (begin < 0 || end < begin) return text
  return text.slice(begin + '\\begin{document}'.length, end)
}

/**
 * Inlines `\input`-style includes of project docs into the root doc, so
 * pandoc can convert the project while sandboxed (it may then read no file
 * at all). Paths resolve like latexmk -cd: relative to the root doc's folder,
 * or to the imported folder inside `\import`/`\subimport`. Includes that don't
 * name a project doc are left untouched for the sandbox to drop.
 */
export function flattenLatex(
  rootPath: string,
  docs: ReadonlyMap<string, string>
): string {
  const rootDir = path.posix.dirname(rootPath)
  let expandedBytes = 0
  let includes = 0

  const resolve = (baseDir: string, name: string): string | null => {
    const joined = path.posix.normalize(path.posix.join(baseDir, name.trim()))
    if (joined.startsWith('../') || joined === '..' || joined.startsWith('/'))
      return null
    const rel = joined.replace(/^\.\//, '')
    if (docs.has(rel)) return rel
    if (docs.has(`${rel}.tex`)) return `${rel}.tex`
    return null
  }

  const expand = (text: string, baseDir: string, stack: string[]): string => {
    expandedBytes += Buffer.byteLength(text)
    if (expandedBytes > 16 * 1024 * 1024 || ++includes > 2000)
      throw new HttpError(
        413,
        'too_large',
        'Export source expansion limit reached'
      )
    return text
      .split('\n')
      .map(line => {
        const cut = commentStart(line)
        const code = line
          .slice(0, cut)
          .replace(
            INCLUDE_RE,
            (whole, cmd, name, importCmd, importDir, importName) => {
              let docPath: string | null
              let nextBase = baseDir
              if (cmd) {
                docPath = resolve(baseDir, name)
              } else {
                const dir = importCmd.startsWith('sub')
                  ? path.posix.join(baseDir, importDir)
                  : path.posix.join(rootDir, importDir)
                docPath = resolve(dir, importName)
                nextBase = path.posix.normalize(dir)
              }
              if (
                !docPath ||
                stack.includes(docPath) ||
                stack.length >= MAX_DEPTH
              )
                return whole
              const body = documentBody(docs.get(docPath) ?? '')
              return expand(body, nextBase, [...stack, docPath])
            }
          )
        return code + line.slice(cut)
      })
      .join('\n')
  }

  return expand(docs.get(rootPath) ?? '', rootDir, [rootPath])
}
