import type { McpServer } from '@agentclientprotocol/sdk'

/** @riviere-role value-object */
export interface AcpReviewAgentClientConfig {
  readonly command: string
  readonly args?: readonly string[]
  readonly environment?: Readonly<Record<string, string>>
  readonly mcpServers?: readonly McpServer[]
  readonly timeoutMs: number
  readonly cancellationGraceMs: number
}
