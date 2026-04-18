const STATE_ABBREVIATIONS: Readonly<Record<string, string>> = {
  SPAWN: 'SPAWN',
  PLANNING: 'PLAN',
  RESPAWN: 'RESP',
  DEVELOPING: 'DEV',
  REVIEWING: 'REV',
  COMMITTING: 'COM',
  CR_REVIEW: 'CR',
  PR_CREATION: 'PR',
  COMPLETE: 'DONE',
  BLOCKED: 'BLOCK',
  FEEDBACK: 'FDBK',
  idle: 'IDLE',
}

const STATE_COLOR_CLASSES: Readonly<Record<string, string>> = {
  SPAWN: 'bg-state-spawn/15 text-state-spawn',
  PLANNING: 'bg-state-planning/15 text-state-planning',
  RESPAWN: 'bg-state-respawn/15 text-state-respawn',
  DEVELOPING: 'bg-state-developing/15 text-state-developing',
  REVIEWING: 'bg-state-reviewing/15 text-state-reviewing',
  COMMITTING: 'bg-state-committing/15 text-state-committing',
  CR_REVIEW: 'bg-state-cr-review/15 text-state-cr-review',
  PR_CREATION: 'bg-state-pr-creation/15 text-state-pr-creation',
  COMPLETE: 'bg-state-complete/15 text-state-complete',
  BLOCKED: 'bg-state-blocked/15 text-state-blocked',
  FEEDBACK: 'bg-state-feedback/15 text-state-feedback',
  idle: 'bg-state-idle/15 text-state-idle',
}

const DEFAULT_COLOR_CLASS = 'bg-state-idle/15 text-state-idle'

type StateBadgeProps = Readonly<{ state: string }>

export function StateBadge({ state }: StateBadgeProps): React.JSX.Element {
  const abbreviation = STATE_ABBREVIATIONS[state] ?? state.slice(0, 4)
  const colorClass = STATE_COLOR_CLASSES[state] ?? DEFAULT_COLOR_CLASS
  return (
    <span
      aria-label={`State: ${state}`}
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${colorClass}`}
    >
      {abbreviation}
    </span>
  )
}
