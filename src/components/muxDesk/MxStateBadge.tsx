import { cn } from '@/lib/utils'

const STATE_COLOR: Record<string, string> = {
  STARTING: 'text-accent-fg',
  READY: 'text-ok',
  BLOCKED_INTERACTIVE: 'text-warn',
  ERROR: 'text-danger',
  TERMINATED: 'text-muted',
  IDLE: 'text-ok',
  SUBMITTING: 'text-accent-fg',
  ASSISTANT_STREAMING: 'text-accent-fg',
  RUNNING_TOOL: 'text-warn',
  WAITING_TOOL_PERMISSION: 'text-warn',
  UNKNOWN: 'text-muted',
}

/** Simple state badge. Takeover/MANUAL mechanism removed -- direct conversation suffices, interrupt via the stop button in the input bar. */
export function MxStateBadge({ state }: { state: string }) {
  return (
    <span className={cn('rounded-md bg-panel-2 px-2.5 py-1 text-xs font-medium', STATE_COLOR[state] ?? 'text-muted')}>
      {state}
    </span>
  )
}
