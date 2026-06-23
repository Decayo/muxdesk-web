import { create } from 'zustand'

interface TerminalStore {
  connected: boolean
  setConnected: (connected: boolean) => void
}

export const useTerminalStore = create<TerminalStore>((set) => ({
  connected: false,
  setConnected: (connected) => set({ connected }),
}))
