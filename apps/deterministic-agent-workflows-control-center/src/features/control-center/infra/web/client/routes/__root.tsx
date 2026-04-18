import {
  createRootRoute, Outlet
} from '@tanstack/react-router'
import { RootLayout } from './-root-layout'

function RootComponent(): React.JSX.Element {
  return (
    <RootLayout>
      <Outlet />
    </RootLayout>
  )
}

function NotFoundComponent(): React.JSX.Element {
  return (
    <section role="alert" className="p-8">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 text-gray-600">
        The page you requested does not exist. Use the navigation to return to the dashboard.
      </p>
    </section>
  )
}

export const Route = createRootRoute({
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
})
