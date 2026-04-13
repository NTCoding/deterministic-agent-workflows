import type {
  TranscriptMessage,
  TranscriptReader,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import {
  openSqliteDatabase,
  type SqliteDatabase,
} from '@nt-ai-lab/deterministic-agent-workflow-event-store'
import { z } from 'zod'

const textPartSchema = z.object({
  type: z.literal('text'),
  text: z.string() 
})

const messageDataSchema = z.object({ parts: z.array(z.unknown()) })

const messageRowSchema = z.object({
  id: z.string(),
  data: z.string(),
})

/** @riviere-role external-client-model */
export class OpenCodeTranscriptReader implements TranscriptReader {
  constructor(private readonly sessionId: string) {}

  readMessages(dbPath: string): readonly TranscriptMessage[] {
    try {
      const db: SqliteDatabase = openSqliteDatabase(dbPath, { readonly: true })
      try {
        return this.queryMessages(db)
      } finally {
        db.close()
      }
    } catch {
      return []
    }
  }

  private queryMessages(db: SqliteDatabase): readonly TranscriptMessage[] {
    return db
      .prepare(
        `SELECT id, data FROM message
         WHERE session_id = ? AND json_extract(data, '$.role') = 'assistant'
         ORDER BY time_created ASC`,
      )
      .all(this.sessionId)
      .flatMap((row) => this.parseRow(row))
  }

  private parseRow(row: unknown): TranscriptMessage[] {
    const rowResult = messageRowSchema.safeParse(row)
    if (!rowResult.success) {
      return []
    }
    const parsedData: unknown = JSON.parse(rowResult.data.data)
    const dataResult = messageDataSchema.safeParse(parsedData)
    if (!dataResult.success) {
      return []
    }
    return [{
      id: rowResult.data.id,
      textContent: extractFirstText(dataResult.data.parts),
    }]
  }
}

function extractFirstText(parts: readonly unknown[]): string | undefined {
  for (const part of parts) {
    const result = textPartSchema.safeParse(part)
    if (result.success) return result.data.text
  }
  return undefined
}
