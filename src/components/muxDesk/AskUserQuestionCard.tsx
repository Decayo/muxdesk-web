import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

export interface AskOption {
  label?: string
  description?: string
}
export interface AskQuestion {
  question?: string
  header?: string
  multiSelect?: boolean
  options?: AskOption[]
}

/**
 * AskUserQuestion structured card (via muxdesk-ask channel, not capture-pane).
 * Receives all questions at once (structured JSON) -> internal per-question stepper
 * (multi-select checkbox / single-select / custom answer) ->
 * POSTs all answers back in one go (no keyboard simulation, no Tab/Space/Enter/Submit stages).
 * answers shape: {"0": "Python", "1": ["VS Code","Neovim"], "2": "custom text"}.
 */
export function AskUserQuestionCard({
  questions,
  onSubmit,
  onCancel,
}: {
  questions: AskQuestion[]
  onSubmit: (answers: Record<string, string | string[]>) => void
  onCancel: () => void
}) {
  const [qIdx, setQIdx] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({})
  const [selected, setSelected] = useState<string[]>([])
  const [customText, setCustomText] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    setSelected([])
    setCustomText('')
    rootRef.current?.focus() // grab focus per question -> Enter/number keys work immediately without clicking first
  }, [qIdx])

  const q = questions[qIdx]
  const multi = !!q?.multiSelect
  const options = q?.options ?? []
  const last = qIdx >= questions.length - 1
  const customActive = customText.trim().length > 0
  const canNext = customActive || selected.length > 0

  const toggle = (label: string) => {
    setCustomText('')
    setSelected((prev) => (multi ? (prev.includes(label) ? prev.filter((l) => l !== label) : [...prev, label]) : [label]))
  }

  const advance = () => {
    if (!canNext) return
    const value: string | string[] = customActive ? customText.trim() : multi ? selected : selected[0]
    const next = { ...answers, [String(qIdx)]: value }
    setAnswers(next)
    if (last) onSubmit(next)
    else setQIdx((i) => i + 1)
  }

  // Enter = next question / submit (capture-phase intercept, prevents
  // "focus on option button -> Enter activates = toggles check");
  // Number keys 1-9 = select that option (inside custom input field, let it type normally).
  const onKeyDownCapture = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      advance()
      return
    }
    const inField = (e.target as HTMLElement).tagName === 'INPUT'
    if (!inField && /^[1-9]$/.test(e.key)) {
      const idx = Number(e.key) - 1
      if (idx < options.length) {
        e.preventDefault()
        e.stopPropagation()
        toggle(options[idx].label ?? '')
      }
    }
  }

  if (!q) return null
  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      onKeyDownCapture={onKeyDownCapture}
      className="border-t border-accent/30 bg-accent/5 px-4 py-3 outline-none"
    >
      {/* Multi-question progress: ✓ answered / ● current / ○ pending */}
      {questions.length > 1 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[11px]">
          {questions.map((qq, i) => {
            const done = String(i) in answers
            const cur = i === qIdx
            return (
              <span
                key={i}
                className={cn(
                  'flex items-center gap-1 rounded px-1.5 py-0.5',
                  cur ? 'bg-accent/20 text-accent-fg' : done ? 'bg-accent/10 text-accent-fg/80' : 'bg-panel-2 text-muted',
                )}
              >
                <span>{cur ? '●' : done ? '✓' : '○'}</span>
                {qq.header || `Q${i + 1}`}
              </span>
            )
          })}
        </div>
      )}
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-subtle">{q.header || 'Choose'}</span>
        {questions.length > 1 && (
          <span className="rounded bg-panel-2 px-1.5 text-[10px] tabular-nums text-muted">
            {qIdx + 1}/{questions.length}
          </span>
        )}
        {multi && <span className="text-xs text-muted">(multi-select)</span>}
        <button type="button" onClick={onCancel} className="ml-auto text-xs text-subtle hover:text-fg">
          Cancel (Esc)
        </button>
      </div>
      {q.question && <p className="text-sm text-fg">{q.question}</p>}
      <div className="mt-2.5 space-y-1.5">
        {options.map((o, i) => {
          const label = o.label ?? ''
          const isSel = !customActive && selected.includes(label)
          return (
            <button
              key={`${label}-${i}`}
              type="button"
              onClick={() => toggle(label)}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors',
                isSel
                  ? 'border-accent/40 bg-accent/10 text-fg'
                  : 'border-transparent bg-panel-2/60 text-fg hover:border-border hover:bg-panel-2',
              )}
            >
              {multi && (
                <span
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded border text-[10px]',
                    isSel ? 'border-accent bg-accent text-white' : 'border-border text-transparent',
                  )}
                >
                  ✓
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{label}</div>
                {o.description && o.description !== label && (
                  <div className="text-xs text-subtle">{o.description}</div>
                )}
              </div>
              {!multi &&
                (isSel ? (
                  <span className="shrink-0 text-accent-fg">✓</span>
                ) : i < 9 ? (
                  <kbd className="flex size-5 shrink-0 items-center justify-center rounded border border-border/60 text-[11px] tabular-nums text-muted">
                    {i + 1}
                  </kbd>
                ) : null)}
            </button>
          )
        })}
      </div>
      <input
        value={customText}
        onChange={(e) => setCustomText(e.target.value)}
        placeholder="Or type a custom answer…"
        className={cn(
          'mt-2 w-full rounded-lg border bg-panel-2 px-3 py-2 text-sm text-fg outline-none placeholder:text-muted',
          customActive ? 'border-accent/40' : 'border-border focus:border-accent',
        )}
      />
      <div className="mt-2.5 flex items-center justify-end gap-2">
        {qIdx > 0 && (
          <button type="button" onClick={() => setQIdx((i) => i - 1)} className="text-xs text-subtle hover:text-fg">
            ← Previous
          </button>
        )}
        <span className="text-xs text-subtle">
          {customActive ? 'Custom answer' : multi ? `${selected.length} checked` : selected.length ? 'Selected' : 'Pick one or type your own'}
        </span>
        <button
          type="button"
          onClick={advance}
          disabled={!canNext}
          className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
        >
          {last ? 'Submit' : 'Next'}
        </button>
      </div>
    </div>
  )
}
