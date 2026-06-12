const nf = new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 0 })

/** Format an amount: thousands-separated, negatives in parentheses, zero as "-". */
export function fmt(n: number | null | undefined): string {
  if (n == null || n === 0 || !isFinite(n)) return '-'
  const r = Math.round(n)
  if (r === 0) return '-'
  return r < 0 ? `(${nf.format(-r)})` : nf.format(r)
}

export function fmtPct(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '-'
  return `${(n * 100).toFixed(1)}%`
}

/** Parse a user-typed or pasted amount: handles spaces, commas, parentheses, "R". */
export function parseAmount(s: string): number | null {
  const t = s.replace(/[R\s, ]/gi, '').trim()
  if (t === '' || t === '-') return 0
  const neg = /^\(.*\)$/.test(t)
  const core = neg ? t.slice(1, -1) : t
  const n = Number(core)
  if (!isFinite(n)) return null
  return neg ? -n : n
}
