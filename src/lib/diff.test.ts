import { describe, it, expect } from 'vitest'
import { buildPatch, buildSplitRows, countChangedLines, isRichPatch, patchBody } from './diff'

describe('buildPatch', () => {
  it('produces a unified patch with file headers and a hunk', () => {
    const p = buildPatch('a.ts', 'const a = 1\n', 'const a = 2\n')
    expect(p).toMatch(/^--- a\.ts/m)
    expect(p).toMatch(/^\+\+\+ a\.ts/m)
    expect(p).toMatch(/^@@ /m)
    expect(p).toContain('-const a = 1')
    expect(p).toContain('+const a = 2')
  })

  it('tolerates null/undefined sides', () => {
    expect(() => buildPatch('', undefined as unknown as string, undefined as unknown as string)).not.toThrow()
  })
})

describe('countChangedLines', () => {
  it('counts additions/deletions, ignoring the ---/+++ headers', () => {
    const p = buildPatch('a.ts', 'x = 1\ny = 2\n', 'x = 1\ny = 3\nz = 4\n')
    expect(countChangedLines(p)).toEqual({ add: 2, del: 1 })
  })

  it('a new file (empty old) is all additions', () => {
    const p = buildPatch('n.py', '', 'a = 1\nb = 2\nc = 3\n')
    expect(countChangedLines(p)).toEqual({ add: 3, del: 0 })
  })

  it('counts hunk content that itself starts with +/- (e.g. ++i -> +++i)', () => {
    const patch = ['@@ -1,2 +1,2 @@', ' ctx', '-- old marker', '+++i', ' tail'].join('\n')
    expect(countChangedLines(patch)).toEqual({ add: 1, del: 1 })
  })
})

describe('isRichPatch', () => {
  it('is true for a real unified patch (---/+++ headers)', () => {
    expect(isRichPatch(buildPatch('a.ts', 'a\n', 'b\n'))).toBe(true)
  })

  it('is true for a git patch', () => {
    expect(isRichPatch('diff --git a/x b/x\n@@ -1 +1 @@\n-a\n+b')).toBe(true)
  })

  it('is false for a bare @@ hunk (no file header)', () => {
    expect(isRichPatch('@@ -1,3 +1,3 @@\n def f():\n-  return a\n+  return b')).toBe(false)
  })

  it('is false for a plain +/- block', () => {
    expect(isRichPatch('- old line\n+ new line')).toBe(false)
  })

  it('is not fooled by hunk content lines that look like headers', () => {
    // a bare hunk whose content includes `--- ` / `+++ ` must NOT be treated as a real patch
    const sneaky = ['@@ -1,2 +1,2 @@', '--- removed text', '+++ added text'].join('\n')
    expect(isRichPatch(sneaky)).toBe(false)
  })
})

describe('patchBody', () => {
  it('strips the Index/===/---/+++ preamble, keeping hunks', () => {
    const body = patchBody(buildPatch('a.ts', 'a\n', 'b\n'))
    expect(body.startsWith('@@')).toBe(true)
    expect(body).not.toContain('+++')
    expect(body).not.toContain('Index:')
  })

  it('returns a header-less block unchanged', () => {
    const bare = '@@ -1 +1 @@\n-a\n+b'
    expect(patchBody(bare)).toBe(bare)
  })
})

describe('buildSplitRows', () => {
  it('zips a 1-for-1 change into a single row with both sides + line numbers', () => {
    const { rows, path } = buildSplitRows(buildPatch('a.ts', 'const a = 1\n', 'const a = 2\n'))
    const change = rows.find((r) => r.left?.kind === 'del')
    expect(change?.left).toMatchObject({ n: 1, text: 'const a = 1', kind: 'del' })
    expect(change?.right).toMatchObject({ n: 1, text: 'const a = 2', kind: 'add' })
    expect(path).toBe('a.ts')
  })

  it('context lines occupy both sides identically', () => {
    const { rows } = buildSplitRows(buildPatch('a.ts', 'keep\nx = 1\n', 'keep\nx = 2\n'))
    const ctx = rows.find((r) => r.left?.kind === 'ctx')
    expect(ctx?.left?.text).toBe('keep')
    expect(ctx?.right?.text).toBe('keep')
    expect(ctx?.left?.kind).toBe('ctx')
    expect(ctx?.right?.kind).toBe('ctx')
  })

  it('a new file is all right-side additions (left null)', () => {
    const { rows, oldSrc, newSrc } = buildSplitRows(buildPatch('n.py', '', 'a = 1\nb = 2\n'))
    const adds = rows.filter((r) => r.right?.kind === 'add')
    expect(adds.length).toBe(2)
    expect(adds.every((r) => r.left === null)).toBe(true)
    expect(oldSrc).toBe('')
    expect(newSrc).toBe('a = 1\nb = 2')
  })

  it('an unbalanced run pads the shorter side with a null cell', () => {
    // 2 removed, 1 added -> 2 rows: [del|add] then [del|null]
    const patch = ['--- a/x', '+++ b/x', '@@ -1,2 +1,1 @@', '-one', '-two', '+merged'].join('\n')
    const { rows } = buildSplitRows(patch)
    expect(rows).toHaveLength(2)
    expect(rows[0].left?.text).toBe('one')
    expect(rows[0].right?.text).toBe('merged')
    expect(rows[1].left?.text).toBe('two')
    expect(rows[1].right).toBeNull()
  })

  it('DiffCell.idx indexes into the matching per-side source line', () => {
    const { rows, oldSrc, newSrc } = buildSplitRows(buildPatch('a.ts', 'keep\nx = 1\n', 'keep\nx = 2\n'))
    const oldLines = oldSrc.split('\n')
    const newLines = newSrc.split('\n')
    for (const r of rows) {
      if (r.left) expect(oldLines[r.left.idx]).toBe(r.left.text)
      if (r.right) expect(newLines[r.right.idx]).toBe(r.right.text)
    }
  })

  it('returns empty rows for an unparseable / bare patch (caller falls back to unified)', () => {
    expect(buildSplitRows('not a patch at all').rows).toEqual([])
  })
})
