import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

const INVALIDATED_EVENT_TYPES: readonly string[] = [
  'event-appended',
  'reflection-appended',
  'session-updated',
]

/** @riviere-role web-tbc */
export function useSSE(sessionId: string): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    const source = new EventSource(`/events?session=${sessionId}`)
    const listeners: readonly {
      type: string;
      handler: (ev: MessageEvent) => void 
    }[] =
      INVALIDATED_EVENT_TYPES.map((type) => ({
        type,
        handler: () => {
          void queryClient.invalidateQueries({ queryKey: ['session', sessionId] })
        },
      }))

    for (const {
      type, handler 
    } of listeners) {
      source.addEventListener(type, handler)
    }

    return () => {
      for (const {
        type, handler 
      } of listeners) {
        source.removeEventListener(type, handler)
      }
      source.close()
    }
  }, [queryClient, sessionId])
}
