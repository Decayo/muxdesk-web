import { Component, type ReactNode } from 'react'

/**
 * Generic render error boundary. Used to isolate each conversation row so one malformed
 * event/message can't unmount the whole transcript (a real failure mode seen with bad diffs).
 * Remounts (resets) when its React key changes — i.e. when the underlying item changes.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return this.props.fallback ?? <div className="px-1 text-xs text-warn">⚠ failed to render this item</div>
    }
    return this.props.children
  }
}
