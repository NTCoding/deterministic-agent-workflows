import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

class NoopEventSource {
  readonly url: string
  constructor(url: string) { this.url = url }
  addEventListener(): void {
    return
  }
  removeEventListener(): void {
    return
  }
  close(): void {
    return
  }
}

if (typeof globalThis.EventSource === 'undefined') {
  Object.defineProperty(globalThis, 'EventSource', {
    value: NoopEventSource,
    writable: true,
    configurable: true,
  })
}

if (typeof globalThis.window !== 'undefined') {
  Object.defineProperty(window, 'scrollTo', {
    value: () => undefined,
    writable: true,
    configurable: true,
  })
}

afterEach(() => {
  cleanup()
})
