import { useEffect, useState } from 'react'
import { getHarnessConfig } from '@/api/nativeAgents'
import type { HarnessAction, HarnessGroup } from '@/config/harness'
import { cn } from '@/lib/utils'

/**
 * Quick-action button bar above the conversation (data-driven).
 * Content provided by backend `GET /harness` (per-project harness.json); no config -> not rendered.
 * Clicking a button injects that action's cmd into the active session (sends user_message).
 */
export function MxHarnessBar({
  onAction,
  disabled,
}: {
  onAction: (cmd: string) => void
  disabled?: boolean
}) {
  const [groups, setGroups] = useState<HarnessGroup[]>([])
  useEffect(() => {
    let alive = true
    getHarnessConfig()
      .then((c) => alive && setGroups(c.groups ?? []))
      .catch(() => undefined)
    return () => {
      alive = false
    }
  }, [])

  const hasAny = groups.some((g) => g.actions?.length)
  if (!hasAny) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-panel px-3 py-2">
      {groups
        .filter((g) => g.actions?.length)
        .map((group, gi) => (
          <span key={group.name} className="flex flex-wrap items-center gap-1.5">
            {gi > 0 && <span className="mx-1 h-4 w-px bg-border" />}
            <span className="mr-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted">{group.name}</span>
            {group.actions.map((action, ai) => (
              <ActionButton
                key={`${group.name}-${ai}`}
                action={action}
                accent={group.accent}
                disabled={disabled}
                onClick={() => onAction(action.cmd)}
              />
            ))}
          </span>
        ))}
    </div>
  )
}

function ActionButton({
  action,
  accent,
  disabled,
  onClick,
}: {
  action: HarnessAction
  accent?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={`${action.hint ?? ''}\n→ inject: ${action.cmd}`}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'rounded-md border px-2 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        accent
          ? 'border-accent/40 bg-accent/10 text-accent-fg hover:bg-accent/20'
          : 'border-border bg-panel-2 text-muted hover:text-fg hover:bg-panel-2/70',
      )}
    >
      {action.label}
    </button>
  )
}
