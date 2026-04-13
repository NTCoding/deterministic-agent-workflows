/** @riviere-role external-client-model */
export type TranscriptMessage = {
  readonly id: string
  readonly textContent: string | undefined
}

/** @riviere-role external-client-model */
export interface TranscriptReader {readMessages(transcriptPath: string): readonly TranscriptMessage[]}
