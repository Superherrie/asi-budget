import { useEffect, useMemo, useState } from 'react'
import { computeStatement } from '../../lib/statement'
import { fmt, fmtPct } from '../../lib/format'
import { monthLabel } from '../../lib/months'
import { supabase } from '../../lib/supabase'
import { monthsOf, type BudgetCtx } from '../../hooks/useBudget'
import type { Account } from '../../lib/types'

const Z12 = () => Array(12).fill(0) as number[]
const ytd = (m: number[], n: number) => m.slice(0, n).reduce((s, v) => s + v, 0)

// which controllable-cost bucket an account belongs to (cuts across P&L sections)
function categoryOf(a: Account): string {
  if (a.section === 'sales') return 'Revenue'
  switch (a.input_type) {
    case 'salary': return 'Payroll'
    case 'cellphone': return 'Cell phones'
    case 'vehicle': return 'Fleet (M/V)'
    case 'subcontractor': return 'Subcontractors'
    case 'training': return 'Training'
  }
  if (a.section === 'cos_material') return 'Materials'
  return 'Other overheads'
}
const CAT_ORDER = ['Revenue', 'Payroll', 'Fleet (M/V)', 'Cell phones', 'Materials', 'Subcontractors', 'Training', 'Other overheads']

// statement line values (single-slot) keyed by line key
function linesBy(accounts: Account[], perAccount: Map<number, number>) {
  const values = new Map<number, number[]>()
  for (const [id, v] of perAccount) values.set(id, [v, ...Array(11).fill(0)])
  return computeStatement(accounts, values)
}

