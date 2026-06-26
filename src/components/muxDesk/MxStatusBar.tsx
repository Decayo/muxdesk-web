import { fmtTokens } from '@/lib/format'

/** Friendly model label: `claude-opus-4-8[1m]` -> `Opus 4.8 · 1M`; unknown ids degrade gracefully. */
export function prettyModel(id: string): string {
  const ctx = /\[1m\]/i.test(id) ? ' · 1M' : ''
  const base = id.replace(/\[1m\]/i, '').replace(/^claude-/, '')
  const m = base.match(/^(opus|sonnet|haiku)-(\d+)-(\d+)/i)
  if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}${ctx}`
  return base + ctx
}

function basename(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path
}

function Sep() {
  return <span className="text-border-strong">│</span>
}

/**
 * cmux-style status bar (front-end aggregated). Renders segments from data the client already has:
 * model, mode/state, cwd, accumulated tokens. Backend-fed segments (context %, git branch, shell
 * count) are a planned follow-up via a status endpoint.
 */
export function MxStatusBar({
  model,
  mode,
  state,
  cwd,
  tokenTotal,
}: {
  model?: string | null
  mode?: string
  state?: string
  cwd?: string | null
  tokenTotal?: number
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 overflow-hidden font-mono text-[11px] text-muted">
      {model && <span className="text-fg">{prettyModel(model)}</span>}
      {(mode || state) && (
        <>
          <Sep />
          <span>
            {mode ? <span className="text-subtle">{mode}</span> : null}
            {mode && state ? ' · ' : ''}
            {state ? <span className={state === 'READY' ? 'text-ok' : 'text-accent'}>{state}</span> : null}
          </span>
        </>
      )}
      {cwd && (
        <>
          <Sep />
          <span title={cwd}>📁 {basename(cwd)}</span>
        </>
      )}
      {tokenTotal != null && tokenTotal > 0 && (
        <>
          <Sep />
          <span className="tabular-nums">Σ {fmtTokens(tokenTotal)} tok</span>
        </>
      )}
    </div>
  )
}
