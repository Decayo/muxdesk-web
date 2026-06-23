import { useCallback, useEffect, useRef } from 'react'
import { wsUrl } from '@/api/http'
import { useTranscriptStore } from '@/stores/transcriptStore'
import type { MxEvent, WsClientMessage } from '@/types/muxDesk'

const BACKOFF_MS = [1000, 2000, 5000, 10000, 10000]

/** Semantic stream WS client: seq watermark + exponential backoff reconnect; events written to transcriptStore. */
export function useMxDeskStream(sessionId: string | null) {
  const wsRef = useRef<WebSocket | null>(null)
  const lastSeqRef = useRef(0)
  const attemptRef = useRef(0)

  const append = useTranscriptStore((s) => s.append)
  const setStatus = useTranscriptStore((s) => s.setStatus)

  useEffect(() => {
    if (!sessionId) {
      wsRef.current = null
      return
    }
    // Per-effect-run cancellation flag: replaces shared ref, prevents old socket's onclose
    // from reconnecting and overwriting wsRef -> send going to the wrong session (cross-talk).
    let cancelled = false
    lastSeqRef.current = 0
    attemptRef.current = 0

    const connect = () => {
      if (cancelled) return
      const socket = new WebSocket(
        wsUrl(`/muxdesk/sessions/${sessionId}/ws?after_seq=${lastSeqRef.current}`),
      )
      wsRef.current = socket

      socket.onopen = () => {
        attemptRef.current = 0
      }
      socket.onmessage = (raw) => {
        const event = JSON.parse(raw.data) as MxEvent
        if (event.event_type === 'heartbeat') return
        if (event.seq) lastSeqRef.current = Math.max(lastSeqRef.current, event.seq)
        if (event.event_type === 'state_change') {
          const store = useTranscriptStore.getState()
          const st = (event.payload.state as string) ?? store.state
          setStatus((event.payload.mode as string) ?? store.mode, st)
          if (st === 'BLOCKED_INTERACTIVE' || st === 'ERROR') {
            store.setBlocked({
              hint: event.payload.hint as string | undefined,
              loginUrl: event.payload.login_url as string | undefined,
            })
          } else if (st === 'READY') {
            store.setBlocked({})
          }
        }
        if (event.event_type === 'assistant_message') {
          const model = (event.payload as { model?: string }).model
          if (model) useTranscriptStore.getState().setModel(model)
        }
        append(sessionId, event)
      }
      socket.onclose = () => {
        if (cancelled) return
        const delay = BACKOFF_MS[Math.min(attemptRef.current, BACKOFF_MS.length - 1)]
        attemptRef.current += 1
        window.setTimeout(connect, delay)
      }
      socket.onerror = () => socket.close()
    }

    connect()
    return () => {
      cancelled = true
      const socket = wsRef.current
      if (socket) {
        socket.onclose = null // prevent reconnect on switch
        socket.onerror = null
        socket.close()
      }
      wsRef.current = null
    }
  }, [sessionId, append, setStatus])

  const send = useCallback((message: WsClientMessage) => {
    const socket = wsRef.current
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message))
    }
  }, [])

  return { send }
}
