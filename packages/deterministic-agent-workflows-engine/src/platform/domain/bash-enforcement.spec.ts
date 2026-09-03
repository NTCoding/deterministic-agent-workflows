import {
  describe, expect, it,
} from 'vitest'
import { checkBashCommand } from './bash-enforcement'

describe('checkBashCommand', () => {
  it('blocks forbidden flags', () => {
    expect(checkBashCommand('git push --force', {
      commands: [],
      flags: ['--force'],
    }, [])).toStrictEqual({
      pass: false,
      reason: "Forbidden flag '--force' in command.",
    })
  })

  it.each([
    'rm build',
    'pwd &&rm build',
    'pwd ||rm build',
    'pwd;rm build',
    'pwd&rm build',
    'pwd|rm build',
    'rm;pwd',
    'rm&pwd',
    'rm|pwd',
    'rm-rf build',
  ])('blocks forbidden commands at shell boundaries: %s', (command) => {
    expect(checkBashCommand(command, { commands: ['rm'] }, [])).toStrictEqual({
      pass: false,
      reason: "Forbidden command 'rm' in command.",
    })
  })

  it('matches whitespace separated commands literally', () => {
    expect(checkBashCommand('run foo.bar now', { commands: ['foo.bar'] }, [])).toStrictEqual({
      pass: false,
      reason: "Forbidden command 'foo.bar' in command.",
    })
    expect(checkBashCommand('run fooXbar now', { commands: ['foo.bar'] }, [])).toStrictEqual({ pass: true })
  })

  it('keeps POSIX command matching and exemptions case sensitive', () => {
    expect(checkBashCommand('Remove-Item secret.txt', { commands: ['remove-item'] }, [])).toStrictEqual({ pass: true })
    expect(checkBashCommand('rm build', { commands: ['rm'] }, ['RM'])).toStrictEqual({
      pass: false,
      reason: "Forbidden command 'rm' in command.",
    })
    expect(checkBashCommand('rm build', { commands: ['rm'] }, ['rm'])).toStrictEqual({ pass: true })
  })

  it('matches PowerShell commands and exemptions without case sensitivity', () => {
    expect(checkBashCommand('remove-item secret.txt', { commands: ['Remove-Item'] }, [], true)).toStrictEqual({
      pass: false,
      reason: "Forbidden command 'Remove-Item' in command.",
    })
    expect(checkBashCommand('Get-Item secret.txt|Remove-Item', { commands: ['remove-item'] }, [], true)).toStrictEqual({
      pass: false,
      reason: "Forbidden command 'remove-item' in command.",
    })
    expect(checkBashCommand('remove-item secret.txt', { commands: ['Remove-Item'] }, ['REMOVE-ITEM'], true)).toStrictEqual({ pass: true })
  })

  it.each([
    "Invoke-Expression 'Remove-Item secret.txt'",
    'Invoke-Expression "Remove-Item secret.txt"',
    '$(Remove-Item secret.txt)',
    '& "Remove-Item" secret.txt',
  ])('blocks forbidden PowerShell commands in quoted and indirect expressions: %s', (command) => {
    expect(checkBashCommand(command, { commands: ['Remove-Item'] }, [], true)).toStrictEqual({
      pass: false,
      reason: "Forbidden command 'Remove-Item' in command.",
    })
  })

  it('matches PowerShell flags without case sensitivity', () => {
    expect(checkBashCommand('Remove-Item secret.txt -force', {
      commands: [],
      flags: ['-Force'],
    }, [], true)).toStrictEqual({
      pass: false,
      reason: "Forbidden flag '-Force' in command.",
    })
  })

  it('allows commands when no flag or command is forbidden', () => {
    expect(checkBashCommand('pnpm test', { commands: ['rm'] }, [])).toStrictEqual({ pass: true })
  })
})
