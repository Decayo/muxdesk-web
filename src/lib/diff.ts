import { createPatch } from 'diff'

/** Build a unified diff patch from before/after strings (used for Edit/Write tool entries). */
export function buildPatch(filePath: string, oldStr: string, newStr: string): string {
  return createPatch(filePath || 'file', oldStr ?? '', newStr ?? '', '', '', { context: 3 })
}

/** Count added/removed lines in a unified diff (ignores the ---/+++ file headers). */
export function countChangedLines(patch: string): { add: number; del: number } {
  let add = 0
  let del = 0
  for (const line of patch.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) add++
    else if (line.startsWith('-') && !line.startsWith('---')) del++
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
  return /^--- /m.test(text) && /^\+\+\+ /m.test(text)
}
