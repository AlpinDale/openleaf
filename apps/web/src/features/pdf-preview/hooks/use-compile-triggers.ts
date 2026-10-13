import type React from 'react'

/** Whether a keydown is one of the compile shortcuts (Mod-s, Mod-Enter, Ctrl-.). */
export const startCompileKeypress = (
  event: KeyboardEvent | React.KeyboardEvent<Element>
) => {
  if (event.shiftKey || event.altKey) {
    return false
  }

  if (event.ctrlKey) {
    // Ctrl+s / Ctrl+Enter / Ctrl+.
    if (event.key === 's' || event.key === 'Enter' || event.key === '.') {
      return true
    }

    // Ctrl+s with Caps-Lock on
    if (event.key === 'S') {
      return true
    }
  } else if (event.metaKey) {
    // Cmd+s / Cmd+Enter
    if (event.key === 's' || event.key === 'Enter') {
      return true
    }

    // Cmd+s with Caps-Lock on
    if (event.key === 'S') {
      return true
    }
  }
  return false
}
