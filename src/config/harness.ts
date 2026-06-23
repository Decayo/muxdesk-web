/**
 * Types for the quick-action bar above the conversation. Actual content provided by
 * backend `GET /harness` (per-project harness.json).
 * Clicking an action injects the `cmd` text into the active claude session. Hidden when no config.
 */
export interface HarnessAction {
  label: string
  /** Text injected into claude (slash command or natural language). */
  cmd: string
  /** Hover tooltip. */
  hint?: string
}

export interface HarnessGroup {
  name: string
  /** Use accent color (e.g. primary workflow). */
  accent?: boolean
  actions: HarnessAction[]
}

export interface HarnessConfig {
  groups: HarnessGroup[]
}
