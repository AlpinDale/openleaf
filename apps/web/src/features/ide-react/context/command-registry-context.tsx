// Adapted from Overleaf services/web/frontend/js/features/ide-react/context/command-registry-context.tsx (AGPL-3.0).
// OpenLeaf keeps the same API but backs it with a zustand store, so the
// top-bar menu bar and ported toolbar code share one registry without a provider.
import type { ReactNode } from 'react'
import { create } from 'zustand'
import { isMac } from '@/shared/utils/os'

type CommandInvocationContext = {
  location?: string
}

export type Command = {
  label: string
  // Optional label for the command when it appears in a menu. If not provided, `label` will be used.
  menuLabel?: string
  id: string
  handler?: (context: CommandInvocationContext) => void
  href?: string
  disabled?: boolean
  leadingIcon?: ReactNode
}

export type Shortcut = { key: string }

export type Shortcuts = Record<string, Shortcut[]>

type CommandRegistry = {
  registry: Map<string, Command>
  register: (...elements: Command[]) => void
  unregister: (...id: string[]) => void
  shortcuts: Shortcuts
}

/** Modifiers of the layout shortcuts (`Ctrl-<arrow>` with these). */
const LAYOUT_MODIFIERS = isMac ? 'Ctrl-Meta' : 'Ctrl-Alt'

/** Named keys a shortcut may end with, and how menus show them. */
const NAMED_KEYS: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Enter: isMac ? '↩' : 'Enter',
}

// NOTE: This is where we'd add functionality for customising shortcuts.
const shortcuts: Shortcuts = {
  cut: [{ key: 'Mod-x' }],
  copy: [{ key: 'Mod-c' }],
  paste: [{ key: 'Mod-v' }],
  'paste-special': [{ key: 'Mod-Shift-V' }],
  'toggle-track-changes': [{ key: 'Mod-Shift-A' }],
  undo: [{ key: 'Mod-z' }],
  redo: [{ key: 'Mod-y' }, { key: 'Mod-Shift-Z' }],
  find: [{ key: 'Mod-f' }],
  'select-all': [{ key: 'Mod-a' }],
  'insert-comment': [{ key: 'Mod-Shift-C' }],
  'format-bold': [{ key: 'Mod-b' }],
  'format-italics': [{ key: 'Mod-i' }],
  compile: [{ key: 'Mod-Enter' }, { key: 'Mod-s' }],
  'project-search': [{ key: 'Mod-Shift-F' }],
  'toggle-review-panel': [{ key: 'Mod-j' }],
  'command-palette': [{ key: 'Mod-p' }],
  'change-layout-focus-mode': [{ key: 'Mod-Shift-M' }],
  // Overleaf's layout shortcuts: ⌃⌘+arrow on macOS, Ctrl+Alt+arrow elsewhere
  'change-layout-side-by-side': [{ key: `${LAYOUT_MODIFIERS}-ArrowDown` }],
  'change-layout-editor-only': [{ key: `${LAYOUT_MODIFIERS}-ArrowLeft` }],
  'change-layout-pdf-only': [{ key: `${LAYOUT_MODIFIERS}-ArrowRight` }],
  'change-layout-detached-pdf': [{ key: `${LAYOUT_MODIFIERS}-ArrowUp` }],
}

export const useCommandRegistryStore = create<CommandRegistry>(set => ({
  registry: new Map(),
  register: (...elements) =>
    set(state => ({
      registry: new Map([
        ...state.registry,
        ...elements.map(element => [element.id, element] as const),
      ]),
    })),
  unregister: (...ids) =>
    set(state => ({
      registry: new Map(
        [...state.registry].filter(([key]) => !ids.includes(key))
      ),
    })),
  shortcuts,
}))

/** Kept for ported code that renders it; the registry is a global store. */
export function CommandRegistryProvider({
  children,
}: {
  children?: ReactNode
}) {
  return <>{children}</>
}

export const useCommandRegistry = (): CommandRegistry =>
  useCommandRegistryStore()

function parseShortcut(shortcut: Shortcut) {
  // Based on KeyBinding type of CodeMirror 6
  let alt = false
  let ctrl = false
  let shift = false
  let meta = false

  let character = null
  // isMac ? shortcut.mac : shortcut.key etc.
  const shortcutString = shortcut.key ?? ''
  const keys = shortcutString.split(/-(?!$)/) ?? []

  for (let i = 0; i < keys.length; i++) {
    const isLast = i === keys.length - 1
    const key = keys[i]
    if (!key) {
      throw new Error(`Empty key in shortcut: ${shortcutString}`)
    }
    if (key === 'Alt' || (!isLast && key === 'a')) {
      alt = true
    } else if (
      key === 'Ctrl' ||
      key === 'Control' ||
      (!isLast && key === 'c')
    ) {
      ctrl = true
    } else if (key === 'Shift' || (!isLast && key === 's')) {
      shift = true
    } else if (key === 'Meta' || key === 'Cmd' || (!isLast && key === 'm')) {
      meta = true
    } else if (key === 'Mod') {
      if (isMac) {
        meta = true
      } else {
        ctrl = true
      }
    } else {
      if (key === 'Space') {
        character = ' '
      }
      if (!isLast) {
        throw new Error(
          `Character key must be last in shortcut: ${shortcutString}`
        )
      }
      if (character) {
        throw new Error(`Multiple characters in shortcut: ${shortcutString}`)
      }
      if (key in NAMED_KEYS) {
        character = NAMED_KEYS[key]
      } else if (key.length !== 1) {
        throw new Error(`Invalid key '${key}' in shortcut: ${shortcutString}`)
      } else {
        character = key
      }
    }
  }
  if (!character) {
    throw new Error(`No character in shortcut: ${shortcutString}`)
  }

  return {
    alt,
    ctrl,
    shift,
    meta,
    character,
  }
}

export const formatShortcut = (shortcut: Shortcut): string => {
  const { alt, ctrl, shift, meta, character } = parseShortcut(shortcut)

  if (isMac) {
    return [
      ctrl ? '⌃' : '',
      alt ? '⌥' : '',
      shift ? '⇧' : '',
      meta ? '⌘' : '',
      character.toUpperCase(),
    ].join('')
  }

  return [
    ctrl ? 'Ctrl' : '',
    shift ? 'Shift' : '',
    meta ? 'Meta' : '',
    alt ? 'Alt' : '',
    character.toUpperCase(),
  ]
    .filter(Boolean)
    .join(' ')
}
