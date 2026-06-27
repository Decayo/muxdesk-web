import { createPatch, parsePatch } from 'diff'

/** Build a unified diff patch from before/after strings (used for Edit/Write tool entries). */
export function buildPatch(filePath: string, oldStr: string, newStr: string): string {
  return createPatch(filePath || 'file', oldStr ?? '', newStr ?? '', '', '', { context: 3 })
}

/**
 * Count added/removed lines in a unified diff. Only `+`/`-` lines *inside a hunk* count — matching by
 * prefix alone miscounts metadata and content that happens to start with `+`/`-` (e.g. an added `++i`
 * line becomes `+++i` in the patch; a content line `-- x` becomes `--- x`).
 */
export function countChangedLines(patch: string): { add: number; del: number } {
  let add = 0
  let del = 0
  let inHunk = false
  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) {
      inHunk = true
      continue
    }
    if (
      line.startsWith('diff --git ') ||
      line.startsWith('Index: ') ||
      line.startsWith('===') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ')
    ) {
      inHunk = false
      continue
    }
    if (!inHunk) continue
    if (line.startsWith('+')) add++
    else if (line.startsWith('-')) del++
  }
  return { add, del }
}

/** Strip the file-header preamble (Index:/===/---/+++) so an inline diff shows just the hunks. */
export function patchBody(patch: string): string {
  const i = patch.indexOf('\n@@')
  return i >= 0 ? patch.slice(i + 1) : patch
}

/**
 * True only when the text carries real per-file headers (`diff --git`, or `---` + `+++`),
 * which @pierre/diffs requires. A bare `@@` hunk (no file header) is NOT rich — it would make
 * PatchDiff throw "must contain exactly 1 file diff", so it falls back to the shiki "diff" lexer.
 */
export function isRichPatch(text: string): boolean {
  if (/^diff --git /m.test(text)) return true
  // Require an actual hunk, and look for the ---/+++ file headers only in the preamble before it,
  // so a hunk *content* line like `--- removed` can't masquerade as a header.
  const hunk = text.search(/^@@/m)
  if (hunk < 0) return false
  const preamble = text.slice(0, hunk)
  return /^--- /m.test(preamble) && /^\+\+\+ /m.test(preamble)
}

export type DiffCellKind = 'ctx' | 'del' | 'add'

export interface DiffCell {
  /** 1-based line number on this cell's own side. */
  n: number
  /** Index into this side's source-line array (`oldSrc`/`newSrc`), for per-row highlight lookup. */
  idx: number
  text: string
  kind: DiffCellKind
}

/** One side-by-side row: a cell per side, `null` where that side has no line (a pure add/del). */
export interface SplitRow {
  left: DiffCell | null
  right: DiffCell | null
}

export interface SplitDiff {
  rows: SplitRow[]
  /** Reconstructed per-side sources (context + removed / context + added) — one shiki pass each. */
  oldSrc: string
  newSrc: string
  /** Best file path (new side preferred) for source-language detection. */
  path: string
}

/** Drop a leading `a/`/`b/` git prefix; `/dev/null` (add/delete sentinel) is handled by the caller. */
function stripABPrefix(p: string): string {
  return p.replace(/^[ab]\//, '').trim()
}

/**
 * Turn a single-file unified patch into side-by-side rows for a split (two-column) diff view.
 * Removed/added runs are zipped row-by-row (GitHub-style); context lines occupy both sides.
 * `oldSrc`/`newSrc` are the reconstructed per-side sources so each column can be syntax-highlighted
 * in one shiki pass and looked up per row via `DiffCell.idx`. Returns empty `rows` on an unparseable
 * patch so the caller can fall back to the unified renderer.
 */
export function buildSplitRows(patch: string): SplitDiff {
  const oldLines: string[] = []
  const newLines: string[] = []
  const rows: SplitRow[] = []
  let dels: DiffCell[] = []
  let adds: DiffCell[] = []

  // Zip a buffered removed/added run into rows (pad the shorter side with a null cell).
  const flush = () => {
    const n = Math.max(dels.length, adds.length)
    for (let i = 0; i < n; i++) rows.push({ left: dels[i] ?? null, right: adds[i] ?? null })
    dels = []
    adds = []
  }

  let path = 'diff'
  try {
    const file = parsePatch(patch)[0]
    if (file) {
      const nf = file.newFileName
      const of = file.oldFileName
      const pick = nf && nf !== '/dev/null' ? nf : (of ?? 'diff')
      path = stripABPrefix(pick)
      for (const hunk of file.hunks) {
        let oldN = hunk.oldStart
        let newN = hunk.newStart
        for (const raw of hunk.lines) {
          const tag = raw[0] ?? ' '
          const text = raw.slice(1)
          if (tag === '\\') continue // "\ No newline at end of file"
          if (tag === '-') {
            dels.push({ n: oldN++, idx: oldLines.length, text, kind: 'del' })
            oldLines.push(text)
          } else if (tag === '+') {
            adds.push({ n: newN++, idx: newLines.length, text, kind: 'add' })
            newLines.push(text)
          } else {
            flush() // context line ends any pending change run before it lands on both sides
            const li = oldLines.length
            const ri = newLines.length
            oldLines.push(text)
            newLines.push(text)
            rows.push({
              left: { n: oldN++, idx: li, text, kind: 'ctx' },
              right: { n: newN++, idx: ri, text, kind: 'ctx' },
            })
          }
        }
        flush()
      }
    }
  } catch {
    // unparseable patch -> empty rows; caller falls back to the unified view
  }

  return { rows, oldSrc: oldLines.join('\n'), newSrc: newLines.join('\n'), path }
}
