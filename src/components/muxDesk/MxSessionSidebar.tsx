import { useEffect, useState, type DragEvent, type MouseEvent } from 'react'
import { archiveSession, bindSession, createSession, listSessions, resumeSession, unbindSession } from '@/api/muxDesk'
import { useSessionStore } from '@/stores/sessionStore'
import { useUiStore, type SidebarView } from '@/stores/uiStore'
import { buildSessionTree, groupByProject } from '@/lib/sessionViews'
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
  const sidebarView = useUiStore((s) => s.sidebarView)
  const setSidebarView = useUiStore((s) => s.setSidebarView)

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
  const refresh = () => listSessions().then((r) => setSessions(r.items)).catch(() => undefined)
  // Drag a session onto another -> bind the dragged one under it (backend validates / rejects cycles).
  const handleBind = async (childId: string, parentId: string) => {
    if (childId === parentId) return
    try {
      await bindSession(childId, parentId)
      await refresh()
    } catch {
      // backend may be older (no /bind) or reject a cycle (409) — leave the tree unchanged
    }
  }
  const handleUnbind = async (id: string) => {
    try {
      await unbindSession(id)
      await refresh()
    } catch {
      // ignore (older backend)
    }
  }

  const item = (session: MxSession, depth = 0) => (
    <SessionItem
      key={session.app_session_id}
      session={session}
      active={session.app_session_id === activeId}
      depth={depth}
      onSelect={() => setActive(session.app_session_id)}
      onArchive={() => handleArchive(session.app_session_id)}
      onResume={() => handleResume(session.app_session_id)}
      onBind={(childId) => handleBind(childId, session.app_session_id)}
      onUnbind={() => handleUnbind(session.app_session_id)}
    />
  )

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
      <SidebarViewToggle value={sidebarView} onChange={setSidebarView} />
      <div className="flex-1 overflow-y-auto p-2">
        {sidebarView === 'tree' ? (
          buildSessionTree(sessions).map(({ session, depth }) => item(session, depth))
        ) : sidebarView === 'project' ? (
          groupByProject(sessions).map(([project, items]) => (
            <div key={project} className="mb-3">
              <div className="truncate px-2 py-1 text-xs text-muted">📁 {project}</div>
              {items.map((session) => item(session))}
            </div>
          ))
        ) : (
          groupByDate(sessions).map(([date, items]) => (
            <div key={date} className="mb-3">
              <div className="px-2 py-1 text-xs text-muted">{date}</div>
              {items.map((session) => item(session))}
            </div>
          ))
        )}
      </div>
    </aside>
  )
}

function SessionItem({
  session,
  active,
  depth = 0,
  onSelect,
  onArchive,
  onResume,
  onBind,
  onUnbind,
}: {
  session: MxSession
  active: boolean
  depth?: number
  onSelect: () => void
  onArchive: () => void
  onResume: () => void
  onBind?: (draggedId: string) => void
  onUnbind?: () => void
}) {
  const [over, setOver] = useState(false)
  const stop = (fn: () => void) => (event: MouseEvent) => {
    event.stopPropagation()
    fn()
  }
  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData('text/plain', session.app_session_id)
    e.dataTransfer.effectAllowed = 'move'
  }
  const onDragOver = (e: DragEvent) => {
    if (!onBind) return
    e.preventDefault() // allow drop
    if (!over) setOver(true)
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    const dragged = e.dataTransfer.getData('text/plain')
    if (dragged) onBind?.(dragged)
  }
  return (
    <div
      onClick={onSelect}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      title="drag onto another session to bind it under that one"
      // tree view: indent children, with a guide border for nested rows
      style={depth ? { marginLeft: depth * 12 } : undefined}
      className={cn(
        'group flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5',
        depth ? 'border-l border-border/60' : '',
        over ? 'ring-1 ring-accent' : '',
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
        {session.parent_session_id && onUnbind && (
          <button type="button" onClick={stop(onUnbind)} title="detach from parent" className="text-xs text-muted hover:text-warn">
            unbind
          </button>
        )}
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

/** Segmented control to switch the sidebar grouping (date / tree / project). */
function SidebarViewToggle({ value, onChange }: { value: SidebarView; onChange: (v: SidebarView) => void }) {
  const views: { key: SidebarView; label: string }[] = [
    { key: 'date', label: 'Date' },
    { key: 'tree', label: 'Tree' },
    { key: 'project', label: 'Project' },
  ]
  return (
    <div className="flex gap-0.5 border-b border-border px-2 py-1.5">
      {views.map((v) => (
        <button
          key={v.key}
          type="button"
          aria-pressed={value === v.key}
          onClick={() => onChange(v.key)}
          className={cn(
            'flex-1 rounded px-2 py-0.5 text-[11px]',
            value === v.key ? 'bg-panel-2 text-fg' : 'text-subtle hover:text-fg',
          )}
        >
          {v.label}
        </button>
      ))}
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
