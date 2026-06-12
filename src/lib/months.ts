// Financial year runs July (m1) to June (m12).
// FY2027 = Jul 2026 .. Jun 2027.

export const MONTH_KEYS = [
  'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10', 'm11', 'm12',
] as const

export type MonthKey = (typeof MONTH_KEYS)[number]

export type MonthValues = Record<MonthKey, number>

const MONTH_NAMES = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']

/** Label for month index 0..11 of a financial year, e.g. fyLabel(2027, 0) = "Jul 26" */
export function monthLabel(fyYear: number, idx: number): string {
  const calendarYear = idx <= 5 ? fyYear - 1 : fyYear
  return `${MONTH_NAMES[idx]} ${String(calendarYear).slice(2)}`
}

export function monthLabels(fyYear: number): string[] {
  return MONTH_KEYS.map((_, i) => monthLabel(fyYear, i))
}

export function emptyMonths(): MonthValues {
  return Object.fromEntries(MONTH_KEYS.map((k) => [k, 0])) as MonthValues
}

export function totalOf(v: Partial<MonthValues> | null | undefined): number {
  if (!v) return 0
  return MONTH_KEYS.reduce((s, k) => s + (Number(v[k]) || 0), 0)
}

export function addInto(target: MonthValues, v: Partial<MonthValues> | null | undefined): MonthValues {
  if (v) for (const k of MONTH_KEYS) target[k] += Number(v[k]) || 0
  return target
}
