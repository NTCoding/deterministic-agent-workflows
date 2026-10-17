import { z } from 'zod'

/** @riviere-role value-object */
export const nonEmptyStringSchema = z.string().trim().min(1)

/** @riviere-role domain-service */
export function requireNonEmptyString(value: string, name: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) throw new TypeError(`${name} must be a non-empty string.`)
  return trimmed
}
