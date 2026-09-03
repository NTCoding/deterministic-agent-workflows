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

function hasIndirectPowerShellInvocation(command: string): boolean {
  const expressionCommand = /(?:^|[\s;&|('"])(?:invoke-expression|iex)(?=$|[\s;&|)'"])/i
  const hasCallOperator = command.replaceAll('&&', '').includes('&')
  const dotSourceOperator = /(?:^|[\s;&|({])\.(?=\s|<#)/
  return expressionCommand.test(command)
    || command.includes('$(')
    || hasCallOperator
    || dotSourceOperator.test(command)
}

function normalizeCommand(command: string, caseInsensitive: boolean): string {
  const withoutPowerShellEscapes = caseInsensitive ? command.replaceAll('`', '') : command
  return caseInsensitive ? withoutPowerShellEscapes.toLowerCase() : withoutPowerShellEscapes
}

function isCommandExempt(command: string, exemptions: readonly string[], caseInsensitive: boolean): boolean {
  const comparableCommand = caseInsensitive ? command.toLowerCase() : command
  return exemptions.some((exemption) => (caseInsensitive ? exemption.toLowerCase() : exemption) === comparableCommand)
}

/** @riviere-role domain-service */
export function checkBashCommand(
  command: string,
  forbidden: BashForbiddenConfig,
  stateExemptions: readonly string[],
  caseInsensitive = false,
): PreconditionResult {
  const commandForMatching = normalizeCommand(command, caseInsensitive)
  const forbiddenFlag = (forbidden.flags ?? []).find((flag) => commandForMatching.includes(normalizeCommand(flag, caseInsensitive)))
  if (forbiddenFlag !== undefined) {
    return fail(`Forbidden flag '${forbiddenFlag}' in command.`)
  }

  const restrictedCommands = forbidden.commands.filter((forbiddenCommand) => !isCommandExempt(forbiddenCommand, stateExemptions, caseInsensitive))
  const forbiddenCommand = restrictedCommands.find((candidate) => buildCommandPattern(candidate, caseInsensitive).test(commandForMatching))
  if (forbiddenCommand !== undefined) {
    return fail(`Forbidden command '${forbiddenCommand}' in command.`)
  }

  if (caseInsensitive && restrictedCommands.length > 0 && hasIndirectPowerShellInvocation(commandForMatching)) {
    return fail('Indirect PowerShell invocation is forbidden while command restrictions are active.')
  }

  return pass()
}
