import { useEffect, useId, useState } from 'react'

// lazy import: mermaid is large, only load on first ```mermaid encounter to avoid slowing initial render
let _mermaid: Promise<(typeof import('mermaid'))['default']> | null = null
function getMermaid() {
  if (!_mermaid) {
    _mermaid = import('mermaid').then((m) => {
      m.default.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' })
      return m.default
    })
  }
  return _mermaid
}

/** Render a ```mermaid code block as a diagram (flowchart/sequence/etc); falls back to raw source on parse failure. */
export function Mermaid({ code }: { code: string }) {
  const [svg, setSvg] = useState('')
  const [failed, setFailed] = useState(false)
  const renderId = `mmd-${useId().replace(/:/g, '')}` // mermaid needs a colon-free DOM id

  useEffect(() => {
    let alive = true
    setSvg('')
    setFailed(false)
    getMermaid()
      .then((mermaid) => mermaid.render(renderId, code))
      .then(({ svg }) => {
        if (alive) setSvg(svg)
      })
      .catch(() => {
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
    }
  }, [code, renderId])

  if (failed) {
    return (
      <pre className="my-2 overflow-x-auto rounded-md border border-border/60 bg-[#0d1117] p-3 font-mono text-[12.5px] leading-[1.55] text-[#c9d1d9]">
        {code}
      </pre>
    )
  }
  if (!svg) return <div className="my-2 text-xs text-muted">Rendering diagram…</div>
  return (
    <div
      className="my-2 flex justify-center overflow-x-auto rounded-md border border-border/60 bg-[#0d1117] p-2 [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
