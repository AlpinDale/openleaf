import {
  cloneElement,
  Fragment,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react'
import en from './en.json'

type Vars = Record<string, unknown>

const messages: Record<string, string> = en
const defaultVariables: Vars = { appName: 'OpenLeaf' }

// Overleaf's locale strings use `__var__` (and `__varHTML__` for unescaped
// values); OpenLeaf strings use i18next's `{{var}}`. Both are supported.
const INTERPOLATION =
  /__([a-zA-Z0-9_]+?)(?:HTML)?__|\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g

function resolveKey(key: string, vars?: Vars): string | undefined {
  const count = vars?.count
  if (typeof count === 'number') {
    const plural = count === 1 ? `${key}_one` : `${key}_other`
    if (plural in messages) return messages[plural]
    if (count !== 1 && `${key}_plural` in messages) {
      return messages[`${key}_plural`]
    }
  }
  return messages[key]
}

export function t(key: string, vars?: Vars): string {
  const template = resolveKey(key, vars)
  if (template === undefined) return key
  return template.replace(INTERPOLATION, (match, a, b) => {
    const name = a ?? b
    const value = vars?.[name] ?? defaultVariables[name]
    return value === undefined ? match : String(value)
  })
}

export type TFunction = typeof t

const translation = { t }

export function useTranslation() {
  return translation
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
  '&nbsp;': '\u00a0',
}

type Components =
  | ReactElement[]
  | Record<string, ReactElement>
  | readonly ReactElement[]

type Token =
  | { type: 'text'; value: string }
  | { type: 'open'; name: string }
  | { type: 'close'; name: string }
  | { type: 'self'; name: string }

const TAG = /<(\/)?([a-zA-Z0-9_-]+)\s*(\/)?>/g

function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let last = 0
  for (const m of text.matchAll(TAG)) {
    if (m.index > last) {
      tokens.push({ type: 'text', value: text.slice(last, m.index) })
    }
    const name = m[2]
    if (m[1]) tokens.push({ type: 'close', name })
    else if (m[3]) tokens.push({ type: 'self', name })
    else tokens.push({ type: 'open', name })
    last = m.index + m[0].length
  }
  if (last < text.length) tokens.push({ type: 'text', value: text.slice(last) })
  return tokens
}

function render(
  text: string,
  components: Components | undefined,
  shouldUnescape: boolean
): ReactNode[] {
  const lookup = (name: string): ReactElement | undefined => {
    if (!components) return undefined
    if (Array.isArray(components)) {
      return /^\d+$/.test(name) ? components[Number(name)] : undefined
    }
    return (components as Record<string, ReactElement>)[name]
  }
  const ENTITY = /&(?:amp|lt|gt|quot|#39|#x27|nbsp);/g

  const tokens = tokenize(text)
  let pos = 0
  let key = 0

  const build = (closing?: string): ReactNode[] => {
    const out: ReactNode[] = []
    while (pos < tokens.length) {
      const token = tokens[pos++]
      if (token.type === 'text') {
        out.push(
          shouldUnescape
            ? token.value.replace(ENTITY, m => ENTITIES[m])
            : token.value
        )
      } else if (token.type === 'close') {
        if (token.name === closing) return out
        out.push(`</${token.name}>`)
      } else if (token.type === 'self') {
        const element = lookup(token.name)
        out.push(
          element ? cloneElement(element, { key: key++ }) : `<${token.name}/>`
        )
      } else {
        const element = lookup(token.name)
        const children = build(token.name)
        if (element && isValidElement(element)) {
          out.push(
            cloneElement(
              element,
              { key: key++ },
              ...(children.length ? children : [])
            )
          )
        } else {
          out.push(
            <Fragment key={key++}>
              {`<${token.name}>`}
              {children}
              {`</${token.name}>`}
            </Fragment>
          )
        }
      }
    }
    return out
  }

  return build()
}

type TransProps = {
  i18nKey: string
  values?: Vars
  components?: Components
  shouldUnescape?: boolean
  tOptions?: Vars
  count?: number
  parent?: unknown
  defaults?: string
}

export function Trans({
  i18nKey,
  values,
  components,
  shouldUnescape = false,
  tOptions,
  count,
}: TransProps) {
  const vars: Vars = { ...tOptions, ...values }
  if (count !== undefined) vars.count = count
  return <>{render(t(i18nKey, vars), components, shouldUnescape)}</>
}
