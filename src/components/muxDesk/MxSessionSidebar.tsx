import { useEffect, useState, type DragEvent, type MouseEvent } from 'react'
import { archiveSession, bindSession, createSession, listSessions, resumeSession, unbindSession, type BindContract } from '@/api/muxDesk'
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
  // Drag a session onto another -> open the bind dialog (optional mission contract, else ephemeral).
  const [pendingBind, setPendingBind] = useState<{ child: MxSession; parent: MxSession } | null>(null)
  const requestBind = (childId: string, parent: MxSession) => {
    if (childId === parent.app_session_id) return
    const child = sessions.find((s) => s.app_session_id === childId)
    if (child) setPendingBind({ child, parent })
  }
  const confirmBind = async (contract?: BindContract) => {
    if (!pendingBind) return
    const { child, parent } = pendingBind
    setPendingBind(null)
    try {
      await bindSession(child.app_session_id, parent.app_session_id, contract)
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
      onBind={(childId) => requestBind(childId, session)}
      onUnbind={() => handleUnbind(session.app_session_id)}
    />
  )

  return (
    <aside className="relative flex w-64 flex-col border-r border-border bg-panel">
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
      {pendingBind && (
        <BindDialog
          childTitle={pendingBind.child.title ?? pendingBind.child.app_session_id.slice(0, 8)}
          parentTitle={pendingBind.parent.title ?? pendingBind.parent.app_session_id.slice(0, 8)}
          onConfirm={confirmBind}
          onCancel={() => setPendingBind(null)}
        />
      )}
    </aside>
  )
}

const COMMON_GUARDRAILS = ['git-push', 'git-merge', 'deploy', 'delete', 'place-trade']

// Preset deliverable shapes (avoids hand-writing a JSON Schema); the child's check-in is validated against it.
const DELIVERABLE_PRESETS: { key: string; label: string; schema?: Record<string, unknown> }[] = [
  { key: 'none', label: 'none' },
  {
    key: 'summary',
    label: 'progress summary',
    schema: { type: 'object', required: ['summary'], properties: { summary: { type: 'string' } } },
  },
  {
    key: 'status',
    label: 'status + blockers',
    schema: {
      type: 'object',
      required: ['status'],
      properties: {
        status: { type: 'string' },
        blockers: { type: 'array', items: { type: 'string' } },
        files_changed: { type: 'array', items: { type: 'string' } },
      },
    },
  },
]

/**
 * Bind wizard (module 4 · 4g): confirm a drag-bind with an optional mission + guardrail blocklist
 * (→ a persistent contract). No mission and no guardrails = a quick ephemeral bind.
 * Enter confirms, Esc cancels. Selected guardrails are enforced by the child's PreToolUse hook.
 */
function BindDialog({
  childTitle,
  parentTitle,
  onConfirm,
  onCancel,
}: {
  childTitle: string
  parentTitle: string
  onConfirm: (contract?: BindContract) => void
  onCancel: () => void
}) {
  const [mission, setMission] = useState('')
  const [blocked, setBlocked] = useState<string[]>([])
  const [deliverable, setDeliverable] = useState<string>('none')
  const toggle = (g: string) => setBlocked((b) => (b.includes(g) ? b.filter((x) => x !== g) : [...b, g]))

  const submit = () => {
    const m = mission.trim()
    const preset = DELIVERABLE_PRESETS.find((p) => p.key === deliverable)
    if (!m && blocked.length === 0 && !preset?.schema) {
      onConfirm(undefined) // quick ephemeral bind
      return
    }
    const contract: BindContract = { kind: 'persistent' }
    if (m) contract.mission = m
    if (blocked.length) contract.guardrails = { blocklist: blocked }
    if (preset?.schema) contract.deliverables = { output_schema: preset.schema }
    onConfirm(contract)
  }

  const hasContract = mission.trim().length > 0 || blocked.length > 0 || deliverable !== 'none'
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 p-3" onClick={onCancel}>
      <div className="w-full rounded-md border border-border bg-panel-2 p-3 text-xs" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 text-fg">
          Bind <span className="font-semibold">{childTitle}</span> under <span className="font-semibold">{parentTitle}</span>
        </div>
        <textarea
          autoFocus
          value={mission}
          onChange={(e) => setMission(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel()
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
          rows={2}
          placeholder="mission (optional) — leave empty + no guardrails for a quick ephemeral bind"
          className="w-full resize-none rounded border border-border bg-panel px-2 py-1 text-fg outline-none placeholder:text-subtle focus:border-accent"
        />
        <div className="mt-2">
          <div className="mb-1 text-subtle">guardrails (block in the child):</div>
          <div className="flex flex-wrap gap-1">
            {COMMON_GUARDRAILS.map((g) => (
              <button
                key={g}
                type="button"
                aria-pressed={blocked.includes(g)}
                onClick={() => toggle(g)}
                className={cn(
                  'rounded border px-1.5 py-0.5 font-mono',
                  blocked.includes(g) ? 'border-warn/60 bg-warn/15 text-warn' : 'border-border text-subtle hover:text-fg',
                )}
              >
                {g}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-2">
          <div className="mb-1 text-subtle">deliverable (validated each check-in):</div>
          <div className="flex flex-wrap gap-1">
            {DELIVERABLE_PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                aria-pressed={deliverable === p.key}
                onClick={() => setDeliverable(p.key)}
                className={cn(
                  'rounded border px-1.5 py-0.5',
                  deliverable === p.key ? 'border-accent/60 bg-accent/15 text-fg' : 'border-border text-subtle hover:text-fg',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-2 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded px-2 py-1 text-subtle hover:text-fg">
            Cancel
          </button>
          <button type="button" onClick={submit} className="rounded bg-accent px-3 py-1 font-medium text-white hover:opacity-90">
            {hasContract ? 'Bind with contract' : 'Bind'}
          </button>
        </div>
      </div>
    </div>
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
      // Pointer affordance for binding; a keyboard-accessible bind path will land via the planned `/team` command.
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