export default function VsBudgetTab({ budget }: { budget: BudgetCtx }) {
  const { cycle, cc, accounts, actuals } = budget
  const [budgetByAcc, setBudgetByAcc] = useState<Map<number, number[]>>(new Map())
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!cycle || !cc) return
    let cancelled = false
    void supabase.from('budget_statement_lines').select('*').eq('cycle_id', cycle.id).eq('cost_centre_id', cc.id)
      .then(({ data }) => {
        if (cancelled) return
        const m = new Map<number, number[]>()
        for (const r of (data ?? []) as Record<string, unknown>[]) m.set(r.account_id as number, monthsOf(r))
        setBudgetByAcc(m)
        setLoaded(true)
      })
    return () => { cancelled = true }
  }, [cycle, cc])

  const actualByAcc = useMemo(() => actuals.get(cycle?.fy_year ?? 2027) ?? new Map<number, number[]>(), [actuals, cycle])
  // posted months this FY = highest month index with any actual
  const n = useMemo(() => {
    let mx = 0
    for (const m of actualByAcc.values()) for (let i = 11; i >= 0; i--) if (m[i] !== 0) { mx = Math.max(mx, i + 1); break }
    return mx
  }, [actualByAcc])

  if (!cycle || !cc) return null
  if (!loaded) return <div className="text-slate-500">Loading vs-budget…</div>
  if (n === 0) return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
      No actuals have been posted for {cycle.name} yet — nothing to compare against budget.
    </div>
  )

  const periodLabel = `${monthLabel(cycle.fy_year, 0)} – ${monthLabel(cycle.fy_year, n - 1)} (${n} month${n > 1 ? 's' : ''})`

  // YTD + full-year budget/actual per account
  const bYtd = new Map<number, number>(), aYtd = new Map<number, number>(), bFull = new Map<number, number>()
  for (const a of accounts) {
    const bm = budgetByAcc.get(a.id) ?? Z12()
    const am = actualByAcc.get(a.id) ?? Z12()
    bYtd.set(a.id, ytd(bm, n)); aYtd.set(a.id, ytd(am, n)); bFull.set(a.id, bm.reduce((s, v) => s + v, 0))
  }

  // category summary
  const catMap = new Map<string, { budget: number; actual: number }>()
  for (const a of accounts) {
    const c = categoryOf(a)
    const e = catMap.get(c) ?? { budget: 0, actual: 0 }
    e.budget += bYtd.get(a.id) ?? 0; e.actual += aYtd.get(a.id) ?? 0
    catMap.set(c, e)
  }
  const cats = CAT_ORDER.filter((c) => catMap.has(c)).map((c) => ({ label: c, ...catMap.get(c)! }))

  // income statement vs budget
  const bLines = linesBy(accounts, bYtd)
  const aByKey = new Map(linesBy(accounts, aYtd).map((l) => [l.key, l.months[0]]))
  const bFullByKey = new Map(linesBy(accounts, bFull).map((l) => [l.key, l.months[0]]))

  const tone = (v: number) => v > 0.0005 ? 'text-green-700' : v < -0.0005 ? 'text-red-600' : 'text-slate-400'
  const varPct = (a: number, b: number) => (b ? `${(a - b) >= 0 ? '+' : ''}${(((a - b) / Math.abs(b)) * 100).toFixed(0)}%` : '–')

  const CatRow = ({ label, b, a, head }: { label: string; b: number; a: number; head?: boolean }) => {
    const v = a - b
    return (
      <tr className={head ? 'bg-brand-navy font-semibold text-white' : 'border-t border-slate-100'}>
        <td className="px-2 py-1.5">{label}</td>
        <td className="num-cell px-2 py-1.5">{fmt(b)}</td>
        <td className="num-cell px-2 py-1.5">{fmt(a)}</td>
        <td className={`num-cell px-2 py-1.5 ${head ? 'text-sky-200' : tone(v)}`}>{fmt(v)}</td>
        <td className={`num-cell px-2 py-1.5 ${head ? 'text-sky-200' : tone(v)}`}>{varPct(a, b)}</td>
      </tr>
    )
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-500">
        Actuals vs budget for <b>{cc.name}</b>, year-to-date <b>{periodLabel}</b>. A positive variance is favourable
        (more revenue, or lower cost). Payroll, fleet and cell-phone actuals come through from the group ledger.
      </p>

      <div>
        <h3 className="mb-1 text-sm font-semibold text-sky-950">By category — YTD</h3>
        <div className="overflow-auto rounded-lg border border-slate-300 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-sky-50 text-sky-900">
                <th className="px-2 py-1.5 text-left font-semibold">Category</th>
                <th className="px-2 py-1.5 text-right font-semibold">Budget YTD</th>
                <th className="px-2 py-1.5 text-right font-semibold">Actual YTD</th>
                <th className="px-2 py-1.5 text-right font-semibold">Variance</th>
                <th className="px-2 py-1.5 text-right font-semibold">Var %</th>
              </tr>
            </thead>
            <tbody>
              {cats.map((c) => <CatRow key={c.label} label={c.label} b={c.budget} a={c.actual} />)}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="mb-1 text-sm font-semibold text-sky-950">Income statement vs budget — YTD</h3>
        <div className="overflow-auto rounded-lg border border-slate-300 bg-white">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-brand-navy text-white">
                <th className="px-2 py-1.5 text-left font-medium">Line</th>
                <th className="px-2 py-1.5 text-right font-medium">FY Budget</th>
                <th className="px-2 py-1.5 text-right font-medium">Budget YTD</th>
                <th className="px-2 py-1.5 text-right font-medium">Actual YTD</th>
                <th className="px-2 py-1.5 text-right font-medium">Variance</th>
                <th className="px-2 py-1.5 text-right font-medium">Var %</th>
              </tr>
            </thead>
            <tbody>
              {bLines.map((l) => {
                if (l.kind === 'section') {
                  return <tr key={l.key} className="bg-sky-50 text-sky-900"><td colSpan={6} className={`px-2 py-1 font-semibold ${l.indent ? 'pl-4' : ''}`}>{l.label}</td></tr>
                }
                const isPct = l.kind === 'pct'
                const bV = l.months[0], aV = aByKey.get(l.key) ?? 0, fy = bFullByKey.get(l.key) ?? 0
                const strong = l.kind === 'computed' || l.kind === 'subtotal'
                if (isPct) {
                  const pp = (aV - bV) * 100
                  return (
                    <tr key={l.key} className="border-t border-slate-100 text-slate-500">
                      <td className="px-2 py-1">{l.label}</td>
                      <td className="num-cell px-2 py-1">{fmtPct(fy)}</td>
                      <td className="num-cell px-2 py-1">{fmtPct(bV)}</td>
                      <td className="num-cell px-2 py-1">{fmtPct(aV)}</td>
                      <td className={`num-cell px-2 py-1 ${tone(aV - bV)}`}>{`${pp >= 0 ? '+' : ''}${pp.toFixed(1)} pp`}</td>
                      <td className="num-cell px-2 py-1" />
                    </tr>
                  )
                }
                const v = aV - bV
                return (
                  <tr key={l.key} className={`border-t border-slate-100 ${strong ? 'font-semibold text-sky-950' : ''}`}>
                    <td className={`px-2 py-1 ${l.indent >= 2 ? 'pl-6' : l.indent === 1 ? 'pl-4' : ''}`}>{l.label}</td>
                    <td className="num-cell px-2 py-1 text-slate-400">{fmt(fy)}</td>
                    <td className="num-cell px-2 py-1">{fmt(bV)}</td>
                    <td className="num-cell px-2 py-1">{fmt(aV)}</td>
                    <td className={`num-cell px-2 py-1 ${tone(v)}`}>{fmt(v)}</td>
                    <td className={`num-cell px-2 py-1 ${tone(v)}`}>{varPct(aV, bV)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
