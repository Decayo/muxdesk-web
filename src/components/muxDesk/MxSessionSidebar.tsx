import { useEffect, type MouseEvent } from 'react'
import { archiveSession, createSession, listSessions, resumeSession } from '@/api/muxDesk'
import { useSessionStore } from '@/stores/sessionStore'
import { cn } from '@/lib/utils'
import type { MxSession } from '@/types/muxDesk'

/** Session sidebar: regular cc session list.
 * Agent teams (orchestrator + teammates) are now rendered by the "Live Agents" panel
 * (reads ~/.claude/teams/), no longer shown as a custom team tree here. */
export function MxSessionSidebar() {
  const sessions = useSessionStore((s) => s.sessions)
  const activeId = useSessionStore((s) => s.activeId)
  const selectedModel = useSessionStore((s) => s.selectedModel)
  const setSessions = useSessionStore((s) => s.setSessions)
  const setActive = useSessionStore((s) => s.setActive)
  const upsert = useSessionStore((s) => s.upsert)

  useEffect(() => {
    let alive = true
    const load = () =>
      listSessions()
        .then((r) => alive && setSessions(r.items))
        .catch(() => undefined)
    load()
    const id = window.setInterval(load, 3000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [setSessions])

  const handleNew = async () => {
    const session = await createSession(selectedModel ? { model: selectedModel } : {})
    upsert(session)
    setActive(session.app_session_id)
  }
  const handleArchive = async (id: string) => upsert(await archiveSession(id))
  const handleResume = async (id: string) => {
    const session = await resumeSession(id)
    upsert(session)
    setActive(id)
  }

  return (
    <aside className="flex w-64 flex-col border-r border-border bg-panel">
      <div className="flex items-center justify-between border-b border-border p-3">
        <span className="text-sm font-semibold text-fg">muxdesk</span>
        <button
          type="button"
          onClick={handleNew}
          className="rounded-md bg-accent px-2 py-1 text-xs font-medium text-white hover:opacity-90"
        >
          + New session
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {groupByDate(sessions).map(([date, items]) => (
          <div key={date} className="mb-3">
            <div className="px-2 py-1 text-xs text-muted">{date}</div>
            {items.map((session) => (
              <SessionItem
                key={session.app_session_id}
                session={session}
                active={session.app_session_id === activeId}
                onSelect={() => setActive(session.app_session_id)}
                onArchive={() => handleArchive(session.app_session_id)}
                onResume={() => handleResume(session.app_session_id)}
              />
            ))}
          </div>
        ))}
      </div>
    </aside>
  )
}

function SessionItem({
  session,
  active,
  onSelect,
  onArchive,
  onResume,
}: {
  session: MxSession
  active: boolean
  onSelect: () => void
  onArchive: () => void
  onResume: () => void
}) {
  const stop = (fn: () => void) => (event: MouseEvent) => {
    event.stopPropagation()
    fn()
  }
  return (
    <div
      onClick={onSelect}
      className={cn(
        'group flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5',
        active ? 'bg-panel-2 text-fg' : 'text-muted hover:bg-panel-2',
      )}
    >
      <div className="min-w-0">
        <div className="truncate text-sm">{session.title ?? session.app_session_id.slice(0, 8)}</div>
        <div className="text-xs text-muted">
          {session.status} · {session.state}
        </div>
      </div>
      <div className="hidden gap-2 group-hover:flex">
        {session.status === 'archived' ? (
          <button type="button" onClick={stop(onResume)} className="text-xs text-accent-fg hover:underline">
            resume
          </button>
        ) : (
          <button type="button" onClick={stop(onArchive)} className="text-xs text-muted hover:text-warn">
            archive
          </button>
        )}
      </div>
    </div>
  )
}

function groupByDate(sessions: MxSession[]): [string, MxSession[]][] {
  const groups = new Map<string, MxSession[]>()
  for (const session of sessions) {
    const date = (session.created_at ?? '').slice(0, 10) || 'Unknown date'
    const list = groups.get(date) ?? []
    list.push(session)
    groups.set(date, list)
  }
  return [...groups.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1))
}
