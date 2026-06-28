import { describe, it, expect } from 'vitest'
import { matchCommands, mergeCommands, slashQuery, SLASH_COMMANDS } from './slashCommands'

describe('slashQuery', () => {
  it('returns the query for a lone slash command being typed', () => {
    expect(slashQuery('/')).toBe('')
    expect(slashQuery('/mod')).toBe('mod')
    expect(slashQuery('/MODEL')).toBe('MODEL')
  })

  it('returns null once there is whitespace or leading text', () => {
    expect(slashQuery('/model ')).toBeNull() // args started -> palette closes
    expect(slashQuery('hello /model')).toBeNull()
    expect(slashQuery('plain text')).toBeNull()
    expect(slashQuery('')).toBeNull()
  })
})

describe('matchCommands', () => {
  it('prefix-matches case-insensitively', () => {
    expect(matchCommands('mod').map((c) => c.name)).toEqual(['model'])
    expect(matchCommands('co').map((c) => c.name)).toEqual(['compact', 'context', 'cost', 'config'])
  })

  it('empty query returns all commands', () => {
    expect(matchCommands('')).toHaveLength(SLASH_COMMANDS.length)
  })

  it('no match returns empty', () => {
    expect(matchCommands('zzz')).toEqual([])
  })

  it('matches case-insensitively against the candidate name too (custom uppercase)', () => {
    const custom = [{ name: 'Deploy', hint: 'ship', source: 'command' as const }]
    expect(matchCommands('de', custom).map((c) => c.name)).toEqual(['Deploy'])
  })

  it('built-ins are tagged source=builtin', () => {
    expect(SLASH_COMMANDS.every((c) => c.source === 'builtin')).toBe(true)
  })
})

describe('mergeCommands', () => {
  it('appends custom commands after built-ins', () => {
    const merged = mergeCommands([{ name: 'deploy', hint: 'ship it', source: 'command' }])
    expect(merged).toHaveLength(SLASH_COMMANDS.length + 1)
    expect(merged.at(-1)).toEqual({ name: 'deploy', hint: 'ship it', source: 'command' })
  })

  it('drops a custom entry whose name collides with a built-in', () => {
    const merged = mergeCommands([{ name: 'model', hint: 'custom model', source: 'command' }])
    expect(merged).toHaveLength(SLASH_COMMANDS.length)
    expect(merged.filter((c) => c.name === 'model')).toHaveLength(1)
    expect(merged.find((c) => c.name === 'model')?.source).toBe('builtin')
  })
})
