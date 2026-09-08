/** @riviere-role external-client-model */
export interface DiffFileLines {
  readonly path: string
  readonly rightLines: ReadonlySet<number>
  readonly leftLines: ReadonlySet<number>
}

/** @riviere-role external-client-model */
export interface DiffLineIndex {
  readonly files: readonly DiffFileLines[]
  hasRightLine(path: string, line: number): boolean
  hasLeftLine(path: string, line: number): boolean
  hasPath(path: string): boolean
}

type RawHunk = {
  readonly leftStart: number
  readonly leftCount: number
  readonly rightStart: number
  readonly rightCount: number
}

type RawFile = {
  readonly leftPath: string
  readonly rightPath: string
  readonly hunks: RawHunk[]
}

const emptyLines: ReadonlySet<number> = new Set()

function stripDiffPathPrefix(path: string): string {
  return path.startsWith('b/') || path.startsWith('a/') ? path.slice(2) : path
}

function parseHeaderPath(line: string, prefix: '--- ' | '+++ '): string | undefined {
  if (!line.startsWith(prefix)) return undefined
  const raw = line.slice(prefix.length).trim()
  if (raw === '/dev/null') return undefined
  const withoutQuote = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw
  return stripDiffPathPrefix(withoutQuote.split('\t')[0] ?? withoutQuote)
}

function toCount(raw: string | undefined): number {
  return raw === undefined ? 1 : Number(raw)
}

function parseHunkHeader(line: string): RawHunk | undefined {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u.exec(line)
  if (match === null) return undefined
  return {
    leftStart: Number(match[1]),
    leftCount: toCount(match[2]),
    rightStart: Number(match[3]),
    rightCount: toCount(match[4]),
  }
}

function rangeSet(start: number, count: number): Set<number> {
  return new Set(Array.from({ length: count }, (unused, index) => start + index))
}

function scanRawFiles(diffText: string): readonly RawFile[] {
  const files: RawFile[] = []
  const state: {
    file?: RawFile
    pendingLeftPath?: string
  } = {}
  for (const line of diffText.split('\n')) {
    if (line.startsWith('diff --git ')) {
      state.file = undefined
      state.pendingLeftPath = undefined
      continue
    }
    const leftHeader = parseHeaderPath(line, '--- ')
    if (leftHeader !== undefined) {
      state.pendingLeftPath = leftHeader
      continue
    }
    const rightHeader = parseHeaderPath(line, '+++ ')
    if (rightHeader !== undefined) {
      state.file = {
        leftPath: state.pendingLeftPath ?? rightHeader,
        rightPath: rightHeader,
        hunks: [],
      }
      state.pendingLeftPath = undefined
      files.push(state.file)
      continue
    }
    const hunk = parseHunkHeader(line)
    if (hunk !== undefined && state.file !== undefined) {
      state.file.hunks.push(hunk)
    }
  }
  return files
}

function buildLineIndex(files: readonly RawFile[]): DiffLineIndex {
  const rightByPath = new Map<string, Set<number>>()
  const leftByPath = new Map<string, Set<number>>()
  for (const file of files) {
    mergeFileLines(rightByPath, leftByPath, file)
  }
  const paths = new Set<string>([...rightByPath.keys(), ...leftByPath.keys()])
  const fileList: DiffFileLines[] = []
  for (const path of paths) {
    fileList.push({
      path,
      rightLines: rightByPath.get(path) ?? emptyLines,
      leftLines: leftByPath.get(path) ?? emptyLines,
    })
  }
  return {
    files: fileList,
    hasRightLine: (path, line) => rightByPath.get(path)?.has(line) === true,
    hasLeftLine: (path, line) => leftByPath.get(path)?.has(line) === true,
    hasPath: (path) => paths.has(path),
  }
}

function mergeFileLines(
  rightByPath: Map<string, Set<number>>,
  leftByPath: Map<string, Set<number>>,
  file: RawFile,
): void {
  for (const hunk of file.hunks) {
    const right = rightByPath.get(file.rightPath) ?? new Set(hunk.rightCount === 0 ? emptyLines : rangeSet(hunk.rightStart, hunk.rightCount))
    const left = leftByPath.get(file.leftPath) ?? new Set(hunk.leftCount === 0 ? emptyLines : rangeSet(hunk.leftStart, hunk.leftCount))
    for (const value of rangeSet(hunk.rightStart, hunk.rightCount)) right.add(value)
    for (const value of rangeSet(hunk.leftStart, hunk.leftCount)) left.add(value)
    rightByPath.set(file.rightPath, right)
    leftByPath.set(file.leftPath, left)
  }
}

/** @riviere-role external-client-service */
export function parseUnifiedDiff(diffText: string): DiffLineIndex {
  return buildLineIndex(scanRawFiles(diffText))
}
