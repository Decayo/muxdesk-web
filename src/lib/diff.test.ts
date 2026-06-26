import { describe, it, expect } from 'vitest'
import { buildPatch, countChangedLines, isRichPatch, patchBody } from './diff'

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
