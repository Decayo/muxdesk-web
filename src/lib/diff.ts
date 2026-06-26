import { createPatch } from 'diff'

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
