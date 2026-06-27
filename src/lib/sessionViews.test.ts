import { describe, it, expect } from 'vitest'
import type { MxSession } from '@/types/muxDesk'
import { buildSessionTree, childrenOf, groupByProject } from './sessionViews'

function s(id: string, extra: Partial<MxSession> = {}): MxSession {
  return {
    app_session_id: id,
    tmux_session: `t-${id}`,
    workspace_path: '/ws',
    model: null,
    title: id,
    mode: 'AUTO',
    state: 'READY',
    status: 'active',
    claude_session_id: null,
    created_at: null,
    last_event_at: null,
    ...extra,
  }
}

describe('buildSessionTree', () => {
  it('nests children under parents with increasing depth', () => {
    const rows = buildSessionTree([s('p'), s('c1', { parent_session_id: 'p' }), s('c2', { parent_session_id: 'p' }), s('g', { parent_session_id: 'c1' })])
    expect(rows.map((r) => [r.session.app_session_id, r.depth])).toEqual([
      ['p', 0],
      ['c1', 1],
      ['g', 2],
      ['c2', 1],
    ])
  })

  it('treats orphan parents (not in set) as roots', () => {
    const rows = buildSessionTree([s('x', { parent_session_id: 'gone' })])
    expect(rows).toEqual([{ session: rows[0].session, depth: 0 }])
    expect(rows[0].depth).toBe(0)
  })

  it('flat list when nobody has a parent', () => {
    const rows = buildSessionTree([s('a'), s('b')])
    expect(rows.map((r) => r.depth)).toEqual([0, 0])
  })

  it('does not loop on a cycle and still emits every session', () => {
    const rows = buildSessionTree([s('a', { parent_session_id: 'b' }), s('b', { parent_session_id: 'a' })])
    expect(new Set(rows.map((r) => r.session.app_session_id))).toEqual(new Set(['a', 'b']))
  })
})

describe('childrenOf', () => {
  it('returns only the direct children of a parent', () => {
    const all = [s('p'), s('c1', { parent_session_id: 'p' }), s('c2', { parent_session_id: 'p' }), s('x')]
    expect(childrenOf(all, 'p').map((c) => c.app_session_id)).toEqual(['c1', 'c2'])
    expect(childrenOf(all, 'x')).toEqual([])
  })
})

describe('groupByProject', () => {
  it('groups by project with untagged last', () => {
    const groups = groupByProject([s('a', { project: 'zeta' }), s('b'), s('c', { project: 'alpha' }), s('d', { project: 'alpha' })])
    expect(groups.map(([k, v]) => [k, v.map((x) => x.app_session_id)])).toEqual([
      ['alpha', ['c', 'd']],
      ['zeta', ['a']],
      ['(no project)', ['b']],
    ])
  })
})
