import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import MonthGrid, { type GridRow } from '../components/MonthGrid'
import StatusBadge from '../components/StatusBadge'
import { computeStatement } from '../lib/statement'
import { monthLabels } from '../lib/months'
import { fmt } from '../lib/format'
import { supabase } from '../lib/supabase'
import { monthsOf } from '../hooks/useBudget'
import { useAuth } from '../context/AuthContext'
import type { Account, Approval, ApprovalStatus, Cycle } from '../lib/types'

type CcValues = Map<number, Map<number, number[]>> // cc -> account -> months

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

  useEffect(() => {
    void (async () => {
      const cyc = (await supabase.from('budget_cycles').select('*').eq('status', 'open')
        .order('fy_year', { ascending: false }).limit(1).maybeSingle()).data as Cycle | null
      if (!cyc) { setLoaded(true); return }
      setCycle(cyc)
      const [accRes, viewRes, actRes, apprRes] = await Promise.all([
        supabase.from('budget_accounts').select('*').order('sort_order'),
        supabase.from('budget_statement_lines').select('*').eq('cycle_id', cyc.id),
        supabase.from('budget_actuals').select('*'),
        supabase.from('budget_approvals').select('*').eq('cycle_id', cyc.id),
      ])
      setAccounts((accRes.data as Account[]) ?? [])
      const byCc: CcValues = new Map()
      for (const r of viewRes.data ?? []) {
        const cc = r.cost_centre_id as number
        if (!byCc.has(cc)) byCc.set(cc, new Map())
        byCc.get(cc)!.set(r.account_id as number, monthsOf(r))
      }
      setBudgetByCc(byCc)
      // company-wide actuals summed per FY per account
      const act = new Map<number, Map<number, number[]>>()
      for (const r of actRes.data ?? []) {
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
        if (filter === 'all') return true
        const s = statusOf(cc.id)
        return filter === 'approved' ? s === 'approved' : s === 'submitted' || s === 'approved'
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [costCentres, filter, approvals],
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

  const keyLines: [string, string][] = [
    ['t_sales', 'Sales'], ['t_gp', 'Gross Profit'], ['t_ebitda', 'EBITDA'],
    ['t_ebitda_ho', 'EBITDA after HO'], ['t_pbt', 'PBT'],
  ]

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
              {keyLines.map(([k, label]) => (
                <th key={k} className="px-2 py-1.5 text-right font-medium">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {includedCcs.map((cc) => {
              const t = perCcTotals.get(cc.id)
              return (
                <tr key={cc.id} className="border-t border-slate-100 hover:bg-sky-50">
                  <td className="px-2 py-1">
                    <Link to={`/cc/${cc.code}`} className="font-medium text-sky-700 hover:underline">
                      {cc.code} — {cc.name}
                    </Link>
                  </td>
                  <td className="px-2 py-1"><StatusBadge status={statusOf(cc.id)} /></td>
                  {keyLines.map(([k]) => (
                    <td key={k} className="num-cell px-2 py-1">{fmt(t?.get(k) ?? 0)}</td>
                  ))}
                </tr>
              )
            })}
          </tbody>
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
