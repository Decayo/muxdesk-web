import { useState } from 'react'
import { cn } from '@/lib/utils'
import { buildPatch, countChangedLines } from '@/lib/diff'
import type { ToolEntry } from '@/lib/eventGroups'
import { CodeDiff } from './CodeDiff'

const OUTPUT_MAX = 4000

function firstLine(s: string): string {
  const i = s.indexOf('\n')
  return i === -1 ? s : `${s.slice(0, i)} …`
}

/** One-line summary for a tool entry header (file path / command / pattern …). */
function toolSummary(name: string, input: unknown): string {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const s = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : '')
  switch (name) {
    case 'Read':
      return s('file_path')
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
      return s('file_path')
    case 'NotebookEdit':
      return s('notebook_path') || s('file_path')
    case 'Bash':
      return firstLine(s('command'))
    case 'Grep':
      return s('pattern') + (s('path') ? `  ·  ${s('path')}` : '')
    case 'Glob':
      return s('pattern')
    case 'WebFetch':
      return s('url')
    case 'WebSearch':
      return s('query')
    case 'TodoWrite':
      return 'todos'
    default:
      try {
        const t = typeof input === 'string' ? input : JSON.stringify(input)
        return t.length > 120 ? `${t.slice(0, 120)}…` : t
      } catch {
        return ''
      }
  }
}

/** Build unified patches for file-mutating tools (Edit/Write/MultiEdit); [] for non-mutating tools. */
function editPatches(name: string, input: unknown): string[] {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const file = (o.file_path as string) || 'file'
  if (name === 'Write') return [buildPatch(file, '', String(o.content ?? ''))]
  if (name === 'Edit') return [buildPatch(file, String(o.old_string ?? ''), String(o.new_string ?? ''))]
  if (name === 'MultiEdit' && Array.isArray(o.edits)) {
    return (o.edits as Array<Record<string, unknown>>).map((e) =>
      buildPatch(file, String(e.old_string ?? ''), String(e.new_string ?? '')),
    )
  }
  return []
}

/** Coerce a tool_result `content` (string | block[] | object) into displayable text. */
function stringifyContent(content: unknown): string {
  if (content == null) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (typeof b === 'string') return b
        if (b && typeof b === 'object' && 'text' in b) return String((b as { text: unknown }).text ?? '')
        return JSON.stringify(b)
      })
      .join('\n')
  }
  try {
    return JSON.stringify(content, null, 2)
  } catch {
    return String(content)
  }
}

function statusIcon(entry: ToolEntry): { icon: string; cls: string } {
  if (!entry.done) return { icon: '·', cls: 'text-accent' }
  return entry.isError ? { icon: '✗', cls: 'text-warn' } : { icon: '✓', cls: 'text-ok' }
}

/** A single tool entry: status + name + summary, expandable to its diff (for edits) or raw input/output. */
export function ToolEntryRow({ entry }: { entry: ToolEntry }) {
  const [open, setOpen] = useState(false)
  const { icon, cls } = statusIcon(entry)
  const summary = toolSummary(entry.name, entry.input)
  const patches = editPatches(entry.name, entry.input)
  const counts = patches.length
    ? patches.reduce(
        (acc, p) => {
          const c = countChangedLines(p)
          return { add: acc.add + c.add, del: acc.del + c.del }
        },
        { add: 0, del: 0 },
      )
    : null
  const output = stringifyContent(entry.content)

  return (
    <div className="text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 py-0.5 text-left hover:bg-panel/40"
      >
        <span className={cn('w-3 shrink-0 text-center', cls)}>{icon}</span>
        <span className="shrink-0 font-medium text-fg">{entry.name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-muted">{summary}</span>
        {counts && (
          <span className="shrink-0 tabular-nums text-subtle">
            <span className="text-ok">+{counts.add}</span> <span className="text-danger">−{counts.del}</span>
          </span>
        )}
        <span className="shrink-0 text-subtle">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="ml-5 mb-1 border-l border-border/40 pl-2">
          {patches.length > 0 ? (
            patches.map((p, i) => <CodeDiff key={i} patch={p} compact />)
          ) : (
            <RawIO input={entry.input} />
          )}
          {output && (entry.isError || patches.length === 0) && (
            <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded border border-border/40 bg-[#0d1117] p-2 font-mono text-[11.5px] leading-[1.5] text-[#c9d1d9]">
              {output.length > OUTPUT_MAX ? `${output.slice(0, OUTPUT_MAX)}\n… (truncated)` : output}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

/** Raw tool input for non-mutating tools (Bash command verbatim, otherwise pretty JSON). */
function RawIO({ input }: { input: unknown }) {
  const o = input && typeof input === 'object' ? (input as Record<string, unknown>) : null
  const cmd = o && typeof o.command === 'string' ? o.command : null
  const text = cmd ?? (() => {
    try {
      return JSON.stringify(input, null, 2)
    } catch {
      return String(input)
    }
  })()
  return (
    <pre className="whitespace-pre-wrap rounded border border-border/40 bg-panel/40 p-2 font-mono text-[11.5px] leading-[1.5] text-muted">
      {text}
    </pre>
  )
}

/** Collapsible WORK LOG group for ≥2 consecutive tool calls (default collapsed). */
export function WorkLog({ entries }: { entries: ToolEntry[] }) {
  const [open, setOpen] = useState(false)
  const anyError = entries.some((e) => e.done && e.isError)
  const allDone = entries.every((e) => e.done)
  const statusCls = anyError ? 'text-warn' : allDone ? 'text-ok' : 'text-accent'
  const statusTxt = anyError ? '✗' : allDone ? '✓' : '·'

  return (
    <div className="ml-1 rounded-md border-l-2 border-border/60 bg-panel/20 py-1 pl-2 pr-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 text-left text-xs"
      >
        <span className="text-subtle">{open ? '▾' : '▸'}</span>
        <span className="font-semibold tracking-wide text-subtle">WORK LOG ({entries.length})</span>
        <span className={cn('shrink-0', statusCls)}>{statusTxt}</span>
        {!open && (
          <span className="min-w-0 flex-1 truncate text-subtle">
            {entries.map((e) => e.name).join(' · ')}
          </span>
        )}
      </button>
      {open && (
        <div className="mt-1 space-y-0.5">
          {entries.map((e) => (
            <ToolEntryRow key={e.id} entry={e} />
          ))}
        </div>
      )}
    </div>
  )
}
