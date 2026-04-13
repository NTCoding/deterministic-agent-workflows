import {
  closeSync,
  openSync,
  readSync,
  statSync,
} from 'node:fs'
import type {
  TranscriptMessage,
  TranscriptReader,
} from '@nt-ai-lab/deterministic-agent-workflow-engine'
import { z } from 'zod'

const READ_TAIL_BYTES = 50_000

const textBlock = z.object({
  type: z.literal('text'),
  text: z.string(),
})
const otherBlock = z.object({ type: z.string() })
const contentBlock = z.union([textBlock, otherBlock])

const assistantEntrySchema = z.object({
  type: z.literal('message'),
  role: z.literal('assistant'),
  id: z.string(),
  content: z.array(contentBlock),
})

type AssistantEntry = z.infer<typeof assistantEntrySchema>

/** @riviere-role external-client-model */
export class ClaudeCodeTranscriptReader implements TranscriptReader {
  readMessages(transcriptPath: string): readonly TranscriptMessage[] {
    const tail = readFileTail(transcriptPath)
    return parseJsonlLines(tail)
  }
}

function readFileTail(filePath: string): string {
  const fileSize = statSync(filePath).size
  const offset = Math.max(0, fileSize - READ_TAIL_BYTES)
  const bytesToRead = fileSize - offset
  const buffer = Buffer.alloc(bytesToRead)
  const fd = openSync(filePath, 'r')
  readSync(fd, buffer, 0, bytesToRead, offset)
  closeSync(fd)
  return buffer.toString('utf-8')
}

function parseJsonlLines(content: string): readonly TranscriptMessage[] {
  return content
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => parseJsonlLine(line))
}

function parseJsonlLine(line: string): TranscriptMessage[] {
  const entry = tryParseEntry(line)
  if (entry === undefined) {
    return []
  }
  return [toTranscriptMessage(entry)]
}

function tryParseEntry(line: string): AssistantEntry | undefined {
  try {
    const result = assistantEntrySchema.safeParse(JSON.parse(line))
    if (result.success) {
      return result.data
    }
    return undefined
  } catch {
    return undefined
  }
}

function toTranscriptMessage(entry: AssistantEntry): TranscriptMessage {
  return {
    id: entry.id,
    textContent: extractFirstText(entry),
  }
}

function extractFirstText(entry: AssistantEntry): string | undefined {
  for (const block of entry.content) {
    const result = textBlock.safeParse(block)
    if (result.success) {
      return result.data.text
    }
  }
  return undefined
}
