import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge as RFEdge,
  type Node as RFNode,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import dagre from 'dagre'
import {
  getNativeTeams,
  getSubagents,
  type NativeTeam,
  type SubagentNode,
  type TeamTask,
} from '@/api/nativeAgents'
import { cn } from '@/lib/utils'

const STATUS_DOT: Record<string, string> = {
  pending: '#6b7280',
  in_progress: '#60a5fa',
  completed: '#4ade80',
  deleted: '#374151',
}

/** Click node to switch view: lead returns to conversation, teammate switches to native session, subagent switches to Task subagent transcript. */
export type PanelPick =
  | { kind: 'lead' }
  | { kind: 'teammate'; name: string; sessionId: string; cwd: string }
  | { kind: 'subagent'; name: string; leadSessionId: string; agentId: string }

/** Unified node: native teammate / Task subagent / lead -- shared by reactflow + dagre. */
type UNode = {
  id: string
  label: string
  role: 'lead' | 'teammate' | 'subagent'
  status?: string
  clickable: boolean
  pick: PanelPick
  activeKeyVal?: string // sessionId (teammate) or agentId (subagent), for active highlight comparison
}

type MemberNodeData = { label: string; role: UNode['role']; status?: string; clickable: boolean; active: boolean }

function MemberNode({ data }: { data: MemberNodeData }) {
  const isLead = data.role === 'lead'
  const accent = isLead ? '#f87171' : data.role === 'subagent' ? '#a78bfa' : '#3b82f6'
  const icon = isLead ? '🧠' : data.role === 'subagent' ? '⚙' : '◉'
  const tag = isLead ? 'orchestrator' : data.role === 'subagent' ? 'subagent' : data.clickable ? 'tmux' : '—'
  const done = data.status === 'completed'
  const running = data.status === 'in_progress'
  return (
    <>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minWidth: 150,
          maxWidth: 240,
          padding: '10px 14px',
          borderRadius: 10,
          background: data.active ? '#1b2430' : done ? '#0e1116' : '#11161d',
          // done -> grey border, running -> accent bright border + glow, active -> blue border
          border: `1.5px solid ${data.active ? '#9ecbff' : done ? '#374151' : accent}`,
          boxShadow: data.active
            ? '0 0 0 1px #9ecbff55'
            : running
              ? `0 0 0 1px ${accent}66, 0 0 12px ${accent}44`
              : 'none',
          color: done ? '#6b7280' : '#e6eaf0', // done -> text turns grey
          fontSize: 13,
          cursor: data.clickable ? 'pointer' : 'default',
          opacity: done ? 0.55 : data.clickable ? 1 : 0.6, // done -> overall faded grey
        }}
      >
        <span style={{ opacity: done ? 0.6 : 1 }}>{icon}</span>
        {data.status && (
          <span
            className={cn('h-2 w-2 shrink-0 rounded-full', running && 'animate-pulse')}
            style={{ background: STATUS_DOT[data.status] ?? '#6b7280' }}
          />
        )}
        <span
          style={{
            fontWeight: 500,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            ...(done ? { textDecoration: 'line-through' } : {}),
          }}
        >
          {data.label}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: done ? '#4b5563' : accent }}>{tag}</span>
      </div>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </>
  )
}

const nodeTypes = { member: MemberNode }

/** Native team -> unified nodes (lead + teammates, teammate clickable only when matched to a sessionId). */
function nativeNodes(team: NativeTeam): UNode[] {
  const lead = team.members.find((m) => m.agentType === 'team-lead') ?? team.members[0]
  if (!lead) return []
  return team.members.map((m) => {
    const isLead = m.name === lead.name
    const sessionId = m.sessionId ?? undefined
    return {
      id: m.name,
      label: m.name,
      role: isLead ? 'lead' : 'teammate',
      clickable: isLead || !!sessionId,
      pick:
        isLead || !sessionId
          ? { kind: 'lead' }
          : { kind: 'teammate', name: m.name, sessionId, cwd: m.cwd ?? '' },
      activeKeyVal: sessionId,
    }
  })
}

/**
 * Keep only the latest batch of subagents to keep the graph clean (new batch replaces old).
 * Sort by spawn ts newest-first, walk backwards; stop at gaps > GAP seconds
 * (same-batch spawn interval ~1-2s, cross-round gaps are larger);
 * always retain in-progress ones (even if cut by the gap, they're what should be visible).
 */
