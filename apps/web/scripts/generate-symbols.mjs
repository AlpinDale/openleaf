#!/usr/bin/env node
// One-time generator for src/features/symbol-palette/symbols.json.
//
// Reads every `\DeclareMathSymbol{\cmd}{\class}…` in LaTeX's fontmath.ltx
// (package null) and amssymb.sty (package "amssymb"), and maps each command to
// its Unicode character through the `\UnicodeMathSymbol` lines of
// unicode-math-table.tex. Commands without a mapping are skipped. Needs a TeX
// distribution with `kpsewhich` on PATH. The output is committed.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const outFile = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/features/symbol-palette/symbols.json'
)

const read = name =>
  readFileSync(
    execFileSync('kpsewhich', [name], { encoding: 'utf8' }).trim(),
    'utf8'
  )

const GREEK_LETTERS = new Set(
  [
    'alpha',
    'beta',
    'gamma',
    'delta',
    'epsilon',
    'zeta',
    'eta',
    'theta',
    'iota',
    'kappa',
    'lambda',
    'mu',
    'nu',
    'xi',
    'omicron',
    'pi',
    'rho',
    'sigma',
    'tau',
    'upsilon',
    'phi',
    'chi',
    'psi',
    'omega',
    'digamma',
  ].flatMap(name => [name, name[0].toUpperCase() + name.slice(1)])
)

/** `\UnicodeMathSymbol{"XXXXX}{\cmd}{\class}{description}` → cmd → {codepoint, name}. */
function parseUnicodeTable(text) {
  const table = new Map()
  const re =
    /^\\UnicodeMathSymbol\{"([0-9A-Fa-f]+)\}\{\\([A-Za-z]+)\s*\}\{\\[A-Za-z]+\}\{([^}]*)\}/gm
  for (const [, hex, command, description] of text.matchAll(re)) {
    if (!table.has(command)) {
      table.set(command, {
        codepoint: Number.parseInt(hex, 16),
        name: description.trim(),
      })
    }
  }
  return table
}

/** `\DeclareMathSymbol{\cmd}{\class}{font}{slot}` → [{command, mathClass}]. */
function parseDeclarations(text) {
  const re = /\\DeclareMathSymbol\{\\([A-Za-z]+)\}\s*\{\\(math[a-z]+)\}/g
  return [...text.matchAll(re)].map(([, command, mathClass]) => ({
    command,
    mathClass,
  }))
}

function category(command, mathClass) {
  const base = command.startsWith('var') ? command.slice(3) : command
  if (GREEK_LETTERS.has(command) || GREEK_LETTERS.has(base)) return 'Greek'
  if (mathClass === 'mathrel') {
    return /arrow|harpoon|mapsto/i.test(command) ? 'Arrows' : 'Relations'
  }
  if (mathClass === 'mathbin' || mathClass === 'mathop') return 'Operators'
  return 'Misc'
}

const unicode = parseUnicodeTable(read('unicode-math-table.tex'))

/**
 * unicode-math names letter-like symbols by style (`\mupalpha`, `\mitalpha`),
 * so plain LaTeX Greek commands fall back to the upright, then italic, form.
 */
const lookup = command =>
  unicode.get(command) ??
  unicode.get(`mup${command}`) ??
  unicode.get(`mit${command}`)

const symbols = []
const seen = new Set()
for (const [file, pkg] of [
  ['fontmath.ltx', null],
  ['amssymb.sty', 'amssymb'],
]) {
  for (const { command, mathClass } of parseDeclarations(read(file))) {
    if (seen.has(command)) continue
    const mapped = lookup(command)
    if (!mapped) continue
    seen.add(command)
    symbols.push({
      command: `\\${command}`,
      character: String.fromCodePoint(mapped.codepoint),
      codepoint: `U+${mapped.codepoint.toString(16).toUpperCase().padStart(4, '0')}`,
      name: mapped.name,
      category: category(command, mathClass),
      package: pkg,
    })
  }
}

writeFileSync(outFile, `${JSON.stringify(symbols, null, 2)}\n`)
const counts = Object.groupBy(symbols, symbol => symbol.category)
console.log(
  `Wrote ${symbols.length} symbols to ${path.relative(process.cwd(), outFile)}:`,
  Object.fromEntries(
    Object.entries(counts).map(([name, list]) => [name, list.length])
  )
)
