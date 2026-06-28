import { isValidElement, memo, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { fmtClock, fmtTokens } from '@/lib/format'
import { Mermaid } from './Mermaid'
import { CodeBlock } from './CodeBlock'
import { CodeDiff } from './CodeDiff'
import { SandboxedFrame } from './SandboxedFrame'

/** Extract the fenced language + source from a markdown <pre> child node (null if it isn't a code block). */
function extractCode(children: ReactNode): { lang: string; code: string } | null {
  const child = Array.isArray(children) ? children[0] : children
  if (!isValidElement(child)) return null
  const props = child.props as { className?: string; children?: ReactNode }
  const lang = /language-([\w+-]+)/.exec(props.className ?? '')?.[1] ?? ''
  return { lang, code: String(props.children ?? '').replace(/\n$/, '') }
}

/**
 * Markdown renderer for assistant messages (react-markdown + remark-gfm).
 * Raw HTML is not rendered (react-markdown sanitizes by default). Styles match t3code aesthetics:
 * wider layout, comfortable line height, dark code-block tokens; footer shows timestamp + turn tokens + actual model.
 * Fenced blocks dispatch to mermaid / diff (two-layer) / shiki-highlighted code.
 */
const components: Components = {
  p: ({ node, ...props }) => <p className="my-1.5 whitespace-pre-wrap leading-[1.65]" {...props} />,
  a: ({ node, ...props }) => <a className="text-accent underline" target="_blank" rel="noreferrer" {...props} />,
  ul: ({ node, ...props }) => <ul className="my-1.5 list-disc space-y-1 pl-5" {...props} />,
  ol: ({ node, ...props }) => <ol className="my-1.5 list-decimal space-y-1 pl-5" {...props} />,
  li: ({ node, ...props }) => <li className="leading-[1.6] marker:text-subtle" {...props} />,
  h1: ({ node, ...props }) => <h1 className="mb-1.5 mt-3 text-base font-semibold text-fg" {...props} />,
  h2: ({ node, ...props }) => <h2 className="mb-1.5 mt-3 text-[0.95rem] font-semibold text-fg" {...props} />,
  h3: ({ node, ...props }) => <h3 className="mb-1 mt-2 text-sm font-semibold text-fg" {...props} />,
  code: ({ node, ...props }) => (
    <code className="rounded bg-panel px-1.5 py-0.5 font-mono text-[0.82em] text-amber-300" {...props} />
  ),
  pre: ({ node, children, ...props }) => {
    const info = extractCode(children)
    if (info?.lang === 'mermaid') return <Mermaid code={info.code} />
    if (info?.lang === 'diff') return <CodeDiff patch={info.code} />
    if (info?.lang === 'html' || info?.lang === 'canvas') return <SandboxedFrame code={info.code} kind={info.lang} />
    if (info) return <CodeBlock code={info.code} lang={info.lang} />
    return (
      <pre
        className="my-2 overflow-x-auto rounded-md border border-border/60 bg-[#0d1117] p-3 font-mono text-[12.5px] leading-[1.55] [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-[#c9d1d9]"
        {...props}
      >
        {children}
      </pre>
    )
  },
  table: ({ node, ...props }) => (
    <div className="my-2 overflow-x-auto rounded-md border border-border/60">
      <table className="w-full border-collapse text-xs" {...props} />
    </div>
  ),
  th: ({ node, ...props }) => <th className="border-b border-border bg-panel px-2.5 py-1.5 text-left font-medium" {...props} />,
  td: ({ node, ...props }) => <td className="border-b border-border/50 px-2.5 py-1.5" {...props} />,
  blockquote: ({ node, ...props }) => (
    <blockquote className="my-1.5 border-l-2 border-accent/40 pl-3 text-muted" {...props} />
  ),
  hr: () => <hr className="my-3 border-border/60" />,
}

/**
 * Memoized: assistant messages re-parse markdown on every render, but the conversation re-renders on
 * each poll (live preview 700ms, menu 1.5s, subagents 3s). Shallow primitive props mean settled
 * messages skip the re-parse entirely.
 */
export const MxMessage = memo(function MxMessage({
  text,
  ts,
  tokens,
  model,
}: {
  text: string
  ts?: number
  tokens?: number
  model?: string
}) {
  return (
    <div className="flex flex-col items-start">
      <div className="max-w-[94%] rounded-lg bg-panel-2/70 px-3.5 py-2.5 text-[13.5px] text-fg">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {text}
        </ReactMarkdown>
      </div>
      <div className="mt-0.5 flex items-center gap-2 px-1 text-[10px] text-subtle">
        {ts ? <span>{fmtClock(ts)}</span> : null}
        {tokens ? <span className="tabular-nums">↓ {fmtTokens(tokens)} tok</span> : null}
        {model ? <span className="truncate">{model}</span> : null}
      </div>
    </div>
  )
})
