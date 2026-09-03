import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SessionEntry } from '@earendil-works/pi-coding-agent'
import {
  afterEach,
  describe,
  expect,
  it,
} from 'vitest'
import { PiSessionFileError } from './pi-session-file-error'
import {
  hasPiWorkflowMarker,
  PI_WORKFLOW_MARKER_CUSTOM_TYPE,
  readPiSessionId,
  readPiSessionMetadata,
} from './pi-session-file'

const testDirectories: string[] = []

function createTestDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'daw-pi-session-file-'))
  testDirectories.push(directory)
  return directory
}

function sessionFile(content: string): string {
  const directory = createTestDirectory()
  const filePath = join(directory, 'session.jsonl')
  writeFileSync(filePath, content)
  return filePath
}

afterEach(() => {
  for (const directory of testDirectories.splice(0)) rmSync(directory, {
    recursive: true,
    force: true,
  })
})

describe('readPiSessionId', () => {
  it('reads the UUID only from a valid first-line Pi session header', () => {
    const filePath = sessionFile(`${JSON.stringify({
      type: 'session',
      version: 3,
      id: 'session-uuid',
      cwd: '/repo',
    })}\n{"type":"message"}\n`)

    expect(readPiSessionId(filePath)).toBe('session-uuid')
    expect(readPiSessionMetadata(filePath)).toStrictEqual({
      id: 'session-uuid',
      hasWorkflowMarker: false,
    })
  })

  it('detects the deterministic workflow marker in files and active branches', () => {
    const filePath = sessionFile([
      JSON.stringify({
        type: 'session',
        id: 'session-uuid'
      }),
      JSON.stringify({
        type: 'custom_message',
        customType: 'other-extension'
      }),
      JSON.stringify({
        type: 'custom_message',
        customType: PI_WORKFLOW_MARKER_CUSTOM_TYPE
      }),
      '',
    ].join('\n'))
    const branch: readonly SessionEntry[] = [{
      type: 'custom_message',
      customType: PI_WORKFLOW_MARKER_CUSTOM_TYPE,
      content: 'Workflow instructions',
      display: true,
      id: 'marker-id',
      parentId: null,
      timestamp: '2026-09-03T12:00:00.000Z',
    }]

    expect(readPiSessionMetadata(filePath)).toStrictEqual({
      id: 'session-uuid',
      hasWorkflowMarker: true,
    })
    expect(hasPiWorkflowMarker(branch)).toBe(true)
    expect(hasPiWorkflowMarker([])).toBe(false)
  })

  it.each([
    ['', 'empty header'],
    ['not-json\n', 'Cannot parse'],
    ['{"type":"message","id":"message-id"}\n', 'does not begin with a session header'],
    ['{"type":"session","id":""}\n', 'has no valid session UUID'],
    ['{"type":"session","id":"session-id"}\nnot-json\n', 'Cannot parse'],
    ['{"type":"session","id":"session-id"}\n42\n', 'invalid entry'],
    ['{"type":"session","id":"session-id"}\n\n{"type":"message"}\n', 'empty entry'],
  ])('rejects unsafe header %s', (content, message) => {
    const filePath = sessionFile(content)

    expect(() => readPiSessionId(filePath)).toThrow(PiSessionFileError)
    expect(() => readPiSessionId(filePath)).toThrow(message)
  })

  it('rejects a header larger than the safety limit', () => {
    const filePath = sessionFile('x'.repeat(1024 * 1024 + 1))

    expect(() => readPiSessionId(filePath)).toThrow('Pi session entry at line 1 exceeds')
  })

  it('wraps filesystem read failures', () => {
    const filePath = join(createTestDirectory(), 'missing.jsonl')

    expect(() => readPiSessionId(filePath)).toThrow(PiSessionFileError)
    expect(() => readPiSessionId(filePath)).toThrow('Cannot read Pi session file')
  })
})
