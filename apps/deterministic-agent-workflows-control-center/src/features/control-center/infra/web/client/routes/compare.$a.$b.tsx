import { createFileRoute } from '@tanstack/react-router'
import { SessionCompare } from '../features/comparison/session-compare'

function SessionCompareRoute(): React.JSX.Element {
  const {
    a, b
  } = Route.useParams()
  return (
    <section className="p-6">
      <h1 className="mb-4 text-2xl font-semibold">Compare</h1>
      <SessionCompare idA={a} idB={b} />
    </section>
  )
}

export const Route = createFileRoute('/compare/$a/$b')({ component: SessionCompareRoute })
