import { useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * Inline sandboxed preview for fenced `html` / `canvas` blocks (muxdesk's differentiator — t3code
 * sanitizes these away). The content runs inside `<iframe sandbox="allow-scripts">`: scripts execute
 * but the frame is an opaque origin with no same-origin access, no top-navigation, no forms, no popups —
 * so a block can draw/animate yet cannot touch the parent page, cookies, or storage.
 */
export function SandboxedFrame({ code, kind }: { code: string; kind: 'html' | 'canvas' }) {
  const [expanded, setExpanded] = useState(false)
  const srcDoc = kind === 'canvas' ? canvasScaffold(code) : code

  return (
    <div className="my-2 overflow-hidden rounded-md border border-border/60 bg-[#0d1117]">
      <div className="flex items-center justify-between border-b border-border/40 px-3 py-1 text-[10px] text-subtle">
        <span className="font-mono uppercase tracking-wide">{kind} · sandboxed</span>
        <button type="button" aria-expanded={expanded} onClick={() => setExpanded((e) => !e)} className="hover:text-fg">
          {expanded ? 'shrink' : 'expand'}
        </button>
      </div>
      <iframe
        // allow-scripts only: code can run/draw, but the frame is a unique opaque origin (no parent access).
        sandbox="allow-scripts"
        srcDoc={srcDoc}
        title={`${kind} preview`}
        className={cn('w-full border-0 bg-white transition-[height]', expanded ? 'h-[70vh]' : 'h-72')}
      />
    </div>
  )
}

/** Wrap raw canvas-drawing code in a full-frame <canvas> scaffold exposing `canvas` + `ctx`. */
function canvasScaffold(code: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#0d1117;overflow:hidden}
canvas{display:block}
.err{color:#ff6b6b;font:12px monospace;padding:8px;white-space:pre-wrap}
</style></head><body><canvas id="canvas"></canvas><script>
(function(){
  var canvas=document.getElementById('canvas');
  canvas.width=window.innerWidth; canvas.height=window.innerHeight;
  var ctx=canvas.getContext('2d');
  try { ${code} } catch(e){ document.body.innerHTML='<div class=err>'+String(e&&e.stack||e)+'</div>'; }
})();
</script></body></html>`
}
