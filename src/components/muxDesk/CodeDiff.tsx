import { useState } from 'react'
import { CodeBlock } from './CodeBlock'
import { countChangedLines, isRichPatch, patchBody } from '@/lib/diff'

/** Diffs ≤ this many changed lines render inline; larger ones collapse to a summary that opens on click. */
const INLINE_MAX = 20

/** First file path referenced by a unified patch (for the collapsed summary header). */
function patchFileLabel(patch: string): string {
  const plus = patch.match(/^\+\+\+ [ab]?\/?(.+)$/m)?.[1]
  if (plus && plus !== '/dev/null') return plus.trim()
  return patch.match(/^Index: (.+)$/m)?.[1]?.trim() ?? 'diff'
}

/**
 * Two-layer diff renderer (t3code-style), highlighted with the shiki "diff" lexer (red/green lines).
 * - bare +/- block or ≤ INLINE_MAX changed lines -> rendered inline.
 * - larger -> collapsed "{file} +N −M" summary; expands to a scrollable full-patch panel.
 * `compact` drops the file-header preamble (the caller — e.g. a WORK LOG row — already shows the file).
 * (Split view + worker-virtualized rendering for very large diffs via @pierre/diffs is a planned follow-up.)
 */
export function CodeDiff({ patch, compact = false }: { patch: string; compact?: boolean }) {
  const { add, del } = countChangedLines(patch)
  const big = isRichPatch(patch) && add + del > INLINE_MAX
  const [open, setOpen] = useState(false)

  if (!big) {
    return <CodeBlock code={compact ? patchBody(patch) : patch} lang="diff" />
  }

  return (
    <div className="my-2">
      <div className="flex items-center gap-2 rounded-md border border-border/60 bg-panel/40 px-2.5 py-1 text-xs">
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 text-fg hover:text-accent">
          <span className="text-subtle">{open ? '▾' : '▸'}</span>
          <span className="font-mono">{patchFileLabel(patch)}</span>
        </button>
        <span className="tabular-nums text-ok">+{add}</span>
        <span className="tabular-nums text-danger">−{del}</span>
      </div>
      {open && (
        <div className="max-h-[60vh] overflow-auto">
          <CodeBlock code={patchBody(patch)} lang="diff" />
        </div>
      )}
    </div>
  )
}
