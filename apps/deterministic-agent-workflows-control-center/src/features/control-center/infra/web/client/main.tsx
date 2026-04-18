import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import {
  RouterProvider, createRouter 
} from '@tanstack/react-router'
import {
  QueryClient, QueryClientProvider 
} from '@tanstack/react-query'
import { routeTree } from './routeTree.gen'
import './styles.css'

const router = createRouter({ routeTree })
const queryClient = new QueryClient()

declare module '@tanstack/react-router' {
  interface Register {router: typeof router}
}

const container = document.getElementById('app')
if (!container) {
  throw new TypeError('Expected #app root element. Found none.')
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
