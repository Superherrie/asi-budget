import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import MonthGrid, { type GridRow } from '../components/MonthGrid'
import StatusBadge from '../components/StatusBadge'
import { computeStatement } from '../lib/statement'
import { monthLabels } from '../lib/months'
import { fmt, fmtPct } from '../lib/format'
import { supabase } from '../lib/supabase'
import { monthsOf } from '../hooks/useBudget'
import { useAuth } from '../context/AuthContext'
import type { Account, Approval, ApprovalStatus, Cycle } from '../lib/types'

type CcValues = Map<number, Map<number, number[]>> // cc -> account -> months
type Row = Record<string, unknown>

// Business verticals, per the ICS monthly-reporting structure. Cost centres not
// listed fall into a trailing "Other" group so the grand total always ties.
const VERTICALS: { label: string; codes: string[] }[] = [
  { label: 'National', codes: ['CAP', 'CPT', 'DBN', 'ESL', 'GAU', 'MDB', 'VEN'] },
  { label: 'Industrial', codes: ['KAT', 'RST', 'SEC', 'RCH', 'VER', 'MED'] },
  { label: 'Data Centres', codes: ['DCS'] },
  { label: 'Head Office', codes: ['000', 'ZZZ'] },
]

// PostgREST caps a single response at 1000 rows; page through so company-wide
// tables (budget_actuals, the statement view) are summed in full.
async function fetchAllRows(
  page: (from: number, to: number) => PromiseLike<{ data: Row[] | null }>,
): Promise<Row[]> {
  const SIZE = 1000
  const all: Row[] = []
  for (let from = 0; ; from += SIZE) {
    const { data } = await page(from, from + SIZE - 1)
    const rows = data ?? []
    all.push(...rows)
    if (rows.length < SIZE) break
  }
  return all
}

function totalsFor(accounts: Account[], values: Map<number, number[]>) {
  const single = new Map<number, number[]>()
  for (const [id, months] of values) single.set(id, [months.reduce((s, v) => s + v, 0), ...Array(11).fill(0)])
  const out = new Map<string, number>()
  for (const line of computeStatement(accounts, single)) out.set(line.key, line.months[0])
  return out
}

