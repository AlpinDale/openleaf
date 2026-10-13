// Ported from Overleaf services/web/scripts/lezer-latex/generate.mjs (AGPL-3.0)
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildParserFile } from '@lezer/generator'

const editorDir = path.resolve(
  import.meta.dirname,
  '../src/features/source-editor'
)

export const grammars = ['latex', 'bibtex'].map(name => ({
  grammarPath: path.join(editorDir, `lezer-${name}`, `${name}.grammar`),
  parserOutputPath: path.join(editorDir, `lezer-${name}`, `${name}.mjs`),
  termsOutputPath: path.join(editorDir, `lezer-${name}`, `${name}.terms.mjs`),
}))

function isUpToDate({ grammarPath, parserOutputPath, termsOutputPath }) {
  if (!existsSync(parserOutputPath) || !existsSync(termsOutputPath)) {
    return false
  }
  const source = statSync(grammarPath).mtimeMs
  return (
    statSync(parserOutputPath).mtimeMs >= source &&
    statSync(termsOutputPath).mtimeMs >= source
  )
}

export function compile(grammar, { force = false } = {}) {
  const { grammarPath, parserOutputPath, termsOutputPath } = grammar
  if (!force && isUpToDate(grammar)) return
  const { parser, terms } = buildParserFile(readFileSync(grammarPath, 'utf8'), {
    fileName: grammarPath,
    moduleStyle: 'es',
  })
  writeFileSync(parserOutputPath, parser)
  writeFileSync(termsOutputPath, terms)
  console.info(`Generated ${path.relative(process.cwd(), parserOutputPath)}`)
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    for (const grammar of grammars) compile(grammar)
  } catch (err) {
    console.error(err)
    process.exit(1)
  }
}
