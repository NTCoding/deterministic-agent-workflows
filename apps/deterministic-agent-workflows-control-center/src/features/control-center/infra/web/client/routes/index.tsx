import { createFileRoute } from '@tanstack/react-router'
import { SessionDashboard } from '../features/sessions/session-dashboard'

export const Route = createFileRoute('/')({ component: SessionDashboard })
