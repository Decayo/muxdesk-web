import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  answerSessionAsk,
  cancelSessionAsk,
  cancelSessionMenu,
  getSessionAsk,
  getSessionMenu,
  getSubagents,
  selectSessionMenu,
  switchSessionModel,
  type AskRequest,
  type SessionMenu,
  type SubagentNode,
} from '@/api/nativeAgents'
import { AskUserQuestionCard, type AskQuestion } from '@/components/muxDesk/AskUserQuestionCard'
import { useSessionStore } from '@/stores/sessionStore'
import { useTranscriptStore } from '@/stores/transcriptStore'
import { useUiStore } from '@/stores/uiStore'
import { useMxDeskStream } from '@/hooks/useMxDeskStream'
import { MxStateBadge } from '@/components/muxDesk/MxStateBadge'
import { MxChatInput } from '@/components/muxDesk/MxChatInput'
import { MxEventStream } from '@/components/muxDesk/MxEventStream'
import { MxTerminal } from '@/components/muxDesk/MxTerminal'
import { MxModelPicker } from '@/components/muxDesk/MxModelPicker'
import { MxStatusBar } from '@/components/muxDesk/MxStatusBar'
import { getSessionStatus, type SessionStatus } from '@/api/muxDesk'
import { dedupeEvents } from '@/lib/eventGroups'
import { MxHarnessBar } from '@/components/muxDesk/MxHarnessBar'
import { cn } from '@/lib/utils'

