import { useEffect, useCallback } from "react";

interface ShortcutConfig {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
  handler: () => void;
  description: string;
}

const shortcuts: ShortcutConfig[] = [];

export function registerShortcut(config: ShortcutConfig) {
  shortcuts.push(config);
  return () => {
    const index = shortcuts.indexOf(config);
    if (index > -1) {
      shortcuts.splice(index, 1);
    }
  };
}

export function getShortcuts() {
  return shortcuts.map((s) => ({
    key: s.key,
    ctrl: s.ctrl,
    shift: s.shift,
    alt: s.alt,
    meta: s.meta,
    description: s.description,
  }));
}

export function useKeyboardShortcuts(localShortcuts: ShortcutConfig[] = []) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const allShortcuts = [...shortcuts, ...localShortcuts];

      for (const shortcut of allShortcuts) {
        const ctrlMatch = shortcut.ctrl
          ? e.ctrlKey || e.metaKey
          : !e.ctrlKey && !e.metaKey;
        const shiftMatch = shortcut.shift ? e.shiftKey : !e.shiftKey;
        const altMatch = shortcut.alt ? e.altKey : !e.altKey;

        if (
          e.key.toLowerCase() === shortcut.key.toLowerCase() &&
          ctrlMatch &&
          shiftMatch &&
          altMatch
        ) {
          e.preventDefault();
          shortcut.handler();
          break;
        }
      }
    },
    [localShortcuts],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}

export default useKeyboardShortcuts;
