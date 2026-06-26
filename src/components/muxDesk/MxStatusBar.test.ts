import { describe, it, expect } from 'vitest'
import { prettyModel } from './MxStatusBar'

describe('prettyModel', () => {
  it('formats known model ids with the 1M context flag', () => {
    expect(prettyModel('claude-opus-4-8[1m]')).toBe('Opus 4.8 · 1M')
    expect(prettyModel('claude-opus-4-6[1m]')).toBe('Opus 4.6 · 1M')
  })

  it('formats non-1M models', () => {
    expect(prettyModel('claude-sonnet-4-6')).toBe('Sonnet 4.6')
  })

  it('degrades gracefully for unknown ids', () => {
    expect(prettyModel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(prettyModel('some-future-model')).toBe('some-future-model')
  })
})
