import { useEffect } from 'react'

/** Full-screen image viewer opened by clicking a thumbnail (click backdrop / Esc to close). src can be a data URL or backend image URL. */
export function ImageLightbox({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
      onClick={onClose}
      role="presentation"
    >
      <img
        src={src}
        alt="Preview"
        className="max-h-full max-w-full rounded shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-panel-2/90 text-lg text-fg hover:bg-panel"
        title="Close (Esc)"
      >
        ×
      </button>
    </div>
  )
}
