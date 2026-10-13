// Adds every translation key referenced under src/ that is missing from
// src/i18n/en.json, copying the string from Overleaf's locales/en.json.
// Usage: node scripts/sync-i18n-keys.mjs <path to overleaf locales/en.json>
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const enPath = path.join(root, 'src/i18n/en.json')
const sourcePath = process.argv[2]
if (!sourcePath) {
  console.error(
    'Usage: node scripts/sync-i18n-keys.mjs <Overleaf locales/en.json>'
  )
  process.exit(1)
}

const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'))
const en = JSON.parse(fs.readFileSync(enPath, 'utf8'))

const patterns = [
  /\bt\(\s*['"`]([a-zA-Z0-9_]+)['"`]/g,
  /i18nKey=\{?\s*['"]([a-zA-Z0-9_]+)['"]/g,
]

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (/\.(tsx?|jsx?|mjs)$/.test(entry.name)) yield full
  }
}

const missing = new Set()
for (const file of walk(path.join(root, 'src'))) {
  const text = fs.readFileSync(file, 'utf8')
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const key = m[1]
      for (const k of [key, `${key}_plural`]) {
        if (!(k in en) && k in source) en[k] = source[k]
      }
      if (!(key in en)) missing.add(key)
    }
  }
}

const sorted = Object.fromEntries(
  Object.keys(en)
    .sort()
    .map(k => [k, en[k]])
)
fs.writeFileSync(enPath, `${JSON.stringify(sorted, null, 2)}\n`)
if (missing.size) {
  console.warn(`Keys with no source string: ${[...missing].join(', ')}`)
}
