import { useEffect, useMemo, useState } from 'react'
import { CodeBlock } from './CodeBlock'
import { buildSplitRows, countChangedLines, isRichPatch, patchBody, type DiffCell, type SplitRow } from '@/lib/diff'
import { highlightToLines, langForFile } from '@/lib/shiki'

/** Diffs ≤ this many changed lines render inline; larger ones collapse to a summary that opens on click. */
const INLINE_MAX = 20

/** First file path referenced by a unified patch (for the collapsed summary header). */
function patchFileLabel(patch: string): string {
  // Only strip a real `a/` or `b/` prefix — not a leading "a"/"b" of an actual path (e.g. api/foo.ts).
  const plus = patch.match(/^\+\+\+ (?:[ab]\/)?(.+)$/m)?.[1]
  if (plus && plus !== '/dev/null') return plus.trim()
  return patch.match(/^Index: (.+)$/m)?.[1]?.trim() ?? 'diff'
}

type DiffView = 'unified' | 'split'

/**
 * Two-layer diff renderer (t3code-style), highlighted with the shiki "diff" lexer (red/green lines).
 * - bare +/- block or ≤ INLINE_MAX changed lines -> rendered inline (unified).
 * - larger -> collapsed "{file} +N −M" summary; expands to a scrollable full-patch panel with a
 *   unified | split toggle (split = side-by-side columns, each highlighted in the source language).
 * `compact` drops the file-header preamble (the caller — e.g. a WORK LOG row — already shows the file).
 */
export function CodeDiff({ patch, compact = false }: { patch: string; compact?: boolean }) {
  const { add, del } = countChangedLines(patch)
  const big = isRichPatch(patch) && add + del > INLINE_MAX
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<DiffView>('unified')

  if (!big) {
    return <CodeBlock code={compact ? patchBody(patch) : patch} lang="diff" />
  }

  return (
    <div className="my-2">
      <div className="flex items-center gap-2 rounded-md border border-border/60 bg-panel/40 px-2.5 py-1 text-xs">
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 text-fg hover:text-accent">
          <span className="text-subtle">{open ? '▾' : '▸'}</span>
          <span className="font-mono">{patchFileLabel(patch)}</span>
        </button>
        <span className="tabular-nums text-ok">+{add}</span>
        <span className="tabular-nums text-danger">−{del}</span>
        <div className="ml-auto flex items-center gap-0.5 text-[10px]" role="group" aria-label="diff view">
          {(['unified', 'split'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => {
                setView(v)
                setOpen(true)
              }}
              className={`rounded px-1.5 py-0.5 ${view === v ? 'bg-accent/20 text-accent' : 'text-subtle hover:text-fg'}`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      {open && (
        <div className="max-h-[60vh] overflow-auto rounded-b-md border border-t-0 border-border/60">
          {view === 'split' ? <CodeDiffSplit patch={patch} /> : <CodeBlock code={patchBody(patch)} lang="diff" />}
        </div>
      )}
    </div>
  )
}

/**
 * Side-by-side diff: old | new columns, each syntax-highlighted in the source language (one shiki
 * pass per side, looked up per row). Falls back to the unified shiki "diff" view if the patch can't
 * be parsed into rows. Renders raw text first, swapping in highlighted spans once shiki resolves.
 */
function CodeDiffSplit({ patch }: { patch: string }) {
  const { rows, oldSrc, newSrc, path } = useMemo(() => buildSplitRows(patch), [patch])
  const [hl, setHl] = useState<{ old: string[]; new: string[] } | null>(null)

  useEffect(() => {
    let alive = true
    setHl(null)
    const lang = langForFile(path)
    Promise.all([highlightToLines(oldSrc, lang), highlightToLines(newSrc, lang)])
      .then(([o, n]) => alive && setHl({ old: o, new: n }))
      .catch(() => alive && setHl(null))
    return () => {
      alive = false
    }
  }, [oldSrc, newSrc, path])

  if (rows.length === 0) return <CodeBlock code={patchBody(patch)} lang="diff" />

  return (
    <div className="grid min-w-max grid-cols-[auto_1fr_auto_1fr] bg-[#0d1117] font-mono text-[12.5px] leading-[1.55]">
      {rows.map((row, i) => (
        <SplitRowCells key={i} row={row} oldHtml={hl?.old} newHtml={hl?.new} />
      ))}
    </div>
  )
}

/** One grid row = four cells: [old #][old code][new #][new code]. */
function SplitRowCells({ row, oldHtml, newHtml }: { row: SplitRow; oldHtml?: string[]; newHtml?: string[] }) {
  return (
    <>
      <SideCell cell={row.left} html={oldHtml} />
      <SideCell cell={row.right} html={newHtml} />
    </>
  )
}

/** A line number + code cell for one side; renders empty (tinted) filler when the side has no line. */
function SideCell({ cell, html }: { cell: DiffCell | null; html?: string[] }) {
  if (!cell) {
    return (
      <>
        <span className="select-none bg-panel/30 px-2" />
        <span className="bg-panel/30 px-2" />
      </>
    )
  }
  const tint = cell.kind === 'del' ? 'bg-danger/10' : cell.kind === 'add' ? 'bg-ok/10' : ''
  const sign = cell.kind === 'del' ? '−' : cell.kind === 'add' ? '+' : ' '
  const lineHtml = html?.[cell.idx]
  return (
    <>
      <span className={`select-none px-2 text-right tabular-nums text-subtle/70 ${tint}`}>{cell.n}</span>
      <span className={`whitespace-pre px-2 text-[#c9d1d9] ${tint}`}>
        <span className="select-none text-subtle/60">{sign} </span>
        {lineHtml != null ? <span dangerouslySetInnerHTML={{ __html: lineHtml }} /> : cell.text}
      </span>
    </>
  )
}