export default function CompanyView() {
  const { costCentres } = useAuth()
  const [cycle, setCycle] = useState<Cycle | null>(null)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [budgetByCc, setBudgetByCc] = useState<CcValues>(new Map())
  const [actualsByFy, setActualsByFy] = useState<Map<number, Map<number, number[]>>>(new Map())
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [filter, setFilter] = useState<'all' | 'submitted' | 'approved'>('all')
  const [loaded, setLoaded] = useState(false)
  // Training/demo cost centres are excluded from every company roll-up.
  const [excludedIds, setExcludedIds] = useState<Set<number>>(new Set())

  useEffect(() => {
    void (async () => {
      const cyc = (await supabase.from('budget_cycles').select('*').eq('status', 'open')
        .order('fy_year', { ascending: false }).limit(1).maybeSingle()).data as Cycle | null
      if (!cyc) { setLoaded(true); return }
      setCycle(cyc)
      const [accRes, apprRes, demoRes, viewRows, actRows] = await Promise.all([
        supabase.from('budget_accounts').select('*').order('sort_order'),
        supabase.from('budget_approvals').select('*').eq('cycle_id', cyc.id),
        supabase.from('budget_cost_centres').select('id').eq('code', 'DEMO'),
        // both of these can exceed PostgREST's 1000-row cap, so page through them
        fetchAllRows((from, to) => supabase.from('budget_statement_lines').select('*').eq('cycle_id', cyc.id).range(from, to)),
        fetchAllRows((from, to) => supabase.from('budget_actuals').select('*').range(from, to)),
      ])
      const excluded = new Set<number>(((demoRes.data ?? []) as { id: number }[]).map((r) => r.id))
      setExcludedIds(excluded)
      setAccounts((accRes.data as Account[]) ?? [])
      const byCc: CcValues = new Map()
      for (const r of viewRows) {
        const cc = r.cost_centre_id as number
        if (excluded.has(cc)) continue
        if (!byCc.has(cc)) byCc.set(cc, new Map())
        byCc.get(cc)!.set(r.account_id as number, monthsOf(r))
      }
      setBudgetByCc(byCc)
      // company-wide actuals summed per FY per account (demo excluded)
      const act = new Map<number, Map<number, number[]>>()
      for (const r of actRows) {
        if (excluded.has(r.cost_centre_id as number)) continue
        const fy = r.fy_year as number
        if (!act.has(fy)) act.set(fy, new Map())
        const m = act.get(fy)!
        const months = monthsOf(r)
        const cur = m.get(r.account_id as number)
        m.set(r.account_id as number, cur ? cur.map((v, i) => v + months[i]) : months)
      }
      setActualsByFy(act)
      setApprovals((apprRes.data as Approval[]) ?? [])
      setLoaded(true)
    })()
  }, [])

  const statusOf = (ccId: number): ApprovalStatus =>
    approvals.find((a) => a.cost_centre_id === ccId)?.status ?? 'draft'

  const includedCcs = useMemo(
    () =>
      costCentres.filter((cc) => {
        if (excludedIds.has(cc.id)) return false
        if (filter === 'all') return true
        const s = statusOf(cc.id)
        return filter === 'approved' ? s === 'approved' : s === 'submitted' || s === 'approved'
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [costCentres, filter, approvals, excludedIds],
  )

  const companyValues = useMemo(() => {
    const sum = new Map<number, number[]>()
    for (const cc of includedCcs) {
      for (const [accId, months] of budgetByCc.get(cc.id) ?? []) {
        const cur = sum.get(accId)
        sum.set(accId, cur ? cur.map((v, i) => v + months[i]) : [...months])
      }
    }
    return sum
  }, [includedCcs, budgetByCc])

  const stmt = useMemo(() => computeStatement(accounts, companyValues), [accounts, companyValues])
  const ctx25 = useMemo(() => totalsFor(accounts, actualsByFy.get(2025) ?? new Map()), [accounts, actualsByFy])
  const ctx26 = useMemo(() => totalsFor(accounts, actualsByFy.get(2026) ?? new Map()), [accounts, actualsByFy])

  const perCcTotals = useMemo(
    () => new Map(includedCcs.map((cc) => [cc.id, totalsFor(accounts, budgetByCc.get(cc.id) ?? new Map())])),
    [includedCcs, accounts, budgetByCc],
  )

  if (!loaded) return <div className="text-slate-500">Loading company view…</div>
  if (!cycle) return <div className="text-slate-500">No open budget cycle.</div>

  const rows: GridRow[] = stmt.map((line) => ({
    key: line.key,
    label: line.label,
    display: line.months,
    kind: line.kind === 'account' ? 'input' : line.kind,
    readOnly: true,
    indent: line.indent,
    context: [ctx25.get(line.key) ?? null, ctx26.get(line.key) ?? null],
  }))

  // money columns show a rand total; pct columns show num/den as a percentage
  // (weighted correctly on the Total row: Σnum / Σden, not an average of ratios)
  type Col = { label: string } & ({ money: string } | { num: string; den: string })
  const columns: Col[] = [
    { label: 'Sales', money: 't_sales' },
    { label: 'Gross Profit', money: 't_gp' },
    { label: 'GP %', num: 't_gp', den: 't_sales' },
    { label: 'EBITDA', money: 't_ebitda' },
    { label: 'EBITDA after HO', money: 't_ebitda_ho' },
    { label: 'EBITDA after HO %', num: 't_ebitda_ho', den: 't_sales' },
    { label: 'PBT', money: 't_pbt' },
  ]
  const cell = (t: Map<string, number> | undefined, c: Col) => {
    const g = (k: string) => t?.get(k) ?? 0
    if ('money' in c) return fmt(g(c.money))
    const den = g(c.den)
    return fmtPct(den ? g(c.num) / den : 0)
  }
  // subtotal/total over any list of cost centres (money = Σ, pct = Σnum/Σden)
  const sumCell = (ccList: typeof includedCcs, c: Col) => {
    const sum = (k: string) => ccList.reduce((s, cc) => s + (perCcTotals.get(cc.id)?.get(k) ?? 0), 0)
    if ('money' in c) return fmt(sum(c.money))
    const den = sum(c.den)
    return fmtPct(den ? sum(c.num) / den : 0)
  }

  // group the included cost centres into the business verticals
  const groups = VERTICALS
    .map((v) => ({ label: v.label, ccs: includedCcs.filter((cc) => v.codes.includes(cc.code)) }))
    .filter((g) => g.ccs.length)
  const placed = new Set(groups.flatMap((g) => g.ccs.map((cc) => cc.id)))
  const other = includedCcs.filter((cc) => !placed.has(cc.id))
  if (other.length) groups.push({ label: 'Other', ccs: other })
  const nCols = 2 + columns.length

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-sky-950">Company View — {cycle.name}</h1>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
          className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
        >
          <option value="all">All cost centres</option>
          <option value="submitted">Submitted + approved only</option>
          <option value="approved">Approved only</option>
        </select>
        <span className="text-sm text-slate-500">{includedCcs.length} cost centres included</span>
      </div>

      <div className="overflow-auto rounded-lg border border-slate-300 bg-white">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-sky-950 text-white">
              <th className="px-2 py-1.5 text-left font-medium">Cost centre</th>
              <th className="px-2 py-1.5 text-left font-medium">Status</th>
              {columns.map((c) => (
                <th key={c.label} className="px-2 py-1.5 text-right font-medium">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.label}>
                <tr className="border-t border-slate-200 bg-sky-100/70 text-sky-900">
                  <td colSpan={nCols} className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide">{g.label}</td>
                </tr>
                {g.ccs.map((cc) => {
                  const t = perCcTotals.get(cc.id)
                  return (
                    <tr key={cc.id} className="border-t border-slate-100 hover:bg-sky-50">
                      <td className="px-2 py-1 pl-4">
                        <Link to={`/cc/${cc.code}`} className="font-medium text-sky-700 hover:underline">
                          {cc.code} — {cc.name}
                        </Link>
                      </td>
                      <td className="px-2 py-1"><StatusBadge status={statusOf(cc.id)} /></td>
                      {columns.map((c) => (
                        <td key={c.label} className="num-cell px-2 py-1">{cell(t, c)}</td>
                      ))}
                    </tr>
                  )
                })}
                <tr className="border-t border-slate-200 bg-slate-50 font-semibold text-slate-700">
                  <td colSpan={2} className="px-2 py-1">Total {g.label}</td>
                  {columns.map((c) => (
                    <td key={c.label} className="num-cell px-2 py-1">{sumCell(g.ccs, c)}</td>
                  ))}
                </tr>
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-300 bg-sky-50 font-semibold text-sky-950">
              <td colSpan={2} className="px-2 py-1.5">Total — all cost centres</td>
              {columns.map((c) => (
                <td key={c.label} className="num-cell px-2 py-1.5">{sumCell(includedCcs, c)}</td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      <MonthGrid
        rows={rows}
        monthHeaders={monthLabels(cycle.fy_year)}
        contextHeaders={['FY25 Act', 'FY26 Act']}
        labelHeader="Consolidated Income Statement (R)"
        readOnly
      />
    </div>
  )
}
