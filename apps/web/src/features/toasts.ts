import type { ReactNode } from 'react'
import { create } from 'zustand'
import type { NotificationType } from '@/shared/components/notification'

export type ToastOptions = {
  type: NotificationType
  content: ReactNode
  title?: string
  /** Milliseconds before the toast hides itself; `null` keeps it until dismissed. */
  delay?: number | null
}

export type Toast = ToastOptions & { id: number }

export const useToastStore = create<{ toasts: Toast[] }>(() => ({
  toasts: [],
}))

let nextId = 1

export function showToast(options: ToastOptions): number {
  const id = nextId++
  useToastStore.setState(state => ({
    toasts: [...state.toasts, { ...options, id }],
  }))
  return id
}

export function dismissToast(id: number) {
  useToastStore.setState(state => ({
    toasts: state.toasts.filter(toast => toast.id !== id),
  }))
}
