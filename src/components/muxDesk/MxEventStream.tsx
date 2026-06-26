import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { fmtClock, fmtTokens } from '@/lib/format'
import type { MxEvent } from '@/types/muxDesk'
import { ccImageUrl, getSessionLive, type SubagentNode } from '@/api/nativeAgents'
import { MxMessage } from './MxMessage'
import { ImageLightbox } from './ImageLightbox'
import { WorkLog, ToolEntryRow, type ToolEntry } from './WorkLog'

interface Props {
  events: MxEvent[]
  state?: string
  pendingText?: string
  /** Current session (for live preview during streaming). */
  sessionId?: string | null
  /** Lead's Task subagents (name->stats), renders Agent tool_start as tree cards (tool uses / tokens / status). */
  agentsByName?: Record<string, SubagentNode>
}

/**
 * Strip muxdesk-ask question tool noise (fixes misbinding visual clutter):
 * - AskUserQuestion tool_use (always blocked by hook -> ✗ tool): drop the entire pair
 * - Skill(muxdesk-ask) tool_use (detour for loading instructions): drop the entire pair
 * Only keep Bash(scripts/muxdesk-ask) -> EventRow renders as a single "❓ question".
 * Pairs matched by tool_use_id to also drop the corresponding tool_end.
 */
function stripCcAskNoise(events: MxEvent[]): MxEvent[] {
  const drop = new Set<string>()
  for (const e of events) {
    if (e.event_type !== 'tool_start') continue
    const id = e.payload?.tool_use_id
    if (!id) continue
    const name = String(e.payload?.tool_name ?? '')
    const input = e.payload?.input as { skill?: string } | undefined
    if (name === 'AskUserQuestion' || (name === 'Skill' && input?.skill === 'muxdesk-ask')) {
      drop.add(String(id))
    }
  }
  if (!drop.size) return events
  return events.filter((e) => {
    const id = e.payload?.tool_use_id
    return !(id && drop.has(String(id)))
  })
}

/**
 * Stable per-event identity for dedup. seq is an emission counter, NOT a stable id: a WS
 * reconnect with after_seq=0 (e.g. StrictMode's second mount) re-emits the whole transcript
 * with fresh seqs, so seq-based dedup misses logical duplicates. Tool calls are keyed by
 * tool_use_id and messages by uuid+text (both stable across re-emits); control events keep
 * their seq (they're skipped at render time, so never collapsed).
 */
function eventSig(e: MxEvent): string {
  const p = e.payload
  switch (e.event_type) {
    case 'tool_start':
      return `ts:${p.tool_use_id}`
    case 'tool_end':
      return `te:${p.tool_use_id}`
    case 'assistant_message':
    case 'user_message':
    case 'assistant_thinking': {
      const txt = typeof p.text === 'string' ? p.text : ''
      return `${e.event_type}:${p.uuid ?? ''}:${txt.length}:${txt.slice(0, 40)}`
    }
    default:
      return `${e.event_type}:${e.seq}`
  }
}

/** Drop logical-duplicate events (keep first) so re-emitted transcripts don't double-render. */
function dedupeEvents(events: MxEvent[]): MxEvent[] {
  const seen = new Set<string>()
  const out: MxEvent[] = []
  for (const e of events) {
    const sig = eventSig(e)
    if (seen.has(sig)) continue
    seen.add(sig)
    out.push(e)
  }
  return out
}

/** Event types that produce visible output and therefore break a tool run (everything else is skipped). */
const GROUP_BREAKERS = new Set(['user_message', 'assistant_message', 'assistant_thinking', 'artifact_written', 'image', 'error'])

/** Render item: either a standalone event or a run of consecutive regular-tool calls (a WORK LOG group). */
type RenderItem = { kind: 'event'; event: MxEvent; key: string } | { kind: 'tools'; entries: ToolEntry[]; key: string }

/** A "regular" tool gets folded into WORK LOG; ask-questions / spawned agents stay standalone (own line / card). */
function isRegularToolStart(name: string, input: unknown): boolean {
  if (ccAskQuestion(name, input) !== undefined) return false
  if (name === 'AskUserQuestion') return false
  if ((name === 'Task' || name === 'Agent') && input && typeof input === 'object' && 'name' in input) return false
  return true
}

/**
 * Group regular tool calls into WORK LOG blocks. tool_start/tool_end are paired GLOBALLY by
 * tool_use_id (first pass) so an event arriving between them — e.g. artifact_written — doesn't
 * orphan the result. tool_end events are then ignored in the grouping pass (consumed via the map).
 * A visible non-tool event (GROUP_BREAKERS) flushes the current run; invisible control events are
 * skipped without flushing, so tools separated only by them still fold into one group.
 */
function buildRenderItems(events: MxEvent[]): RenderItem[] {
  // First pass: index every tool_end by tool_use_id.
  const ends = new Map<string, { isError: boolean; content: unknown }>()
  for (const e of events) {
    if (e.event_type !== 'tool_end') continue
    const id = String(e.payload.tool_use_id ?? '')
    if (id) ends.set(id, { isError: Boolean(e.payload.is_error), content: e.payload.content })
  }

  const items: RenderItem[] = []
  let group: ToolEntry[] = []

  const flush = () => {
    if (group.length) {
      items.push({ kind: 'tools', entries: group, key: `tools-${group[0].id}` })
      group = []
    }
  }

  for (const e of events) {
    if (e.event_type === 'tool_start') {
      const name = String(e.payload.tool_name ?? 'tool')
      const input = e.payload.input
      const id = String(e.payload.tool_use_id ?? `s${e.seq}`)
      if (!isRegularToolStart(name, input)) {
        flush()
        items.push({ kind: 'event', event: e, key: `ev-${e.seq}` })
        continue
      }
      const end = ends.get(id)
      group.push({ id, name, input, done: !!end, isError: end?.isError ?? false, content: end?.content })
      continue
    }
    // tool_end (paired above) + invisible control events are skipped WITHOUT flushing.
    if (!GROUP_BREAKERS.has(e.event_type)) continue
    flush()
    items.push({ kind: 'event', event: e, key: `ev-${e.seq}` })
  }
  flush()
  return items
}

export function MxEventStream({ events: rawEvents, state, pendingText, sessionId, agentsByName }: Props) {
  const events = dedupeEvents(stripCcAskNoise(rawEvents))
  const bottomRef = useRef<HTMLDivElement>(null)

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

  // Auto-scroll to bottom: scroll on event count / optimistic input / state / live preview text changes (live.text grows during streaming -> keeps scrolling)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [events.length, pendingText, state, live.text])

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
    <div className="flex-1 overflow-y-auto px-4 py-3">
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

/** Detect muxdesk-ask question: Skill(muxdesk-ask) or Bash(scripts/muxdesk-ask) -> return first question text ('' if not extractable); non-muxdesk-ask -> undefined. */
function ccAskQuestion(toolName: string, input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const o = input as Record<string, unknown>
  let raw: string | undefined
  if (toolName === 'Skill' && o.skill === 'muxdesk-ask') {
    raw = typeof o.args === 'string' ? o.args : undefined
  } else if (toolName === 'Bash' && typeof o.command === 'string' && /\/muxdesk-ask\s/.test(o.command)) {
    raw = (o.command.match(/muxdesk-ask\s+'([\s\S]+)'\s*$/) ?? [])[1]
  } else {
    return undefined
  }
  if (!raw) return ''
  try {
    return String((JSON.parse(raw) as { questions?: { question?: string }[] }).questions?.[0]?.question ?? '')
  } catch {
    return ''
  }
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
