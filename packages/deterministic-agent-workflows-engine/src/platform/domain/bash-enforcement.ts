import {
  fail, pass, type PreconditionResult 
} from './precondition-result'
import type { BashForbiddenConfig } from './workflow-registry'

function buildCommandPattern(command: string): RegExp {
  const parts = command.trim().split(/\s+/)
  const escapedParts = parts.map((part) => part.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const patternBody = escapedParts.join('\\s+')
  return new RegExp(`(?:^|\\s|&&|;)${patternBody}(?:\\s|$|-|;|&)`)
}

/** @riviere-role domain-service */
export function checkBashCommand(
  command: string,
  forbidden: BashForbiddenConfig,
  stateExemptions: readonly string[],
): PreconditionResult {
  for (const flag of forbidden.flags ?? []) {
    if (command.includes(flag)) {
      return fail(`Forbidden flag '${flag}' in command.`)
    }
  }

  for (const forbiddenCommand of forbidden.commands) {
    if (stateExemptions.includes(forbiddenCommand)) continue
    const pattern = buildCommandPattern(forbiddenCommand)
    if (pattern.test(command)) {
      return fail(`Forbidden command '${forbiddenCommand}' in command.`)
    }
  }

  return pass()
}
