import {
  fail, pass, type PreconditionResult 
} from './precondition-result'
import type { BashForbiddenConfig } from './workflow-registry'

function buildCommandPattern(command: string, caseInsensitive: boolean): RegExp {
  const parts = command.trim().split(/\s+/)
  const escapedParts = parts.map((part) => part.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const patternBody = escapedParts.join('\\s+')
  const leftBoundary = caseInsensitive ? '(?:^|\\s|&&|\\|\\||[;&|\'"(])' : '(?:^|\\s|&&|\\|\\||[;&|])'
  const rightBoundary = caseInsensitive ? '(?:\\s|$|-|[;&|\'"\\)])' : '(?:\\s|$|-|[;&|])'
  return new RegExp(`${leftBoundary}${patternBody}${rightBoundary}`, caseInsensitive ? 'i' : undefined)
}

/** @riviere-role domain-service */
export function checkBashCommand(
  command: string,
  forbidden: BashForbiddenConfig,
  stateExemptions: readonly string[],
  caseInsensitive = false,
): PreconditionResult {
  const comparableCommand = caseInsensitive ? command.toLowerCase() : command
  for (const flag of forbidden.flags ?? []) {
    const comparableFlag = caseInsensitive ? flag.toLowerCase() : flag
    if (comparableCommand.includes(comparableFlag)) {
      return fail(`Forbidden flag '${flag}' in command.`)
    }
  }

  for (const forbiddenCommand of forbidden.commands) {
    const isExempt = stateExemptions.some((exemption) => caseInsensitive
      ? exemption.toLowerCase() === forbiddenCommand.toLowerCase()
      : exemption === forbiddenCommand)
    if (isExempt) continue
    const pattern = buildCommandPattern(forbiddenCommand, caseInsensitive)
    if (pattern.test(command)) {
      return fail(`Forbidden command '${forbiddenCommand}' in command.`)
    }
  }

  return pass()
}
