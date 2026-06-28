export interface MxSession {
  app_session_id: string
  tmux_session: string
  workspace_path: string
  model: string | null
  title: string | null
  mode: string
  state: string
  status: string
  claude_session_id: string | null
  created_at: string | null
  last_event_at: string | null
  // session tree (module 4); absent on older backends -> treated as flat / ungrouped
  parent_session_id?: string | null
  project?: string | null
}

export interface MxEvent {
  session_id: string
  event_type: string
  seq: number
  ts?: number
  payload: Record<string, unknown>
}

export type WsClientMessage =
  | { type: 'user_message'; text: string }
  | { type: 'interrupt' }
  | { type: 'takeover' }
  | { type: 'resume_automation' }

export const MODELS = [
  'claude-opus-4-8[1m]',
  'claude-opus-4-6[1m]',
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',
] as const

/** Default model (when creating a session without explicit specification) -- no longer uses settings.json default, directly specifies opus-4-8. */
export const DEFAULT_MODEL = 'claude-opus-4-8[1m]'
