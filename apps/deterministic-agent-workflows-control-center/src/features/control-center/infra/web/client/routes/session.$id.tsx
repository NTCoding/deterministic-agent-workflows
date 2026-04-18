import { createFileRoute } from '@tanstack/react-router'
import { SessionDetail } from '../features/sessions/session-detail'

function SessionDetailRoute(): React.JSX.Element {
  const { id } = Route.useParams()
  return <SessionDetail sessionId={id} />
}

export const Route = createFileRoute('/session/$id')({ component: SessionDetailRoute })
