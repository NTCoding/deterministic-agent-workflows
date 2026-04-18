import { createFileRoute } from '@tanstack/react-router'
import { AnalyticsOverview } from '../features/analytics/analytics-overview'

function AnalyticsRoute(): React.JSX.Element {
  return (
    <section className="p-6">
      <h1 className="mb-4 text-2xl font-semibold">Analytics</h1>
      <AnalyticsOverview />
    </section>
  )
}

export const Route = createFileRoute('/analytics')({ component: AnalyticsRoute })
