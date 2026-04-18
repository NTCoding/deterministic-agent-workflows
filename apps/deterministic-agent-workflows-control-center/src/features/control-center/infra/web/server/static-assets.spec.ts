import {
  mkdirSync, writeFileSync, rmSync 
} from 'node:fs'
import { join } from 'node:path'
import {
  describe, it, expect, beforeEach, afterEach 
} from 'vitest'
import { createStaticFileServer } from './static-assets'
import {
  createMockResponse, createSafeTempDir 
} from './http-test-fixtures'

describe('createStaticFileServer', () => {
  const testDir = createSafeTempDir('wcc-test-static-')

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true })
    writeFileSync(join(testDir, 'index.html'), '<html>test</html>')
    writeFileSync(join(testDir, 'styles.css'), 'body {}')
    writeFileSync(join(testDir, 'app'), 'console.log("hi")')
    writeFileSync(join(testDir, 'data.bin'), Buffer.from([0x00, 0x01]))
  })

  afterEach(() => {
    rmSync(testDir, {
      recursive: true,
      force: true 
    })
  })

  it('serves index.html for root path', () => {
    const server = createStaticFileServer(testDir)
    const response = createMockResponse()
    const served = server.serve('/', response.res)
    expect(served).toBe(true)
    expect(response.written.statusCode).toBe(200)
    expect(response.written.headers['Content-Type']).toBe('text/html')
  })

  it('serves CSS files', () => {
    const server = createStaticFileServer(testDir)
    const response = createMockResponse()
    server.serve('/styles.css', response.res)
    expect(response.written.headers['Content-Type']).toBe('text/css')
  })

  it('serves JS files', () => {
    const server = createStaticFileServer(testDir)
    const response = createMockResponse()
    server.serve('/app', response.res)
    expect(response.written.headers['Content-Type']).toBe('application/javascript')
  })

  it('returns false for non-existent files', () => {
    const server = createStaticFileServer(testDir)
    expect(server.serve('/nonexistent.txt', createMockResponse().res)).toBe(false)
  })

  it('strips path traversal attempts', () => {
    const server = createStaticFileServer(testDir)
    expect(server.serve('/../../../etc/passwd', createMockResponse().res)).toBe(false)
  })

  it('serves index.html for empty path', () => {
    const server = createStaticFileServer(testDir)
    const response = createMockResponse()
    const served = server.serve('', response.res)
    expect(served).toBe(true)
  })

  it('falls back to index.html for extensionless paths (SPA deep links)', () => {
    const server = createStaticFileServer(testDir)
    const response = createMockResponse()
    const served = server.serve('/session/abc-123', response.res)
    expect(served).toBe(true)
    expect(response.written.headers['Content-Type']).toBe('text/html')
  })

  it('uses application/octet-stream for unknown extensions', () => {
    const server = createStaticFileServer(testDir)
    const response = createMockResponse()
    server.serve('/data.bin', response.res)
    expect(response.written.headers['Content-Type']).toBe('application/octet-stream')
  })
})
