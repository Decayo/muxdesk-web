import { useEffect } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { wsUrl } from '@/api/http'
import { useTerminalStore } from '@/stores/terminalStore'

/** Terminal stream: xterm.js connected to pty WebSocket, bidirectional I/O + resize. */
export function useMxTerminal(sessionId: string | null, container: HTMLDivElement | null) {
  const setConnected = useTerminalStore((s) => s.setConnected)

  useEffect(() => {
    if (!sessionId || !container) return

    const term = new Terminal({
      fontSize: 13,
      // Use monospace fonts actually present on the host (mac fonts don't exist on Linux ->
      // fallback measurement mismatch -> letter spacing blows up);
      // override with VITE_MUXDESK_TERMINAL_FONT (placed first); Nerd Font preferred (best for
      // claude TUI box-drawing / icons), DejaVu/Liberation as fallback.
      // The terminal itself is independent of the host terminal emulator (xterm.js <-> tmux).
      fontFamily: [
        import.meta.env.VITE_MUXDESK_TERMINAL_FONT,
        '"JetBrainsMono Nerd Font"',
        '"JetBrains Mono"',
        '"DejaVu Sans Mono"',
        '"Liberation Mono"',
        'Menlo',
        'Consolas',
        'monospace',
      ]
        .filter(Boolean)
        .join(', '),
      letterSpacing: 0,
      theme: { background: '#0a0a0c', foreground: '#e8e8ec' },
      cursorBlink: true,
      allowProposedApi: true,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.loadAddon(new WebLinksAddon())
    term.open(container)
    fit.fit()

    const socket = new WebSocket(wsUrl(`/muxdesk/sessions/${sessionId}/terminal`))
    socket.binaryType = 'arraybuffer'

    const sendResize = () => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ resize: { cols: term.cols, rows: term.rows } }))
      }
    }

    socket.onopen = () => {
      setConnected(true)
      sendResize()
    }
    socket.onmessage = (raw) => {
      if (raw.data instanceof ArrayBuffer) term.write(new Uint8Array(raw.data))
      else term.write(raw.data as string)
    }
    socket.onclose = () => setConnected(false)

    const dataDisposable = term.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(data)
    })

    const resizeObserver = new ResizeObserver(() => {
      try {
        fit.fit()
        sendResize()
      } catch {
        // container not yet measurable, ignore
      }
    })
    resizeObserver.observe(container)

    return () => {
      dataDisposable.dispose()
      resizeObserver.disconnect()
      socket.close()
      term.dispose()
    }
  }, [sessionId, container, setConnected])
}
