import { create } from 'zustand'
import { DEFAULT_MODEL, type MxSession } from '@/types/muxDesk'

interface SessionStore {
  sessions: MxSession[]
  activeId: string | null
  selectedModel: string
  setSessions: (sessions: MxSession[]) => void
  setActive: (id: string | null) => void
  setSelectedModel: (model: string) => void
  upsert: (session: MxSession) => void
  remove: (id: string) => void
}

export const useSessionStore = create<SessionStore>((set) => ({
  sessions: [],
  activeId: null,
  selectedModel: DEFAULT_MODEL,
  setSelectedModel: (selectedModel) => set({ selectedModel }),
  setSessions: (sessions) => set({ sessions }),
  setActive: (activeId) => set({ activeId }),
  upsert: (session) =>
    set((state) => {
      const index = state.sessions.findIndex((s) => s.app_session_id === session.app_session_id)
      const sessions =
        index >= 0
          ? state.sessions.map((s, i) => (i === index ? session : s))
          : [session, ...state.sessions]
      return { sessions }
    }),
  remove: (id) =>
    set((state) => ({
      sessions: state.sessions.filter((s) => s.app_session_id !== id),
      activeId: state.activeId === id ? null : state.activeId,
    })),
}))
