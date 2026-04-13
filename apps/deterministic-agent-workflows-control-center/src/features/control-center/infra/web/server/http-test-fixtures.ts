import {
  IncomingMessage, ServerResponse, type OutgoingHttpHeaders 
} from 'node:http'
import { Socket } from 'node:net'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ZodType } from 'zod'

/** @riviere-role web-tbc */
export type MockResponse = {
  readonly res: ServerResponse
  readonly written: {
    statusCode: number
    headers: OutgoingHttpHeaders
    body: string
  }
}

/** @riviere-role web-tbc */
export class TestInvariantError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TestInvariantError'
  }
}

/** @riviere-role web-tbc */
export function createMockRequest(method = 'GET', url = '/'): IncomingMessage {
  const req = new IncomingMessage(new Socket())
  req.method = method
  req.url = url
  return req
}

/** @riviere-role web-tbc */
export function createMockResponse(): MockResponse {
  const written = {
    statusCode: 0,
    headers: {},
    body: '',
  }

  const res = new ServerResponse(createMockRequest())
  const writeHead: typeof res.writeHead = (statusCode, statusMessageOrHeaders?, headers?) => {
    written.statusCode = statusCode
    const resolvedHeaders =
      typeof statusMessageOrHeaders === 'string'
        ? headers
        : statusMessageOrHeaders
    if (resolvedHeaders !== undefined) {
      Object.assign(written.headers, resolvedHeaders)
    }
    return res
  }
  res.writeHead = writeHead
  res.end = (chunk) => {
    if (typeof chunk === 'string') {
      written.body = chunk
    } else if (Buffer.isBuffer(chunk)) {
      written.body = chunk.toString('utf8')
    }
    return res
  }

  return {
    res,
    written,
  }
}

/** @riviere-role web-tbc */
export function parseJsonBody<T>(body: string, schema: ZodType<T>): T {
  const parsed: unknown = JSON.parse(body)
  return schema.parse(parsed)
}

/** @riviere-role web-tbc */
export function createSafeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}
