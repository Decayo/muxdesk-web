export function fmtMoney(value: number | null | undefined, currency = 'USD'): string {
  if (value == null || Number.isNaN(value)) return '—'
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    return value.toFixed(2)
  }
}

export function fmtNum(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return '—'
  return value.toLocaleString('en-US', { maximumFractionDigits: digits })
}

export function fmtPct(value: number | null | undefined, digits = 2): string {
  if (value == null || Number.isNaN(value)) return '—'
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`
}

export function fmtDate(value: string | null | undefined): string {
  if (!value) return '—'
  return value.length > 10 ? value.slice(0, 10) : value
}

export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  return value.replace('T', ' ').slice(0, 19)
}

/** Return tailwind color class based on sign (green for positive, red for negative). */
export function pnlClass(value: number | null | undefined): string {
  if (value == null || value === 0) return 'text-muted'
  return value > 0 ? 'text-ok' : 'text-danger'
}

/** Epoch seconds -> local HH:MM:SS (conversation message timestamp). */
export function fmtClock(ts: number | null | undefined): string {
  if (!ts) return ''
  return new Date(ts * 1000).toLocaleTimeString('zh-TW', { hour12: false })
}

/** Short format for token count: >=1000 shows k (e.g. 10.2k), otherwise raw number. */
export function fmtTokens(n: number | null | undefined): string {
  if (!n) return ''
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}
