import type { SessionStatusFilter } from './sessions-api'

const FILTER_OPTIONS: readonly {
  value: SessionStatusFilter;
  label: string 
}[] = [
  {
    value: 'all',
    label: 'All' 
  },
  {
    value: 'active',
    label: 'Active' 
  },
  {
    value: 'complete',
    label: 'Complete' 
  },
  {
    value: 'stale',
    label: 'Stale' 
  },
] as const

type SessionStatusFilterControlProps = Readonly<{
  value: SessionStatusFilter
  onChange: (next: SessionStatusFilter) => void
}>

export function SessionStatusFilterControl({
  value, onChange
}: SessionStatusFilterControlProps): React.JSX.Element {
  return (
    <fieldset
      role="radiogroup"
      aria-label="Filter sessions by status"
      className="flex items-center gap-2 p-2"
    >
      {FILTER_OPTIONS.map((option) => {
        const id = `session-filter-${option.value}`
        return (
          <label
            key={option.value}
            htmlFor={id}
            className="inline-flex items-center gap-1 text-sm"
          >
            <input
              id={id}
              type="radio"
              name="session-status-filter"
              value={option.value}
              checked={value === option.value}
              onChange={() => { onChange(option.value) }}
            />
            {option.label}
          </label>
        )
      })}
    </fieldset>
  )
}
