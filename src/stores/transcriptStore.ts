import { create } from 'zustand'
import type { MxEvent } from '@/types/muxDesk'

interface TranscriptStore {
  eventsBySession: Record<string, MxEvent[]>
  lastSeqBySession: Record<string, number>
  mode: string
  state: string
  model: string
  blocked: { hint?: string; loginUrl?: string }
  append: (sessionId: string, event: MxEvent) => void
  clear: (sessionId: string) => void
  setStatus: (mode: string, state: string) => void
  setModel: (model: string) => void
  setBlocked: (blocked: { hint?: string; loginUrl?: string }) => void
}

export const useTranscriptStore = create<TranscriptStore>((set) => ({
  eventsBySession: {},
  lastSeqBySession: {},
  mode: 'AUTO',
  state: 'UNKNOWN',
  model: '',
  blocked: {},
  append: (sessionId, event) =>
    set((store) => {
      if (event.event_type === 'heartbeat') return store
      const lastSeq = store.lastSeqBySession[sessionId] ?? 0
      if (event.seq && event.seq <= lastSeq) return store // seq watermark dedup
      const current = store.eventsBySession[sessionId] ?? []
      return {
        eventsBySession: { ...store.eventsBySession, [sessionId]: [...current, event] },
        lastSeqBySession: {
          ...store.lastSeqBySession,
          [sessionId]: Math.max(lastSeq, event.seq ?? 0),
        },
      }
    }),
  clear: (sessionId) =>
    set((store) => ({
      eventsBySession: { ...store.eventsBySession, [sessionId]: [] },
      lastSeqBySession: { ...store.lastSeqBySession, [sessionId]: 0 },
    })),
  setStatus: (mode, state) => set({ mode, state }),
  setModel: (model) => set({ model }),
  setBlocked: (blocked) => set({ blocked }),
}))
