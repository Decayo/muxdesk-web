export interface SlashCommand {
  name: string
  hint: string
  /** 'builtin' = native claude command; 'command'/'skill' = the user's own (from the backend). */
  source?: 'builtin' | 'command' | 'skill'
}

/**
 * Built-in claude-code slash commands offered by the input palette.
 * (Enumerating the user's own `.claude/commands` + `.claude/skills` via a backend
 * `/api/muxdesk/commands` endpoint is a planned follow-up — this is the static base set.)
 */
export const SLASH_COMMANDS: SlashCommand[] = [
  { name: 'model', hint: 'switch the active model' },
  { name: 'clear', hint: 'clear conversation history' },
  { name: 'compact', hint: 'summarize & compact the context' },
  { name: 'context', hint: 'show token / context usage' },
  { name: 'cost', hint: 'show session cost' },
  { name: 'config', hint: 'open settings' },
  { name: 'agents', hint: 'manage subagents' },
  { name: 'review', hint: 'review a pull request' },
  { name: 'init', hint: 'generate CLAUDE.md' },
  { name: 'memory', hint: 'edit memory files' },
  { name: 'resume', hint: 'resume a past session' },
  { name: 'export', hint: 'export the conversation' },
  { name: 'status', hint: 'show system status' },
  { name: 'vim', hint: 'toggle vim editing mode' },
  { name: 'help', hint: 'list available commands' },
].map((c) => ({ ...c, source: 'builtin' as const }))

/** Merge the user's discovered commands after the built-ins, dropping names already built in. */
export function mergeCommands(custom: SlashCommand[]): SlashCommand[] {
  const builtinNames = new Set(SLASH_COMMANDS.map((c) => c.name))
  return [...SLASH_COMMANDS, ...custom.filter((c) => !builtinNames.has(c.name))]
}

/** When the input is exactly a slash command being typed (`/mod`), return the query after `/`; else null. */
export function slashQuery(text: string): string | null {
  const m = /^\/(\S*)$/.exec(text)
  return m ? m[1] : null
}

/** Candidates whose name starts with the query (case-insensitive), from the given list. */
export function matchCommands(query: string, commands: SlashCommand[] = SLASH_COMMANDS): SlashCommand[] {
  const q = query.toLowerCase()
  return commands.filter((c) => c.name.toLowerCase().startsWith(q))
}
