const CATEGORY_COLOR_CLASSES: Readonly<Record<string, string>> = {
  transition: 'bg-indigo-100 text-indigo-900',
  agent: 'bg-blue-100 text-blue-900',
  permission: 'bg-amber-100 text-amber-900',
  journal: 'bg-emerald-100 text-emerald-900',
  session: 'bg-gray-100 text-gray-900',
  domain: 'bg-slate-100 text-slate-900',
}

type EventBadgeProps = Readonly<{
  type: string
  category?: string | undefined
  denied?: boolean | undefined
}>

export function EventBadge({
  type, category, denied
}: EventBadgeProps): React.JSX.Element {
  const deniedClass = 'bg-red-100 text-red-900'
  const fallbackClass = 'bg-gray-100 text-gray-900'
  const categoryClass = (category ? CATEGORY_COLOR_CLASSES[category] : undefined) ?? fallbackClass
  const className = denied ? deniedClass : categoryClass
  const label = [
    `Event: ${type}`,
    category ? `category ${category}` : undefined,
    denied ? 'denied' : undefined,
  ].filter((segment): segment is string => typeof segment === 'string').join(', ')

  return (
    <span
      aria-label={label}
      className={`inline-flex items-center rounded px-2 py-0.5 font-mono text-xs ${className}`}
    >
      {type}
    </span>
  )
}
