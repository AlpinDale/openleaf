import '@/stylesheets/main-style.scss'
import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router'
import { queryClient } from '@/api/query-client'
import { GlobalToasts } from '@/features/ide-react/components/global-toasts'
import { router } from '@/router'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <GlobalToasts />
    </QueryClientProvider>
  </StrictMode>
)
