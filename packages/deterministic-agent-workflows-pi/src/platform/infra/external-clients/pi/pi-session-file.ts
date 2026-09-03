import { readFileSync } from 'node:fs'
import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import { PiSessionFileError } from './pi-session-file-error'

const MAX_ENTRY_BYTES = 1024 * 1024

export const PI_WORKFLOW_MARKER_CUSTOM_TYPE = 'deterministic-agent-workflow'

/** @riviere-role external-client-model */
export type PiSessionMetadata = {
  readonly id: string
  readonly hasWorkflowMarker: boolean
}

function parseEntry(entryText: string, filePath: string, lineNumber: number): Record<string, unknown> {
  if (Buffer.byteLength(entryText) > MAX_ENTRY_BYTES) {
    throw new PiSessionFileError(`Pi session entry at line ${lineNumber} exceeds ${MAX_ENTRY_BYTES} bytes: ${filePath}`)
  }
  if (entryText.trim().length === 0) {
    const detail = lineNumber === 1 ? 'an empty header' : `an empty entry at line ${lineNumber}`
    throw new PiSessionFileError(`Pi session file has ${detail}: ${filePath}`)
  }
  try {
    const entry: unknown = JSON.parse(entryText)
    if (typeof entry !== 'object' || entry === null || !('type' in entry) || typeof entry.type !== 'string') {
      throw new PiSessionFileError(`Pi session file has an invalid entry at line ${lineNumber}: ${filePath}`)
    }
    return entry
  } catch (error: unknown) {
    if (error instanceof PiSessionFileError) throw error
    throw new PiSessionFileError(`Cannot parse Pi session entry at line ${lineNumber}: ${filePath}`, { cause: error })
  }
}

function readEntries(filePath: string): readonly Record<string, unknown>[] {
  const content = readFileSync(filePath, 'utf8')
  const serializedEntries = content.endsWith('\n') ? content.slice(0, -1).split('\n') : content.split('\n')
  return serializedEntries.map((entry, index) => parseEntry(entry, filePath, index + 1))
}

function requireSessionId(header: Record<string, unknown>, filePath: string): string {
  if (header.type !== 'session') throw new PiSessionFileError(`Pi session file does not begin with a session header: ${filePath}`)
  if (typeof header.id !== 'string' || header.id.trim().length === 0) {
    throw new PiSessionFileError(`Pi session header has no valid session UUID: ${filePath}`)
  }
  return header.id
}

function isWorkflowMarker(entry: Record<string, unknown>): boolean {
  return entry.type === 'custom_message' && entry.customType === PI_WORKFLOW_MARKER_CUSTOM_TYPE
}

/** @riviere-role external-client-service */
export function hasPiWorkflowMarker(entries: readonly SessionEntry[]): boolean {
  return entries.some((entry) => entry.type === 'custom_message' && entry.customType === PI_WORKFLOW_MARKER_CUSTOM_TYPE)
}

/** @riviere-role external-client-service */
export function readPiSessionMetadata(filePath: string): PiSessionMetadata {
  try {
    const [header, ...entries] = readEntries(filePath)
    return {
      id: requireSessionId(header, filePath),
      hasWorkflowMarker: entries.some(isWorkflowMarker),
    }
  } catch (error: unknown) {
    if (error instanceof PiSessionFileError) throw error
    throw new PiSessionFileError(`Cannot read Pi session file: ${filePath}`, { cause: error })
  }
}

/** @riviere-role external-client-service */
export function readPiSessionId(filePath: string): string {
  return readPiSessionMetadata(filePath).id
}
