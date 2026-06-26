import { describe, it, expect } from 'vitest'
import { matchCommands, slashQuery, SLASH_COMMANDS } from './slashCommands'

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
})
