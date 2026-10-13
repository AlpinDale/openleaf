import { useCallback, useEffect, useRef, useState } from 'react'

export default function useDropdown(defaultOpen = false) {
  const [open, setOpen] = useState(defaultOpen)

  // the dropdown node, for the "click outside" listener
  const ref = useRef<HTMLElement | null>(null)

  const handleRef = useCallback((node: HTMLElement | null) => {
    if (node) ref.current = node
  }, [])

  // prevent a click on the dropdown toggle propagating to the original handler
  const handleClick = useCallback((event: any) => {
    event.stopPropagation()
  }, [])

  const handleToggle = useCallback((value: any) => {
    setOpen(Boolean(value))
  }, [])

  const handleDocumentClick = useCallback((event: MouseEvent) => {
    if (ref.current && !ref.current.contains(event.target as Node)) {
      setOpen(false)
    }
  }, [])

  useEffect(() => {
    if (open) document.addEventListener('mousedown', handleDocumentClick)
    return () => document.removeEventListener('mousedown', handleDocumentClick)
  }, [open, handleDocumentClick])

  return { ref: handleRef, onClick: handleClick, onToggle: handleToggle, open }
}