export function MxDeskPage() {
  const activeId = useSessionStore((s) => s.activeId)
  const sessions = useSessionStore((s) => s.sessions)
  const selectedModel = useSessionStore((s) => s.selectedModel)
  const setSelectedModel = useSessionStore((s) => s.setSelectedModel)

  const eventsBySession = useTranscriptStore((s) => s.eventsBySession)
  const state = useTranscriptStore((s) => s.state)
  const mode = useTranscriptStore((s) => s.mode)
  const blocked = useTranscriptStore((s) => s.blocked)

  const { send } = useMxDeskStream(activeId)
  const [tab, setTab] = useState<'chat' | 'terminal'>('chat')

  const actualModel = useTranscriptStore((s) => s.model)
  const [pending, setPending] = useState('')

  const active = sessions.find((s) => s.app_session_id === activeId) ?? null
  const events = activeId ? eventsBySession[activeId] ?? [] : []
  const tokenTotal = useMemo(
    // dedupe first: a reconnect replay re-emits assistant messages with fresh seqs, which would
    // otherwise double-count tokens.
    () => dedupeEvents(events).reduce((sum, e) => sum + (e.event_type === 'assistant_message' ? Number(e.payload.output_tokens) || 0 : 0), 0),
    [events],
  )

  // Fetch Task subagents spawned by this session (name->stats), so Agent tree cards in the conversation show tool uses / tokens / status
  const [subagents, setSubagents] = useState<SubagentNode[]>([])
  const claudeSid = active?.claude_session_id ?? null
  useEffect(() => {
    if (!claudeSid) {
      setSubagents([])
      return
    }
    let alive = true
    const load = () =>
      getSubagents(claudeSid)
        .then((r) => alive && setSubagents(r.found ? r.items : []))
        .catch(() => undefined)
    load()
    const id = window.setInterval(load, 3000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [claudeSid])
  const agentsByName = useMemo(
    () => Object.fromEntries(subagents.map((s) => [s.name, s])) as Record<string, SubagentNode>,
    [subagents],
  )

  // Live status-bar segments (git branch/dirty + shells); polled, graceful when the endpoint is absent.
  const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(null)
  useEffect(() => {
    if (!activeId) {
      setSessionStatus(null)
      return
    }
    let alive = true
    const load = () =>
      getSessionStatus(activeId)
        .then((s) => alive && setSessionStatus(s))
        .catch(() => alive && setSessionStatus(null))
    load()
    const id = window.setInterval(load, 5000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [activeId])

  // Detect claude TUI interactive menus (/model, AskUserQuestion..., not written to jsonl) -> show clickable options below the conversation
  const [menu, setMenu] = useState<SessionMenu | null>(null)
  useEffect(() => {
    if (!activeId) {
      setMenu(null)
      return
    }
    let alive = true
    const load = () =>
      getSessionMenu(activeId)
        .then((m) => alive && setMenu(m.active ? m : null))
        .catch(() => undefined)
    load()
    const id = window.setInterval(load, 1500)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [activeId])

  // muxdesk-ask structured questions (replaces AskUserQuestion's capture-pane): poll pending -> render card -> single POST submit
  const [ask, setAsk] = useState<AskRequest | null>(null)
  useEffect(() => {
    if (!activeId) {
      setAsk(null)
      return
    }
    let alive = true
    const load = () =>
      getSessionAsk(activeId)
        .then((a) => alive && setAsk(a.active ? a : null))
        .catch(() => undefined)
    load()
    const id = window.setInterval(load, 1200)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [activeId])

  // Clear optimistic input on session switch; new user/assistant event in conversation = jsonl written back, clear optimistic bubble
  useEffect(() => setPending(''), [activeId])
  useEffect(() => {
    const last = events[events.length - 1]
    if (last && (last.event_type === 'user_message' || last.event_type === 'assistant_message')) {
      setPending('')
    }
  }, [events])

  const sendUser = (text: string) => {
    setPending(text)
    send({ type: 'user_message', text })
  }

  // Model switch: already in session and READY -> backend sends /model + auto-confirms "Switch model?" dialog; sessions not yet started use --model at creation
  const handleModelChange = (model: string) => {
    setSelectedModel(model)
    if (active && state === 'READY') {
      void switchSessionModel(activeId!, model)
    }
  }

  if (!active) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted">
        Select or create a session
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-border bg-panel px-4 py-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-fg">{active.title ?? active.app_session_id}</div>
          <div className="truncate text-xs text-muted">{active.workspace_path}</div>
        </div>
        <MxStateBadge state={state} />
      </header>

      <MxHarnessBar onAction={sendUser} />

      <div className="flex items-center gap-1 border-b border-border bg-panel px-3">
        <TabButton active={tab === 'chat'} onClick={() => setTab('chat')}>
          Chat
        </TabButton>
        <TabButton active={tab === 'terminal'} onClick={() => setTab('terminal')}>
          Terminal
        </TabButton>
        {tab === 'chat' && <ViewModeToggle />}
      </div>

      <div className="relative min-h-0 flex-1">
        {tab === 'chat' ? (
          <div className="flex h-full flex-col">
            <MxEventStream events={events} state={state} pendingText={pending} sessionId={activeId} agentsByName={agentsByName} />
          </div>
        ) : (
          <MxTerminal sessionId={activeId} />
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-border bg-panel px-3 py-1.5">
        <MxModelPicker value={selectedModel} onChange={handleModelChange} />
        <div className="h-3.5 w-px shrink-0 bg-border-strong" />
        <MxStatusBar
          model={actualModel || active.model}
          mode={mode}
          state={state}
          cwd={active.workspace_path}
          tokenTotal={tokenTotal}
          context={sessionStatus?.context}
          gitBranch={sessionStatus?.git.branch}
          gitDirty={sessionStatus?.git.dirty}
          shells={sessionStatus?.shells}
        />
      </div>
      <StatusHint state={state} blocked={blocked} onTerminal={() => setTab('terminal')} />
      {activeId && ask?.active && ask.reqid ? (
        <AskUserQuestionCard
          key={ask.reqid}
          questions={(ask.questions ?? []) as AskQuestion[]}
          onSubmit={(answers) => void answerSessionAsk(activeId, ask.reqid!, answers)}
          onCancel={() => void cancelSessionAsk(activeId, ask.reqid!)}
        />
      ) : activeId && menu?.active ? (
        <NativeMenuPanel
          menu={menu}
          onSelect={(i) => void selectSessionMenu(activeId, i)}
          onCancel={() => void cancelSessionMenu(activeId)}
        />
      ) : null}
      <MxChatInput
        sessionId={activeId}
        onSend={sendUser}
        disabled={state !== 'READY'}
        busy={
          state === 'SUBMITTING' ||
          state === 'ASSISTANT_STREAMING' ||
          state === 'RUNNING_TOOL' ||
          // "last event = user_message" only counts as busy fallback when not READY; after stop, state -> READY clears it (the interrupt message itself is a user_message)
          (state !== 'READY' && events[events.length - 1]?.event_type === 'user_message')
        }
        onStop={() => send({ type: 'interrupt' })}
      />
    </div>
  )
}

/** Startup / blocked / error banner; BLOCKED extracts login URL for frontend copy (terminal copy is inconvenient). */
function StatusHint({
  state,
  blocked,
  onTerminal,
}: {
  state: string
  blocked: { hint?: string; loginUrl?: string }
  onTerminal: () => void
}) {
  if (state === 'BLOCKED_INTERACTIVE') {
    return (
      <div className="flex flex-wrap items-center gap-2 border-t border-warn/40 bg-warn/5 px-4 py-2 text-xs">
        <span className="text-warn">⚠ {blocked.hint || 'Login required / directory not trusted'}</span>
        {blocked.loginUrl && (
          <>
            <input
              readOnly
              value={blocked.loginUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="min-w-0 flex-1 rounded border border-border bg-panel-2 px-2 py-1 font-mono text-[10px] text-fg"
            />
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(blocked.loginUrl ?? '')}
              className="rounded border border-accent/40 bg-accent/10 px-2 py-1 text-accent-fg hover:bg-accent/20"
            >
              Copy login URL
            </button>
          </>
        )}
        <button
          type="button"
          onClick={onTerminal}
          className="rounded border border-border px-2 py-1 text-muted hover:text-fg"
        >
          Switch to terminal →
        </button>
      </div>
    )
  }
  const map: Record<string, { text: string; tone: string; cta?: boolean }> = {
    STARTING: { text: '⏳ Claude starting… ready to type shortly', tone: 'text-accent-fg' },
    ERROR: { text: '✗ Startup failed — check the terminal for raw output or run claude doctor', tone: 'text-danger', cta: true },
    TERMINATED: { text: 'Session ended', tone: 'text-muted' },
  }
  const info = map[state]
  if (!info) return null
  return (
    <div className="flex items-center gap-3 border-t border-border bg-panel px-4 py-2 text-xs">
      <span className={info.tone}>{info.text}</span>
      {info.cta && (
        <button
          type="button"
          onClick={onTerminal}
          className="rounded border border-border px-2 py-0.5 text-muted hover:text-fg"
        >
          Switch to terminal tab →
        </button>
      )}
    </div>
  )
}

/** Claude native TUI menu (/model etc, capture-pane): single-select, click to send (arrow navigation + Enter). AskUserQuestion uses muxdesk-ask structured flow. */
function NativeMenuPanel({
  menu,
  onSelect,
  onCancel,
}: {
  menu: SessionMenu
  onSelect: (index: number) => void
  onCancel: () => void
}) {
  return (
    <div className="border-t border-accent/30 bg-accent/5 px-4 py-2">
      <div className="mb-1.5 flex items-center gap-2 text-xs">
        <span className="font-medium text-accent-fg">▤ {menu.title || 'Select'}</span>
        <button type="button" onClick={onCancel} className="ml-auto text-subtle hover:text-fg">
          Cancel (Esc)
        </button>
      </div>
      <div className="space-y-1">
        {menu.options.map((o) => (
          <button
            key={o.index}
            type="button"
            onClick={() => onSelect(o.index)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm',
              o.current ? 'border-accent/40 bg-accent/10 text-fg' : 'border-border bg-panel-2 text-fg hover:bg-panel',
            )}
          >
            <span className="shrink-0 text-xs text-subtle">{o.index}.</span>
            <span className="min-w-0 flex-1 truncate">
              {o.label}
              {o.description && <span className="ml-1 text-xs text-subtle">— {o.description}</span>}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'border-b-2 px-3 py-2 text-sm',
        active ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg',
      )}
    >
      {children}
    </button>
  )
}

/** Focus/Full segmented toggle: 'focus' hides internal thinking (results-only), 'full' shows everything. */
function ViewModeToggle() {
  const viewMode = useUiStore((s) => s.viewMode)
  const setViewMode = useUiStore((s) => s.setViewMode)
  return (
    <div className="ml-auto flex items-center gap-0.5 rounded-md border border-border/60 p-0.5 text-[11px]">
      {(['focus', 'full'] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          aria-pressed={viewMode === mode}
          onClick={() => setViewMode(mode)}
          title={mode === 'focus' ? 'Results only — hide thinking' : 'Show every event'}
          className={cn(
            'rounded px-2 py-0.5 capitalize',
            viewMode === mode ? 'bg-panel-2 text-fg' : 'text-subtle hover:text-fg',
          )}
        >
          {mode}
        </button>
      ))}
    </div>
  )
}
