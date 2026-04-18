import type { ReactNode } from 'react'

type RootLayoutProps = Readonly<{ children: ReactNode }>

export function RootLayout({ children }: RootLayoutProps): React.JSX.Element {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:bg-white focus:px-3 focus:py-2 focus:rounded focus:shadow"
      >
        Skip to main content
      </a>
      <header className="border-b border-gray-200 bg-white px-6 py-3">
        <div className="flex items-baseline gap-4">
          <h1 className="text-base font-semibold">Workflow Control Center</h1>
          <nav aria-label="Primary" className="flex gap-4 text-sm">
            <a href="/">Sessions</a>
            <a href="/analytics">Analytics</a>
          </nav>
        </div>
      </header>
      <main id="main-content" className="p-6">
        {children}
      </main>
    </div>
  )
}
