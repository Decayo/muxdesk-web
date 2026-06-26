import { create } from 'zustand'

/** Conversation view density: 'full' shows every event; 'focus' hides internal thinking (results-only). */
export type ViewMode = 'full' | 'focus'

const STORAGE_KEY = 'muxdesk.viewMode'

function loadViewMode(): ViewMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'focus' ? 'focus' : 'full'
  } catch {
    return 'full'
  }
}

interface UiStore {
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
}

/** UI-only state, kept separate from transcript data (per the rendering design's state split). */
export const useUiStore = create<UiStore>((set) => ({
  viewMode: loadViewMode(),
  setViewMode: (viewMode) => {
    try {
      localStorage.setItem(STORAGE_KEY, viewMode)
    } catch {
      // ignore (private mode / storage disabled)
    }
    set({ viewMode })
  },
}))
