import { execFileSync } from 'node:child_process'

const httpsRemotePattern = /github\.com\/([^/]+\/[^/.]+?)(?:\.git)?$/
const sshRemotePattern = /github\.com:([^/]+\/[^/.]+?)(?:\.git)?$/

/** @riviere-role external-client-service */
export function getRepositoryName(cwd: string): string | undefined {
  try {
    const url = execFileSync('/usr/bin/git', ['remote', 'get-url', 'origin'], {
      encoding: 'utf-8',
      cwd,
      env: {
        ...Object.fromEntries(Object.entries(process.env).filter(([key]) =>
          key !== 'GIT_CONFIG' && !key.startsWith('GIT_CONFIG_'))),
        GIT_DIR: undefined,
        GIT_WORK_TREE: undefined,
        GIT_COMMON_DIR: undefined,
        GIT_INDEX_FILE: undefined,
      },
    }).trim()
    const httpsMatch = httpsRemotePattern.exec(url)
    if (httpsMatch?.[1] !== undefined) return httpsMatch[1]
    const sshMatch = sshRemotePattern.exec(url)
    if (sshMatch?.[1] !== undefined) return sshMatch[1]
    return undefined
  } catch {
    return undefined
  }
}
