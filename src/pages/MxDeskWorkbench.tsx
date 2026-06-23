import { useState } from 'react'
import { MxNativeTranscript } from '@/components/muxDesk/MxNativeTranscript'
import { MxPreflightBanner } from '@/components/muxDesk/MxPreflightBanner'
import { MxSessionSidebar } from '@/components/muxDesk/MxSessionSidebar'
import { MxTeamPanel, type PanelPick } from '@/components/muxDesk/MxTeamPanel'
import { MxDeskPage } from '@/pages/MxDeskPage'
import { createLead } from '@/api/nativeAgents'
import { useSessionStore } from '@/stores/sessionStore'

/** muxdesk workbench: left session sidebar + center conversation pane + right MxTeamPanel (node flow graph, sole entry point).
 *
 * Agent team model (replaces custom team impl): click "+ Start team" to create an orchestrator (lead) session,
 * user talks to it directly in the conversation pane -> lead spawns work via native agent team or Task subagent,
 * right-side MxTeamPanel renders both paths, click node to view that teammate/subagent's transcript (decision 8 / 2.3). */
export function MxDeskWorkbench() {
  const setActive = useSessionStore((s) => s.setActive)
  const upsert = useSessionStore((s) => s.upsert)
  const sessions = useSessionStore((s) => s.sessions)
  const activeId = useSessionStore((s) => s.activeId)
  const selectedModel = useSessionStore((s) => s.selectedModel)
  const [starting, setStarting] = useState(false)
  // Teammate/subagent selected by clicking a node (left side switches to their transcript); lead / clear -> back to MxDeskPage
  const [picked, setPicked] = useState<PanelPick | null>(null)
  // Conversation area font zoom (CSS zoom, Chrome supported): top-left +/- controls, persisted in localStorage
  const [zoom, setZoom] = useState(() => {
    const v = Number(localStorage.getItem('muxdesk-zoom'))
    return v >= 0.7 && v <= 1.8 ? v : 1
  })
  const setZoomClamped = (z: number) => {
    const clamped = Math.min(1.8, Math.max(0.7, Math.round(z * 10) / 10))
    setZoom(clamped)
    localStorage.setItem('muxdesk-zoom', String(clamped))
  }

  const activeSession = sessions.find((s) => s.app_session_id === activeId) ?? null
  // Node graph uses the session bound to the current conversation as lead: reads its native team / Task subagents
  const leadSessionId = activeSession?.claude_session_id ?? null

  const handleStartTeam = async () => {
    setStarting(true)
    try {
      const lead = await createLead(selectedModel)
      upsert(lead)
      setActive(lead.app_session_id)
      setPicked(null)
    } finally {
      setStarting(false)
    }
  }

  const handlePick = (p: PanelPick) => {
    setPicked(p.kind === 'lead' ? null : p)
  }

  const activeKey = picked?.kind === 'teammate' ? picked.sessionId : picked?.kind === 'subagent' ? picked.agentId : null

  return (
    <div className="flex h-full w-full flex-col">
      <MxPreflightBanner />
      <div className="flex min-h-0 flex-1">
        <MxSessionSidebar />
        <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-border bg-panel px-4 py-2 text-sm">
          {/* Font zoom: top-left +/-, adjusts conversation area size */}
          <div className="flex items-center overflow-hidden rounded-md border border-border" title="Adjust conversation font size">
            <button
              type="button"
              onClick={() => setZoomClamped(zoom - 0.1)}
              className="px-2 py-0.5 text-muted hover:bg-panel-2 hover:text-fg"
            >
              −
            </button>
            <button
              type="button"
              onClick={() => setZoomClamped(1)}
              className="border-x border-border px-1.5 py-0.5 text-[11px] tabular-nums text-muted hover:bg-panel-2 hover:text-fg"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              onClick={() => setZoomClamped(zoom + 0.1)}
              className="px-2 py-0.5 text-muted hover:bg-panel-2 hover:text-fg"
            >
              +
            </button>
          </div>
          <button
            type="button"
            onClick={handleStartTeam}
            disabled={starting}
            className="rounded-md border border-accent/40 bg-accent/10 px-3 py-1 text-accent-fg hover:bg-accent/20 disabled:opacity-50"
          >
            {starting ? 'Starting orchestrator…' : '+ Start team (orchestrator)'}
          </button>
          <span className="text-xs text-muted">user ⇄ orchestrator: send instructions → it spawns teammates / subagents (see node graph on the right)</span>
        </div>

        <div className="min-h-0 flex-1">
          <div className="flex h-full">
            <div className="min-w-0 flex-1" style={{ zoom }}>
              {picked && picked.kind !== 'lead' ? (
                <PickTranscriptPane pick={picked} onBack={() => setPicked(null)} />
              ) : (
                <MxDeskPage />
              )}
            </div>
            <div className="w-[400px] shrink-0 border-l border-border">
              <MxTeamPanel leadSessionId={leadSessionId} onPick={handlePick} activeKey={activeKey} />
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  )
}

/** Left conversation area after clicking a teammate / subagent node: read-only transcript for that node (interactive messaging is future 4.x). */
function PickTranscriptPane({
  pick,
  onBack,
}: {
  pick: Exclude<PanelPick, { kind: 'lead' }>
  onBack: () => void
}) {
  const isSub = pick.kind === 'subagent'
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border bg-panel px-4 py-2 text-sm">
        <button type="button" onClick={onBack} className="rounded border border-border px-2 py-0.5 text-muted hover:text-fg">
          ← Back to orchestrator
        </button>
        <span className="min-w-0">
          <span className="font-medium text-fg">
            {isSub ? '⚙' : '◉'} {pick.name}
          </span>
          <span className="ml-2 truncate text-xs text-muted">{isSub ? 'Task subagent' : pick.cwd}</span>
        </span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {isSub ? (
          <MxNativeTranscript leadSessionId={pick.leadSessionId} agentId={pick.agentId} />
        ) : (
          <MxNativeTranscript sessionId={pick.sessionId} cwd={pick.cwd} />
        )}
      </div>
    </div>
  )
}