function latestBatch(subs: SubagentNode[]): SubagentNode[] {
  if (subs.length <= 1) return subs
  const GAP = 3.5 // seconds: same-batch spawn interval measured ~0.4-1s, cross-round ~5-7s -> 3.5 splits them, isolating the latest round
  const sorted = [...subs].sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0))
  const keep = new Set<string>([sorted[0].agentId])
  for (let i = 1; i < sorted.length; i++) {
    if ((sorted[i - 1].ts ?? 0) - (sorted[i].ts ?? 0) > GAP) break
    keep.add(sorted[i].agentId)
  }
  for (const s of subs) if (s.status === 'in_progress') keep.add(s.agentId)
  return subs.filter((s) => keep.has(s.agentId))
}

/** Task subagent -> unified nodes (synthetic orchestrator root + each subagent, all clickable to view transcript). */
function subagentNodes(subs: SubagentNode[], leadSessionId: string): UNode[] {
  const lead: UNode = {
    id: '__lead__',
    label: 'orchestrator',
    role: 'lead',
    clickable: true,
    pick: { kind: 'lead' },
  }
  const kids: UNode[] = subs.map((s) => ({
    id: s.agentId,
    // Task subagent has no name -> backend often returns agentId (UUID); description ("Agent 1-A: ...") is the readable label
    label: s.description || s.name,
    role: 'subagent',
    status: s.status,
    clickable: true,
    pick: { kind: 'subagent', name: s.name, leadSessionId, agentId: s.agentId },
    activeKeyVal: s.agentId,
  }))
  return [lead, ...kids]
}

function layout(unodes: UNode[], activeKey?: string | null): { nodes: RFNode[]; edges: RFEdge[] } {
  if (unodes.length === 0) return { nodes: [], edges: [] }
  const root = unodes[0] // lead is always the first node
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', nodesep: 28, ranksep: 90 })
  g.setDefaultEdgeLabel(() => ({}))
  unodes.forEach((n) => g.setNode(n.id, { width: 180, height: 46 }))
  unodes.filter((n) => n.id !== root.id).forEach((n) => g.setEdge(root.id, n.id))
  dagre.layout(g)
  const nodes: RFNode[] = unodes.map((n) => {
    const p = g.node(n.id)
    const active = !!activeKey && n.activeKeyVal === activeKey
    return {
      id: n.id,
      type: 'member',
      position: { x: p.x - 90, y: p.y - 23 },
      data: { label: n.label, role: n.role, status: n.status, clickable: n.clickable, active },
    }
  })
  const edges: RFEdge[] = unodes
    .filter((n) => n.id !== root.id)
    .map((n) => ({
      id: `${root.id}-${n.id}`,
      source: root.id,
      target: n.id,
      animated: true,
      style: { stroke: '#2b333f', strokeWidth: 1.5 },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#2b333f' },
    }))
  return { nodes, edges }
}

/** Right-side agent team panel: node flow graph (lead->teammates/subagents) + task/subagent list.
 *
 * Both paths are rendered (decision 8): claude using native team (independent tmux sessions) or
 * Task subagent (bound to lead) are both supported. Click node -> onPick: lead returns to
 * conversation, teammate/subagent switches to their transcript (2.3). */
