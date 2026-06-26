import { useEffect, useRef, useState } from 'react'
import { highlightCode } from '@/lib/shiki'

/**
 * Fenced code block with shiki syntax highlighting (async), a language badge, and a copy button.
 * Renders plain text first, then swaps in highlighted HTML once shiki resolves -> safe during streaming
 * (settled assistant messages re-highlight only when their text changes).
 */
export function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [html, setHtml] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    let alive = true
    highlightCode(code, lang)
      .then((h) => alive && setHtml(h))
      .catch(() => alive && setHtml(null))
    return () => {
      alive = false
    }
  }, [code, lang])

  useEffect(() => () => window.clearTimeout(copyTimer.current), [])

  const copy = () => {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true)
      window.clearTimeout(copyTimer.current)
      copyTimer.current = window.setTimeout(() => setCopied(false), 1200)
    })
  }

  const label = lang && lang !== 'text' ? lang : 'text'

  return (
    <div className="group/code my-2 overflow-hidden rounded-md border border-border/60 bg-[#0d1117]">
      <div className="flex items-center justify-between border-b border-border/40 px-3 py-1 text-[10px] text-subtle">
        <span className="font-mono uppercase tracking-wide">{label}</span>
        <button
          type="button"
          onClick={copy}
          className="opacity-0 transition-opacity hover:text-fg group-hover/code:opacity-100"
        >
          {copied ? '✓ copied' : 'copy'}
        </button>
      </div>
      {html ? (
        // shiki output; neutralize its <pre> chrome so our container controls padding/scroll/size
        <div
          className="overflow-x-auto px-3 py-2.5 font-mono text-[12.5px] leading-[1.55] [&_pre]:!m-0 [&_pre]:!bg-transparent [&_pre]:!p-0"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="overflow-x-auto px-3 py-2.5 font-mono text-[12.5px] leading-[1.55] text-[#c9d1d9]">
          <code>{code}</code>
        </pre>
      )}
    </div>
  )
}
