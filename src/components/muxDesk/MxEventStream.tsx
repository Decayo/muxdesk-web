import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { fmtClock, fmtTokens } from '@/lib/format'
import type { MxEvent } from '@/types/muxDesk'
import { ccImageUrl, getSessionLive, type SubagentNode } from '@/api/nativeAgents'
import { MxMessage } from './MxMessage'
import { ImageLightbox } from './ImageLightbox'
import { WorkLog, ToolEntryRow } from './WorkLog'
import { applyViewMode, buildRenderItems, ccAskQuestion, dedupeEvents, stripCcAskNoise, type ToolEntry } from '@/lib/eventGroups'
import { useUiStore } from '@/stores/uiStore'

interface Props {
  events: MxEvent[]
  state?: string
  pendingText?: string
  /** Current session (for live preview during streaming). */
  sessionId?: string | null
  /** Lead's Task subagents (name->stats), renders Agent tool_start as tree cards (tool uses / tokens / status). */
  agentsByName?: Record<string, SubagentNode>
}

export function MxEventStream({ events: rawEvents, state, pendingText, sessionId, agentsByName }: Props) {
  const viewMode = useUiStore((s) => s.viewMode)
  const events = applyViewMode(dedupeEvents(stripCcAskNoise(rawEvents)), viewMode)
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  // "Stick to bottom" intent. Only a deliberate scroll-up clears it; programmatic scrolls (which only
  // move downward) and async content growth never do — so following survives reflow during load.
  const stickRef = useRef(true)
  const lastTopRef = useRef(0)

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const top = el.scrollTop
    const dist = el.scrollHeight - top - el.clientHeight
    if (top < lastTopRef.current - 4) stickRef.current = false // user scrolled up -> stop following
    else if (dist < 160) stickRef.current = true // back near the bottom -> resume following
    lastTopRef.current = top
  }, [])

  // Live preview polling moved up so live.text is included in scroll deps (auto-scroll to bottom during streaming)
  const [live, setLive] = useState<{ working: boolean; text: string }>({ working: false, text: '' })
  useEffect(() => {
    if (!sessionId) {
      setLive({ working: false, text: '' })
      return
    }
    let alive = true
    const load = () =>
      getSessionLive(sessionId)
        .then((r) => alive && setLive({ working: !!r.working, text: r.text ?? '' }))
        .catch(() => undefined)
    load()
    const id = window.setInterval(load, 700)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [sessionId])

  // Switching sessions: always jump to the bottom and resume following.
  useEffect(() => {
    stickRef.current = true
    lastTopRef.current = 0
    bottomRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [sessionId])

  // Follow growing content (new events, streaming, async media/highlight reflow) — but only while the
  // user is parked near the bottom, so reading scrollback isn't yanked away. A ResizeObserver on the
  // content catches height changes that land after the initial render (shiki, iframes), unlike a
  // one-shot effect. Mirrors t3code's maintainScrollAtEnd.
  useEffect(() => {
    const content = contentRef.current
    if (!content) return
    const ro = new ResizeObserver(() => {
      if (stickRef.current) bottomRef.current?.scrollIntoView({ behavior: 'auto' })
    })
    ro.observe(content)
    return () => ro.disconnect()
  }, [])

  const busy = state === 'SUBMITTING' || state === 'ASSISTANT_STREAMING' || state === 'RUNNING_TOOL'
  // In-turn (inTurn): from submission until "assistant message persisted / turn ended / interrupted" -> show live preview throughout.
  // Cannot use "last event is user_message" -- claude thinking emits assistant_thinking first, changing the last event.
  // Instead, compare indices: last (non-interrupt) user_message after last "done marker" = in turn.
  // Done markers = assistant_message persisted (-> replaced by final markdown) / system_notice turn end / interrupt message.
  // assistant_thinking does NOT count as done, so "thinking + streaming" stays stable as true, no flicker, no flaky state dependency.
  let lastUserIdx = -1
  let lastDoneIdx = -1
  events.forEach((e, i) => {
    const t = e.event_type
    if (t === 'user_message') {
      if (/Request interrupted|interrupted by user/i.test(String(e.payload?.text ?? ''))) lastDoneIdx = i
      else lastUserIdx = i
    } else if (t === 'assistant_message' || t === 'system_notice') {
      lastDoneIdx = i
    }
  })
  const inTurn = Boolean(pendingText) || lastUserIdx > lastDoneIdx

  return (
    <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-4 py-3">
      <div ref={contentRef}>
        {events.length === 0 && !pendingText && !busy ? (
          <div className="mt-12 text-center text-sm text-muted">No events yet. Send a message to start the conversation.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {buildRenderItems(events).map((item) =>
              item.kind === 'tools' ? (
                <WorkLogItem key={item.key} entries={item.entries} />
              ) : (
                <EventRow key={item.key} event={item.event} agentsByName={agentsByName} />
              ),
            )}
            {pendingText && <Bubble text={pendingText} pending />}
            <LivePreview live={live} active={inTurn} />
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

function EventRow({ event, agentsByName }: { event: MxEvent; agentsByName?: Record<string, SubagentNode> }) {
  const { event_type: type, payload, ts } = event
  const text = (key: string) => String(payload[key] ?? '')

  switch (type) {
    case 'user_message': {
      const t = text('text')
      // skill load preamble (harness injects "Base directory for this skill: ..." full SKILL.md) -> not user input, hide it
      if (t.startsWith('Base directory for this skill:')) return null
      // claude slash command log (<command-name>/<local-command-stdout>) -> compress to single meta line, no bubble
      if (t.includes('<command-name>') || t.includes('<local-command-')) return <CommandLine text={t} />
      return <Bubble text={t} ts={ts} />
    }
    case 'assistant_message':
      return (
        <MxMessage
          text={text('text')}
          ts={ts}
          tokens={Number(payload.output_tokens) || undefined}
          model={String(payload.model ?? '') || undefined}
        />
      )
    case 'assistant_thinking':
      return <ThinkingBlock text={text('text')} ts={ts} />
    case 'tool_start': {
      const toolName = text('tool_name') || 'tool'
      const input = payload.input
      // muxdesk-ask question (Skill muxdesk-ask / Bash scripts/muxdesk-ask) -> single "❓ question {text}" line, card below for answering;
      // don't leak Skill JSON / full Bash command (SKILL.md dump filtered out by the user_message branch above)
      const ccAskQ = ccAskQuestion(toolName, input)
      if (ccAskQ !== undefined) {
        return <Meta label="❓ question" text={ccAskQ || '(see card below to answer)'} ok />
      }
      // Task/Agent (spawn subagent) -> tree card (name, type, desc -- tool uses, tokens, status), replaces raw JSON
      if ((toolName === 'Task' || toolName === 'Agent') && input && typeof input === 'object' && 'name' in input) {
        const meta = input as { name?: string; subagent_type?: string; description?: string }
        return <AgentCard meta={meta} info={agentsByName?.[String(meta.name ?? '')]} />
      }
      // AskUserQuestion -> single question line (options clickable in MenuPanel above input), no raw JSON
      if (toolName === 'AskUserQuestion' && input && typeof input === 'object') {
        const q = (input as { questions?: { question?: string }[] }).questions?.[0]?.question
        return <Meta label="❓ question" text={q ? String(q) : 'Awaiting selection (see options below)'} ok />
      }
      return <Meta label={`▶ ${toolName}`} text={summarize(input)} />
    }
    case 'tool_end':
      return <Meta label={payload.is_error ? '✗ tool' : '✓ tool'} text="" warn={Boolean(payload.is_error)} />
    case 'artifact_written':
      return <Meta label="📝 written to vault" text={text('rel_path')} ok />
    case 'image':
      return <Meta label="🖼 image" text="(image)" />
    case 'error':
      return <Meta label="error" text={text('message')} warn />
    default:
      return null
  }
}

/** A run of tool calls: WORK LOG collapsible block when ≥2, a single expandable row otherwise. */
function WorkLogItem({ entries }: { entries: ToolEntry[] }) {
  if (entries.length === 1) return <ToolEntryRow entry={entries[0]} />
  return <WorkLog entries={entries} />
}

/** Spawned subagent tree card: ⚙ name, type, desc -- N tools, ~Xk tok, status (synced via hook). */
function AgentCard({
  meta,
  info,
}: {
  meta: { name?: string; subagent_type?: string; description?: string }
  info?: SubagentNode
}) {
  const done = info?.status === 'completed'
  return (
    <div
      className={cn(
        'ml-1 flex items-center gap-2 border-l-2 py-1 pl-2 pr-2 text-xs transition-opacity',
        done ? 'border-border bg-panel/20 opacity-50' : 'border-violet-500/40 bg-panel/30',
      )}
    >
      <span className="text-violet-300">⚙</span>
      <span className="shrink-0 font-medium text-fg">{meta.name ?? 'agent'}</span>
      {meta.subagent_type && <span className="shrink-0 text-subtle">{meta.subagent_type}</span>}
      <span className="min-w-0 flex-1 truncate text-muted">{meta.description}</span>
      {info?.toolUses != null && <span className="shrink-0 tabular-nums text-subtle">{info.toolUses} tools</span>}
      {info?.tokens ? <span className="shrink-0 tabular-nums text-subtle">{fmtTokens(info.tokens)} tok</span> : null}
      <span className={cn('shrink-0', done ? 'text-ok' : 'text-accent-fg')}>{done ? '✓ Done' : '· In progress'}</span>
    </div>
  )
}

/** Progressively reveal the full thinking block (typewriter effect), with skip / collapse. */
function ThinkingBlock({ text, ts }: { text: string; ts?: number }) {
  const [len, skip] = useTypewriter(text)
  const [collapsed, setCollapsed] = useState(false)
  const done = len >= text.length

  return (
    <div className="rounded-lg border border-border/60 bg-panel/40 px-3 py-2 text-xs">
      <div className="mb-1 flex items-center gap-2">
        <span className="font-medium text-subtle">💭 thinking</span>
        {ts ? <span className="text-[10px] text-subtle">{fmtClock(ts)}</span> : null}
        {!done && !collapsed && (
          <button type="button" onClick={skip} className="text-[10px] text-subtle hover:text-fg">
            (revealing gradually · click to skip)
          </button>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="ml-auto text-[10px] text-subtle hover:text-fg"
        >
          {collapsed ? 'Expand' : 'Collapse'}
        </button>
      </div>
      {!collapsed && (
        <div className="whitespace-pre-wrap leading-relaxed text-muted">
          {text.slice(0, len)}
          {!done && <span className="animate-pulse">▋</span>}
        </div>
      )}
    </div>
  )
}

/** Progressively reveal the full text within ~1.5s, speed adapts to length; returns revealed length and skip function. */
function useTypewriter(full: string): readonly [number, () => void] {
  const [len, setLen] = useState(0)
  useEffect(() => {
    setLen(0)
    if (!full) return
    const speed = Math.max(2, Math.ceil(full.length / 90))
    const id = window.setInterval(() => {
      setLen((l) => {
        const next = l + speed
        if (next >= full.length) {
          window.clearInterval(id)
          return full.length
        }
        return next
      })
    }, 16)
    return () => window.clearInterval(id)
  }, [full])
  const skip = useCallback(() => setLen(full.length), [full])
  return [len, skip] as const
}

/**
 * Live preview during streaming: claude only persists the full assistant block to jsonl (long wait),
 * so we continuously poll the TUI for the in-progress reply to display early.
 * Visibility driven by backend `working` (spinner detection), not flaky jsonl state,
 * avoiding blank screen if unmounted mid-stream.
 * working but no text (just started / pure thinking) -> show "thinking Xs" only;
 * neither -> hide (defer to final markdown).
 */
function LivePreview({ live, active }: { live: { working: boolean; text: string }; active: boolean }) {
  const [sec, setSec] = useState(0)
  // Retain last non-empty text: when capture occasionally returns empty, prevent the text area from flashing away (visibility governed by active = turn lifecycle)
  const [shown, setShown] = useState('')
  useEffect(() => {
    if (live.text) setShown(live.text)
  }, [live.text])
  useEffect(() => {
    if (!active) {
      setSec(0)
      setShown('')
      return
    }
    const id = window.setInterval(() => setSec((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [active])

  if (!active) return null
  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex items-center gap-2 px-1 text-xs text-muted">
        <span className="animate-pulse">💭 claude is replying…</span>
        <span className="tabular-nums text-subtle">{sec}s</span>
        {shown && <span className="text-[10px] text-subtle">live preview</span>}
      </div>
      {shown && (
        <div className="max-w-[94%] whitespace-pre-wrap rounded-lg border border-border/40 bg-panel-2/40 px-3 py-2 font-mono text-[12px] leading-[1.5] text-muted">
          {shown}
          <span className="ml-0.5 animate-pulse">▋</span>
        </div>
      )}
    </div>
  )
}

const _IMG_PATH_RE = /\/tmp\/muxdesk-img\/[A-Za-z0-9._-]+\.(?:png|jpe?g|gif|webp)/g

function Bubble({ text, ts, pending }: { text: string; ts?: number; pending?: boolean }) {
  const [preview, setPreview] = useState<string | null>(null)
  // User-pasted images appear as paths in the message -> render as thumbnails (click for full size), strip path lines + attachment label from text
  const paths = text ? Array.from(text.matchAll(_IMG_PATH_RE), (m) => m[0]) : []
  const clean = paths.length
    ? text.replace(_IMG_PATH_RE, '').replace(/Attached image \(use Read to view\):/g, '').replace(/\n{2,}/g, '\n').trim()
    : text
  return (
    <div className="flex flex-col items-end">
      {paths.length > 0 && (
        <div className="mb-1 flex flex-wrap justify-end gap-1.5">
          {paths.map((p) => (
            <img
              key={p}
              src={ccImageUrl(p)}
              alt="Attached image"
              onClick={() => setPreview(ccImageUrl(p))}
              className="h-20 w-20 cursor-zoom-in rounded border border-border object-cover"
            />
          ))}
        </div>
      )}
      {clean && (
        <div
          className={cn(
            'max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm',
            pending ? 'bg-accent/10 text-accent-fg/70' : 'bg-accent/20 text-accent-fg',
          )}
        >
          {clean}
        </div>
      )}
      <span className="mt-0.5 px-1 text-[10px] text-subtle">{pending ? 'Sending…' : fmtClock(ts)}</span>
      {preview && <ImageLightbox src={preview} onClose={() => setPreview(null)} />}
    </div>
  )
}

/** Claude slash command log (/model etc) compressed to one line: ⚙ command -- stdout (ANSI stripped / truncated). Pure caveat lines are hidden. */
function CommandLine({ text }: { text: string }) {
  const name = text.match(/<command-name>([^<]+)<\/command-name>/)?.[1]
  const stdout = text
    .match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/)?.[1]
    ?.replace(/\[\d+m/g, '')
    .trim()
  if (!name && !stdout) return null // pure caveat / no content -> hide
  return <Meta label={`⚙ ${name ?? 'command'}`} text={stdout ? stdout.slice(0, 100) : ''} ok />
}

function Meta({ label, text, warn, ok }: { label: string; text: string; warn?: boolean; ok?: boolean }) {
  return (
    <div className="flex items-baseline gap-2 px-1 text-xs">
      <span className={cn('font-medium', warn ? 'text-warn' : ok ? 'text-ok' : 'text-accent-fg')}>{label}</span>
      {text && <span className="truncate text-muted">{text}</span>}
    </div>
  )
}

function summarize(input: unknown): string {
  if (input == null) return ''
  try {
    const text = typeof input === 'string' ? input : JSON.stringify(input)
    return text.length > 120 ? `${text.slice(0, 120)}…` : text
  } catch {
    return ''
  }
}
