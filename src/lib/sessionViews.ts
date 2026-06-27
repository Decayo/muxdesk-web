import type { MxSession } from '@/types/muxDesk'

export interface TreeRow {
  session: MxSession
  depth: number
}

/**
 * Flatten sessions into a parent→child tree (pre-order, indent via `depth`). A session whose
 * parent isn't in the set is treated as a root (orphan). Input order is preserved within siblings;
 * a cycle can't loop forever (each session is emitted at most once).
 */
export function buildSessionTree(sessions: MxSession[]): TreeRow[] {
  const ids = new Set(sessions.map((s) => s.app_session_id))
  const childrenOf = new Map<string, MxSession[]>()
  const roots: MxSession[] = []
  for (const s of sessions) {
    const parent = s.parent_session_id
    if (parent && parent !== s.app_session_id && ids.has(parent)) {
      const arr = childrenOf.get(parent) ?? []
      arr.push(s)
      childrenOf.set(parent, arr)
    } else {
      roots.push(s)
    }
  }
  const out: TreeRow[] = []
  const seen = new Set<string>()
  const walk = (session: MxSession, depth: number) => {
    if (seen.has(session.app_session_id)) return // cycle guard
    seen.add(session.app_session_id)
    out.push({ session, depth })
    for (const child of childrenOf.get(session.app_session_id) ?? []) walk(child, depth + 1)
  }
  for (const root of roots) walk(root, 0)
  // any session not reached (e.g. caught in a cycle) still gets shown, at the top level
  for (const s of sessions) if (!seen.has(s.app_session_id)) out.push({ session: s, depth: 0 })
  return out
}

const NO_PROJECT = '(no project)'

/** Group sessions by `project` (untagged -> "(no project)", sorted last); group order alphabetical. */
export function groupByProject(sessions: MxSession[]): [string, MxSession[]][] {
  const groups = new Map<string, MxSession[]>()
  for (const s of sessions) {
    const key = s.project || NO_PROJECT
    const arr = groups.get(key) ?? []
    arr.push(s)
    groups.set(key, arr)
  }
  return [...groups.entries()].sort((a, b) => {
    if (a[0] === NO_PROJECT) return 1
    if (b[0] === NO_PROJECT) return -1
    return a[0] < b[0] ? -1 : 1
  })
}
