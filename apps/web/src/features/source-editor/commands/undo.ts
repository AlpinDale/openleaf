import type { Command } from '@codemirror/view'
import { yUndoManagerKeymap } from 'y-codemirror.next'

/** Undo/redo go through the doc's Y.UndoManager (the yCollab keymap commands). */
const binding = (key: string): Command => {
  const run = yUndoManagerKeymap.find(item => item.key === key)?.run
  if (!run) throw new Error(`Missing y-codemirror binding ${key}`)
  return run
}

export const undo = binding('Mod-z')
export const redo = binding('Mod-y')
