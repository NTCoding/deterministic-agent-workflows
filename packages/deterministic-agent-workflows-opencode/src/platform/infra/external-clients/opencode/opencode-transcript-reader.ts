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

const partRowSchema = z.object({
  message_id: z.string(),
  part_data: z.string(),
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
    const textByMessage = new Map<string, string[]>()

    const rows = db
      .prepare(
        `SELECT m.id AS message_id, p.data AS part_data
         FROM message m
         JOIN part p ON p.message_id = m.id
         WHERE m.session_id = ? AND json_extract(m.data, '$.role') = 'assistant'
         ORDER BY m.time_created ASC, p.time_created ASC`,
      )
      .all(this.sessionId)

    for (const row of rows) {
      const parsedRow = partRowSchema.safeParse(row)
      if (!parsedRow.success) {
        continue
      }

      const textContent = this.parseTextPart(parsedRow.data.part_data)
      if (textContent === undefined) {
        continue
      }

      const existingParts = textByMessage.get(parsedRow.data.message_id) ?? []
      existingParts.push(textContent)
      textByMessage.set(parsedRow.data.message_id, existingParts)
    }

    return [...textByMessage.entries()].map(([id, parts]) => ({
      id,
      textContent: parts.join('\n'),
    }))
  }

  private parseTextPart(partData: string): string | undefined {
    const parsedData: unknown = JSON.parse(partData)
    const textPart = textPartSchema.safeParse(parsedData)
    if (!textPart.success) {
      return undefined
    }

    const textContent = textPart.data.text.trim()
    if (textContent.length === 0) {
      return undefined
    }

    return textContent
  }
}
