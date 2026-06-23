import { useEffect, useState } from 'react'
import { getPreflight, type PreflightCheck } from '@/api/muxDesk'

type Status =
  | { kind: 'loading' }
  | { kind: 'unreachable' }
  | { kind: 'ready'; failing: PreflightCheck[] }

/** Dependency preflight banner.
 *
 * muxdesk drives a *real* tmux + claude — so when those are missing the demo
 * cannot work. This warns explicitly (instead of an opaque failure) and lists
 * install hints. Also catches the case where the backend itself is unreachable.
 * Shown across the top of the workbench; dismissible; checked once on mount. */
export function MxPreflightBanner() {
  const [status, setStatus] = useState<Status>({ kind: 'loading' })
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let alive = true
    getPreflight()
      .then((p) => alive && setStatus({ kind: 'ready', failing: p.checks.filter((c) => c.required && !c.ok) }))
      .catch(() => alive && setStatus({ kind: 'unreachable' }))
    return () => {
      alive = false
    }
  }, [])

  if (dismissed || status.kind === 'loading') return null
  if (status.kind === 'ready' && status.failing.length === 0) return null

  const unreachable = status.kind === 'unreachable'
  const failing = status.kind === 'ready' ? status.failing : []

  return (
    <div className="flex flex-col gap-1 border-b border-warn/40 bg-warn/10 px-4 py-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="font-medium text-warn">
          ⚠ {unreachable ? 'muxdesk backend not reachable' : 'Missing dependencies — the demo needs a real tmux + claude'}
        </span>
        <button type="button" onClick={() => setDismissed(true)} className="ml-auto text-subtle hover:text-fg">
          dismiss
        </button>
      </div>
      {unreachable ? (
        <span className="text-muted">
          Can&apos;t reach the backend (default <code className="font-mono">:8001</code>). Start it with{' '}
          <code className="font-mono">./serve.sh start</code> or <code className="font-mono">./serve.sh demo</code>.
        </span>
      ) : (
        <ul className="space-y-0.5">
          {failing.map((c) => (
            <li key={c.name} className="text-muted">
              <span className="font-mono text-danger">✗ {c.name}</span> — {c.detail}
              {c.hint && <span className="text-subtle"> · {c.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
