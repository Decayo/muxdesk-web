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
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path
}

/** Compact token count for the context segment: 945000 -> "945k", 1000000 -> "1M". */
export function fmtCtx(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
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
  context,
  gitBranch,
  gitDirty,
  shells,
}: {
  model?: string | null
  mode?: string
  state?: string
  cwd?: string | null
  tokenTotal?: number
  context?: { peak: number; window: number; pct: number } | null
  gitBranch?: string | null
  gitDirty?: number
  shells?: number
}) {
  const ctxCls = context ? (context.pct >= 90 ? 'text-danger' : context.pct >= 70 ? 'text-warn' : 'text-muted') : ''
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
      {context && (
        <>
          <Sep />
          <span className={ctxCls} title="peak context usage this session">
            ctx {context.pct}% <span className="tabular-nums">{fmtCtx(context.peak)}/{fmtCtx(context.window)}</span>
          </span>
        </>
      )}
      {cwd && (
        <>
          <Sep />
          <span title={cwd}>📁 {basename(cwd)}</span>
        </>
      )}
      {gitBranch && (
        <>
          <Sep />
          <span title="git branch · uncommitted changes">
            ⎇ {gitBranch}
            {gitDirty ? <span className="text-warn">~{gitDirty}</span> : null}
          </span>
        </>
      )}
      {shells != null && shells > 0 && (
        <>
          <Sep />
          <span className="tabular-nums" title="open shells (tmux panes)">
            ⌨ {shells}
          </span>
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
