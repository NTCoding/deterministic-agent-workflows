import type { ZodType } from 'zod'

/** @riviere-role web-tbc */
export class ApiRequestFailedError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`API request failed with status ${status}`)
    this.name = 'ApiRequestFailedError'
    this.status = status
  }
}

/** @riviere-role web-tbc */
export async function fetchParsedJson<T>(path: string, schema: ZodType<T>): Promise<T> {
  const response = await fetch(path)
  if (!response.ok) {
    throw new ApiRequestFailedError(response.status)
  }
  const body: unknown = await response.json()
  return schema.parse(body)
}
