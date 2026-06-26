import type { MxEvent } from '@/types/muxDesk'

/** One tool invocation (tool_start paired with its tool_end by tool_use_id). */
export interface ToolEntry {
  id: string
  name: string
  input: unknown
  done: boolean
  isError: boolean
  content: unknown
}

/** Render item: either a standalone event or a run of consecutive regular-tool calls (a WORK LOG group). */
export type RenderItem =
  | { kind: 'event'; event: MxEvent; key: string }
  | { kind: 'tools'; entries: ToolEntry[]; key: string }

/** Event types that produce visible output and therefore break a tool run (everything else is skipped). */
export const GROUP_BREAKERS = new Set([
  'user_message',
  'assistant_message',
  'assistant_thinking',
  'artifact_written',
  'image',
  'error',
])

/**
 * Detect a muxdesk-ask question: Skill(muxdesk-ask) or Bash(scripts/muxdesk-ask) -> first question
 * text ('' if not extractable); a non-muxdesk-ask tool -> undefined.
 */
export function ccAskQuestion(toolName: string, input: unknown): string | undefined {
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

/**
 * Strip muxdesk-ask question tool noise (fixes misbinding visual clutter):
 * - AskUserQuestion tool_use (always blocked by hook -> ✗ tool): drop the entire pair
 * - Skill(muxdesk-ask) tool_use (detour for loading instructions): drop the entire pair
 * Only keep Bash(scripts/muxdesk-ask) -> rendered as a single "❓ question".
 * Pairs matched by tool_use_id to also drop the corresponding tool_end.
 */
export function stripCcAskNoise(events: MxEvent[]): MxEvent[] {
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
export function eventSig(e: MxEvent): string {
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

/**
 * Apply the conversation view mode. 'focus' drops internal `assistant_thinking` blocks
 * (results-only view); 'full' keeps everything. Pure — both stream and tests use it.
 */
export function applyViewMode(events: MxEvent[], mode: 'full' | 'focus'): MxEvent[] {
  if (mode === 'full') return events
  return events.filter((e) => e.event_type !== 'assistant_thinking')
}

/** Drop logical-duplicate events (keep first) so re-emitted transcripts don't double-render. */
export function dedupeEvents(events: MxEvent[]): MxEvent[] {
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

/** A "regular" tool gets folded into WORK LOG; ask-questions / spawned agents stay standalone (own line / card). */
export function isRegularToolStart(name: string, input: unknown): boolean {
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
export function buildRenderItems(events: MxEvent[]): RenderItem[] {
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
