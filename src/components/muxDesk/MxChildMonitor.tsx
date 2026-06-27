import { useEffect, useRef, useState } from 'react'
import type { MxSession } from '@/types/muxDesk'
import { relaySession } from '@/api/muxDesk'
import { getSessionLive } from '@/api/nativeAgents'
import { MxStateBadge } from './MxStateBadge'

/**
 * Parent read-only monitor (module 4 · 4d): when the active session has bound children, show a
 * collapsible panel — each child's state + live preview, with a relay box to inject a message and an
 * "open" button to focus the child. Renders nothing when there are no children.
 */
export function MxChildMonitor({ children, onOpen }: { children: MxSession[]; onOpen: (id: string) => void }) {
  const [collapsed, setCollapsed] = useState(false)
  if (children.length === 0) return null
  return (
    <div className="border-t border-border bg-panel">
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center gap-2 px-3 py-1 text-left text-[11px] text-subtle"
      >
        <span>{collapsed ? '▸' : '▾'}</span>
        <span className="font-semibold tracking-wide">BOUND CHILDREN ({children.length})</span>
      </button>
      {!collapsed && (
        <div className="max-h-56 space-y-1 overflow-y-auto px-2 pb-2">
          {children.map((child) => (
            <ChildRow key={child.app_session_id} child={child} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  )
}

function ChildRow({ child, onOpen }: { child: MxSession; onOpen: (id: string) => void }) {
  const [live, setLive] = useState<{ working: boolean; text: string }>({ working: false, text: '' })
  const [relay, setRelay] = useState('')
  const [sending, setSending] = useState(false)
  const id = child.app_session_id

  useEffect(() => {
    let alive = true
    const load = () =>
      getSessionLive(id)
        .then((r) => alive && setLive({ working: !!r.working, text: r.text ?? '' }))
        .catch(() => undefined)
    load()
    const t = window.setInterval(load, 1500)
    return () => {
      alive = false
      window.clearInterval(t)
    }
  }, [id])

  const send = async () => {
    const text = relay.trim()
    if (!text || sending) return
    setSending(true)
    try {
      const r = await relaySession(id, text)
      if (r.ok) setRelay('') // soft failure (200 {ok:false}) keeps the text for retry
    } catch {
      // older backend without /relay, or session gone — leave the text for retry
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="rounded-md border border-border/60 bg-panel-2/40 px-2 py-1.5 text-xs">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium text-fg">{child.title ?? id.slice(0, 8)}</span>
        <MxStateBadge state={child.state} />
        <button type="button" onClick={() => onOpen(id)} className="shrink-0 text-subtle hover:text-fg">
          open
        </button>
      </div>
      {live.text && (
        <pre className="mt-1 max-h-16 overflow-hidden whitespace-pre-wrap font-mono text-[11px] leading-[1.4] text-muted">
          {live.text.slice(-280)}
        </pre>
      )}
      <div className="mt-1 flex items-center gap-1">
        <input
          value={relay}
          onChange={(e) => setRelay(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) void send()
          }}
          placeholder="relay a message…"
          className="min-w-0 flex-1 rounded border border-border bg-panel px-2 py-0.5 text-[11px] text-fg outline-none placeholder:text-subtle focus:border-accent"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || !relay.trim()}
          className="shrink-0 rounded bg-accent px-2 py-0.5 text-[11px] text-white hover:opacity-90 disabled:opacity-50"
        >
          relay
        </button>
      </div>
    </div>
  )
}
