import { useEffect } from 'react'

export default function useEventListener<T extends Event = CustomEvent>(
  eventName: string,
  listener: (event: T) => void
) {
  useEffect(() => {
    const handler = listener as EventListener
    window.addEventListener(eventName, handler)
    return () => window.removeEventListener(eventName, handler)
  }, [eventName, listener])
}
