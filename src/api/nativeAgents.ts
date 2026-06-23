import { request } from './http'
import type { MxSession } from '@/types/muxDesk'

/** Claude code native live session (Agent View / Agent Teams lead/teammate). */
export interface NativeAgent {
  sessionId: string
  cwd: string
  kind: string
  status?: string
  startedAt?: number
  pid?: number
}

export interface NativeEvent {
  event_type?: string
  payload?: Record<string, unknown>
  seq?: number
}

export function getNativeAgents(): Promise<{ items: NativeAgent[] }> {
  return request('/muxdesk/native-agents')
}

export function getNativeTranscript(sid: string, cwd: string): Promise<{ items: NativeEvent[]; found: boolean }> {
  return request(
    `/muxdesk/native-agents/transcript?sid=${encodeURIComponent(sid)}&cwd=${encodeURIComponent(cwd)}`,
  )
}

/** Claude code native agent team (~/.claude/teams/) active state. */
export interface TeamMember {
  name: string
  agentType: string
  model?: string
  tmuxPaneId?: string
  cwd?: string
  /** Claude sessionId resolved by backend native-teams (null if unmatched -> node not clickable). */
  sessionId?: string | null
}
export interface TeamTask {
  id?: string
  subject?: string
  status?: string
  owner?: string
  blocks?: string[]
  blockedBy?: string[]
}
export interface InboxMessage {
  from?: string
  text?: string
  summary?: string
  timestamp?: string
  color?: string
  type?: string
  read?: boolean
}
export interface NativeTeam {
  key: string
  members: TeamMember[]
  tasks: TeamTask[]
  inboxes: Record<string, InboxMessage[]>
}

export function getNativeTeams(): Promise<{ items: NativeTeam[] }> {
  return request('/muxdesk/native-teams')
}

/** Lead's Task subagent (claude's path for simple tasks, not native team; no independent session, bound to lead). */
export interface SubagentNode {
  name: string
  agentType: string
  description?: string
  agentId: string
  toolUseId?: string
  status?: string
  toolUses?: number
  tokens?: number
  /** Spawn time (meta mtime) -> used by frontend for batching, graph shows only the latest batch. */
  ts?: number
}

/** Read a lead session's Task subagent list (second path in node graph). */
export function getSubagents(sid: string): Promise<{ items: SubagentNode[]; found: boolean }> {
  return request(`/muxdesk/native-teams/subagents?sid=${encodeURIComponent(sid)}`)
}

/** Read a subagent's transcript (bound to lead sid + agentId, jsonl under lead's subagents/ dir). */
export function getSubagentTranscript(
  sid: string,
  agentId: string,
): Promise<{ items: NativeEvent[]; found: boolean }> {
  return request(
    `/muxdesk/native-agents/subagent-transcript?sid=${encodeURIComponent(sid)}&agent_id=${encodeURIComponent(agentId)}`,
  )
}

/** Start an agent team orchestrator (lead): cc session + system prompt forcing native team. Returns the lead session. */
export function createLead(model?: string): Promise<MxSession> {
  return request('/muxdesk/lead', { method: 'POST', body: JSON.stringify(model ? { model } : {}) })
}

/** Claude TUI interactive menu (/model, AskUserQuestion etc): detected via capture-pane -> clickable in conversation. */
export interface MenuOption {
  index: number
  label: string
  description?: string
  current?: boolean
  /** Multi-select option checked state (capture-pane [✔]/[ ]); null = not multi-select. */
  checked?: boolean | null
}
export interface MenuStage {
  name: string
  done: boolean
}
export interface SessionMenu {
  active: boolean
  title?: string
  multiSelect?: boolean
  /** Stage list for multi-question AskUserQuestion (language selection / dev environment / ... / Submit). */
  stages?: MenuStage[]
  options: MenuOption[]
  current?: number
}

export function getSessionMenu(sid: string): Promise<SessionMenu> {
  return request(`/muxdesk/sessions/${encodeURIComponent(sid)}/menu`)
}
export function selectSessionMenu(sid: string, index: number): Promise<{ ok: boolean }> {
  return request(`/muxdesk/sessions/${encodeURIComponent(sid)}/menu/select`, {
    method: 'POST',
    body: JSON.stringify({ index }),
  })
}
export function selectSessionMenuMulti(sid: string, indices: number[]): Promise<{ ok: boolean }> {
  return request(`/muxdesk/sessions/${encodeURIComponent(sid)}/menu/select-multi`, {
    method: 'POST',
    body: JSON.stringify({ indices }),
  })
}
export function customSessionMenu(sid: string, text: string): Promise<{ ok: boolean }> {
  return request(`/muxdesk/sessions/${encodeURIComponent(sid)}/menu/custom`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  })
}
export function cancelSessionMenu(sid: string): Promise<{ ok: boolean }> {
  return request(`/muxdesk/sessions/${encodeURIComponent(sid)}/menu/cancel`, { method: 'POST' })
}

/** Switch model for a running session: backend sends `/model X` + auto-confirms the "Switch model?" dialog (no manual Yes needed). */
export function switchSessionModel(sid: string, model: string): Promise<{ ok: boolean; confirmed?: boolean }> {
  return request(`/muxdesk/sessions/${encodeURIComponent(sid)}/switch-model`, {
    method: 'POST',
    body: JSON.stringify({ model }),
  })
}

/** Live preview during streaming: working = claude is producing output, text = in-progress reply block (shown before full paragraph persists to jsonl, replaced by clean markdown after). */
export function getSessionLive(sid: string): Promise<{ text: string; working: boolean }> {
  return request(`/muxdesk/sessions/${encodeURIComponent(sid)}/live`)
}

/** Quick-action bar config above the conversation (per-project backend/harness.json); empty = frontend hides the entire bar. */
export function getHarnessConfig(): Promise<import('@/config/harness').HarnessConfig> {
  return request('/muxdesk/harness')
}

/** Build a displayable image URL from the backend-stored absolute path (conversation / input thumbnails + click for full size). */
export function ccImageUrl(path: string): string {
  return `/api/muxdesk/image?path=${encodeURIComponent(path)}`
}

/** Upload pasted image: base64 -> backend saves file -> returns absolute path (included in message text for claude Read). */
export function uploadSessionImage(
  sid: string,
  dataBase64: string,
  ext: string,
): Promise<{ ok: boolean; path?: string; reason?: string }> {
  return request(`/muxdesk/sessions/${encodeURIComponent(sid)}/image`, {
    method: 'POST',
    body: JSON.stringify({ data_base64: dataBase64, ext }),
  })
}

/** muxdesk-ask structured questions (replaces AskUserQuestion): questions and answers are both JSON, frontend renders card + single POST submit. */
export interface AskQuestionSpec {
  question?: string
  header?: string
  multiSelect?: boolean
  options?: { label?: string; description?: string }[]
}
export interface AskRequest {
  active: boolean
  reqid?: string
  questions?: AskQuestionSpec[]
}
export function getSessionAsk(sid: string): Promise<AskRequest> {
  return request(`/muxdesk/sessions/${encodeURIComponent(sid)}/ask`)
}
export function answerSessionAsk(
  sid: string,
  reqid: string,
  answers: Record<string, string | string[]>,
): Promise<{ ok: boolean }> {
  return request(`/muxdesk/sessions/${encodeURIComponent(sid)}/ask`, {
    method: 'POST',
    body: JSON.stringify({ reqid, answers }),
  })
}
export function cancelSessionAsk(sid: string, reqid: string): Promise<{ ok: boolean }> {
  return request(`/muxdesk/sessions/${encodeURIComponent(sid)}/ask/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reqid }),
  })
}
