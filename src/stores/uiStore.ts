import { create } from 'zustand'

/** Conversation view density: 'full' shows every event; 'focus' hides internal thinking (results-only). */
export type ViewMode = 'full' | 'focus'
/** Session sidebar grouping: by date (default), parent/child tree, or by project. */
export type SidebarView = 'date' | 'tree' | 'project'

const VIEW_KEY = 'muxdesk.viewMode'
const SIDEBAR_KEY = 'muxdesk.sidebarView'

function load<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return (allowed as readonly string[]).includes(v ?? '') ? (v as T) : fallback
  } catch {
    return fallback
  }
}

function persist(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // ignore (private mode / storage disabled)
  }
}

interface UiStore {
  viewMode: ViewMode
  setViewMode: (mode: ViewMode) => void
  sidebarView: SidebarView
  setSidebarView: (view: SidebarView) => void
}

/** UI-only state, kept separate from transcript data (per the rendering design's state split). */
export const useUiStore = create<UiStore>((set) => ({
  viewMode: load(VIEW_KEY, ['full', 'focus'] as const, 'full'),
  setViewMode: (viewMode) => {
    persist(VIEW_KEY, viewMode)
    set({ viewMode })
  },
  sidebarView: load(SIDEBAR_KEY, ['date', 'tree', 'project'] as const, 'date'),
  setSidebarView: (sidebarView) => {
    persist(SIDEBAR_KEY, sidebarView)
    set({ sidebarView })
  },
}))
