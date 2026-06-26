export interface SlashCommand {
  name: string
  hint: string
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
]

/** When the input is exactly a slash command being typed (`/mod`), return the query after `/`; else null. */
export function slashQuery(text: string): string | null {
  const m = /^\/(\S*)$/.exec(text)
  return m ? m[1] : null
}

/** Candidates whose name starts with the query (case-insensitive). */
export function matchCommands(query: string): SlashCommand[] {
  const q = query.toLowerCase()
  return SLASH_COMMANDS.filter((c) => c.name.startsWith(q))
}
