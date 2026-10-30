// Business verticals, per the ICS monthly-reporting structure. Shared by the
// Company View and the Performance (actuals) dashboard.
export const VERTICALS: { label: string; codes: string[] }[] = [
  { label: 'National', codes: ['CAP', 'CPT', 'DBN', 'ESL', 'GAU', 'MDB', 'VEN'] },
  { label: 'Industrial', codes: ['KAT', 'RST', 'SEC', 'RCH', 'VER', 'MED'] },
  { label: 'Data Centres', codes: ['DCS'] },
  { label: 'Head Office', codes: ['000', 'ZZZ'] },
]

/** Group cost centres into verticals (in VERTICALS order); anything unmapped
 *  falls into a trailing "Other" group so totals always reconcile. */
export function groupByVertical<T extends { code: string }>(ccs: T[]): { label: string; ccs: T[] }[] {
  const groups = VERTICALS
    .map((v) => ({ label: v.label, ccs: ccs.filter((c) => v.codes.includes(c.code)) }))
    .filter((g) => g.ccs.length)
  const placed = new Set(groups.flatMap((g) => g.ccs.map((c) => c.code)))
  const other = ccs.filter((c) => !placed.has(c.code))
  if (other.length) groups.push({ label: 'Other', ccs: other })
  return groups
}