export function MxTeamPanel({
  leadSessionId,
  onPick,
  activeKey,
}: {
  leadSessionId?: string | null
  onPick?: (p: PanelPick) => void
  activeKey?: string | null
}) {
  const [teams, setTeams] = useState<NativeTeam[]>([])
  const [subs, setSubs] = useState<SubagentNode[]>([])

  useEffect(() => {
    let alive = true
    const load = () => {
      getNativeTeams()
        .then((r) => alive && setTeams(r.items))
        .catch(() => undefined)
      if (leadSessionId) {
        getSubagents(leadSessionId)
          .then((r) => alive && setSubs(r.found ? r.items : []))
          .catch(() => undefined)
      } else {
        setSubs([])
      }
    }
    load()
    const id = window.setInterval(load, 2000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [leadSessionId])

  const team = teams[0]
  // Keep graph clean: only show latest batch of subagents (+ in-progress), collapse old batches -> new ones replace old
  const visibleSubs = useMemo(() => latestBatch(subs), [subs])
  const hiddenCount = subs.length - visibleSubs.length
  // Native team takes priority; no native team but lead has Task subagents -> render subagent path
  const unodes = useMemo<UNode[]>(() => {
    if (team) return nativeNodes(team)
    if (visibleSubs.length && leadSessionId) return subagentNodes(visibleSubs, leadSessionId)
    return []
  }, [team, visibleSubs, leadSessionId])

  const { nodes, edges } = useMemo(() => layout(unodes, activeKey), [unodes, activeKey])

  // Auto-focus on running group: when the in_progress set changes, fitView to those nodes (none running -> fit all)
  const rfRef = useRef<ReactFlowInstance | null>(null)
  const runningKey = useMemo(
    () => unodes.filter((n) => n.status === 'in_progress').map((n) => n.id).join(','),
    [unodes],
  )
  useEffect(() => {
    const inst = rfRef.current
    if (!inst) return
    const running = runningKey ? runningKey.split(',').map((id) => ({ id })) : []
    inst.fitView(
      running.length
        ? { nodes: running, duration: 500, padding: 0.6, maxZoom: 1.15 }
        : { duration: 400, padding: 0.2 },
    )
  }, [runningKey, unodes.length])

  const handleNodeClick = (_: unknown, node: RFNode) => {
    const un = unodes.find((n) => n.id === node.id)
    if (un && un.clickable) onPick?.(un.pick)
  }

  if (unodes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted">
        No active agent team / subagent.
        <br />
        Tell the orchestrator to "build a team / assign a teammate to analyze…" and the flow graph + list will appear here.
      </div>
    )
  }

  const headerLabel = team ? `🧩 ${team.key}` : '🧩 orchestrator subagents'
  const count = team
    ? `${team.members.length} agents · ${team.tasks.length} tasks`
    : hiddenCount > 0
      ? `latest ${visibleSubs.length} / total ${subs.length} subagents`
      : `${subs.length} subagents`

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border px-3 py-2 text-sm">
        <span className="font-medium text-fg">{headerLabel}</span>
        <span className="ml-2 text-xs text-muted">{count}</span>
      </div>
      <div style={{ height: '46%', background: '#0b0f14' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={handleNodeClick}
          onInit={(inst) => {
            rfRef.current = inst
          }}
          fitView
          nodesDraggable={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#161c26" gap={18} />
        </ReactFlow>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-border p-3">
        {team ? (
          <>
            <div className="mb-1 text-xs uppercase tracking-wide text-muted">Task list (claude code native)</div>
            {team.tasks.length === 0 && <div className="text-sm text-muted">(orchestrator has not created any tasks yet)</div>}
            {team.tasks.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </>
        ) : (
          <>
            <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-wide text-muted">
              <span>Subagent list (latest batch)</span>
              {hiddenCount > 0 && <span className="ml-auto normal-case text-subtle">+{hiddenCount} older ones collapsed</span>}
            </div>
            {visibleSubs.map((s) => (
              <SubagentRow key={s.agentId} sub={s} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

function TaskRow({ task }: { task: TeamTask }) {
  const done = task.status === 'completed'
  return (
    <div className="mb-1 flex items-center gap-2 text-sm">
      <span
        className="inline-flex shrink-0 items-center justify-center text-[10px]"
        style={{
          width: 14,
          height: 14,
          borderRadius: 3,
          border: `1.5px solid ${STATUS_DOT[task.status ?? ''] ?? '#6b7280'}`,
          background: done ? STATUS_DOT.completed : 'transparent',
          color: '#0b0f14',
        }}
      >
        {done ? '✓' : ''}
      </span>
      <span className="shrink-0 text-xs text-muted">#{task.id}</span>
      <span className={cn('min-w-0 flex-1 truncate', done ? 'text-muted line-through' : 'text-fg')}>{task.subject}</span>
      {task.owner && <span className="shrink-0 text-xs text-subtle">{task.owner}</span>}
    </div>
  )
}

function SubagentRow({ sub }: { sub: SubagentNode }) {
  const done = sub.status === 'completed'
  const running = sub.status === 'in_progress'
  return (
    <div className={cn('mb-1 flex items-center gap-2 text-sm', done && 'opacity-50')}>
      <span
        className={cn('h-2 w-2 shrink-0 rounded-full', running && 'animate-pulse')}
        style={{ background: STATUS_DOT[sub.status ?? ''] ?? '#6b7280' }}
      />
      {/* description ("Agent 1-A: ...") as primary label; UUID shortened to small trailing text, no longer dominating the row */}
      <span className={cn('min-w-0 flex-1 truncate', done ? 'text-muted line-through' : 'text-fg')}>
        {sub.description || sub.name}
      </span>
      <span className="shrink-0 font-mono text-[10px] text-subtle/70">{sub.agentId.slice(0, 8)}</span>
      <span className="shrink-0 text-xs text-muted">{done ? '✓' : sub.status}</span>
    </div>
  )
}
