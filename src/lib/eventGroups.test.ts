import { describe, it, expect } from 'vitest'
import type { MxEvent } from '@/types/muxDesk'
import {
  buildRenderItems,
  ccAskQuestion,
  dedupeEvents,
  eventSig,
  isRegularToolStart,
  stripCcAskNoise,
} from './eventGroups'

let seqCounter = 0
function ev(event_type: string, payload: Record<string, unknown> = {}, seq?: number): MxEvent {
  return { session_id: 's', event_type, seq: seq ?? ++seqCounter, payload }
}
const toolStart = (name: string, id: string, input: unknown = {}, seq?: number) =>
  ev('tool_start', { tool_name: name, tool_use_id: id, input }, seq)
const toolEnd = (id: string, isError = false, content: unknown = 'ok', seq?: number) =>
  ev('tool_end', { tool_use_id: id, is_error: isError, content }, seq)

describe('eventSig', () => {
  it('keys tools by tool_use_id (stable across re-emit seqs)', () => {
    expect(eventSig(toolStart('Read', 't1', {}, 1))).toBe('ts:t1')
    expect(eventSig(toolStart('Read', 't1', {}, 999))).toBe('ts:t1')
    expect(eventSig(toolEnd('t1', false, 'x', 2))).toBe('te:t1')
  })

  it('keys messages by uuid+text, control events by seq', () => {
    expect(eventSig(ev('assistant_message', { uuid: 'u1', text: 'hi' }, 5))).toBe('assistant_message:u1:2:hi')
    expect(eventSig(ev('state_change', { state: 'READY' }, 7))).toBe('state_change:7')
  })
})

describe('dedupeEvents', () => {
  it('drops re-emitted tools with the same id but a new seq', () => {
    const out = dedupeEvents([toolStart('Read', 't1', {}, 1), toolStart('Read', 't1', {}, 50)])
    expect(out).toHaveLength(1)
    expect(out[0].seq).toBe(1) // keeps first
  })

  it('keeps distinct control events (seq-keyed)', () => {
    const out = dedupeEvents([ev('state_change', {}, 1), ev('state_change', {}, 2)])
    expect(out).toHaveLength(2)
  })
})

describe('isRegularToolStart', () => {
  it('treats normal tools as regular', () => {
    expect(isRegularToolStart('Read', { file_path: 'a' })).toBe(true)
    expect(isRegularToolStart('Bash', { command: 'ls' })).toBe(true)
  })

  it('excludes ask-questions and spawned agents', () => {
    expect(isRegularToolStart('AskUserQuestion', { questions: [] })).toBe(false)
    expect(isRegularToolStart('Bash', { command: "/x/muxdesk-ask '{}'" })).toBe(false)
    expect(isRegularToolStart('Task', { name: 'a', description: 'd' })).toBe(false)
    expect(isRegularToolStart('Agent', { name: 'a' })).toBe(false)
  })
})

describe('ccAskQuestion', () => {
  it('extracts the first question from a Bash(muxdesk-ask) command', () => {
    const cmd = `/p/muxdesk-ask '${JSON.stringify({ questions: [{ question: 'Pick?' }] })}'`
    expect(ccAskQuestion('Bash', { command: cmd })).toBe('Pick?')
  })

  it('extracts from Skill(muxdesk-ask) args', () => {
    expect(ccAskQuestion('Skill', { skill: 'muxdesk-ask', args: JSON.stringify({ questions: [{ question: 'Q?' }] }) })).toBe('Q?')
  })

  it('returns undefined for non-ask tools', () => {
    expect(ccAskQuestion('Read', { file_path: 'a' })).toBeUndefined()
  })
})

describe('stripCcAskNoise', () => {
  it('drops AskUserQuestion start+end pair but keeps a Bash(muxdesk-ask) line', () => {
    const events = [
      toolStart('AskUserQuestion', 'a1', { questions: [] }),
      toolEnd('a1', true),
      toolStart('Bash', 'b1', { command: "/x/muxdesk-ask '{}'" }),
      toolEnd('b1'),
    ]
    const out = stripCcAskNoise(events)
    expect(out.find((e) => e.payload.tool_use_id === 'a1')).toBeUndefined()
    expect(out.filter((e) => e.payload.tool_use_id === 'b1')).toHaveLength(2)
  })
})

describe('buildRenderItems', () => {
  it('folds consecutive regular tools into one group with paired status', () => {
    const items = buildRenderItems([
      toolStart('Read', 't1', { file_path: 'a' }),
      toolEnd('t1'),
      toolStart('Bash', 't2', { command: 'ls' }),
      toolEnd('t2', true),
    ])
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('tools')
    if (items[0].kind === 'tools') {
      expect(items[0].entries.map((e) => e.name)).toEqual(['Read', 'Bash'])
      expect(items[0].entries.every((e) => e.done)).toBe(true)
      expect(items[0].entries[1].isError).toBe(true)
    }
  })

  it('keeps tools grouped across invisible control events', () => {
    const items = buildRenderItems([
      toolStart('Read', 't1'),
      ev('state_change', { state: 'RUNNING_TOOL' }),
      toolEnd('t1'),
      toolStart('Bash', 't2'),
      toolEnd('t2'),
    ])
    expect(items).toHaveLength(1)
    if (items[0].kind === 'tools') expect(items[0].entries).toHaveLength(2)
  })

  it('splits groups on a visible message, which renders standalone', () => {
    const items = buildRenderItems([
      toolStart('Read', 't1'),
      toolEnd('t1'),
      ev('assistant_message', { text: 'done', uuid: 'u1' }),
      toolStart('Bash', 't2'),
      toolEnd('t2'),
    ])
    expect(items.map((i) => i.kind)).toEqual(['tools', 'event', 'tools'])
  })

  it('pairs tool_end across an interleaved artifact_written (no orphan)', () => {
    const items = buildRenderItems([
      toolStart('Write', 'w1', { file_path: 'f.py', content: 'x' }),
      ev('artifact_written', { rel_path: 'f.py' }),
      toolEnd('w1'),
    ])
    // group flushes at artifact_written, but the Write entry still resolves its end via the global map
    expect(items[0].kind).toBe('tools')
    if (items[0].kind === 'tools') {
      expect(items[0].entries).toHaveLength(1)
      expect(items[0].entries[0].done).toBe(true)
    }
    expect(items.some((i) => i.kind === 'tools' && i.entries.some((e) => e.name === 'tool'))).toBe(false)
  })

  it('renders spawned agents standalone, not folded', () => {
    const items = buildRenderItems([toolStart('Task', 'k1', { name: 'agent', description: 'd' }), toolEnd('k1')])
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('event')
  })
})
