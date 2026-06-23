import { MODELS } from '@/types/muxDesk'

interface Props {
  value: string
  onChange: (model: string) => void
}

export function MxModelPicker({ value, onChange }: Props) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="rounded-md border border-border bg-panel-2 px-2 py-1 text-xs text-fg outline-none focus:border-accent"
      title="Model to use for new sessions"
    >
      {MODELS.map((model) => (
        <option key={model} value={model}>
          {model}
        </option>
      ))}
    </select>
  )
}
