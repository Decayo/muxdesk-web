import { request } from './http'
import type { MxEvent, MxSession } from '@/types/muxDesk'

export interface CreateSessionBody {
  workspace_path?: string
  model?: string
  title?: string
}

export function createSession(body: CreateSessionBody): Promise<MxSession> {
  return request<MxSession>('/muxdesk/sessions', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function listSessions(status?: string): Promise<{ items: MxSession[] }> {
  const query = status ? `?status=${encodeURIComponent(status)}` : ''
  return request<{ items: MxSession[] }>(`/muxdesk/sessions${query}`)
}

export function getSession(id: string): Promise<MxSession> {
  return request<MxSession>(`/muxdesk/sessions/${id}`)
}

export function archiveSession(id: string): Promise<MxSession> {
  return request<MxSession>(`/muxdesk/sessions/${id}/archive`, { method: 'POST' })
}

export function resumeSession(id: string): Promise<MxSession> {
  return request<MxSession>(`/muxdesk/sessions/${id}/resume`, { method: 'POST' })
}

export function deleteSession(id: string): Promise<void> {
  return request<void>(`/muxdesk/sessions/${id}`, { method: 'DELETE' })
}

export function listEvents(id: string, afterSeq = 0): Promise<{ items: MxEvent[] }> {
  return request<{ items: MxEvent[] }>(`/muxdesk/sessions/${id}/events?after_seq=${afterSeq}`)
}

export interface CommandItem {
  name: string
  hint: string
  source: 'command' | 'skill'
  scope: 'user' | 'project'
}

/** Custom slash commands/skills for a session (user ~/.claude + project workspace). */
export function listSessionCommands(id: string): Promise<{ items: CommandItem[] }> {
  return request<{ items: CommandItem[] }>(`/muxdesk/sessions/${id}/commands`)
}

export interface SessionStatus {
  git: { branch: string | null; dirty: number }
  shells: number
}

/** Live status-bar segments (git branch/dirty + open shells) for a session. */
export function getSessionStatus(id: string): Promise<SessionStatus> {
  return request<SessionStatus>(`/muxdesk/sessions/${id}/status`)
}

/** One runtime dependency check (tmux / claude / login / python). */
export interface PreflightCheck {
  name: string
  /** required deps flip overall `ok`; non-required are warnings only. */
  required: boolean
  ok: boolean
  detail: string
  hint?: string | null
}

export interface Preflight {
  ok: boolean
  checks: PreflightCheck[]
}

/** Backend dependency status — the demo needs a real tmux + claude on the host. */
export function getPreflight(): Promise<Preflight> {
  return request<Preflight>('/muxdesk/preflight')
}
