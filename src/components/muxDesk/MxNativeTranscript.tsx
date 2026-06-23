import { useEffect, useState } from 'react'
import { getNativeTranscript, getSubagentTranscript, type NativeEvent } from '@/api/nativeAgents'

/** Shared: render a claude session's jsonl transcript (read-only, polled updates).
 *
 * Two sources: (1) native session (sessionId+cwd, standalone jsonl) (2) lead's Task subagent
 * (leadSessionId+agentId, jsonl under lead's subagents/ dir). Used by live agent dashboard,
 * clicking a teammate / clicking a subagent node -- jsonl is persistent, viewing history
 * does not require an active session or muxdesk management. */
export function MxNativeTranscript({
  sessionId,
  cwd,
  leadSessionId,
  agentId,
}: {
  sessionId?: string
  cwd?: string
  leadSessionId?: string
  agentId?: string
}) {
  const [events, setEvents] = useState<NativeEvent[]>([])
  const [found, setFound] = useState(true)

  useEffect(() => {
    let alive = true
    const load = () => {
      const req =
        leadSessionId && agentId
          ? getSubagentTranscript(leadSessionId, agentId)
          : getNativeTranscript(sessionId ?? '', cwd ?? '')
      req
        .then((r) => {
          if (!alive) return
          setEvents(r.items)
          setFound(r.found)
        })
        .catch(() => undefined)
    }
    load()
    const id = window.setInterval(load, 2500)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [sessionId, cwd, leadSessionId, agentId])

  if (!found) return <div className="text-sm text-muted">Transcript jsonl not found</div>
  if (events.length === 0) return <div className="text-sm text-muted">(no events)</div>
  return (
    <>
      {events.map((ev, i) => (
        <NativeEventRow key={`${ev.seq ?? i}`} ev={ev} />
      ))}
    </>
  )
}

function userText(p: Record<string, unknown>): string {
  if (typeof p.text === 'string') return p.text
  const content = p.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c === 'object' && c && 'text' in c ? String((c as { text: unknown }).text) : ''))
      .join('')
  }
  return ''
}

function NativeEventRow({ ev }: { ev: NativeEvent }) {
  const t = ev.event_type
  const p = ev.payload ?? {}
  if (t === 'assistant_message') {
    const text = String(p.text ?? '')
    if (!text.trim()) return null
    return (
      <div className="mb-2 rounded-md bg-panel-2 p-2 text-sm">
        <span className="text-xs text-accent-fg">assistant</span>
        <div className="mt-0.5 whitespace-pre-wrap text-fg">{text}</div>
      </div>
    )
  }
  if (t === 'user_message') {
    const text = userText(p)
    if (!text.trim()) return null
    return (
      <div className="mb-2 rounded-md border border-border p-2 text-sm">
        <span className="text-xs text-muted">user</span>
        <div className="mt-0.5 whitespace-pre-wrap text-fg">{text}</div>
      </div>
    )
  }
  if (t === 'tool_use') return <div className="mb-1 text-xs text-muted">🔧 {String(p.name ?? p.tool_name ?? 'tool')}</div>
  if (t === 'tool_result') return <div className="mb-1 text-xs text-subtle">✓ tool result</div>
  return null
}
