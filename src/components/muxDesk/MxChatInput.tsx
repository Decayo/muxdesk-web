import { useCallback, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { uploadSessionImage } from '@/api/nativeAgents'
import { matchCommands, slashQuery, type SlashCommand } from '@/config/slashCommands'
import { ImageLightbox } from './ImageLightbox'

interface Props {
  /** Current session (image upload target). */
  sessionId?: string | null
  disabled?: boolean
  /** Claude is working (send button becomes red stop button -> interrupt). */
  busy?: boolean
  onSend: (text: string) => void
  /** Interrupt claude (send Escape to pane). */
  onStop?: () => void
}

interface PastedImg {
  path: string // absolute path stored by backend (included in message for claude Read)
  url: string // data URL (frontend thumbnail preview)
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

export function MxChatInput({ sessionId, disabled, busy, onSend, onStop }: Props) {
  const [text, setText] = useState('')
  const [imgs, setImgs] = useState<PastedImg[]>([])
  const [uploading, setUploading] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  // IME (fcitx5 + rime) alignment: Enter during composition confirms the candidate, not submit.
  const composingRef = useRef(false)
  const justEndedRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Slash-command palette: open when the whole input is a `/cmd` being typed (and not dismissed via Esc).
  const [cmdSel, setCmdSel] = useState(0)
  const [cmdDismissed, setCmdDismissed] = useState(false)
  const query = slashQuery(text)
  const candidates = query !== null ? matchCommands(query) : []
  const paletteOpen = query !== null && !cmdDismissed && candidates.length > 0
  const sel = Math.min(cmdSel, Math.max(0, candidates.length - 1))

  const changeText = (next: string) => {
    setText(next)
    setCmdDismissed(false) // typing re-opens / re-filters the palette
    setCmdSel(0)
  }

  const acceptCommand = (cmd: SlashCommand) => {
    setText(`/${cmd.name} `) // trailing space: ready for arguments
    setCmdDismissed(true)
    textareaRef.current?.focus()
  }

  const submit = () => {
    const trimmed = text.trim()
    if (!trimmed && imgs.length === 0) return
    // Attach images as absolute paths in the message -> claude reads via Read (web clipboard can't pipe directly to tmux)
    const paths = imgs.map((i) => i.path)
    const composed = paths.length
      ? `${trimmed ? `${trimmed}\n\n` : ''}Attached image (use Read to view):\n${paths.join('\n')}`
      : trimmed
    onSend(composed)
    setText('')
    setImgs([])
  }

  const onPaste = async (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(event.clipboardData?.items ?? []).filter((it) => it.type.startsWith('image/'))
    if (items.length === 0) return // plain text paste -> let native handle it
    event.preventDefault()
    if (!sessionId) return
    setUploading(true)
    try {
      for (const it of items) {
        const file = it.getAsFile()
        if (!file) continue
        const dataUrl = await fileToDataUrl(file)
        const ext = (file.type.split('/')[1] || 'png').toLowerCase()
        const res = await uploadSessionImage(sessionId, dataUrl, ext)
        if (res.ok && res.path) setImgs((prev) => [...prev, { path: res.path as string, url: dataUrl }])
      }
    } catch {
      // silently ignore upload failure (best-effort), user can re-paste
    } finally {
      setUploading(false)
    }
  }

  const onCompositionStart = useCallback(() => {
    composingRef.current = true
    justEndedRef.current = false
  }, [])

  const onCompositionEnd = useCallback(() => {
    composingRef.current = false
    // On Linux/Chromium, compositionend may be followed by another keydown from the same physical Enter.
    // Use a microtask window to swallow this "confirm key tail", without delaying the user's next real Enter.
    justEndedRef.current = true
    queueMicrotask(() => {
      justEndedRef.current = false
    })
  }, [])

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const native = event.nativeEvent as KeyboardEvent & { keyCode?: number; isComposing?: boolean }
    const composing = composingRef.current || justEndedRef.current || native.isComposing || native.keyCode === 229

    // Command-palette navigation takes priority over send/newline — but never while the IME composes.
    if (paletteOpen && !composing) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setCmdSel((i) => (i + 1) % candidates.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setCmdSel((i) => (i - 1 + candidates.length) % candidates.length)
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        acceptCommand(candidates[sel])
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setCmdDismissed(true)
        return
      }
    }

    if (event.key !== 'Enter') return
    if (event.shiftKey) return // Shift+Enter for newline, let native handle it
    // Triple gate: local composing flag + event-level isComposing + keyCode 229 fallback + compositionend tail
    if (composing) return // hand back to IME, do not submit
    event.preventDefault()
    submit()
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border bg-panel p-3">
      {(imgs.length > 0 || uploading) && (
        <div className="flex flex-wrap items-center gap-2">
          {imgs.map((img, i) => (
            <div key={img.path} className="relative">
              <img
                src={img.url}
                alt="Pasted image"
                onClick={() => setPreview(img.url)}
                className="h-16 w-16 cursor-zoom-in rounded border border-border object-cover"
              />
              <button
                type="button"
                onClick={() => setImgs((prev) => prev.filter((_, j) => j !== i))}
                title="Remove"
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-panel-2 text-xs text-muted hover:text-fg"
              >
                ×
              </button>
            </div>
          ))}
          {uploading && <span className="text-xs text-muted">Uploading image…</span>}
        </div>
      )}
      {preview && <ImageLightbox src={preview} onClose={() => setPreview(null)} />}
      <div className="flex items-end gap-2">
        <div className="relative flex-1">
          {paletteOpen && (
            <div className="absolute bottom-full left-0 z-10 mb-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-panel-2 py-1 shadow-lg">
              {candidates.map((cmd, i) => (
                <button
                  key={cmd.name}
                  type="button"
                  // onMouseDown (not onClick) so the textarea doesn't blur before we accept + refocus
                  onMouseDown={(e) => {
                    e.preventDefault()
                    acceptCommand(cmd)
                  }}
                  onMouseEnter={() => setCmdSel(i)}
                  className={`flex w-full items-baseline gap-2 px-3 py-1 text-left text-sm ${i === sel ? 'bg-accent/20 text-fg' : 'text-muted'}`}
                >
                  <span className="font-mono text-accent">/{cmd.name}</span>
                  <span className="truncate text-xs text-subtle">{cmd.hint}</span>
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(event) => changeText(event.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={onCompositionEnd}
            disabled={disabled}
            rows={1}
            placeholder="Type a message — / for commands, Enter to send, Shift+Enter for newline…"
            className="max-h-40 min-h-[40px] w-full resize-none rounded-md border border-border bg-panel-2 px-3 py-2 text-sm text-fg outline-none placeholder:text-muted focus:border-accent disabled:opacity-50"
          />
        </div>
        {busy && onStop ? (
          <button
            type="button"
            onClick={onStop}
            title="Interrupt claude (Esc)"
            className="flex items-center gap-1.5 rounded-md bg-danger px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            <span className="inline-block h-2.5 w-2.5 rounded-[2px] bg-white" />
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={disabled}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            Send
          </button>
        )}
      </div>
    </div>
  )
}
